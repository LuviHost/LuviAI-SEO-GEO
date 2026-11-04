/**
 * Resend kanali (04.11.2026) — kurumsal kampanya, sistem e-postalariyla AYNI Resend hesabindan ve ranksup.ai'den.
 *
 * KARAR (sahip, 04.11): Resend'in kullanim politikasi soguk gonderimi ("cold outreach, purchased lists, or scraped
 * contact data") yasakliyor ve hesabi uyarisiz kapatabiliyor; hesap kapanirsa admin giris kodu ve musteri e-postalari
 * da durur. Risk sahibe anlatildi, ayni hesap + ranksup.ai secildi. Bu yuzden fren burada daha siki ve hacim dusuk.
 *
 * Mailjet'in yaptigi isler burada:
 *  - Metin: SMTP kanaliyla ayni duz metin (soguk-gonderim.ts sablonlari, kimlik satiri + imzali ret linki). HTML yok →
 *    Resend acilma pikseli/tiklama yonlendirmesi eklemez.
 *  - Geri donme / spam / teslim: Resend webhook'u (Svix imzali) → resendOlayEsle.
 *  - Yanitlar Reply-To kutusuna gider; EPOSTA_IMAP_* verilirse gelen kutusu okunur (ret yanitlari → RET).
 *
 * Bu dosya saf fonksiyonlar; HTTP cagrisi serviste.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';
import type { EpostaKimlik } from '../prospect/eposta-sablon.js';
import { type SogukHedef, retUrl, sogukSablonlar, sogukSatir } from './soguk-gonderim.js';
import { doldur } from './smtp-kanal.js';

export type ResendAyar = {
  apiKey: string;
  /** gonderen adres — Resend'de dogrulanmis alan adinda olmali */
  from: string;
  fromName: string;
  replyTo: string;
  /** webhook imza sirri (whsec_…) — Resend panelinde webhook olusturulunca verilir */
  webhookSecret: string;
};

export function resendAyar(env: Record<string, string | undefined> = process.env): ResendAyar {
  const from = (env.EPOSTA_RESEND_FROM?.trim() || env.MAILJET_FROM_EMAIL?.trim() || '').toLowerCase();
  return {
    // NEDEN yedek RESEND_API_KEY: sahip ayni hesabi secti; ayri anahtar verilirse o kullanilir
    apiKey: env.EPOSTA_RESEND_API_KEY?.trim() || env.RESEND_API_KEY?.trim() || '',
    from,
    fromName: env.EPOSTA_RESEND_FROM_NAME?.trim() || env.MAILJET_FROM_NAME?.trim() || 'RanksUp',
    replyTo: (env.EPOSTA_RESEND_REPLY_TO?.trim() || env.MAILJET_REPLY_TO?.trim() || from).toLowerCase(),
    webhookSecret: env.EPOSTA_RESEND_WEBHOOK_SECRET?.trim() ?? '',
  };
}

/** Eksik ayarlar (panelde "hazir degil" nedeni). Anahtar ve sir GOSTERILMEZ, yalniz degisken adlari. */
export function resendSorunlari(a: ResendAyar): string[] {
  const s: string[] = [];
  if (!a.apiKey) s.push('RESEND_API_KEY yok');
  if (!a.from.includes('@')) s.push('EPOSTA_RESEND_FROM (ya da MAILJET_FROM_EMAIL) geçersiz');
  // NEDEN zorunlu: webhook olmadan geri donme/spam gorulmez, fren kor kalir — Resend esigi asilinca hesap kapanir
  if (!a.webhookSecret.startsWith('whsec_')) s.push('EPOSTA_RESEND_WEBHOOK_SECRET yok (Resend › Webhooks › imza sırrı)');
  if (/^noreply@|^no-reply@/.test(a.from)) s.push('Kampanya noreply adresinden gitmez — yanıt alınabilen bir adres verin');
  return s;
}

export type ResendMesaj = {
  from: string;
  to: string[];
  subject: string;
  text: string;
  reply_to: string;
  headers: Record<string, string>;
  tags: Array<{ name: string; value: string }>;
};

