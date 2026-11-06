/**
 * SMTP kanali (03.11.2026) — kurumsal kampanyayi Mailjet yerine KENDI posta sunucumuzdan (cPanel) gonderir.
 *
 * NEDEN: Mailjet toplanmis listeye gonderimi yasakladi; Workspace + Instantly ayda ~58 $. Ayri bir alan adinin cPanel
 * kutusundan dusuk hacimle (gunde ~30) gondermek ek maliyetsiz. ranksup.ai bu kanalda KULLANILMAZ (ayri alan adi) —
 * sikayet/kara liste olursa musteri e-postalari (sifre, rapor, fatura) etkilenmesin.
 *
 * Mailjet'in yaptigi iki isi burada biz yapariz:
 *  - Metin: soguk-gonderim.ts sablonlari (duz metin, ayni kimlik satiri + imzali ret linki), degiskenler burada doldurulur.
 *  - Geri donme / yanit: Mailjet webhook'u yok → gonderen kutunun gelen kutusu IMAP ile okunur (dsnAyikla, yanitTuru).
 *
 * Bu dosya saf fonksiyonlar; baglanti (nodemailer / imapflow) servistedir.
 */
import { randomBytes } from 'node:crypto';
import type { EpostaKimlik } from '../prospect/eposta-sablon.js';
import { type SogukHedef, retUrl, sogukSablonlar, sogukSatir, tikBaglantisiEkle } from './soguk-gonderim.js';

export type SmtpAyar = {
  host: string;
  port: number;
  /** 465 → dogrudan TLS; 587 → STARTTLS */
  secure: boolean;
  user: string;
  pass: string;
  /** gonderen adres (ayri alan adinda, ranksup.ai DEGIL) */
  from: string;
  fromName: string;
  imapHost: string;
  imapPort: number;
};

export type Kanal = 'smtp' | 'resend' | 'mailjet';

/** EPOSTA_KANAL=smtp → SMTP, =resend → Resend (resend-kanal.ts); aksi halde Mailjet (eski davranis) */
export function kanal(env: Record<string, string | undefined> = process.env): Kanal {
  const k = env.EPOSTA_KANAL?.trim().toLowerCase();
  return k === 'smtp' || k === 'resend' ? k : 'mailjet';
}

export function smtpAyar(env: Record<string, string | undefined> = process.env): SmtpAyar {
  const port = Number(env.EPOSTA_SMTP_PORT) || 465;
  const host = env.EPOSTA_SMTP_HOST?.trim() ?? '';
  return {
    host,
    port,
    secure: port === 465,
    user: env.EPOSTA_SMTP_USER?.trim() ?? '',
    pass: env.EPOSTA_SMTP_PASS ?? '',
    from: (env.EPOSTA_SMTP_FROM?.trim() || env.EPOSTA_SMTP_USER?.trim() || '').toLowerCase(),
    fromName: env.EPOSTA_SMTP_FROM_NAME?.trim() || env.MAILJET_FROM_NAME?.trim() || 'RanksUp',
    imapHost: env.EPOSTA_IMAP_HOST?.trim() || host,
    imapPort: Number(env.EPOSTA_IMAP_PORT) || 993,
  };
}

/** Eksik ayarlar (panelde "hazir degil" nedeni). Sifre ve adresler GOSTERILMEZ, yalniz degisken adlari. */
export function smtpSorunlari(a: SmtpAyar): string[] {
  const s: string[] = [];
  if (!a.host) s.push('EPOSTA_SMTP_HOST yok');
  if (!a.user) s.push('EPOSTA_SMTP_USER yok');
  if (!a.pass) s.push('EPOSTA_SMTP_PASS yok');
  if (!a.from.includes('@')) s.push('EPOSTA_SMTP_FROM geçersiz');
  // NEDEN: soguk gonderim ana alan adinin itibarini yakar (musteri postalari spam'e duser)
  if (/@(.+\.)?ranksup\.ai$/.test(a.from)) s.push('Soğuk gönderim ranksup.ai adresinden yapılmaz — ayrı alan adı kullanın');
  return s;
}

/** Message-ID'nin yerel kismi; messageId sutununa (VarChar 40) sigar, yanitlari ve geri donmeleri bununla eslestiririz */
export function mesajKimligi(): string {
  return `rs${randomBytes(12).toString('hex')}`;
}

/** {{degisken}} → deger. Doldurulamayan etiket kalirsa hata (yarim metin gitmesin). */
export function doldur(s: string, d: Record<string, string>): string {
  const out = s.replace(/\{\{([a-z_]+)\}\}/g, (m, k: string) => (k in d ? d[k] : m));
  const kalan = out.match(/\{\{[a-z_]+\}\}/);
  if (kalan) throw new Error(`doldurulamayan etiket: ${kalan[0]}`);
  return out;
}

export type SmtpMesaj = {
  from: { name: string; address: string };
  to: string;
  subject: string;
  text: string;
  messageId: string;
  headers: Record<string, string>;
};

