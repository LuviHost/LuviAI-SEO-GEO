/**
 * Yerel olcum: isletmenin NAP'i (ad-adres-telefon) — site tarafi, AI cevabi
 * tarafi ve ikisinin karsilastirmasi (saf; ag ve veritabani yok).
 *
 * NEDEN: yerel isletme icin "AI beni onerdi mi" tek basina yetmiyor; asistan
 * markayi yanlis numara ya da baska ilceyle verirse musteri yanlis yere
 * gider. Burada yalnizca OLCULEBILIR olani yapiyoruz:
 *   - Site NAP'i: sitenin kendi LocalBusiness JSON-LD'si ve tel: baglantilari.
 *     Baska kaynaktan (harita, rehber) tahmin YOK — yoksa "bilinmiyor".
 *   - Cevap NAP'i: cevapta markanin gectigi madde/paragrafta yazan telefon ve
 *     adres benzeri metin.
 *   - Telefon E.164 ile (tr-phone.ts), adres ilce/il adlariyla karsilastirilir.
 *     Sokak/no karsilastirmasi yapilmaz — AI cevaplari adresi farkli yazar,
 *     yanlis "farkli" demek dogru "bilinmiyor" demekten kotudur.
 *
 * LocalBusiness alt turleri WS4'un schema-org-types.ts modulunden (Google en
 * spesifik alt turu ister, sitede HairSalon/Dentist olabilir).
 */
import { foldForMatch } from '../common/text-normalize.js';
import { collectTypedNodes, isLocalBusinessType, schemaTypesOf } from './schema-org-types.js';
import { hostMentionIndex } from './host-match.js';
import { extractTrPhones, normalizeTrPhone } from './tr-phone.js';

// ────────────────────────────────────────────────────────────
//  YER ADLARI
// ────────────────────────────────────────────────────────────

/**
 * Karsilastirma katlamasi: Turkce harfler Latin esine, kucuk harf. AI
 * cevaplari "Kadikoy" / "Kadıköy" ikisini de yazabiliyor.
 */
