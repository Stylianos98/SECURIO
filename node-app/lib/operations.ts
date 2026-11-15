import { createHash } from 'node:crypto';
import { db } from './db';
import type { Actor } from './auth';
import { canAccessSite, coverage, jobTransitions, requireRole, RequestError, siteScope } from './policy';

export async function snapshot(actor: Actor) {
  const { tenantId } = actor;
  const now = new Date();
  if (actor.role === 'GUARD') {
    const jobs = await db.job.findMany({
      where: { tenantId, guardId: actor.id, cancelled: false, dutyStart: { lte: now }, dutyEnd: { gt: now } },
      select: { id: true, siteId: true, site: { select: { name: true } }, title: true, status: true, dueAt: true },
      orderBy: { dueAt: 'asc' },
    });
    const sos = await db.sos.findFirst({ where: { tenantId, guardId: actor.id }, select: { status: true }, orderBy: { createdAt: 'desc' } });
    const queueScope = createHash('sha256').update(JSON.stringify([tenantId, actor.id])).digest('hex');
    return { role: 'GUARD' as const, jobs, sos, queueScope };
  }
  const scope = siteScope(actor);
  const sites = await db.site.findMany({ where: { tenantId, ...(actor.role === 'COMPANY_ADMIN' ? {} : { id: { in: actor.sites } }) }, select: { id: true, name: true, phone: true }, orderBy: { name: 'asc' } });
  const config = await db.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { name: true, rosterSyncedAt: true, overdueMinutes: true } });
  if (actor.role === 'CLIENT') {
    const properties = await Promise.all(sites.map(async site => {
      const active = await db.job.findFirst({
        where: { tenantId, siteId: site.id, cancelled: false, dutyStart: { lte: now }, dutyEnd: { gt: now }, guard: { enabled: true } },
        select: { id: true },
      });
      const [incidents, messages] = await Promise.all([
        db.incident.findMany({
          where: { tenantId, siteId: site.id, deletedAt: null, clientSummary: { not: null } },
          select: { id: true, clientSummary: true }, orderBy: { createdAt: 'desc' }, take: 30,
        }),
        db.message.findMany({
          where: { tenantId, siteId: site.id, clientId: actor.id },
          select: { id: true, fromSecurity: true, body: true, createdAt: true }, orderBy: { createdAt: 'desc' }, take: 50,
        }),
      ]);
      return { ...site, coverage: coverage(config.rosterSyncedAt, Boolean(active)), incidents, messages };
    }));
    return { role: 'CLIENT' as const, sites: properties };
  }
  const where = { tenantId, ...scope };
  const [jobs, incidents, sos, messages, audit] = await Promise.all([
    db.job.findMany({ where: { ...where, cancelled: false, dutyEnd: { gt: now }, dutyStart: { lte: now } }, select: { id: true, title: true, status: true, dueAt: true, siteId: true, guard: { select: { name: true } } }, orderBy: { dueAt: 'asc' }, take: 250 }),
    db.incident.findMany({ where: { ...where, deletedAt: null }, orderBy: { createdAt: 'desc' }, take: 100 }),
    db.sos.findMany({ where: { ...where, status: { not: 'RESOLVED' } }, orderBy: { createdAt: 'desc' } }),
    db.message.findMany({ where: where, orderBy: { createdAt: 'desc' }, take: 100 }),
    db.audit.findMany({ where, select: { action: true, entityId: true, occurredAt: true }, orderBy: { occurredAt: 'desc' }, take: 50 }),
  ]);
  const users = actor.role === 'COMPANY_ADMIN' ? await db.user.findMany({
    where: { tenantId }, select: { id: true, name: true, email: true, role: true, enabled: true, grants: { select: { siteId: true } } },
  }) : [];
  return { role: actor.role, sites, config, jobs: jobs.map(job => ({ ...job, overdue: job.status !== 'COMPLETED' && job.dueAt.getTime() + config.overdueMinutes * 60_000 < now.getTime() })), incidents, sos, messages, audit, users };
}

export type Operation =
  | { kind: 'job'; id: string; transition: keyof typeof jobTransitions }
  | { kind: 'incident'; siteId: string; category: string; description: string }
  | { kind: 'sos'; siteId: string }
  | { kind: 'respond'; id: string; transition: 'ACKNOWLEDGED' | 'RESOLVED' }
  | { kind: 'review'; id: string; summary?: string | null; advance?: boolean; reason?: string }
  | { kind: 'message'; siteId: string; clientId?: string; body: string };