/** Gorunen ad + adres; ozel karakterli ad tirnaklanir ("Emir · RanksUp") */
function adresli(ad: string, adres: string): string {
  const temiz = ad.replace(/["\\\r\n<>]/g, '').trim();
  return temiz ? `"${temiz}" <${adres}>` : adres;
}

/** Resend etiket degeri: yalniz ASCII harf, rakam, _ ve - (256 karakter) */
export function etiketDegeri(s: string): string {
  return s.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 256);
}

/**
 * Ilk e-postanin Resend /emails/batch ogesi. Duz metin; List-Unsubscribe: imzali https ret linki + mailto yedek,
 * List-Unsubscribe-Post (RFC 8058) → Gmail/Yahoo tek tik ret dugmesi /api/eposta/ret'e POST eder.
 */
export function resendMesaj(h: SogukHedef & { id: string }, k: EpostaKimlik, a: ResendAyar, sir: string, base: string, kampanya: string): ResendMesaj {
  const satir = sogukSatir(h, sir, base);
  const [ilk] = sogukSablonlar(h.sektor, { ...k, fromEmail: a.from, replyTo: a.replyTo });
  return {
    from: adresli(a.fromName, a.from),
    to: [satir.email],
    subject: doldur(ilk.konu, satir),
    text: doldur(ilk.govde, satir),
    reply_to: a.replyTo,
    headers: {
      'List-Unsubscribe': `<${retUrl(h.email, sir, base)}>, <mailto:${a.replyTo}?subject=ret>`,
      'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
    },
    tags: [
      { name: 'kampanya', value: etiketDegeri(kampanya) },
      { name: 'hedef', value: etiketDegeri(h.id) },
    ],
  };
}

/** Svix zaman toleransi: eski imzali istegin tekrar oynatilmasina karsi */
export const SVIX_TOLERANS_SN = 5 * 60;

/**
 * Resend webhook imzasi (Svix, https://docs.svix.com/receiving/verifying-payloads/how-manual):
 * imzalanan = `${svix-id}.${svix-timestamp}.${ham govde}`, anahtar = whsec_ sonrasinin base64 cozumu,
 * HMAC-SHA256 → base64; svix-signature bosluklu "v1,<imza>" listesi, biri tutmali.
 */
export function svixDogrula(
  secret: string,
  basliklar: { id?: string; timestamp?: string; signature?: string },
  ham: string | Buffer,
  simdiSn = Math.floor(Date.now() / 1000),
): boolean {
  const { id, timestamp, signature } = basliklar;
  if (!secret.startsWith('whsec_') || !id || !timestamp || !signature) return false;
  const ts = Number(timestamp);
  if (!Number.isFinite(ts) || Math.abs(simdiSn - ts) > SVIX_TOLERANS_SN) return false;
  let anahtar: Buffer;
  try {
    anahtar = Buffer.from(secret.slice('whsec_'.length), 'base64');
  } catch {
    return false;
  }
  if (!anahtar.length) return false;
  const govde = typeof ham === 'string' ? ham : ham.toString('utf8');
  const beklenen = createHmac('sha256', anahtar).update(`${id}.${timestamp}.${govde}`).digest();
  return signature.split(' ').some((parca) => {
    const [surum, imza] = parca.split(',');
    if (surum !== 'v1' || !imza) return false;
    const b = Buffer.from(imza, 'base64');
    return b.length === beklenen.length && timingSafeEqual(b, beklenen);
  });
}

/** Resend olayi → hedef guncellemesi (Mailjet olayEsle ile ayni bicim + teslim kaniti) */
export type ResendOlay = {
  emailId: string;
  alici: string;
  zaman: Date;
  sonOlay: string;
  durum?: 'BOUNCE' | 'SPAM' | 'HATA';
  /** teslim/gonderim kaniti: belirsiz kalmis satir GONDERILDI olur */
  teslim?: boolean;
  acildi?: boolean;
  tiklandi?: boolean;
  hata?: string;
};

/**
 * https://resend.com/docs/webhooks/emails/* — govde: { type, created_at, data: { email_id, to[], bounce?: {type, subType, message} } }.
 * NEDEN suppressed da BOUNCE: adres Resend'in bastirma listesinde (onceki kalici geri donme/sikayet) — bir daha yazilmaz.
 * NEDEN failed HATA: gonderim Resend'de dustu (kota, alan adi); tekrar denenmez, panelde gorunur.
 */
export function resendOlayEsle(govde: unknown, simdi = new Date()): ResendOlay | null {
  if (!govde || typeof govde !== 'object') return null;
  const g = govde as Record<string, any>;
  const d = g.data && typeof g.data === 'object' ? g.data : null;
  if (!d) return null;
  const emailId = typeof d.email_id === 'string' ? d.email_id : '';
  const ilk = Array.isArray(d.to) ? d.to[0] : d.to;
  const alici = typeof ilk === 'string' ? (/<([^>]+)>/.exec(ilk)?.[1] ?? ilk).trim().toLowerCase() : '';
  if (!emailId && !alici) return null;
  const t = Date.parse(String(g.created_at ?? ''));
  const zaman = Number.isFinite(t) ? new Date(t) : simdi;
  const temel = { emailId, alici, zaman };
  const neden = [d.bounce?.type, d.bounce?.subType, d.bounce?.message ?? d.failed?.reason].filter(Boolean).join(': ').slice(0, 500) || undefined;
  switch (String(g.type ?? '')) {
    case 'email.sent': return { ...temel, sonOlay: 'sent', teslim: true };
    case 'email.delivered': return { ...temel, sonOlay: 'delivered', teslim: true };
    case 'email.delivery_delayed': return { ...temel, sonOlay: 'gecikti', teslim: true };
    case 'email.opened': return { ...temel, sonOlay: 'open', teslim: true, acildi: true };
    case 'email.clicked': return { ...temel, sonOlay: 'click', teslim: true, acildi: true, tiklandi: true };
    case 'email.bounced': return { ...temel, sonOlay: 'bounce', durum: 'BOUNCE', teslim: true, hata: neden ?? 'Geri döndü' };
    case 'email.suppressed': return { ...temel, sonOlay: 'suppressed', durum: 'BOUNCE', teslim: true, hata: neden ?? 'Resend bastırma listesinde' };
    case 'email.complained': return { ...temel, sonOlay: 'spam', durum: 'SPAM', teslim: true };
    case 'email.failed': return { ...temel, sonOlay: 'failed', durum: 'HATA', hata: neden ?? 'Resend gönderemedi' };
    default: return null;
  }
}
