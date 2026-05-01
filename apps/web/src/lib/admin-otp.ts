import { createHmac } from 'node:crypto';

/**
 * Admin paneli için email-OTP akışı.
 *
 * Akış:
 *   1) Admin kullanıcı /admin-unlock'a gelir
 *   2) "Kod Gönder" butonuna basar → requestAdminOtp(email) çağrılır
 *   3) 6 haneli kod oluşturulur, 5dk TTL ile in-memory Map'e konur, Resend ile mail
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
  // 6 haneli sayısal kod (kriptografik random değil, ama 5dk TTL + 5 attempt brute-force engeller)
  return String(Math.floor(100000 + Math.random() * 900000));
}

export function isAdminOtpEnabled(): boolean {
  return !!process.env.RESEND_API_KEY;
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
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return { ok: false, reason: 'OTP_DISABLED' };

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

  const html = `<!DOCTYPE html>
<html lang="tr"><head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#0f0a1f;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif;color:#e2d9ff;">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#1a0f3d;">
<tr><td align="center" style="padding:40px 16px;">
<table role="presentation" width="480" cellspacing="0" cellpadding="0" style="max-width:480px;background:#1a0f3d;border-radius:16px;border:1px solid rgba(250,204,21,0.4);">
<tr><td style="padding:40px 32px;">
<div style="display:inline-block;padding:6px 12px;background:rgba(250,204,21,0.15);border-radius:999px;font-family:SF Mono,Menlo,monospace;font-size:10px;letter-spacing:3px;color:#fde047;text-transform:uppercase;margin-bottom:16px;">LUVIAI ADMIN</div>
<h1 style="font-size:24px;font-weight:700;margin:0 0 8px;color:#fff;">Giriş kodu</h1>
<p style="margin:0 0 24px;color:#c4b5fd;font-size:14px;">Aşağıdaki kodu admin panelinde gir. Kod 5 dakika geçerli.</p>
<div style="background:rgba(250,204,21,0.1);border:1px solid rgba(250,204,21,0.3);border-radius:12px;padding:24px;text-align:center;font-family:SF Mono,Menlo,monospace;font-size:42px;letter-spacing:14px;color:#fde047;font-weight:700;margin:0 0 24px;">
${code}
</div>
<p style="margin:0;color:#9ca3af;font-size:12px;line-height:1.6;">Bu giriş denemesini siz yapmadıysanız bu maili göz ardı edin. Hesabınız güvende — kod doğrulanmadan oturum açılmaz.</p>
</td></tr>
</table>
<p style="color:#6b7280;font-size:11px;margin:16px 0 0;font-family:SF Mono,Menlo,monospace;">LuviAI · Admin OTP</p>
</td></tr></table>
</body></html>`;

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: `LuviAI Admin <${process.env.EMAIL_FROM ?? 'noreply@luvihost.com.tr'}>`,
        to: [email],
        subject: `🔐 LuviAI Admin giriş kodu: ${code}`,
        html,
      }),
    });
    if (!res.ok) {
      const errText = await res.text();
      console.error('[admin-otp] Resend fail:', res.status, errText);
      return { ok: false, reason: 'MAIL_FAIL' };
    }
    return { ok: true };
  } catch (err: any) {
    console.error('[admin-otp] mail error:', err?.message);
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
