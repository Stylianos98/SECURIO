import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { createCipheriv, createHmac, randomBytes, randomUUID } from 'node:crypto';
import { appendFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync, spawn } from 'node:child_process';
import EmbeddedPostgres from 'embedded-postgres';
import type { Actor } from '../lib/auth';
import { coverage } from '../lib/policy';

let database: typeof import('../lib/db').db;
let operations: typeof import('../lib/operations');
let roster: typeof import('../lib/roster');
let server: EmbeddedPostgres | undefined;
let directory: string | undefined;
const tenantId = 'test-a';
const guard: Actor = { tenantId, id: 'guard', role: 'GUARD', sites: [] };
const admin: Actor = { tenantId, id: 'admin', role: 'COMPANY_ADMIN', sites: [] };
const supervisor: Actor = { tenantId, id: 'supervisor', role: 'SUPERVISOR', sites: ['one'] };
const client: Actor = { tenantId, id: 'client', role: 'CLIENT', sites: ['one'] };
const when = (minutes: number) => new Date(Date.now() + minutes * 60_000).toISOString();

before(async () => {
  if (!process.env.TEST_DATABASE_URL) {
    directory = await mkdtemp(join(tmpdir(), 'securio-pg-'));
    const password = randomUUID();
    server = new EmbeddedPostgres({ databaseDir: directory, port: 55432, user: 'securio', password, persistent: false, onLog: message => process.env.TEST_PG_VERBOSE && console.error(message) });
    await server.initialise();
    await appendFile(join(directory, 'postgresql.conf'), "\nunix_socket_directories = ''\nlisten_addresses = '127.0.0.1'\n");
    await server.start();
    process.env.DATABASE_URL = 'postgresql://securio:' + password + '@127.0.0.1:55432/postgres';
  } else process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
  execFileSync(process.execPath, ['node_modules/prisma/build/index.js', 'migrate', 'deploy'], { stdio: 'pipe' });
  ({ db: database } = await import('../lib/db'));
  operations = await import('../lib/operations');
  roster = await import('../lib/roster');
  for (const tenant of ['test-a', 'test-b']) {
    await database.tenant.create({ data: { id: tenant, name: tenant } });
    for (const site of ['one', 'two']) await database.site.create({ data: { tenantId: tenant, id: site, name: 'Site ' + site } });
    for (const account of [guard, admin, supervisor, client, { ...guard, id: 'other' }]) {
      await database.user.create({ data: { tenantId: tenant, id: account.id, email: account.id + '@' + tenant + '.example', name: 'Private staff ' + account.id, role: account.role, passwordHash: 'fixture' } });
    }
    await database.grant.create({ data: { tenantId: tenant, siteId: 'one', userId: 'client' } });
  }
});

after(async () => {
  await database?.$disconnect();
  if (server) await server.stop();
  if (directory) await rm(directory, { recursive: true, force: true });
});

const csv = (job = 'job', cancelled = 'false', site = 'one', user = 'guard') => [
  'id,siteId,guardId,assignmentRef,title,dutyStart,dutyEnd,dueAt,cancelled',
  [job, site, user, 'assignment', 'Internal patrol', when(-90), when(90), when(-30), cancelled].join(','),
].join('\n');

test('CSV imports atomically, preserves execution, supports cancellation and refuses malformed records', async () => {
  assert.equal(await roster.importRoster(admin, csv()), 1);
  await assert.rejects(roster.importRoster(admin, csv('foreign', 'false', 'one', 'missing')), { status: 400 });
  await assert.rejects(roster.importRoster(client, csv()), { status: 403 });
  assert.throws(() => roster.parseRoster('garbage'), { status: 400 });
  await roster.importRoster(admin, csv('cancelled', 'false', 'two'));
  await roster.importRoster(admin, csv('cancelled', 'true', 'two'));
  assert.equal(await database.job.count({ where: { tenantId, cancelled: true } }), 1);
});

test('job transitions enforce guard and tenant ownership and deduplicate concurrent retries', async () => {
  await roster.importRoster(admin, csv('other-job', 'false', 'one', 'other'));
  const { mutate, snapshot } = operations;
  const input = { kind: 'job', id: 'job', transition: 'start' } as const;
  await assert.rejects(mutate({ ...guard, id: 'other' }, randomUUID(), input), { status: 404 });
  await assert.rejects(mutate({ ...guard, tenantId: 'test-b' }, randomUUID(), input), { status: 404 });
  const operationId = randomUUID();
  const [a, b] = await Promise.all([mutate(guard, operationId, input), mutate(guard, operationId, input)]);
  assert.deepEqual(a, b);
  assert.equal(await database.audit.count({ where: { tenantId, action: 'job.start' } }), 1);
  await assert.rejects(mutate(guard, operationId, { ...input, transition: 'done' }), { status: 409 });
  await roster.importRoster(admin, csv());
  await mutate(guard, randomUUID(), { ...input, transition: 'done' });
  const result = await snapshot(guard);
  assert.equal(result.role, 'GUARD');
  if (result.role === 'GUARD') assert.deepEqual(result.jobs.map(job => [job.id, job.status]), [['job', 'COMPLETED']]);
});

