import { createDecipheriv, createHash, createHmac, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { cookies } from 'next/headers';
import { db } from './db';

const derive = promisify(scrypt);
const digest = (value: string) => createHash('sha256').update(value).digest('hex');
export const secure = process.env.APP_ORIGIN?.startsWith('https://') ?? false;
export const sessionCookie = secure ? '__Host-securio' : 'securio-local';

export async function hashPassword(password: string, salt = randomBytes(16).toString('hex')) {
  const key = await derive(password, salt, 64) as Buffer;
  return salt + ':' + key.toString('hex');
}

function matchingStep(ciphertext: string, otp: string) {
  const key = Buffer.from(process.env.MFA_KEY ?? '', 'hex');
  const [iv, tag, data] = ciphertext.split(':').map(value => Buffer.from(value, 'hex'));
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  const secret = Buffer.concat([decipher.update(data), decipher.final()]);
  const current = Math.floor(Date.now() / 30_000);
  for (const step of [current, current - 1, current + 1]) {
    const counter = Buffer.alloc(8);
    counter.writeBigUInt64BE(BigInt(step));
    const hash = createHmac('sha1', secret).update(counter).digest();
    const code = String((hash.readUInt32BE(hash[19] & 15) & 0x7fffffff) % 1_000_000).padStart(6, '0');
    if (timingSafeEqual(Buffer.from(code), Buffer.from(otp))) return BigInt(step);
  }
  return null;
}

export async function login(email: string, password: string, otp?: string) {
  const key = digest(email);
  const bucket = Math.floor(Date.now() / 900_000);
  const rate = await db.loginLimit.upsert({
    where: { key_bucket: { key, bucket } }, create: { key, bucket }, update: { attempts: { increment: 1 } },
  });
  if (rate.attempts > 12) return null;
  const user = await db.user.findUnique({ where: { email } });
  const stored = user?.passwordHash ?? ('0'.repeat(32) + ':' + '0'.repeat(128));
  const actual = await hashPassword(password, stored.split(':')[0]);
  if (!timingSafeEqual(Buffer.from(stored), Buffer.from(actual)) || !user?.enabled) return null;
  const privileged = user.role === 'COMPANY_ADMIN' || user.role === 'SUPERVISOR';
  const step = privileged && user.mfaCiphertext && otp ? matchingStep(user.mfaCiphertext, otp) : null;
  if (privileged && step === null) return null;
  const token = randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + 8 * 3600_000);
  const created = await db.$transaction(async tx => {
    if (step !== null) {
      const consumed = await tx.user.updateMany({ where: { tenantId: user.tenantId, id: user.id, mfaStep: { lt: step } }, data: { mfaStep: step } });
      if (!consumed.count) return false;
    }
    await tx.session.create({ data: { tokenHash: digest(token), tenantId: user.tenantId, userId: user.id, expiresAt } });
    return true;
  });
  if (!created) return null;
  (await cookies()).set(sessionCookie, token, { httpOnly: true, secure, sameSite: 'strict', path: '/', expires: expiresAt });
  return user.role;
}

export async function logout() {
  const jar = await cookies();
  const token = jar.get(sessionCookie)?.value;
  if (token) await db.session.deleteMany({ where: { tokenHash: digest(token) } });
  jar.delete(sessionCookie);
}

export async function actor() {
  const token = (await cookies()).get(sessionCookie)?.value;
  if (!token || !/^[0-9a-f]{64}$/.test(token)) return null;
  const session = await db.session.findUnique({
    where: { tokenHash: digest(token), expiresAt: { gt: new Date() }, user: { enabled: true } },
    select: { user: { select: { tenantId: true, id: true, role: true, grants: { select: { siteId: true } } } } },
  });
  if (!session) return null;
  const { grants, ...user } = session.user;
  return { ...user, sites: grants.map(grant => grant.siteId) };
}

export type Actor = NonNullable<Awaited<ReturnType<typeof actor>>>;
