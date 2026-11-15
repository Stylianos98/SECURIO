import { createCipheriv, randomBytes } from 'node:crypto';
import { hashPassword } from '../lib/auth';
import { db } from '../lib/db';
import { importRoster } from '../lib/roster';

async function seed() {
  if (process.env.ALLOW_SIMULATED_SEED !== 'yes') throw new Error('Set ALLOW_SIMULATED_SEED=yes on a dedicated simulated database.');
  const password = process.env.DEMO_PASSWORD;
  const key = Buffer.from(process.env.MFA_KEY ?? '', 'hex');
  if (!password || password.length < 16 || key.length !== 32) throw new Error('Set DEMO_PASSWORD (at least 16 characters) and a 32-byte hex MFA_KEY.');
  const tenantId = 'simulation';
  await db.tenant.upsert({ where: { id: tenantId }, create: { id: tenantId, name: 'SECURIO Simulation' }, update: {} });
  await db.site.upsert({ where: { tenantId_id: { tenantId, id: 'alpha' } }, create: { tenantId, id: 'alpha', name: 'Alpha Residence' }, update: {} });
  const accounts = [['guard', 'GUARD'], ['command', 'SUPERVISOR'], ['client', 'CLIENT'], ['admin', 'COMPANY_ADMIN']] as const;
  for (const [id, role] of accounts) {
    const email = id + '@securio.example';
    const privileged = role === 'SUPERVISOR' || role === 'COMPANY_ADMIN';
    const iv = randomBytes(12);
    const secret = randomBytes(20);
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    const encrypted = Buffer.concat([cipher.update(secret), cipher.final()]);
    const mfaCiphertext = privileged ? [iv, cipher.getAuthTag(), encrypted].map(part => part.toString('hex')).join(':') : null;
    const passwordHash = await hashPassword(password);
    const created = await db.user.upsert({ where: { tenantId_id: { tenantId, id } }, create: { tenantId, id, email, name: 'Demo ' + id, role, mfaCiphertext, passwordHash }, update: {} });
    if (created.mfaCiphertext === mfaCiphertext && privileged) {
      const bits = [...secret].map(byte => byte.toString(2).padStart(8, '0')).join('');
      const base32 = bits.match(/.{5}/g)!.map(bits => 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'[parseInt(bits, 2)]).join('');
      console.log(email + ' authenticator setup key (store privately): ' + base32);
    }
    if (role === 'SUPERVISOR' || role === 'CLIENT') {
      const key = { tenantId, userId: id, siteId: 'alpha' };
      await db.grant.upsert({ where: { tenantId_siteId_userId: key }, create: key, update: {} });
    }
  }
  const when = (hours: number) => new Date(Date.now() + hours * 3600_000).toISOString();
  await importRoster({ tenantId, id: 'admin', role: 'COMPANY_ADMIN', sites: [] }, [
    'id,siteId,guardId,assignmentRef,title,dutyStart,dutyEnd,dueAt,cancelled',
    ['patrol-1', 'alpha', 'guard', 'demo-duty', 'Perimeter patrol', when(-1), when(6), when(1), 'false'].join(','),
    ['patrol-2', 'alpha', 'guard', 'demo-duty', 'Check service entrance', when(-1), when(6), when(3), 'false'].join(','),
  ].join('\n'));
}
seed().finally(() => db.$disconnect()).catch(error => { console.error(error.message); process.exitCode = 1; });