test('incident approval, SOS and chat enforce site ACLs and client projections', async () => {
  const { mutate, snapshot } = operations;
  const { id } = await mutate(guard, randomUUID(), { kind: 'incident', siteId: 'one', category: 'Internal category', description: 'Internal description' });
  const sos = await mutate(guard, randomUUID(), { kind: 'sos', siteId: 'one' });
  await assert.rejects(mutate({ ...supervisor, sites: ['two'] }, randomUUID(), { kind: 'respond', id: sos.id, transition: 'ACKNOWLEDGED' }), { status: 404 });
  await mutate(supervisor, randomUUID(), { kind: 'respond', id: sos.id, transition: 'ACKNOWLEDGED' });
  await mutate(supervisor, randomUUID(), { kind: 'respond', id: sos.id, transition: 'RESOLVED' });
  await assert.rejects(mutate(client, randomUUID(), { kind: 'review', id, summary: 'Forged' }), { status: 403 });
  assert.doesNotMatch(JSON.stringify(await snapshot(client)), /Internal description/);
  await mutate(supervisor, randomUUID(), { kind: 'review', id, summary: 'Approved property update' });
  await mutate(client, randomUUID(), { kind: 'message', siteId: 'one', body: 'Client question' });
  await mutate(supervisor, randomUUID(), { kind: 'message', siteId: 'one', clientId: 'client', body: 'Security reply' });
  await assert.rejects(mutate(client, randomUUID(), { kind: 'message', siteId: 'two', body: 'No access' }), { status: 404 });
  const data = JSON.stringify(await snapshot(client));
  assert.match(data, /Approved property update/);
  assert.match(data, /Security reply/);
  assert.doesNotMatch(data, /Internal|Private staff|guardId|dutyStart|dueAt|clientId|tenantId/);
  assert.doesNotMatch(JSON.stringify(await snapshot({ ...client, tenantId: 'test-b' })), /Approved property update|Client question/);
  await mutate(admin, randomUUID(), { kind: 'review', id, reason: 'Duplicate report' });
  assert.doesNotMatch(JSON.stringify(await snapshot(client)), /Approved property update/);
  await assert.rejects(database.audit.deleteMany({ where: { tenantId } }));
});

test('stale or missing roster prevents positive coverage claims', () => {
  assert.equal(coverage(null, true), 'UNKNOWN');
  assert.equal(coverage(new Date(Date.now() - 13 * 3600_000), true), 'UNKNOWN');
  assert.equal(coverage(new Date(), true), 'ACTIVE');
});


test('HTTP authentication, privileged MFA, cookie sessions and request authorization', { skip: process.env.TEST_HTTP !== '1' }, async () => {
  const { hashPassword } = await import('../lib/auth');
  const origin = 'http://127.0.0.1:3197';
  const password = randomUUID();
  const secret = randomBytes(20);
  const key = randomBytes(32);
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(secret), cipher.final()]);
  const mfaCiphertext = [iv, cipher.getAuthTag(), encrypted].map(item => item.toString('hex')).join(':');
  const passwordHash = await hashPassword(password);
  await database.user.updateMany({ where: { tenantId, id: { in: ['guard', 'admin'] } }, data: { passwordHash } });
  await database.user.update({ where: { tenantId_id: { tenantId, id: 'admin' } }, data: { mfaCiphertext } });
  const app = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', '-H', '127.0.0.1', '-p', '3197'], {
    env: { ...process.env, APP_ORIGIN: origin, MFA_KEY: key.toString('hex') }, stdio: 'ignore',
  });
  try {
    let started = false;
    for (let attempt = 0; attempt < 50; attempt++) {
      try {
        const response = await fetch(origin);
        if (response.ok) { started = true; break; }
      } catch { /* Waiting for the local Next.js listener. */ }
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    assert.ok(started, 'Next.js did not start');
    const get = (path: string, cookie?: string) => fetch(origin + '/api/' + path, { headers: cookie ? { cookie } : {} });
    const post = (path: string, body: unknown, cookie?: string, source = origin) => fetch(origin + '/api/' + path, {
      method: 'POST', headers: { origin: source, 'content-type': 'application/json', ...(cookie ? { cookie } : {}) }, body: JSON.stringify(body),
    });
    assert.equal((await get('snapshot')).status, 401);
    assert.equal((await post('login', { email: 'guard@test-a.example', password }, undefined, 'https://invalid.example')).status, 403);
    const guardResponse = await post('login', { email: 'guard@test-a.example', password });
    assert.equal(guardResponse.status, 200);
    const setCookie = guardResponse.headers.get('set-cookie') ?? '';
    assert.match(setCookie, /HttpOnly/i);
    assert.match(setCookie, /SameSite=strict/i);
    const guardCookie = setCookie.split(';')[0];
    const snapshot = await get('snapshot', guardCookie);
    assert.equal(snapshot.status, 200);
    assert.equal((await snapshot.json()).role, 'GUARD');
    assert.equal((await get('report', guardCookie)).status, 403);
    assert.equal((await post('settings', { name: 'Attempt', overdueMinutes: 4 }, guardCookie)).status, 403);
    const adminLogin = { email: 'admin@test-a.example', password };
    assert.equal((await post('login', adminLogin)).status, 401);
    const counter = Buffer.alloc(8);
    counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30_000)));
    const hash = createHmac('sha1', secret).update(counter).digest();
    const otp = String((hash.readUInt32BE(hash[19] & 15) & 0x7fffffff) % 1_000_000).padStart(6, '0');
    const authorized = await post('login', { ...adminLogin, otp });
    assert.equal(authorized.status, 200);
    assert.equal((await post('login', { ...adminLogin, otp })).status, 401);
    const adminCookie = authorized.headers.get('set-cookie')!.split(';')[0];
    assert.equal((await get('report', adminCookie)).status, 200);
    assert.equal((await post('logout', {}, guardCookie)).status, 200);
    assert.equal((await get('snapshot', guardCookie)).status, 401);
  } finally {
    app.kill();
  }
});