/**
 * Ilk e-postanin tam hali. Duz metin (soguk gonderimde HTML + takip pikseli teslim oranini dusurur).
 * List-Unsubscribe: imzali https ret linki + mailto yedek; List-Unsubscribe-Post (RFC 8058) → Gmail/Yahoo tek tik ret
 * dugmesi linke POST eder, /api/eposta/ret POST'u ret yazar.
 */
export function smtpMesaj(h: SogukHedef, k: EpostaKimlik, a: SmtpAyar, sir: string, base: string, kimlik = mesajKimligi(), tik?: string): SmtpMesaj {
  const satir = sogukSatir(h, sir, base);
  const [ilk] = sogukSablonlar(satir.sektor, { ...k, fromEmail: a.from, replyTo: a.from });
  const domain = a.from.split('@')[1];
  return {
    from: { name: a.fromName, address: a.from },
    to: satir.email,
    subject: doldur(ilk.konu, satir),
    text: tik ? tikBaglantisiEkle(doldur(ilk.govde, satir), k, tik) : doldur(ilk.govde, satir),
    messageId: `<${kimlik}@${domain}>`,
    headers: {
      'List-Unsubscribe': `<${retUrl(h.email, sir, base)}>, <mailto:${a.from}?subject=ret>`,
      'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
    },
  };
}

/**
 * SMTP hatasi kalici mi (5xx — adres yok, kutu kapali)? Kalici ise satir BOUNCE olur ve bir daha denenmez.
 * Gecici (4xx) ya da baglanti hatasi → satir HATA, tur durur.
 */
export function kaliciRet(e: { responseCode?: number; code?: string } | null | undefined): boolean {
  const c = Number(e?.responseCode);
  return c >= 500 && c < 600;
}

export type GeriDonme = { alici: string; kalici: boolean; durum: string };

/**
 * Teslim edilemedi raporundan (DSN, RFC 3464) alicilari cikar. Yalniz "Action: failed" + 5.x.x kalici sayilir;
 * "delayed"/4.x.x gecicidir. DSN bicimi yoksa (eski tip MAILER-DAEMON metni) bos doner — tahminle adres dusurmeyiz.
 */
export function dsnAyikla(ham: string): GeriDonme[] {
  const out: GeriDonme[] = [];
  // her alici blogu bos satirla ayrilir; Final-Recipient ile baslayan bloklari gez
  const bloklar = ham.replace(/\r\n/g, '\n').split(/\n\s*\n/);
  for (const b of bloklar) {
    const alici = /^Final-Recipient:\s*rfc822;\s*<?([^\s>]+@[^\s>]+)>?/im.exec(b)?.[1];
    if (!alici) continue;
    const action = /^Action:\s*(\w+)/im.exec(b)?.[1]?.toLowerCase() ?? '';
    const durum = /^Status:\s*([245]\.\d{1,3}\.\d{1,3})/im.exec(b)?.[1] ?? '';
    if (action !== 'failed') continue;
    out.push({ alici: alici.toLowerCase(), kalici: durum.startsWith('5'), durum });
  }
  return out;
}

/** Gelen mesaj DSN mi (geri donme raporu)? */
export function dsnMi(ustbilgi: { contentType?: string; from?: string; subject?: string }): boolean {
  const ct = (ustbilgi.contentType ?? '').toLowerCase();
  if (ct.includes('multipart/report') && ct.includes('delivery-status')) return true;
  const from = (ustbilgi.from ?? '').toLowerCase();
  return /mailer-daemon|postmaster/.test(from) && /undeliver|delivery status|delivery failed|failure|returning message|returned|teslim edilemedi/i.test(ustbilgi.subject ?? '');
}

/**
 * Yanitin turu: 'ret' (listeden cikmak istiyor) ya da 'yanit' (insan yaniti — panelde gorulsun).
 * NEDEN yalniz ilk satirlar: alintilanan orijinal metinde ret linki/"listeden çık" gecer; tum govdeye bakmak her yaniti ret sayardi.
 */
export function yanitTuru(konu: string, govde: string): 'ret' | 'yanit' {
  const ilk = govde
    .replace(/\r\n/g, '\n')
    .split('\n')
    .filter((l) => !l.trim().startsWith('>'))
    .slice(0, 6)
    .join(' ')
    .toLowerCase();
  const k = konu.toLowerCase();
  const RET = /\b(ret|unsubscribe|abonelikten çık|listeden çıkar|listeden çık|istemiyoruz|istemiyorum|göndermeyin|gondermeyin|remove)\b/i;
  // mailto List-Unsubscribe konusu "ret" gelir; insan yanitinda ilk satirlar
  if (/^\s*(re:\s*)?ret\s*$/i.test(k) || RET.test(ilk)) return 'ret';
  return 'yanit';
}

/** In-Reply-To / References icinden bizim Message-ID yerel kisimlarimiz (rs + 24 hex) */
export function bizimKimlikler(...basliklar: Array<string | undefined | null>): string[] {
  const out = new Set<string>();
  for (const b of basliklar) for (const m of String(b ?? '').matchAll(/<(rs[0-9a-f]{24})@/g)) out.add(m[1]);
  return [...out];
}
