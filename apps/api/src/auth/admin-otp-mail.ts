/**
 * Admin giris kodu e-postasi — saf (23.11.2026).
 *
 * NEDEN API'de: kod e-postasini web sureci kendi RESEND_API_KEY'iyle gonderiyordu. Anahtar
 * yenilenince API'deki guncellendi, web'deki eski kaldi; Resend "API key is invalid" dondu ve
 * yeni yonetici kod alamadi. Artik web kodu uretir/dogrular, e-postayi API'nin EmailService'i
 * (tek anahtar, noreply@ranksup.ai) gonderir.
 *
 * GUVENLIK: konu satirinda kod YOK (EmailLog.subject'e yazilir); kod yalniz govdede.
 */

export const ADMIN_OTP_KONU = 'RanksUp yönetici giriş kodu';

/** 6 haneli sayisal kod mu */
export function gecerliOtpKodu(code: unknown): code is string {
  return typeof code === 'string' && /^\d{6}$/.test(code);
}

export function adminOtpHtml(code: string): string {
  if (!gecerliOtpKodu(code)) throw new Error('Geçersiz kod');
  return `<!DOCTYPE html>
<html lang="tr"><head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#0b0b0f;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif;color:#e5e7eb;">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#0b0b0f;">
<tr><td align="center" style="padding:40px 16px;">
<table role="presentation" width="480" cellspacing="0" cellpadding="0" style="max-width:480px;background:#15151c;border-radius:16px;border:1px solid rgba(249,115,22,0.35);">
<tr><td style="padding:36px 32px;">
<div style="font-family:SF Mono,Menlo,monospace;font-size:10px;letter-spacing:3px;color:#fb923c;text-transform:uppercase;margin-bottom:14px;">RanksUp Admin</div>
<h1 style="font-size:22px;font-weight:600;margin:0 0 8px;color:#fff;">Giriş kodu</h1>
<p style="margin:0 0 22px;color:#a1a1aa;font-size:14px;">Aşağıdaki kodu yönetici panelinde gir. Kod 5 dakika geçerli.</p>
<div style="background:rgba(249,115,22,0.1);border:1px solid rgba(249,115,22,0.3);border-radius:12px;padding:22px;text-align:center;font-family:SF Mono,Menlo,monospace;font-size:40px;letter-spacing:14px;color:#fdba74;font-weight:700;margin:0 0 22px;">${code}</div>
<p style="margin:0;color:#71717a;font-size:12px;line-height:1.6;">Bu giriş denemesini sen yapmadıysan bu e-postayı yok say. Kod girilmeden oturum açılmaz.</p>
</td></tr>
</table>
</td></tr></table>
</body></html>`;
}
