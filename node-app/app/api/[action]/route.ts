import { z } from 'zod';
import { actor, login, logout } from '../../../lib/auth';
import { mutate, snapshot } from '../../../lib/operations';
import { importRoster } from '../../../lib/roster';
import { requireRole, RequestError } from '../../../lib/policy';
import { db } from '../../../lib/db';

const id = z.string().min(1).max(100);
const text = (max: number) => z.string().trim().min(1).max(max);
const actionInput = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('job'), id, transition: z.enum(['start', 'done', 'block']) }),
  z.object({ kind: z.literal('incident'), siteId: id, category: text(80), description: text(4000) }),
  z.object({ kind: z.literal('sos'), siteId: id }),
  z.object({ kind: z.literal('respond'), id, transition: z.enum(['ACKNOWLEDGED', 'RESOLVED']) }),
  z.object({ kind: z.literal('review'), id, summary: text(1600).nullable().optional(), advance: z.boolean().optional(), reason: text(400).optional() }),
  z.object({ kind: z.literal('message'), siteId: id, clientId: id.optional(), body: text(2000) }),
]);
type Context = { params: Promise<{ action: string }> };
const headers = { 'Cache-Control': 'no-store' };
const json = (body: unknown, status = 200) => Response.json(body, { status, headers });

function failure(error: unknown) {
  if (error instanceof RequestError) return json({ error: error.message }, error.status);
  if (error instanceof z.ZodError || error instanceof SyntaxError) return json({ error: 'Invalid request.' }, 400);
  console.error('SECURIO request failed', error instanceof Error ? error.name : 'UnknownError');
  return json({ error: 'Service unavailable.' }, 500);
}

