import { randomInt } from 'node:crypto';

/**
 * Admin paneli için email-OTP akışı.
 *
 * Akış:
 *   1) Admin kullanıcı /admin-unlock'a gelir
 *   2) "Kod Gönder" butonuna basar → requestAdminOtp(email) çağrılır
 *   3) 6 haneli kod oluşturulur, 5dk TTL ile in-memory Map'e konur, e-postayı API gönderir
 *   4) Kullanıcı maildeki kodu form'a girer → verifyAdminOtp(email, code)
 *   5) Doğruysa setAdminUnlockCookie + /admin redirect
 *
 * Storage: in-memory Map (PM2 single-process, kabul edilebilir).
 * Restart sonrası tüm pending OTP'ler silinir — zaten 5dk TTL.
 *
 * Brute-force koruma: max 5 deneme/email/oturum.
 */

interface OtpRecord {
  code: string;
  expiresAt: number;
  attempts: number;
}

const otpStore = new Map<string, OtpRecord>();
const TTL_MS = 5 * 60 * 1000; // 5 dakika
const MAX_ATTEMPTS = 5;
const COOLDOWN_MS = 30 * 1000; // aynı email için tekrar göndermeden önce 30sn

const lastSent = new Map<string, number>();

function generateCode(): string {
  // 6 haneli sayisal kod, kriptografik rastgele (Math.random tahmin edilebilir)
  return String(randomInt(100000, 1000000));
}

/** Web → API dahili anahtari (welcome-hook ile ayni kural) */
function internalKey(): string {
  return process.env.INTERNAL_API_KEY ?? process.env.NEXTAUTH_SECRET ?? process.env.AUTH_SECRET ?? '';
}

/**
 * NEDEN anahtara bagli: kod e-postasini artik API gonderiyor (23.11); web'in kendi
 * RESEND_API_KEY'i gerekmez. Eskiden RESEND_API_KEY yoksa OTP kapaniyor, panel kodsuz
 * aciliyordu — dahili anahtar her zaman var, kapi kendiliginden gevsemez.
 */
export function isAdminOtpEnabled(): boolean {
  return !!internalKey();
}

export function getAdminEmail(): string | null {
  // Birden fazla admin için env: ADMIN_EMAILS=a@x.com,b@x.com
  // Tek admin için: ADMIN_EMAIL=a@x.com
  return process.env.ADMIN_EMAIL ?? null;
}

export function isAuthorizedAdminEmail(email: string): boolean {
  const list = process.env.ADMIN_EMAILS ?? process.env.ADMIN_EMAIL ?? '';
  if (!list) return false;
  const normalized = email.toLowerCase().trim();
  return list
    .split(',')
    .map((e) => e.toLowerCase().trim())
    .filter(Boolean)
    .includes(normalized);
}

export async function requestAdminOtp(email: string): Promise<{ ok: boolean; reason?: string }> {
  if (!internalKey()) return { ok: false, reason: 'OTP_DISABLED' };

  const key = email.toLowerCase().trim();

  // Rate-limit: aynı email için 30sn cooldown
  const last = lastSent.get(key);
  if (last && Date.now() - last < COOLDOWN_MS) {
    return { ok: false, reason: 'COOLDOWN' };
  }

  const code = generateCode();
  otpStore.set(key, {
    code,
    expiresAt: Date.now() + TTL_MS,
    attempts: 0,
  });
  lastSent.set(key, Date.now());

  // E-postayi API gonderir (tek Resend anahtari, noreply@ranksup.ai) — bkz. api auth/admin-otp-mail.ts
  const apiBase = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';
  try {
    const res = await fetch(`${apiBase}/api/auth/admin-otp-mail`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-internal-key': internalKey() },
      body: JSON.stringify({ email: key, code }),
    });
    const veri = (await res.json().catch(() => null)) as { ok?: boolean } | null;
    if (!res.ok || veri?.ok !== true) {
      console.error('[admin-otp] API e-postasi gonderilemedi:', res.status);
      // Gitmeyen kod bekletmesin: kullanici hemen yeniden deneyebilsin
      otpStore.delete(key);
      lastSent.delete(key);
      return { ok: false, reason: 'MAIL_FAIL' };
    }
    return { ok: true };
  } catch (err: any) {
    console.error('[admin-otp] mail error:', err?.message);
    otpStore.delete(key);
    lastSent.delete(key);
    return { ok: false, reason: 'MAIL_FAIL' };
  }
}

export function verifyAdminOtp(email: string, code: string): { ok: boolean; reason?: string } {
  const key = email.toLowerCase().trim();
  const record = otpStore.get(key);

  if (!record) return { ok: false, reason: 'NO_CODE' };

  if (Date.now() > record.expiresAt) {
    otpStore.delete(key);
    return { ok: false, reason: 'EXPIRED' };
  }

  record.attempts++;
  if (record.attempts > MAX_ATTEMPTS) {
    otpStore.delete(key);
    return { ok: false, reason: 'TOO_MANY_ATTEMPTS' };
  }

  const expected = record.code;
  const actual = code.trim();
  if (expected !== actual) return { ok: false, reason: 'WRONG_CODE' };

  // Doğru — tek kullanımlık
  otpStore.delete(key);
  lastSent.delete(key);
  return { ok: true };
}
