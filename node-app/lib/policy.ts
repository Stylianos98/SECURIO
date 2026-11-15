import type { Actor } from './auth';

export class RequestError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

export function requireRole(actor: Actor, ...roles: Actor['role'][]) {
  if (!roles.includes(actor.role)) throw new RequestError(403, 'Access denied.');
}

export function siteScope(actor: Actor) {
  return actor.role === 'COMPANY_ADMIN' ? {} : { siteId: { in: actor.sites } };
}

export function canAccessSite(actor: Actor, siteId: string) {
  return actor.role === 'COMPANY_ADMIN' || actor.sites.includes(siteId);
}

export function coverage(synced: Date | null, active: boolean, now = Date.now()) {
  if (!synced || synced.getTime() < now - 12 * 3600_000) return 'UNKNOWN';
  return active ? 'ACTIVE' : 'NO_COVERAGE';
}

export const jobTransitions = {
  start: { from: 'SCHEDULED', to: 'IN_PROGRESS' },
  done: { from: 'IN_PROGRESS', to: 'COMPLETED' },
  block: { from: 'IN_PROGRESS', to: 'BLOCKED' },
} as const;
