import { istanbulParts, normalizeProfileUrl } from './linkedin-outreach-rules.js';

/**
 * ELLE KAYIT — saf kurallar (DB yok, 23.11.2026).
 *
 * NEDEN: /admin/linkedin takip listesi yalniz botun gonderdigi mesajlari tutuyordu. Kurucunun
 * LinkedIn'den elle (ya da Chrome eklentisiyle) ve e-postayla attigi mesajlar hicbir yerde
 * kayitli degildi: "kime ne yazdik, kim cevap verdi, ne zaman hatirlatalim" sorusu mesaj
 * kutusu taranarak cevaplaniyordu.
 *
 * KURAL:
 *  - LINKEDIN kaydi profil linki ister (tekil anahtar, bot cevap kontrolu bununla eslesir).
 *  - EPOSTA kaydi e-posta adresi ister; tekil anahtar "mailto:<adres>" olur.
 *  - Ayni kisiye ikinci mesaj (hatirlatma) yeni kayit ACMAZ: metin tarihli basliklariyla
 *    mevcut kaydin sonuna eklenir — kime ne yazildigi tek yerde, sirasiyla okunur.
 *  - Hatirlatma verilmezse gonderimden 4 IS GUNU sonra, Istanbul saatiyle 10:00.
 *  - KONUSMA (23.11): karsi tarafin cevabi da kaydedilir (yon GELEN). Blok basligi
 *    "── 21.11.2026 20:08 · LinkedIn · Gelen · Konu: X ──"; panel bunu sohbet gibi
 *    (giden sagda, gelen solda) gosterir (web lib/konusma.ts ayni bicimi okur).
 *    Gelen mesaj kaydi "Cevap verdi" yapar, hatirlatmayi kaldirir, giden sayacina girmez.
 */

export type Kanal = 'LINKEDIN' | 'EPOSTA';
/** GIDEN = kurucunun yazdigi, GELEN = karsi tarafin cevabi */
export type Yon = 'GIDEN' | 'GELEN';

export interface ElleKayitGirdi {
  kanal?: string;
  ad?: string;
  soyad?: string;
  firma?: string;
  unvan?: string | null;
  profileUrl?: string | null;
  eposta?: string | null;
  /** E-posta konusu ya da InMail basligi (varsa metnin basina yazilir) */
  konu?: string | null;
  mesaj?: string;
  /** Gonderim ani (ISO). Bos = simdi */
  gonderimAt?: string | null;
  /** Hatirlatma (ISO). Bos = gonderimden 4 is gunu sonra 10:00 */
  hatirlatmaAt?: string | null;
  /** Cevap da geldiyse true → kayit "Cevap verdi" olarak duser */
  cevapGeldi?: boolean;
  /** Bu mesaji kim yazdi (bos = GIDEN) */
  yon?: string | null;
}

export interface ElleKayitHazir {
  kanal: Kanal;
  ad: string;
  soyad: string;
  firma: string;
  unvan: string | null;
  /** Tekil anahtar: LinkedIn profil linki ya da mailto:<adres> */
  anahtar: string;
  eposta: string | null;
  /** Tarih basligiyla mesaj blogu (kaydin metnine eklenir) */
  blok: string;
  gonderimAt: Date;
  hatirlatmaAt: Date;
  cevapGeldi: boolean;
  yon: Yon;
}

export const HATIRLATMA_IS_GUNU = 4;
const MESAJ_SINIR = 8000;
const EPOSTA_RE = /^[^\s@<>()]+@[^\s@<>()]+\.[^\s@<>()]{2,}$/;

/** "a@b.com" → "a@b.com" (kucuk harf); gecersizse null */
export function normalizeEposta(input: string | null | undefined): string | null {
  const s = (input ?? '').trim().replace(/^mailto:/i, '').toLowerCase();
  return EPOSTA_RE.test(s) && s.length <= 191 ? s : null;
}

/** "Kaan Küçükarslan" tek alana yazildiysa ad / soyad ayir (son kelime soyad) */
export function adSoyadAyir(ad: string, soyad: string): { ad: string; soyad: string } {
  const a = ad.replace(/\s+/g, ' ').trim();
  const s = soyad.replace(/\s+/g, ' ').trim();
  if (s || !a.includes(' ')) return { ad: a, soyad: s };
  const parca = a.split(' ');
  return { ad: parca.slice(0, -1).join(' '), soyad: parca[parca.length - 1] };
}

/** Istanbul takvim gunu (YYYY-MM-DD) uzerinde n IS GUNU ileri git; Istanbul 10:00 (UTC ani) dondur */
export function isGunuSonra(baslangic: Date, isGunu = HATIRLATMA_IS_GUNU): Date {
  const { ymd } = istanbulParts(baslangic);
  // Ogle vakti UTC ile gun gezmek, saat dilimi kaymasina karsi guvenli
  const d = new Date(`${ymd}T12:00:00+03:00`);
  let kalan = isGunu;
  while (kalan > 0) {
    d.setUTCDate(d.getUTCDate() + 1);
    const gun = istanbulParts(d).weekday;
    if (gun !== 0 && gun !== 6) kalan--;
  }
  return new Date(`${istanbulParts(d).ymd}T10:00:00+03:00`);
}

