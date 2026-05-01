import { cookies } from 'next/headers';
import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Admin paneli icin ikinci-faktor unlock akisi.
 *
 *  - Kullanici Google ile login (NextAuth) + role === 'ADMIN' olmasina
 *    ragmen `/admin/*` rotalarina ek bir PIN ile girer.
 *  - PIN env'de tutulur (ADMIN_PIN). Env'de PIN yoksa unlock devre disi —
 *    sadece role kontrolu yapilir (geriye uyumluluk).
 *  - Dogru PIN/OTP girince signed httpOnly cookie set edilir, varsayilan 24 saat (gunde 1 kez kod istenir).
 *  - HMAC SHA-256 ile imzalanir; gizli anahtar ADMIN_UNLOCK_SECRET (yoksa
 *    NEXTAUTH_SECRET).
 */

const COOKIE_NAME = 'luviai_admin_unlocked';
const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000; // 24 saat

function getSecret(): string {
  return process.env.ADMIN_UNLOCK_SECRET ?? process.env.NEXTAUTH_SECRET ?? process.env.AUTH_SECRET ?? '';
}

export function isAdminUnlockEnabled(): boolean {
  return !!process.env.ADMIN_PIN;
}

export function verifyPin(input: string): boolean {
  const expected = process.env.ADMIN_PIN;
  if (!expected) return false;
  const a = Buffer.from(input);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

function sign(payload: string): string {
  return createHmac('sha256', getSecret()).update(payload).digest('base64url');
}

export function buildToken(userId: string, ttlMs = DEFAULT_TTL_MS): string {
  const exp = Date.now() + ttlMs;
  const payload = `${exp}.${userId}`;
  return `${payload}.${sign(payload)}`;
}

export function verifyToken(token: string | undefined, userId: string): boolean {
  if (!token) return false;
  const parts = token.split('.');
  if (parts.length !== 3) return false;
  const [expStr, sub, sig] = parts;
  const payload = `${expStr}.${sub}`;
  const expected = sign(payload);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  let sigOk = false;
  try {
    sigOk = timingSafeEqual(a, b);
  } catch {
    sigOk = false;
  }
  if (!sigOk) return false;
  if (sub !== userId) return false;
  const exp = Number(expStr);
  if (!Number.isFinite(exp) || Date.now() > exp) return false;
  return true;
}

export async function setAdminUnlockCookie(userId: string, ttlMs = DEFAULT_TTL_MS): Promise<void> {
  const token = buildToken(userId, ttlMs);
  const store = await cookies();
  store.set(COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    path: '/',
    maxAge: Math.floor(ttlMs / 1000),
  });
}

export async function clearAdminUnlockCookie(): Promise<void> {
  const store = await cookies();
  store.delete(COOKIE_NAME);
}

export async function isAdminUnlocked(userId: string): Promise<boolean> {
  if (!isAdminUnlockEnabled()) return true;
  const store = await cookies();
  const token = store.get(COOKIE_NAME)?.value;
  return verifyToken(token, userId);
}
