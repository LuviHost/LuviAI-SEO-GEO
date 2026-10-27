/**
 * Kurumsal e-posta kampanyasi — saf kurallar (zaman penceresi, kota, fren, Mailjet olay eslemesi, CSV satiri).
 * Servis bunlari cagirir; testler eposta-kurallar.spec.ts.
 */
import { normalizeDomain } from '../prospect/prospect-utils.js';
import { GONDERIM_SEKTORLERI } from '../prospect/eposta-sablon.js';

/** Turkiye UTC+3 (2016'dan beri yaz saati yok) */
const TR_OFFSET_MS = 3 * 60 * 60 * 1000;

/** TR takvim gunu "YYYY-MM-DD" */
export function trGun(d: Date): string {
  return new Date(d.getTime() + TR_OFFSET_MS).toISOString().slice(0, 10);
}

/** TR gununun baslangici (UTC Date) — "bugun gonderilen" sayimi icin */
export function trGunBasi(d: Date): Date {
  return new Date(Date.parse(`${trGun(d)}T00:00:00.000Z`) - TR_OFFSET_MS);
}

/** TR ayinin baslangici (UTC Date) — aylik Mailjet hakki (6.000) sayimi icin */
export function trAyBasi(d: Date): Date {
  return new Date(Date.parse(`${trGun(d).slice(0, 7)}-01T00:00:00.000Z`) - TR_OFFSET_MS);
}

/**
 * Gonderim penceresi: hafta ici 10:00-17:00 TR. NEDEN: kurumsal kutular mesai saatinde okunur; gece/hafta sonu
 * giden soguk e-posta hem gecikir hem yigin icinde kaybolur. Bitis haric (17:00'de tur atilmaz).
 */
export function gonderimPenceresinde(d: Date): boolean {
  const tr = new Date(d.getTime() + TR_OFFSET_MS);
  const gun = tr.getUTCDay(); // 0 pazar
  const saat = tr.getUTCHours();
  return gun >= 1 && gun <= 5 && saat >= 10 && saat < 17;
}

export interface KotaGirdi {
  bugunGonderilen: number;
  ayGonderilen: number;
  gunluk: number;
  aylik: number;
  /** Tek turda en fazla (saatlik tur → gunluk kota gune yayilsin) */
  turBasi: number;
}

/** Bu turda gonderilebilecek adet (negatif olmaz) */
export function turKotasi(k: KotaGirdi): number {
  return Math.max(0, Math.min(k.gunluk - k.bugunGonderilen, k.aylik - k.ayGonderilen, k.turBasi));
}

export interface FrenGirdi { gonderilen: number; bounce: number; spam: number }

/**
 * Otomatik fren: son 7 gunde geri donme > %3 (en az 30 gonderimde) ya da spam sikayeti > %0,2 (en az 50 gonderimde,
 * ilk sikayette degil — tek sikayet 100 gonderimde %1 olur ve gurultudur; 500'de 1 = %0,2 esik).
 * Donus: durma nedeni ya da null. NEDEN: yuksek bounce/spam Mailjet hesabini ve ranksup.ai alan adi itibarini yakar.
 */
export function frenNedeni(f: FrenGirdi): string | null {
  if (f.gonderilen >= 30 && f.bounce / f.gonderilen > 0.03) {
    return `Son 7 günde geri dönme %${((f.bounce / f.gonderilen) * 100).toFixed(1)} (> %3) — liste gözden geçirilmeden devam etmez`;
  }
  if (f.gonderilen >= 50 && f.spam / f.gonderilen > 0.002) {
    return `Son 7 günde spam şikâyeti %${((f.spam / f.gonderilen) * 100).toFixed(2)} (> %0,2) — metin ve hedef gözden geçirilmeli`;
  }
  return null;
}

/** Mailjet olay → hedef guncellemesi (durum degisikligi + zaman alanlari) */
export type OlayGuncelleme = {
  durum?: 'BOUNCE' | 'RET' | 'SPAM' | 'HATA';
  acildi?: boolean;
  tiklandi?: boolean;
  sonOlay: string;
  hata?: string;
};

/**
 * Mailjet Event API olayi (https://dev.mailjet.com/email/guides/webhooks/). Alanlar: event, email, time (unix sn),
 * MessageID, CustomID, hard_bounce, error, error_related_to. Bilinmeyen olay → null (yok sayilir).
 * NEDEN soft bounce da BOUNCE: soguk kurumsal kutuda "kutu dolu / gecici" tekrarlanir; ikinci deneme yapilmaz.
 */
export function olayEsle(e: Record<string, unknown>): OlayGuncelleme | null {
  const ev = String(e.event ?? '').toLowerCase();
  const hata = [e.error_related_to, e.error].filter(Boolean).join(': ').slice(0, 500) || undefined;
  switch (ev) {
    case 'sent': return { sonOlay: 'sent' };
    case 'open': return { sonOlay: 'open', acildi: true };
    case 'click': return { sonOlay: 'click', tiklandi: true, acildi: true };
    case 'bounce': return { sonOlay: e.hard_bounce ? 'hard_bounce' : 'soft_bounce', durum: 'BOUNCE', hata };
    case 'blocked': return { sonOlay: 'blocked', durum: 'BOUNCE', hata };
    case 'spam': return { sonOlay: 'spam', durum: 'SPAM' };
    case 'unsub': return { sonOlay: 'unsub', durum: 'RET' };
    default: return null;
  }
}