export async function GET(_: Request, context: Context) {
  try {
    const { action } = await context.params;
    if (action !== 'snapshot' && action !== 'report') return json({ error: 'Not found.' }, 404);
    const user = await actor();
    if (!user) return json({ error: 'Sign in required.' }, 401);
    if (action === 'snapshot') return json(await snapshot(user));
    requireRole(user, 'COMPANY_ADMIN', 'SUPERVISOR');
    const jobs = await db.job.findMany({
      where: { tenantId: user.tenantId, ...(user.role === 'SUPERVISOR' ? { siteId: { in: user.sites } } : {}) },
      select: { title: true, site: { select: { name: true } }, status: true, dueAt: true, cancelled: true },
      orderBy: [{ dueAt: 'desc' }, { id: 'asc' }], take: 2000,
    });
    const cell = (value: string) => '"' + (/^[\s]*[=+@-]|^[\t\r\n]/.test(value) ? "'" : '') + value.replaceAll('"', '""') + '"';
    const csv = [['Site', 'Job', 'Status', 'Due (UTC)', 'Cancelled'], ...jobs.map(job => [job.site.name, job.title, job.status, job.dueAt.toISOString(), String(job.cancelled)])].map(row => row.map(cell).join(',')).join('\r\n');
    return new Response(csv, { headers: { ...headers, 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="securio-jobs.csv"' } });
  } catch (error) { return failure(error); }
}

async function readBody(request: Request) {
  if (!request.headers.get('content-type')?.startsWith('application/json')) throw new RequestError(415, 'JSON required.');
  const reader = request.body?.getReader();
  if (!reader) throw new RequestError(400, 'Body required.');
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > 512_000) {
      await reader.cancel();
      throw new RequestError(413, 'Request too large.');
    }
    chunks.push(value);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

export async function POST(request: Request, context: Context) {
  try {
    const origin = process.env.APP_ORIGIN;
    if (!origin || request.headers.get('origin') !== origin) throw new RequestError(403, 'Invalid origin.');
    const { action } = await context.params;
    if (action === 'logout') {
      await logout();
      return json({ ok: true });
    }
    const input = await readBody(request);
    if (action === 'login') {
      const credentials = z.object({ email: z.email().max(254).transform(value => value.toLowerCase()), password: z.string().min(1).max(256), otp: z.string().regex(/^\d{6}$/).optional() }).parse(input);
      const role = await login(credentials.email, credentials.password, credentials.otp);
      return role ? json({ role }) : json({ error: 'Sign-in failed. Check credentials or try again later.' }, 401);
    }
    const user = await actor();
    if (!user) return json({ error: 'Sign in required.' }, 401);
    if (action === 'operation') {
      const { operationId, payload } = z.object({ operationId: z.uuid(), payload: actionInput }).parse(input);
      return json(await mutate(user, operationId, payload));
    }
    if (action === 'roster') {
      const { csv, mapping } = z.object({ csv: text(450_000), mapping: z.record(z.string(), text(100)).optional() }).parse(input);
      return json({ imported: await importRoster(user, csv, mapping) });
    }
    if (action === 'settings') {
      requireRole(user, 'COMPANY_ADMIN');
      const settings = z.object({ name: text(100), overdueMinutes: z.coerce.number().int().min(1).max(1440) }).parse(input);
      await db.$transaction([
        db.tenant.update({ where: { id: user.tenantId }, data: settings }),
        db.audit.create({ data: { tenantId: user.tenantId, actorId: user.id, action: 'company.settings', entityId: user.tenantId } }),
      ]);
      return json({ ok: true });
    }
    if (action === 'site') {
      requireRole(user, 'COMPANY_ADMIN');
      const site = z.object({ id: id.regex(/^[a-zA-Z0-9_.-]+$/), name: text(160), phone: z.string().regex(/^\+?[0-9 ()-]{5,24}$/).nullable() }).parse(input);
      await db.$transaction([
        db.site.upsert({ where: { tenantId_id: { tenantId: user.tenantId, id: site.id } }, create: { tenantId: user.tenantId, ...site }, update: { name: site.name, phone: site.phone } }),
        db.audit.create({ data: { tenantId: user.tenantId, actorId: user.id, siteId: site.id, action: 'site.saved', entityId: site.id } }),
      ]);
      return json({ ok: true });
    }
    if (action === 'account-status') {
      requireRole(user, 'COMPANY_ADMIN');
      const change = z.object({ userId: id, enabled: z.boolean() }).parse(input);
      await db.$transaction(async tx => {
        const changed = await tx.user.updateMany({
          where: { tenantId: user.tenantId, id: change.userId, role: { not: 'COMPANY_ADMIN' } },
          data: { enabled: change.enabled },
        });
        if (!changed.count) throw new RequestError(404, 'Account unavailable.');
        if (!change.enabled) await tx.session.deleteMany({ where: { tenantId: user.tenantId, userId: change.userId } });
        await tx.audit.create({ data: { tenantId: user.tenantId, actorId: user.id, action: change.enabled ? 'account.enabled' : 'account.disabled', entityId: change.userId } });
      });
      return json({ ok: true });
    }
    if (action === 'grant') {
      requireRole(user, 'COMPANY_ADMIN');
      const grant = z.object({ siteId: id, userId: id, enabled: z.boolean() }).parse(input);
      const key = { tenantId: user.tenantId, siteId: grant.siteId, userId: grant.userId };
      await db.$transaction(async tx => {
        const target = await tx.user.findUnique({ where: { tenantId_id: { tenantId: key.tenantId, id: key.userId }, role: { in: ['CLIENT', 'SUPERVISOR'] } } });
        const site = await tx.site.findUnique({ where: { tenantId_id: { tenantId: key.tenantId, id: key.siteId } } });
        if (!target || !site) throw new RequestError(404, 'User or site unavailable.');
        if (grant.enabled) await tx.grant.upsert({ where: { tenantId_siteId_userId: key }, create: key, update: {} });
        else await tx.grant.deleteMany({ where: key });
        await tx.audit.create({ data: { tenantId: key.tenantId, actorId: user.id, siteId: key.siteId, action: grant.enabled ? 'grant.added' : 'grant.revoked', entityId: key.userId } });
      });
      return json({ ok: true });
    }
    return json({ error: 'Not found.' }, 404);
  } catch (error) { return failure(error); }
}