/** Istanbul saati "HH:MM" */
function istanbulSaat(at: Date): string {
  return new Intl.DateTimeFormat('tr-TR', { timeZone: 'Europe/Istanbul', hour: '2-digit', minute: '2-digit', hour12: false }).format(at);
}

/**
 * Tarih basligi: "── 20.11.2026 15:00 · E-posta · Gelen · Yazan: Talat · Konu: X ──" (Konu her zaman sonda).
 * Yazan (28.11.2026, iki yonetici): giden mesaji hangi yoneticinin yazdigi; web lib/konusma.ts okur.
 */
export function blokBasligi(kanal: Kanal, at: Date, konu?: string | null, yon: Yon = 'GIDEN', yazan?: string | null): string {
  const { ymd } = istanbulParts(at);
  const [y, m, g] = ymd.split('-');
  const parca = [`${g}.${m}.${y} ${istanbulSaat(at)}`, kanal === 'EPOSTA' ? 'E-posta' : 'LinkedIn'];
  if (yon === 'GELEN') parca.push('Gelen');
  const yz = (yazan ?? '').replace(/[·─]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 40);
  if (yz) parca.push(`Yazan: ${yz}`);
  if (konu && konu.trim()) parca.push(`Konu: ${konu.trim().replace(/\s+/g, ' ').replace(/──/g, '—').slice(0, 200)}`);
  return `── ${parca.join(' · ')} ──`;
}

/** Mevcut metne yeni blogu ekle. Ayni blok zaten varsa (cift gonderim) metin degismez. */
export function metneEkle(mevcut: string | null | undefined, blok: string): string {
  const eski = (mevcut ?? '').trim();
  if (!eski) return blok;
  if (eski.includes(blok)) return eski;
  return `${eski}\n\n${blok}`.slice(-60_000);
}

function tarihOku(v: string | null | undefined, ad: string): Date | null {
  if (v === undefined || v === null || String(v).trim() === '') return null;
  const d = new Date(String(v));
  if (Number.isNaN(d.getTime())) throw new Error(`${ad} okunamadı`);
  return d;
}

/** Girdiyi dogrula ve kayda hazirla. Eksik / gecersiz alanda acik Turkce hata firlatir. */
/** `yazan`: kaydi giren yonetici; GIDEN mesajin basligina yazilir (GELEN'i karsi taraf yazdi) */
export function elleKayitHazirla(g: ElleKayitGirdi, now: Date = new Date(), yazan?: string | null): ElleKayitHazir {
  const kanal: Kanal = String(g.kanal ?? 'LINKEDIN').toUpperCase() === 'EPOSTA' ? 'EPOSTA' : 'LINKEDIN';
  const yon: Yon = String(g.yon ?? 'GIDEN').toUpperCase() === 'GELEN' ? 'GELEN' : 'GIDEN';
  const { ad, soyad } = adSoyadAyir(String(g.ad ?? ''), String(g.soyad ?? ''));
  const firma = String(g.firma ?? '').replace(/\s+/g, ' ').trim();
  const mesaj = String(g.mesaj ?? '').replace(/\r\n/g, '\n').trim();
  if (!ad) throw new Error('Ad gerekli');
  if (!firma) throw new Error('Firma gerekli');
  if (!mesaj) throw new Error('Gönderilen mesaj metni gerekli');

  let anahtar: string;
  let eposta: string | null = null;
  if (kanal === 'EPOSTA') {
    eposta = normalizeEposta(g.eposta);
    if (!eposta) throw new Error('Geçerli bir e-posta adresi gerekli');
    anahtar = `mailto:${eposta}`;
  } else {
    const u = normalizeProfileUrl(g.profileUrl);
    if (!u) throw new Error('LinkedIn profil linki gerekli (linkedin.com/in/...)');
    anahtar = u;
    eposta = normalizeEposta(g.eposta);
  }

  const gonderimAt = tarihOku(g.gonderimAt, 'Gönderim tarihi') ?? now;
  if (gonderimAt.getTime() > now.getTime() + 5 * 60_000) throw new Error('Gönderim tarihi ileri bir tarih olamaz');
  const hatirlatmaAt = tarihOku(g.hatirlatmaAt, 'Hatırlatma tarihi') ?? isGunuSonra(gonderimAt);

  return {
    kanal,
    ad: ad.slice(0, 80),
    soyad: soyad.slice(0, 80),
    firma: firma.slice(0, 160),
    unvan: g.unvan ? String(g.unvan).trim().slice(0, 160) || null : null,
    anahtar,
    eposta,
    blok: `${blokBasligi(kanal, gonderimAt, g.konu, yon, yon === 'GIDEN' ? yazan : null)}\n${mesaj.slice(0, MESAJ_SINIR)}`,
    gonderimAt,
    hatirlatmaAt,
    // Karsi tarafin mesaji kaydediliyorsa kisi cevap vermistir
    cevapGeldi: g.cevapGeldi === true || yon === 'GELEN',
    yon,
  };
}