export function foldPlace(s: string): string {
  return foldForMatch(s || '')
    .replace(/ç/g, 'c').replace(/ğ/g, 'g').replace(/ş/g, 's')
    .replace(/ö/g, 'o').replace(/ü/g, 'u')
    .replace(/[âà]/g, 'a').replace(/[îì]/g, 'i').replace(/[ûù]/g, 'u')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * 81 il. Liste BTK'nin ITU'ya bildirdigi numaralandirma planindaki il bazli
 * alan kodu tablosundan (https://www.itu.int/oth/T02020000D6) — tabloda 81
 * il var; Istanbul iki kodla. Ayni il/alan kodu listesi:
 * https://en.wikipedia.org/wiki/Telephone_numbers_in_Turkey. Takma adlar
 * gundelik yazimlar ("Antep", "Urfa") ve eski ad (İçel → Mersin).
 */
const PROVINCES: ReadonlyArray<readonly [string, ...string[]]> = [
  ['Adana'], ['Adıyaman'], ['Afyonkarahisar', 'Afyon'], ['Ağrı'], ['Aksaray'], ['Amasya'], ['Ankara'],
  ['Antalya'], ['Ardahan'], ['Artvin'], ['Aydın'], ['Balıkesir'], ['Bartın'], ['Batman'], ['Bayburt'],
  ['Bilecik'], ['Bingöl'], ['Bitlis'], ['Bolu'], ['Burdur'], ['Bursa'], ['Çanakkale'], ['Çankırı'],
  ['Çorum'], ['Denizli'], ['Diyarbakır'], ['Düzce'], ['Edirne'], ['Elazığ'], ['Erzincan'], ['Erzurum'],
  ['Eskişehir'], ['Gaziantep', 'Antep'], ['Giresun'], ['Gümüşhane'], ['Hakkari', 'Hakkâri'], ['Hatay'],
  ['Iğdır'], ['Isparta'], ['İstanbul'], ['İzmir'], ['Kahramanmaraş', 'Maraş'], ['Karabük'], ['Karaman'],
  ['Kars'], ['Kastamonu'], ['Kayseri'], ['Kilis'], ['Kırıkkale'], ['Kırklareli'], ['Kırşehir'],
  ['Kocaeli'], ['Konya'], ['Kütahya'], ['Malatya'], ['Manisa'], ['Mardin'], ['Mersin', 'İçel'],
  ['Muğla'], ['Muş'], ['Nevşehir'], ['Niğde'], ['Ordu'], ['Osmaniye'], ['Rize'], ['Sakarya'],
  ['Samsun'], ['Siirt'], ['Sinop'], ['Sivas'], ['Şanlıurfa', 'Urfa'], ['Şırnak'], ['Tekirdağ'],
  ['Tokat'], ['Trabzon'], ['Tunceli'], ['Uşak'], ['Van'], ['Yalova'], ['Yozgat'], ['Zonguldak'],
];

const PROVINCE_BY_FOLD: ReadonlyMap<string, string> = new Map(
  PROVINCES.flatMap(([canonical, ...aliases]) =>
    [canonical, ...aliases].map((n) => [foldPlace(n), canonical] as [string, string])),
);

export const TR_PROVINCE_COUNT = PROVINCES.length;

/** "istanbul", "İstanbul'da", "Antep" → kanonik il adi; il degilse null */
export function provinceOf(token: string): string | null {
  const head = String(token || '').split(/['’]/)[0];
  return PROVINCE_BY_FOLD.get(foldPlace(head)) ?? null;
}

/**
 * Il plaka kodlari 01..81 (dizi sirasi = kod). Turkiye posta kodu bes
 * hanelidir ve ilk iki hanesi ilin plaka kodudur. Iki kaynak:
 * https://en.wikipedia.org/wiki/Postal_codes_in_Turkey ("five digits starting
 * with the two digit license plate code of the provinces") ve CNN Turk
 * posta kodu rehberi ("Posta kodları il plakalarına göre belirlenmektedir";
 * Bursa ilceleri 16xxx). Kod listesi:
 * https://en.wikipedia.org/wiki/Vehicle_registration_plates_of_Turkey
 */
const PLATE_PROVINCES: readonly string[] = [
  'Adana', 'Adıyaman', 'Afyonkarahisar', 'Ağrı', 'Amasya', 'Ankara', 'Antalya', 'Artvin', 'Aydın', 'Balıkesir',
  'Bilecik', 'Bingöl', 'Bitlis', 'Bolu', 'Burdur', 'Bursa', 'Çanakkale', 'Çankırı', 'Çorum', 'Denizli',
  'Diyarbakır', 'Edirne', 'Elazığ', 'Erzincan', 'Erzurum', 'Eskişehir', 'Gaziantep', 'Giresun', 'Gümüşhane', 'Hakkari',
  'Hatay', 'Isparta', 'Mersin', 'İstanbul', 'İzmir', 'Kars', 'Kastamonu', 'Kayseri', 'Kırklareli', 'Kırşehir',
  'Kocaeli', 'Konya', 'Kütahya', 'Malatya', 'Manisa', 'Kahramanmaraş', 'Mardin', 'Muğla', 'Muş', 'Nevşehir',
  'Niğde', 'Ordu', 'Rize', 'Sakarya', 'Samsun', 'Siirt', 'Sinop', 'Sivas', 'Tekirdağ', 'Tokat',
  'Trabzon', 'Tunceli', 'Şanlıurfa', 'Uşak', 'Van', 'Yozgat', 'Zonguldak', 'Aksaray', 'Bayburt', 'Karaman',
  'Kırıkkale', 'Batman', 'Şırnak', 'Bartın', 'Ardahan', 'Iğdır', 'Yalova', 'Karabük', 'Kilis', 'Osmaniye',
  'Düzce',
];

/** Bes haneli Turkiye posta kodundan il ("34710" → "İstanbul"); kod gecersizse null */
export function provinceFromPostalCode(code: unknown): string | null {
  const m = /^\s*(\d{2})\d{3}\s*$/.exec(typeof code === 'number' ? String(code) : typeof code === 'string' ? code : '');
  if (!m) return null;
  const plate = Number(m[1]);
  return plate >= 1 && plate <= PLATE_PROVINCES.length ? PLATE_PROVINCES[plate - 1] : null;
}

/** Ilce yerine gecemeyen genel sozcukler — "Merkez" her ilde var */
const NOT_A_DISTRICT = new Set(['merkez', 'turkiye', 'turkey', 'tr', 'turkiye cumhuriyeti']);

/** Sokak/bina sozcukleri — ilce sanilmasin ("No:12", "Cad.") */
const STREETISH = /^(?:no|kat|daire|d|blok|mah|mahalle|mahallesi|mh|cad|cd|cadde|caddesi|sok|sk|sokak|sokagi|blv|bulvar|bulvari|apt|apartmani|is merkezi|plaza|site|sitesi)\b|\d/;

/**
 * Parcanin herhangi bir yerinde mahalle/sokak/bina isareti (katlanmis metinde).
 * STREETISH basa bagli oldugu icin "Caferağa Mah." yakalanmiyor, mahalle ilce
 * sayiliyordu ("Caferağa Mah., Kadıköy" → ilce "Caferağa Mah.").
 */
const STREET_MARK = /(?:^|[^a-z0-9])(?:mah|mahalle|mahallesi|mh|cad|cd|cadde|caddesi|sok|sk|sokak|sokagi|blv|bulvar|bulvari|yolu|apt|apartmani|sitesi|plaza|is merkezi|no|kat|daire)(?=$|[^a-z0-9])/;

/** addressCountry Turkiye mi ya da hic yazilmamis mi (posta kodundan il cikarmak icin) */
function turkishOrUnstated(country: unknown): boolean {
  const raw = typeof country === 'string'
    ? country
    : country && typeof country === 'object' ? str((country as Record<string, unknown>).name) : '';
  const f = foldPlace(raw);
  return !f || ['tr', 'tur', 'turkiye', 'turkey', 'turkiye cumhuriyeti', 'republic of turkiye', 'republic of turkey'].includes(f);
}

// ────────────────────────────────────────────────────────────
//  SITE NAP'I — LocalBusiness JSON-LD + tel: baglantilari
// ────────────────────────────────────────────────────────────

export interface NapAddress {
  street: string | null;
  /** Ilce (ya da semt) — ornek "Kadıköy" */
  district: string | null;
  /** Il, kanonik adla — ornek "İstanbul" */
  city: string | null;
  postalCode: string | null;
}

export type SiteNapSource = 'json-ld' | 'tel-link';

export interface SiteNap {
  /** E.164, tekrarsiz, en fazla 10 */
  phones: string[];
  /** En fazla 5 (cok subeli isletme) */
  addresses: NapAddress[];
  sources: SiteNapSource[];
  /** Bulunan LocalBusiness turleri (orn. "HairSalon") */
  businessTypes: string[];
}

const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : typeof v === 'number' ? String(v) : '');
const asList = (v: unknown): unknown[] => (Array.isArray(v) ? v : v === undefined || v === null ? [] : [v]);
const titleTr = (s: string) => s.replace(/\s+/g, ' ').trim();

function splitPlace(s: string): string[] {
  return s.split(/[,/|–—-]+/).map((p) => p.trim()).filter(Boolean);
}

/**
 * Duz metin adres: "Caferağa Mah. Moda Cad. No:12, 34710 Kadıköy/İstanbul".
 * Il = metindeki son il adi; ilce = ilden hemen onceki, sokak/numara olmayan
 * kelime. Ilce listesi tutmuyoruz; bu yuzden emin olunmayan durumda ilce bos
 * kalir — o zaman karsilastirma yalniz il adiyla yapilir.
 */
export function parsePlainAddress(raw: string): NapAddress | null {
  const text = titleTr(String(raw || '')).slice(0, 300);
  if (!text) return null;
  const words = [...text.matchAll(/[\p{L}][\p{L}'’.]*/gu)].map((m) => ({ w: m[0].replace(/\.$/, ''), at: m.index ?? 0 }));
  let cityIdx = -1;
  let city: string | null = null;
  for (let i = words.length - 1; i >= 0; i--) {
    const p = provinceOf(words[i].w);
    if (p) { city = p; cityIdx = i; break; }
  }
  let district: string | null = null;
  if (cityIdx > 0) {
    const prev = words[cityIdx - 1];
    const between = text.slice(prev.at + prev.w.length, words[cityIdx].at);
    const prevFold = foldPlace(prev.w);
    // Arada yalniz ayirici olmali ("Kadıköy/İstanbul", "Kadıköy, İstanbul", "Kadıköy İstanbul")
    if (/^[\s,/|–—-]*$/.test(between) && prev.w.length >= 3 && !STREETISH.test(prevFold)
      && !NOT_A_DISTRICT.has(prevFold) && !provinceOf(prev.w)) {
      district = prev.w.split(/['’]/)[0];
    }
  }
  const postalCode = /\b(\d{5})\b/.exec(text)?.[1] ?? null;
  let street: string | null = null;
  const cut = district ? text.lastIndexOf(district) : city && cityIdx >= 0 ? words[cityIdx].at : -1;
  if (cut > 0) street = text.slice(0, cut).replace(/\b\d{5}[\s,/|–—-]*$/, '').replace(/[\s,/|–—-]+$/, '').trim() || null;
  else if (!city) street = text;
  if (!district && !city && !street) return null;
  return { street: street ? street.slice(0, 120) : null, district, city, postalCode };
}

/** schema.org PostalAddress (ya da duz metin address) → NapAddress */
export function addressFromSchema(value: unknown): NapAddress | null {
  const v = Array.isArray(value) ? value[0] : value;
  if (typeof v === 'string') return parsePlainAddress(v);
  if (!v || typeof v !== 'object') return null;
  const a = v as Record<string, unknown>;
  const localityParts = splitPlace(str(a.addressLocality));
  const regionParts = splitPlace(str(a.addressRegion));
  let city: string | null = null;
  for (const p of [...regionParts, ...localityParts]) {
    const prov = provinceOf(p);
    if (prov) { city = prov; break; }
  }
  // Ilce yalniz addressLocality'den: addressRegion il ya da cografi bolge
  // ("Marmara") olur, ilce degil. Mahalle/sokak isaretli parca atlanir ve
  // SON uygun parca alinir: Turkce adres ozelden genele yazilir
  // ("Caferağa Mah., Moda, Kadıköy" → "Kadıköy").
  let district: string | null = null;
  for (const p of localityParts) {
    const f = foldPlace(p);
    if (provinceOf(p) || NOT_A_DISTRICT.has(f) || f.length < 3 || /\d/.test(f) || STREET_MARK.test(f)) continue;
    district = titleTr(p);
  }
  const street = str(a.streetAddress) || null;
  let streetPostal: string | null = null;
  // Tum adresi streetAddress'e yazan siteler: ilce/il oradan cikar
  if ((!district || !city) && street) {
    const parsed = parsePlainAddress(street);
    if (parsed) {
      if (!city) city = parsed.city;
      if (!district && parsed.district && parsed.city) district = parsed.district;
      streetPostal = parsed.postalCode;
    }
  }
  const postalCode = str(a.postalCode) || null;
  // Il hala yoksa (addressRegion "Marmara" ya da bos) posta kodunun ilk iki
  // hanesi il plaka kodudur — yalniz adres Turkiye'deyse ya da ulke yazilmamissa
  if (!city && turkishOrUnstated(a.addressCountry)) city = provinceFromPostalCode(postalCode ?? streetPostal);
  if (!street && !district && !city) return null;
  return { street: street ? street.slice(0, 120) : null, district, city, postalCode };
}

function sameAddress(a: NapAddress, b: NapAddress): boolean {
  return foldPlace(a.district ?? '') === foldPlace(b.district ?? '')
    && foldPlace(a.city ?? '') === foldPlace(b.city ?? '')
    && foldPlace(a.street ?? '') === foldPlace(b.street ?? '');
}

/**
 * JSON-LD bloklarindan (parse edilmis) LocalBusiness telefon + adresleri.
 * Organization'in telefonu BILEREK alinmaz: cogu zaman genel merkez / cagri
 * merkezi numarasidir; yerel karsilastirmada yanlis "farkli" uretir.
 */
export function siteNapFromJsonLd(blocks: unknown[]): Pick<SiteNap, 'phones' | 'addresses' | 'businessTypes'> {
  const phones: string[] = [];
  const addresses: NapAddress[] = [];
  const businessTypes: string[] = [];
  for (const block of asList(blocks)) {
    for (const node of collectTypedNodes(block)) {
      const types = schemaTypesOf(node);
      const lb = types.find((t) => isLocalBusinessType(t) && t !== 'LocalBusiness') ?? types.find(isLocalBusinessType);
      if (!lb) continue;
      if (!businessTypes.includes(lb)) businessTypes.push(lb);
      for (const t of asList(node.telephone)) {
        const e164 = normalizeTrPhone(str(t));
        if (e164 && !phones.includes(e164)) phones.push(e164);
      }
      const addr = addressFromSchema(node.address);
      if (addr && !addresses.some((x) => sameAddress(x, addr))) addresses.push(addr);
    }
  }
  return { phones: phones.slice(0, 10), addresses: addresses.slice(0, 5), businessTypes: businessTypes.slice(0, 5) };
}

/** <a href="tel:..."> degerleri → E.164 */
export function phonesFromTelHrefs(hrefs: unknown[]): string[] {
  const out: string[] = [];
  for (const h of asList(hrefs)) {
    const s = str(h);
    if (!/^tel:/i.test(s)) continue;
    const e164 = normalizeTrPhone(s);
    if (e164 && !out.includes(e164)) out.push(e164);
  }
  return out.slice(0, 10);
}

/** Birden fazla sayfanin bulgularini birlestirir (anasayfa + iletisim sayfasi) */
export function mergeSiteNap(parts: Array<Partial<SiteNap>>): SiteNap {
  const out: SiteNap = { phones: [], addresses: [], sources: [], businessTypes: [] };
  for (const p of parts) {
    for (const ph of p.phones ?? []) if (!out.phones.includes(ph)) out.phones.push(ph);
    for (const a of p.addresses ?? []) if (!out.addresses.some((x) => sameAddress(x, a))) out.addresses.push(a);
    for (const s of p.sources ?? []) if (!out.sources.includes(s)) out.sources.push(s);
    for (const t of p.businessTypes ?? []) if (!out.businessTypes.includes(t)) out.businessTypes.push(t);
  }
  out.phones = out.phones.slice(0, 10);
  out.addresses = out.addresses.slice(0, 5);
  return out;
}

/** Tek sayfanin JSON-LD + tel: bulgulari */
export function siteNapFromPage(input: { jsonLdBlocks?: unknown[]; telHrefs?: unknown[] }): SiteNap {
  const ld = siteNapFromJsonLd(input.jsonLdBlocks ?? []);
  const tel = phonesFromTelHrefs(input.telHrefs ?? []);
  const sources: SiteNapSource[] = [];
  if (ld.phones.length || ld.addresses.length) sources.push('json-ld');
  if (tel.length) sources.push('tel-link');
  return mergeSiteNap([{ ...ld, sources }, { phones: tel }]);
}

/** Karsilastirmada kullanilabilir bir NAP var mi (telefon ya da ilce/il) */
export function hasUsableNap(nap: Pick<SiteNap, 'phones' | 'addresses'> | null | undefined): boolean {
  return !!nap && (nap.phones.length > 0 || nap.addresses.some((a) => !!(a.district || a.city)));
}

// ────────────────────────────────────────────────────────────
//  CEVAP TARAFI — markanin yaninda gecen telefon / adres
// ────────────────────────────────────────────────────────────

export interface AnswerNapSignal {
  /** Markanin gectigi madde/paragrafta, markadan SONRA gecen numaralar (E.164, en fazla 3) */
  nearPhones: string[];
  /**
   * Cevaptaki tum Turkiye numaralari (E.164, en fazla MAX_ANSWER_PHONES; nearPhones
   * her zaman dahil) — "sitedeki numara cevapta var mi" icin. Eski kayitlarda en fazla 10.
   */
  allPhones: string[];
  /** Markanin yanindaki adres benzeri metin (en fazla 160 karakter) */
  address: string | null;
}

/** brand-in-query.ts BrandMatcher'in burada gereken kismi */
export interface NapBrandMatcher {
  indexInFolded(foldedText: string): number | null;
  readonly matchLength: number;
  /** www'suz alan adi — cevap isletmeyi yalniz alan adiyla anarsa da madde bulunur */
  readonly host?: string;
}

const HEADING = /^\s{0,3}#{1,6}\s/;
const LIST_MARKER = /^\s*(?:\d{1,2}[.)]|[-*•–])\s+/;
/** Isletme maddesinin ayrinti satiri — "Adres:", "Telefon:", "📞 0216..." */
const DETAIL_LABEL = /^(?:adres|address|konum|lokasyon|location|yer|telefon|tel|phone|gsm|cep|iletisim|contact|whatsapp|calisma saat|acilis|saat|web|website|site|e-?posta|email|mail|puan|rating|degerlendirme|yorum|fiyat|ucret|hizmet|uzmanlik|ozellik|not|neden|instagram|harita)/;
/** Adres ipuclari (katlanmis metinde) */
const ADDRESS_HINT = /(?:^|[^a-z0-9])(?:mah(?:alle(?:si)?)?\.?|mh\.|cad(?:de(?:si)?)?\.?|cd\.|sok(?:ak|agi)?\.?|sk\.|blv\.?|bulvari?|no\s*[:.]?\s*\d|kat\s*[:.]?\s*\d|adres|address)(?=$|[^a-z])/;

const MAX_BLOCK_CHARS = 700;
const MAX_REGION_AFTER_BRAND = 500;
const MAX_BRAND_MENTIONS = 8;
/**
 * allPhones tavani. Liste yalniz eslestirme icin; tavan yalnizca snapshot'a
 * yazilan probe'un boyutunu sinirlar. Eskiden 10'du: 11 rakip numarasinin
 * ardindan gelen sitenin kendi numarasi listeye girmiyor, sonuc yanlislikla
 * "farkli" ya da "yok" oluyordu.
 */
export const MAX_ANSWER_PHONES = 50;

function indentOf(line: string): number {
  return /^\s*/.exec(line)?.[0].length ?? 0;
}

/** Satir isletme maddesinin devami mi (ayrinti etiketi, numara ile baslayan satir, daha icerde alt madde) */
function isDetailLine(line: string, baseIndent: number): boolean {
  if (!line.trim() || HEADING.test(line)) return false;
  const stripped = line.replace(LIST_MARKER, '').replace(/^[\s*_~`>]+/, '').replace(/^[^\p{L}\p{N}+(]+/u, '');
  if (DETAIL_LABEL.test(foldPlace(stripped))) return true;
  if (/^[+(\d]/.test(stripped)) return true;
  return indentOf(line) > baseIndent && LIST_MARKER.test(line);
}

/** Ardisik aramayla tum gecislerin (katlanmis metinde) baslangic indeksleri */
function allPositions(folded: string, find: (s: string) => number | null, step: number): number[] {
  const out: number[] = [];
  let offset = 0;
  while (offset < folded.length && out.length < MAX_BRAND_MENTIONS) {
    const idx = find(folded.slice(offset));
    if (idx === null || idx === undefined) break;
    const abs = offset + idx;
    out.push(abs);
    // Donen indeks eslesmenin onundeki sinir karakteri olabilir — eslesme sonrasina atla
    offset = abs + Math.max(1, step) + 1;
  }
  return out;
}

/**
 * Marka ADI ve alan adi gecisleri. Model isletmeyi "lavantakuafor.com" diye
 * anip adini yazmayabilir; o madde de isletmenindir (olcumde cited sayilir).
 */
function brandPositions(folded: string, matcher: NapBrandMatcher): number[] {
  const byName = allPositions(folded, (s) => matcher.indexInFolded(s), matcher.matchLength);
  const host = matcher.host;
  const byHost = host ? allPositions(folded, (s) => hostMentionIndex(s, host), host.length) : [];
  return [...new Set([...byName, ...byHost])].sort((a, b) => a - b).slice(0, MAX_BRAND_MENTIONS);
}

/** "### Salon X" ya da tek basina kalin ad ("1. **Salon X**") — altindaki duz satirlar o isletmeye ait */
const TITLE_LINE = /^\s*(?:#{1,6}\s+|(?:\d{1,2}[.)]\s*|[-*•]\s*)?\*\*[^*\n]{2,80}\*\*\s*:?\s*$)/;

/** Yeni bir isletme maddesi baslayabilir mi (baslik, kalin ad, ayni seviyede madde) */
function startsNewItem(line: string, baseIndent: number): boolean {
  return HEADING.test(line) || TITLE_LINE.test(line) || (LIST_MARKER.test(line) && indentOf(line) <= baseIndent);
}

/**
 * Markanin gectigi yerden itibaren "o isletmenin maddesi": ayni satir +
 * ardindan gelen ayrinti satirlari (bos satir ancak ardindan yine ayrinti
 * geliyorsa atlanir). Marka bir baslik satirindaysa altindaki duz aciklama
 * satirlari da maddeye dahildir. Yeni baslik, yeni madde ya da duz paragraf
 * bloku bitirir.
 */
function regionAfter(text: string, pos: number): string {
  const lineStart = text.lastIndexOf('\n', pos - 1) + 1;
  const lines = text.slice(lineStart).split('\n');
  const baseIndent = indentOf(lines[0]);
  const underTitle = TITLE_LINE.test(lines[0]);
  let end = lines[0].length;
  let k = 1;
  while (k < lines.length && end < MAX_BLOCK_CHARS) {
    const line = lines[k];
    if (!line.trim()) {
      let n = k + 1;
      while (n < lines.length && !lines[n].trim()) n++;
      if (n < lines.length && isDetailLine(lines[n], baseIndent)) {
        for (let b = k; b < n; b++) end += lines[b].length + 1;
        k = n;
        continue;
      }
      break;
    }
    const continues = isDetailLine(line, baseIndent) || (underTitle && !startsNewItem(line, baseIndent));
    if (!continues) break;
    end += line.length + 1;
    k++;
  }
  const from = pos - lineStart;
  return text.slice(lineStart, lineStart + Math.min(end, MAX_BLOCK_CHARS)).slice(from, from + MAX_REGION_AFTER_BRAND);
}

/** Uzunlugu koruyan katlama — indeksler gorunum metninde de gecerli kalsin (bkz. foldForMatch) */
function foldKeepLength(s: string): string | null {
  const f = foldForMatch(s);
  if (f.length !== s.length) return null;
  return f.replace(/ç/g, 'c').replace(/ğ/g, 'g').replace(/ş/g, 's').replace(/ö/g, 'o').replace(/ü/g, 'u')
    .replace(/[âà]/g, 'a').replace(/[îì]/g, 'i').replace(/[ûù]/g, 'u');
}

/** Cumle sonu sayilmayan kisaltmalar ("Mah. Moda Cad. No. 12", "Dr. Ayşe") */
const ABBREVIATION = /^(?:mah|mh|cad|cd|sok|sk|blv|bul|no|apt|d|k|kat|dr|av|op|prof|doç|doc|uzm|st|vb)$/i;
const ADDRESS_LABEL = /(?:adres|address|konum)\s*[:：]\s*/i;
/** Adresten sonra gelen baska bir ayrinti etiketi — alinti orada biter */
const NEXT_LABEL = /[,;|]?\s*(?:tel(?:efon)?|phone|gsm|cep|whatsapp|web(?:site|sitesi)?|e-?posta|e-?mail|çalışma saatleri|saatler)\s*[:：]/i;

/** `at` konumunu iceren cumle — adres kisaltmalarindaki noktalar cumle sonu sayilmaz */
function sentenceAround(line: string, at: number): string {
  let start = 0;
  let end = line.length;
  for (const m of line.matchAll(/([\p{L}\d]+)[\])"'”’]*[.!?]+\s+/gu)) {
    if (ABBREVIATION.test(m[1])) continue;
    const b = (m.index ?? 0) + m[0].length;
    if (b <= at) start = b;
    else { end = b; break; }
  }
  return line.slice(start, end);
}

/**
 * Bolgedeki adres benzeri metinden kisa alinti — kullaniciya kanit olarak
 * gosterilir, karsilastirma da bunun uzerinden yapilir. "Adres:" etiketi
 * varsa etiketten sonraki kisim, tablo satirinda ipucunu tasiyan hucre, duz
 * paragrafta ipucunun gectigi cumle alinir.
 */
function addressSnippet(region: string): string | null {
  for (const rawLine of region.split('\n')) {
    if (!ADDRESS_HINT.test(foldPlace(rawLine))) continue;
    let line = rawLine;
    if (line.includes('|')) {
      const cell = line.split('|').find((c) => ADDRESS_HINT.test(foldPlace(c)));
      if (cell) line = cell;
    }
    line = line.replace(LIST_MARKER, '').replace(/\*\*|__|`|\*/g, '').replace(/\s+/g, ' ').trim();
    const label = ADDRESS_LABEL.exec(line);
    if (label) {
      line = line.slice(label.index + label[0].length);
    } else {
      const folded = foldKeepLength(line);
      const hint = folded ? ADDRESS_HINT.exec(folded) : null;
      if (hint) line = sentenceAround(line, hint.index);
    }
    line = line.split(NEXT_LABEL)[0].replace(/^[\s,;:–—-]+|[\s,;:–—-]+$/g, '');
    if (line.length > 160) line = `${line.slice(0, 160).replace(/\s+\S*$/, '')}…`;
    if (line) return line;
  }
  return null;
}

/**
 * Ayni satirda marka ile numara arasinda baska bir isletme adi basliyor mu
 * ("Lavanta Kuaför ve Rakip Salon (0216 ...)"). Varsa numara rakibindir;
 * markaya yazilirsa yanlis "farkli numara" uretir. Turkce'de yer adlari da
 * buyuk harfle basladigi icin yalniz baglacla (ve/ile/veya...) baslayan ad
 * sayilir — "Lavanta Kuaför, Moda'da, 0216 ..." markanindir.
 */
const ANOTHER_ENTITY = /\s(?:ve|ile|veya|ya da|ayrıca|and|or)\s+[*_"'“‘([]*\p{Lu}/u;

/**
 * AI cevabindan NAP sinyali. `text` normalizeText'ten gecmis gorunum metni,
 * `folded` onun foldForMatch hali (buildProbe ikisini zaten uretiyor).
 * Uzunluklar esit degilse indeksler katlanmis metinde aranir.
 *
 * Donus: hicbir sey bulunmadiysa null (olculdu, bos). Cagiran alanin
 * VARLIGINA bakarak "olculdu mu" sorusunu cevaplayabilsin diye undefined
 * degil null.
 */
export function answerNapSignal(text: string, folded: string, matcher: NapBrandMatcher): AnswerNapSignal | null {
  if (!text) return null;
  const source = text.length === folded.length ? text : folded;
  const allPhones = extractTrPhones(source, MAX_ANSWER_PHONES).map((p) => p.e164);
  const nearPhones: string[] = [];
  let address: string | null = null;
  for (const pos of brandPositions(folded, matcher)) {
    const region = regionAfter(source, pos);
    for (const p of extractTrPhones(region, 3)) {
      const before = region.slice(0, p.index);
      if (!before.includes('\n') && ANOTHER_ENTITY.test(before)) continue;
      if (!nearPhones.includes(p.e164) && nearPhones.length < 3) nearPhones.push(p.e164);
    }
    address ??= addressSnippet(region);
  }
  // Markanin yanindaki numara cevapta gecen numaradir; tavan yuzunden disarida kalmasin
  for (const p of nearPhones) if (!allPhones.includes(p)) allPhones.push(p);
  if (!allPhones.length && !nearPhones.length && !address) return null;
  return { nearPhones, allPhones, address };
}

// ────────────────────────────────────────────────────────────
//  KARSILASTIRMA
// ────────────────────────────────────────────────────────────

/**
 * eslesiyor  — sitedeki numara cevapta geciyor
 * farkli     — markanin yaninda numara var ama sitedekiyle ayni degil
 * yok        — markanin yaninda numara yok
 * bilinmiyor — sitede numara bulunamadi; karsilastirma yapilamaz
 * olculmedi  — bu olcumde cevap metni incelenemedi
 */
export type PhoneStatus = 'eslesiyor' | 'farkli' | 'yok' | 'bilinmiyor' | 'olculmedi';
/**
 * eslesiyor     — adres metninde sitedeki ilce ve il (hangisi biliniyorsa) geciyor
 * kismen        — biri geciyor, digeri gecmiyor
 * eslesmiyor    — sitedeki ilce/il gecmiyor VE adreste baska bir il adi geciyor
 *                 (yalniz sitedeki tum adreslerin ili biliniyorsa)
 * dogrulanamadi — adres benzeri metin var ama ilce/il adi yok ya da taninmadi;
 *                 "yanlis" denmez (ilce listesi tutmuyoruz), kullanici kontrol eder
 * yok / bilinmiyor / olculmedi — telefonla ayni anlam
 */
export type AddressStatus = 'eslesiyor' | 'kismen' | 'eslesmiyor' | 'dogrulanamadi' | 'yok' | 'bilinmiyor' | 'olculmedi';

export interface PhoneCheck { status: PhoneStatus; found: string[] }
export interface AddressCheck {
  status: AddressStatus;
  snippet: string | null;
  /** Adreste gecen site ilce/il adlari */
  matched: string[];
  /** eslesmiyor: adreste gecen baska il */
  otherCity: string | null;
}

export function comparePhone(storedSitePhones: string[], answer: AnswerNapSignal | null): PhoneCheck {
  const near = answer?.nearPhones ?? [];
  // Site NAP'i kv_store'da 14 gune kadar eski kurallarla normalize edilmis
  // durabilir ("0212 444 0 448" → +902124440448); cevapla ayni kurala indirilir
  const sitePhones = [...new Set(storedSitePhones.map((p) => normalizeTrPhone(p) ?? p))];
  if (!sitePhones.length) return { status: 'bilinmiyor', found: near };
  // Yakin + tum numaralarin birlesimi: eski kayitlarda allPhones 10'la kesikti
  // ve markanin yanindaki (dogru) numara orada olmayabiliyordu
  const pool = [...new Set([...near, ...(answer?.allPhones ?? [])])];
  const hit = pool.filter((p) => sitePhones.includes(p));
  if (hit.length) return { status: 'eslesiyor', found: hit };
  if (near.length) return { status: 'farkli', found: near };
  return { status: 'yok', found: [] };
}

/** Katlanmis metinde kelime sinirli gecis ("Kadıköy'de" eslesir, "Kadıköylü" eslesmez) */
function hasPlaceToken(foldedText: string, token: string): boolean {
  const t = foldPlace(token);
  if (t.length < 2) return false;
  const esc = t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?:^|[^a-z0-9])${esc}(?=$|[^a-z0-9])`).test(foldedText);
}

/** Il adindan sonra gelirse sokak adidir ("Ankara Cad.", "İzmir Sok.") — il sayilmaz */
const STREET_AFTER = /^(?:cad|cd|cadde|caddesi|sok|sk|sokak|sokagi|blv|bulvar|bulvari|mah|mh|mahalle|mahallesi|yolu|yol|apt|apartmani|sitesi|plaza|carsisi|pasaji|is)$/;

/** Adreste sitenin ilinden FARKLI bir il adi geciyor mu */
function otherProvinceIn(snippet: string, ourCities: Set<string>): string | null {
  const words = [...foldPlace(snippet).matchAll(/[a-z]+(?:['’][a-z]+)?/g)].map((m) => m[0]);
  for (let i = 0; i < words.length; i++) {
    const p = provinceOf(words[i]);
    if (!p || ourCities.has(p)) continue;
    if (STREET_AFTER.test(words[i + 1] ?? '')) continue;
    return p;
  }
  return null;
}

const ADDRESS_RANK: Record<AddressStatus, number> = {
  eslesiyor: 6, kismen: 5, eslesmiyor: 4, dogrulanamadi: 3, yok: 2, bilinmiyor: 1, olculmedi: 0,
};

/**
 * Karsilastirmada kullanilan adres. Duzeltmeden once okunup kv_store'da
 * saklanan (14 gune kadar) kayitlarda ilce olarak mahalle yazili olabilir
 * ("Caferağa Mah."); o ilce yok sayilir, yoksa dogru cevap "kismen" kalirdi.
 */
function comparableAddress(a: NapAddress): NapAddress {
  return a.district && STREET_MARK.test(foldPlace(a.district)) ? { ...a, district: null } : a;
}

export function compareAddress(siteAddresses: NapAddress[], answer: AnswerNapSignal | null): AddressCheck {
  const snippet = answer?.address ?? null;
  const known = siteAddresses.map(comparableAddress).filter((a) => a.district || a.city);
  if (!known.length) return { status: 'bilinmiyor', snippet, matched: [], otherCity: null };
  if (!snippet) return { status: 'yok', snippet: null, matched: [], otherCity: null };
  const folded = foldPlace(snippet);
  let best: AddressCheck | null = null;
  for (const a of known) {
    const tokens = [a.district, a.city].filter((t): t is string => !!t);
    const matched = tokens.filter((t) => hasPlaceToken(folded, t));
    const status: AddressStatus = matched.length === tokens.length ? 'eslesiyor' : matched.length > 0 ? 'kismen' : 'dogrulanamadi';
    if (!best || ADDRESS_RANK[status] > ADDRESS_RANK[best.status]) best = { status, snippet, matched, otherCity: null };
  }
  // "Baska il" ancak TUM subelerin ili biliniyorsa denebilir: ili bilinmeyen
  // (addressRegion "Marmara" ya da bos) adres cevaptaki ilde olabilir. Eskiden
  // il bilinmeyince cevaptaki dogru il de "farkli il" sayiliyordu.
  if (best && best.status === 'dogrulanamadi' && known.every((a) => !!a.city)) {
    const ourCities = new Set(known.map((a) => a.city as string));
    const other = otherProvinceIn(snippet, ourCities);
    if (other) best = { ...best, status: 'eslesmiyor', otherCity: other };
  }
  return best ?? { status: 'dogrulanamadi', snippet, matched: [], otherCity: null };
}