export async function mutate(actor: Actor, operationId: string, input: Operation) {
  const { tenantId, id: actorId } = actor;
  return db.$transaction(async tx => {
    // Serialize retries for one actor and operation ID across server replicas.
    await tx.$queryRaw`SELECT 1::int FROM pg_advisory_xact_lock(hashtextextended(${JSON.stringify([tenantId, actorId, operationId])}, 0))`;
    const key = { tenantId, actorId, operationId };
    const fingerprint = createHash('sha256').update(JSON.stringify(input)).digest('hex');
    const prior = await tx.receipt.findUnique({ where: { tenantId_actorId_operationId: key } });
    if (prior) {
      if (prior.kind !== fingerprint) throw new RequestError(409, 'Operation ID already used.');
      return { id: prior.resourceId };
    }
    const now = new Date();
    const activeDuty = { tenantId, guardId: actorId, cancelled: false, dutyStart: { lte: now }, dutyEnd: { gt: now } };
    const missing = () => new RequestError(404, 'Item unavailable.');
    let id: string;
    let siteId: string;
    let action: string = input.kind;
    if (input.kind === 'job') {
      requireRole(actor, 'GUARD');
      await tx.$queryRaw`SELECT 1::int FROM pg_advisory_xact_lock(hashtextextended(${JSON.stringify([tenantId, "job", input.id])}, 0))`;
      const job = await tx.job.findFirst({ where: { ...activeDuty, id: input.id } });
      if (!job) throw missing();
      const transition = jobTransitions[input.transition];
      const changed = await tx.job.updateMany({
        where: { ...activeDuty, id: job.id, status: transition.from },
        data: { status: transition.to, ...(input.transition === 'start' ? { startedAt: now } : input.transition === 'done' ? { doneAt: now } : {}) },
      });
      if (!changed.count) throw new RequestError(409, 'Job state has changed.');
      ({ id, siteId } = job);
      action = 'job.' + input.transition;
    } else if (input.kind === 'incident' || input.kind === 'sos') {
      requireRole(actor, 'GUARD');
      siteId = input.siteId;
      if (!await tx.job.findFirst({ where: { ...activeDuty, siteId }, select: { id: true } })) throw missing();
      const base = { tenantId, siteId, guardId: actorId };
      if (input.kind === 'incident') {
        ({ id } = await tx.incident.create({ data: { ...base, category: input.category, description: input.description } }));
      } else {
        ({ id } = await tx.sos.create({ data: base }));
      }
    } else if (input.kind === 'respond') {
      requireRole(actor, 'SUPERVISOR', 'COMPANY_ADMIN');
      const event = await tx.sos.findFirst({ where: { tenantId, id: input.id, ...siteScope(actor) } });
      if (!event) throw missing();
      ({ id, siteId } = event);
      const expected = input.transition === 'ACKNOWLEDGED' ? 'DELIVERED' : 'ACKNOWLEDGED';
      const changed = await tx.sos.updateMany({ where: { tenantId, id, status: expected }, data: { status: input.transition } });
      if (!changed.count) throw new RequestError(409, 'SOS state has changed.');
      action = 'sos.' + input.transition.toLowerCase();
    } else if (input.kind === 'review') {
      requireRole(actor, 'SUPERVISOR', 'COMPANY_ADMIN');
      const incident = await tx.incident.findFirst({ where: { tenantId, id: input.id, deletedAt: null, ...siteScope(actor) } });
      if (!incident) throw missing();
      ({ id, siteId } = incident);
      const lifecycle = ['OPEN', 'ACKNOWLEDGED', 'UNDER_REVIEW', 'RESOLVED', 'CLOSED'];
      if (input.reason) requireRole(actor, 'COMPANY_ADMIN');
      const changed = await tx.incident.updateMany({
        where: { tenantId, id, deletedAt: null, status: incident.status },
        data: {
          ...(input.advance ? { status: lifecycle[lifecycle.indexOf(incident.status) + 1] ?? incident.status } : {}),
          ...(input.summary !== undefined ? { clientSummary: input.summary } : {}),
          ...(input.reason ? { deletedAt: now, clientSummary: null } : {}),
        },
      });
      if (!changed.count) throw new RequestError(409, 'Incident state has changed.');
      action = input.reason ? 'incident.deleted' : input.advance ? 'incident.advanced' : 'incident.visibility';
    } else {
      requireRole(actor, 'CLIENT', 'SUPERVISOR', 'COMPANY_ADMIN');
      siteId = input.siteId;
      if (!canAccessSite(actor, siteId)) throw missing();
      const clientId = actor.role === 'CLIENT' ? actorId : input.clientId;
      if (!clientId || !await tx.grant.findFirst({ where: { tenantId, siteId, userId: clientId, user: { role: 'CLIENT', enabled: true } } })) throw missing();
      ({ id } = await tx.message.create({ data: { tenantId, siteId, clientId, body: input.body, fromSecurity: actor.role !== 'CLIENT' } }));
    }
    await tx.audit.create({ data: { tenantId, actorId, siteId, action, entityId: id, reason: input.kind === 'review' ? input.reason : undefined } });
    await tx.receipt.create({ data: { ...key, kind: fingerprint, resourceId: id } });
    return { id };
  });
}
