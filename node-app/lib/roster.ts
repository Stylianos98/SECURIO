import { parse } from 'csv-parse/sync';
import { z } from 'zod';
import { db } from './db';
import { requireRole, RequestError } from './policy';
import type { Actor } from './auth';

const columns = ['id', 'siteId', 'guardId', 'assignmentRef', 'title', 'dutyStart', 'dutyEnd', 'dueAt', 'cancelled'] as const;
const date = z.iso.datetime({ offset: true }).transform(value => new Date(value));
const id = z.string().regex(/^[a-zA-Z0-9_.-]{1,100}$/);
const rowSchema = z.object({
  id, siteId: id, guardId: id, assignmentRef: id, title: z.string().trim().min(1).max(160),
  dutyStart: date, dutyEnd: date, dueAt: date,
  cancelled: z.enum(['true', 'false', '']).transform(value => value === 'true'),
}).refine(row => row.dutyStart < row.dutyEnd && row.dueAt >= row.dutyStart && row.dueAt <= row.dutyEnd);

export function parseRoster(csv: string, mapping: Partial<Record<typeof columns[number], string>> = {}) {
  const headers = columns.map(column => mapping[column] ?? column);
  if (new Set(headers).size !== columns.length) throw new RequestError(400, 'Each mapped header must be unique.');
  try {
    const rows = parse(csv, {
      bom: true, skip_empty_lines: true, max_record_size: 8192,
      columns: (incoming: string[]) => {
        if (new Set(incoming).size !== incoming.length || !headers.every(header => incoming.includes(header))) {
          throw new Error('Invalid headers');
        }
        return incoming.map(header => columns[headers.indexOf(header)] ?? false);
      },
    }) as unknown[];
    if (!rows.length || rows.length > 2000) throw new Error('Invalid row count');
    const parsed = rows.map(row => rowSchema.parse(row));
    if (new Set(parsed.map(row => row.id)).size !== parsed.length) throw new Error('Duplicate jobs');
    return parsed;
  } catch {
    throw new RequestError(400, 'Invalid roster CSV. Check column mapping, unique job IDs and duty timestamps.');
  }
}

export async function importRoster(actor: Actor, csv: string, mapping?: Parameters<typeof parseRoster>[1]) {
  requireRole(actor, 'COMPANY_ADMIN');
  const rows = parseRoster(csv, mapping);
  const { tenantId } = actor;
  await db.$transaction(async tx => {
    await tx.tenant.update({ where: { id: tenantId }, data: { rosterSyncedAt: new Date() } });
    for (const row of [...rows].sort((a, b) => a.id.localeCompare(b.id))) {
      await tx.$queryRaw`SELECT 1::int FROM pg_advisory_xact_lock(hashtextextended(${JSON.stringify([tenantId, "job", row.id])}, 0))`;
      const guard = await tx.user.findUnique({ where: { tenantId_id: { tenantId, id: row.guardId }, role: 'GUARD', enabled: true } });
      const site = await tx.site.findUnique({ where: { tenantId_id: { tenantId, id: row.siteId } } });
      if (!guard || !site) throw new RequestError(400, 'Roster references an unknown guard or site.');
      const current = await tx.job.findUnique({ where: { tenantId_id: { tenantId, id: row.id } } });
      if (current && current.status !== 'SCHEDULED' && (current.guardId !== row.guardId || current.siteId !== row.siteId)) {
        throw new RequestError(409, 'An executed job cannot change guard or site. Cancel it and use a new job ID.');
      }
      await tx.job.upsert({ where: { tenantId_id: { tenantId, id: row.id } }, create: { tenantId, ...row }, update: row });
    }
    await tx.audit.create({ data: { tenantId, actorId: actor.id, action: 'roster.import', entityId: tenantId } });
  }, { timeout: 30_000 });
  return rows.length;
}