/** Olay zamani (unix sn) → Date; yoksa/bozuksa simdi */
export function olayZamani(e: Record<string, unknown>, simdi = new Date()): Date {
  const t = Number(e.time);
  return Number.isFinite(t) && t > 1_500_000_000 ? new Date(t * 1000) : simdi;
}

/** Kalici durumlar: bir daha gonderilmez ve olaylar bunlari geri almaz */
export const KAPALI_DURUMLAR = ['BOUNCE', 'RET', 'SPAM', 'HARIC'] as const;

/** CLI/ice aktarmadaki gecmis gonderim yalniz bu durumlarin uzerine yazilabilir (kapali durum korunur) */
export const ACIK_DURUMLAR = ['YENI', 'IYS_DOSYADA', 'SIRADA', 'HATA'] as const;

/** Bizim kampanya mesajimiz mi? Mailjet CustomID'yi olaya geri koyar: "kurumsal-...:<email>" */
export function bizimMesaj(e: Record<string, unknown>, email: string): boolean {
  const c = String(e.CustomID ?? '');
  return c.startsWith('kurumsal-') && c.toLowerCase().endsWith(`:${email}`);
}

/** Mailjet yanit metnindeki 64-bit MessageID'leri JSON.parse'tan once dizeye cevir (2^53 ustu hassasiyet kaybi) */
export function mailjetJsonOku(text: string): any {
  return JSON.parse(text.replace(/"MessageID"\s*:\s*(\d+)/g, '"MessageID":"$1"'));
}

export interface IceAktarSatir {
  email: string;
  firma: string;
  marka: string | null;
  sektor: string;
  web: string | null;
  kaynakSayfa: string | null;
  kaynak: string;
  varyant: 'A' | 'B';
  /** Gecmis gonderim (CLI'dan gidenler) — panelde GONDERILDI olarak gorunsun, tekrar gonderilmesin */
  gecmis: { kampanya: string; messageId: string | null; gonderildiAt: Date | null } | null;
}

const EMAIL_RE = /^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/;

/**
 * 07'nin kurumsal-import.csv satiri (+ istege bagli marka, durum=gonderildi, kampanya, messageId, tarih) → ice aktarma.
 * Gecersiz satir → null + neden. Isimli satir (ad dolu) REDDEDILIR: bu tablo yalniz kurumsal kutu tutar.
 */
export function iceAktarSatiri(r: Record<string, string>): { satir: IceAktarSatir } | { hata: string } {
  const email = String(r.email ?? '').trim().toLowerCase();
  if (!EMAIL_RE.test(email)) return { hata: `geçersiz e-posta: ${email || '(boş)'}` };
  if (String(r.ad ?? '').trim() || String(r.soyad ?? '').trim()) return { hata: `${email}: kişi adlı satır — bu tablo yalnız kurumsal kutu tutar` };
  const firma = String(r.firma ?? '').trim();
  if (!firma) return { hata: `${email}: firma boş` };
  const sektorHam = String(r.sektor ?? '').trim() || 'diger';
  const sektor = GONDERIM_SEKTORLERI.includes(sektorHam) ? sektorHam : 'diger';
  const durum = String(r.durum ?? '').trim().toLowerCase();
  const tarih = Date.parse(String(r.tarih ?? r.gonderildiAt ?? ''));
  const gecmis = durum === 'gonderildi'
    ? { kampanya: String(r.kampanya ?? '').trim() || 'cli', messageId: String(r.messageId ?? '').trim() || null, gonderildiAt: Number.isFinite(tarih) ? new Date(tarih) : null }
    : null;
  return {
    satir: {
      email,
      firma: firma.slice(0, 255),
      marka: String(r.marka ?? '').trim().slice(0, 120) || null,
      sektor,
      web: normalizeDomain(r.web) ?? (email.split('@')[1] || null),
      kaynakSayfa: String(r.kaynakSayfa ?? '').trim().slice(0, 500) || null,
      kaynak: String(r.kaynak ?? '').trim().slice(0, 32) || '07',
      varyant: String(r.konu_varyanti ?? r.varyant ?? '').trim() === 'B' ? 'B' : 'A',
      gecmis,
    },
  };
}

/** Firma adi eslestirme anahtari (LinkedIn ile e-posta kanalini yan yana gostermek icin) */
export function firmaAnahtari(firma: string): string {
  return firma
    .toLocaleLowerCase('tr')
    .replace(/[ıİ]/g, 'i').replace(/ş/g, 's').replace(/ğ/g, 'g').replace(/ü/g, 'u').replace(/ö/g, 'o').replace(/ç/g, 'c')
    .replace(/\b(a\.?\s?ş\.?|as|ltd\.?|şti\.?|sti|tic\.?|san\.?|ve|anonim|şirketi|sirketi|limited|hizmetleri|reklamcilik|iletisim|ticaret|sanayi)\b/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(' ')
    .slice(0, 2)
    .join(' ');
}
