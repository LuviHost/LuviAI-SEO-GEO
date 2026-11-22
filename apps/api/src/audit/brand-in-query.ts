/**
 * "Bu metinde marka adi geciyor mu?" — TEK tanim.
 *
 * NEDEN AYRI DOSYA: ayni kural iki farkli soruyu cevapliyor ve ikisinin de
 * AYNI olcutle olculmesi sart:
 *
 *   1. Cevapta marka anildi mi?  → ai-citation.service.ts / brandMentioned
 *   2. Soruda marka gecti mi?    → prompt-lab.service.ts  / brandInQuery
 *
 * Ikisi ayrisirsa "markasiz gorunurluk" sayisi kendi icinde tutarsiz olur:
 * soruyu markasiz sayip cevapta markayi bulan bir satir olcumu sessizce
 * sisirir. Bu yuzden kural kopyalanmaz, iki taraf da buradan cagirir.
 *
 * NEDEN BU AYRIM ONEMLI: sorguda markanin adi gecince asistanin markayi
 * anmasi neredeyse totolojik. Sektor olcumu bu farki 33 kat olarak veriyor
 * (sorguda ismi gecen markalar %68,9 anilirken yalnizca getirilen markalar
 * %2,1). Ikisi ayni havuzda toplanirsa skor gorunurlugu degil, prompt
 * bilesimini olcer — ve fan-out uretimi her basarisiz oldugunda (sablona
 * dusup tum dallar markali olunca) skor kendiliginden yukselir.
 *
 * KURAL — ai-citation.service.ts icindeki orijinal mantigin birebir aynisi:
 *   - foldForMatch() ile Turkce-guvenli katlama. Ham metinde
 *     `"İddaa".toLowerCase()` = `i` + U+0307 uretip regex'i sessizce kiriyordu
 *     (bkz. common/text-normalize.ts).
 *   - Kelime siniri zorunlu: "Kobipratik" ile "Kobipratikci" ayni sayilmaz.
 *   - Minimum 4 karakter: daha kisa markalar metinde rastgele eslesip her
 *     satiri markali gosteriyordu.
 */
import { foldForMatch, escapeRegex } from '../common/text-normalize.js';
import { hostMentionIndex, registrableDomain } from './host-match.js';

/**
 * Kelime siniri sayilmayan karakter sinifi. Turkce harfler acikca dahil —
 * aksi halde "Kobipratik'in" gibi ekli kullanimlar sinir sanilip eslesmeyi
 * bozuyordu.
 */
const WORD_CHARS = 'a-z0-9à-ſğüşöç';

/** Marka adi bu uzunlugun altindaysa eslesme denenmez. */
export const MIN_BRAND_LEN = 4;

/**
 * Sitenin marka adi — site.name cok kisa veya generic ise hostname'in ana
 * parcasi kullanilir ("ai" gibi 2 harfli adi AI kelimesinden ayirt edemeyiz).
 *
 * Burada duruyor cunku ayni kurali uc yer birden kullaniyor: olcum
 * (AiCitationService), satir yazimi (PromptLabService uzerinden) ve geri
 * doldurma script'i. Ayrisirsa gecmis veri ile yeni veri farkli markayi
 * arar ve fark sessizce metrige yansir.
 *
 * Kok, kayit edilebilir alanin ilk etiketidir: eskiden son-iki etiket kurali
 * "ornek.com.tr" icin "com" donduruyordu (CITATION_MATCH_VERSION 4).
 */
export function resolveSiteBrand(name: string | null, url: string): string {
  const brand = (name || '').trim();
  if (brand.length >= MIN_BRAND_LEN) return brand;
  try {
    const host = new URL(url).hostname.replace(/^www\./, '');
    if (host.split('.').length >= 2) {
      const stem = registrableDomain(host).split('.')[0]; // ranksup.ai -> "ranksup", ornek.com.tr -> "ornek"
      if (stem) return stem;
    }
  } catch { /* ignore */ }
  return brand;
}

// ────────────────────────────────────────────────────────────
//  JENERIK MARKA KORUMASI (CITATION_MATCH_VERSION 4)
// ────────────────────────────────────────────────────────────
//
// NEDEN: marka cogu zaman otomatik turetiliyor — onboarding site adini alan
// adinin ilk etiketinden tahmin ediyor (eticaret.com → "eticaret"), public
// kontrol og:site_name / baslik / alan kokunden cikariyor. Kok "emlak",
// "sigorta", "oyun" gibi gundelik bir kelimeyse kelime-sinirli eslesme bile
// sektorun her cevabinda "anildi" der: "en iyi sigorta sirketleri" cevabinda
// "sigorta" kelimesi zaten gecer. Anilma orani sisiyor, ayni kelimeyi tasiyan
// sorular "markali" sayilip markasiz havuzdan dusuyordu.
//
// KURAL: marka alan adindan turetilmis gorunuyorsa VE dayandigi alan adi koku
// TEK bir jenerik kelimeyse ("eticaret", "emlak", "blog") yalin kelime
// eslesmesi SAYILMAZ; marka yalnizca alan adinin kendisi ("eticaret.com",
// etiket sinirli — host-match.ts) gectiginde anilmis sayilir.
// Alan kokunden farkli, musterinin kendi yazdigi ad ("Sigorta Dunyasi")
// etkilenmez; jenerik olmayan kok ("kobipratik") etkilenmez.
//
// BILESIK KOK KORUNMAZ: "Yapı Kredi" (yapikredi.com.tr), "Emlak Konut"
// (emlakkonut.com.tr), "Ak Sigorta" (aksigorta.com.tr), "İş Yatırım"
// (isyatirim.com.tr) gundelik kelimelerden olussa da gercek ozel adlardir;
// ilk surum bunlari yalniz-alan-adi moduna aliyor ve cevapta adiyla onerilen
// bankayi "anilmadi" sayiyordu. Bilesik tek kelime zaten kelime siniriyla
// gundelik metinden ayrisir (dosya basi: "hepsiemlak", "yemeksepeti"). Iki
// harfli parcalar ("ak", "is") koke dahilse atilmaz: kok sikistirilmis haliyle
// ("aksigorta") degerlendirilir. Bu ayrim CITATION_MATCH_VERSION 4'un parcasi
// (v4 henuz canlida degil) — ayrica surum artirilmadi.

/**
 * Jenerik kelime listesi — URUN PARAMETRESI, olgusal iddia degil. Alan adi
 * olarak sik kullanilan TR+EN sektor/gundelik kelimeleri (ASCII, Turkce
 * harfler katlanmis halde). Genisletilebilir; bir kelime eklemek yalnizca o
 * kelimeyi alan adi kokunde tasiyan markalari alan-adi esleme moduna alir.
 */
const GENERIC_BRAND_WORDS = new Set<string>([
  // TR — ticaret ve sektorler
  'alisveris', 'magaza', 'market', 'pazar', 'indirim', 'kampanya', 'firsat', 'ucuz', 'ilan', 'ticaret',
  'eticaret', 'toptan', 'emlak', 'konut', 'daire', 'arsa', 'kira', 'kiralik', 'satilik', 'sigorta',
  'kredi', 'banka', 'finans', 'borsa', 'doviz', 'altin', 'yatirim', 'muhasebe', 'vergi', 'hukuk',
  'avukat', 'saglik', 'doktor', 'hastane', 'klinik', 'eczane', 'diyet', 'spor', 'futbol', 'bahis',
  'oyun', 'haber', 'gazete', 'dergi', 'medya', 'sinema', 'film', 'dizi', 'muzik', 'kitap',
  'egitim', 'kurs', 'okul', 'sinav', 'ders', 'kariyer', 'eleman', 'turizm', 'tatil', 'otel',
  'seyahat', 'ucak', 'bilet', 'tur', 'yemek', 'tarif', 'restoran', 'kahve', 'gida', 'kuafor',
  'berber', 'guzellik', 'kozmetik', 'parfum', 'moda', 'giyim', 'ayakkabi', 'canta', 'saat', 'taki',
  'mobilya', 'dekorasyon', 'mutfak', 'insaat', 'yapi', 'tadilat', 'temizlik', 'nakliyat', 'nakliye', 'kargo',
  'lojistik', 'oto', 'otomobil', 'araba', 'arac', 'galeri', 'kiralama', 'lastik', 'servis', 'tamir',
  'elektrik', 'elektronik', 'bilgisayar', 'telefon', 'yazilim', 'teknoloji', 'internet', 'hosting', 'tasarim', 'reklam',
  'ajans', 'dijital', 'pazarlama', 'danismanlik', 'matbaa', 'fotograf', 'dugun', 'cicek', 'hediye', 'oyuncak',
  'bebek', 'cocuk', 'veteriner', 'bahce', 'tarim', 'enerji', 'guvenlik', 'kamera', 'sozluk', 'ceviri',
  'harita', 'hava', 'rehber', 'forum', 'blog', 'kobi', 'teklif', 'fiyat', 'urun', 'hizmet',
  // EN
  'shop', 'store', 'deals', 'sale', 'news', 'sport', 'game', 'play', 'music', 'movie',
  'book', 'travel', 'hotel', 'flight', 'food', 'recipe', 'health', 'doctor', 'dental', 'fitness',
  'insurance', 'bank', 'finance', 'credit', 'loan', 'money', 'crypto', 'trade', 'tech', 'software',
  'app', 'cloud', 'web', 'design', 'media', 'job', 'career', 'education', 'school', 'academy',
  'course', 'home', 'house', 'estate', 'realestate', 'rent', 'rental', 'car', 'auto', 'taxi',
  'fashion', 'beauty', 'hair', 'salon', 'shoe', 'watch', 'jewelry', 'furniture', 'garden', 'pet',
  'baby', 'kids', 'toy', 'gift', 'flower', 'wedding', 'photo', 'video', 'print', 'cleaning',
  'moving', 'cargo', 'energy', 'solar', 'security', 'weather', 'map', 'guide', 'dating', 'online',
  'digital', 'global', 'best', 'top',
]);

/**
 * Basit cekim sezgiseli: kelime + yaygin ek de jenerik sayilir (cogul
 * -lar/-ler, meslek -ci/-cu, iyelik -i/-u/-si/-su, EN cogul -s/-es).
 * ASCII duzleminde: "emlakci", "ilanlari", "sigortasi", "games".
 */
const GENERIC_SUFFIXES = ['lari', 'leri', 'lar', 'ler', 'cilar', 'ciler', 'ci', 'cu', 'si', 'su', 'i', 'u', 'es', 's'];

/** Alan adlari ASCII oldugu icin karsilastirma Turkce harfleri Latin esine indirerek yapilir. */
export function asciiFold(s: string): string {
  return foldForMatch(s)
    .replace(/ç/g, 'c').replace(/ğ/g, 'g').replace(/ş/g, 's')
    .replace(/ö/g, 'o').replace(/ü/g, 'u')
    .replace(/[âà]/g, 'a').replace(/[îì]/g, 'i').replace(/[ûù]/g, 'u');
}

function isGenericToken(t: string): boolean {
  if (GENERIC_BRAND_WORDS.has(t)) return true;
  for (const suf of GENERIC_SUFFIXES) {
    if (t.length > suf.length + 2 && t.endsWith(suf) && GENERIC_BRAND_WORDS.has(t.slice(0, -suf.length))) return true;
  }
  return false;
}

/**
 * Marka gundelik bir kelime(ler)den mi ibaret? Iki harf ve altindaki parcalar
 * ("e-ticaret"teki "e", "tr") dolgu sayilir; geri kalan HER parca jenerik
 * olmali. Bilesik tek kelime ("hepsiemlak", "yemeksepeti") jenerik DEGILDIR —
 * kelime siniri onu gundelik metinden zaten ayirir.
 */
export function isGenericBrandWord(brand: string): boolean {
  const tokens = asciiFold(brand || '').split(/[^a-z0-9]+/).filter((t) => t.length > 2);
  return tokens.length > 0 && tokens.every(isGenericToken);
}

/**
 * Marka alan adindan turetilmis gibi mi? Kokler: alan adinin ilk etiketi
 * (onboarding tahmini) ve kayit edilebilir alanin ilk etiketi
 * (resolveSiteBrand / public kontrol). Marka kokun kendisiyse ya da koku ayri
 * bir kelime olarak iceriyorsa (public kontrolun basliktan sectigi "Emlak
 * Ilanlari") turetilmis sayilir. Musteri koku birebir yazdiysa ayirt
 * edilemez — jenerik kok icin sonuc ayni olmali, sayilir.
 */
export function isDomainDerivedBrand(brand: string, host: string | null | undefined): boolean {
  return derivedStems(brand, host).length > 0;
}

const compactAscii = (s: string) => asciiFold(s).replace(/[^a-z0-9]/g, '');

/**
 * Markanin dayandigi alan adi kokleri (sikistirilmis ASCII). Kok adaylari:
 * ilk etiket (onboarding tahmini) ve kayit edilebilir alanin ilk etiketi
 * (resolveSiteBrand / public kontrol). Marka kokun kendisiyse ya da koku ayri
 * bir kelime olarak iceriyorsa o kok doner; turetilmemisse bos dizi.
 */
function derivedStems(brand: string, host: string | null | undefined): string[] {
  const h = (host || '').toLowerCase().replace(/^www\./, '').replace(/\.$/, '');
  if (!h || !h.includes('.')) return [];
  const stems = new Set<string>();
  const first = h.split('.')[0];
  if (first) stems.add(first);
  const regStem = registrableDomain(h).split('.')[0];
  if (regStem) stems.add(regStem);
  const compactStems = [...stems].map(compactAscii).filter((s) => s.length >= 3);
  const b = compactAscii(brand || '');
  if (!b) return [];
  const tokens = asciiFold(brand || '').split(/[^a-z0-9]+/).filter(Boolean);
  return compactStems.filter((s) => s === b || tokens.includes(s));
}

// ────────────────────────────────────────────────────────────
//  MARKA AILESI (22.11.2026)
// ────────────────────────────────────────────────────────────
//
// NEDEN: tek ad tutuluyordu. tokeninc.com olcumunde ad "tokeninc" idi; cevaplar
// sirketi "Token", cihazlarini "Beko X30 TR" diye aniyordu — ikisi de "anilmadi"
// sayildi (sahip: "marka adi tokeninc, urunleri Beko"). Marka ailesi: ana ad
// (Site.name, eski kurallarla) + diger adlar (Site.brandAliases). Cevapta herhangi
// biri gecerse marka anilmis sayilir ve HANGI adin gectigi probe'a yazilir.
//
// DIGER ADLARIN KURALI (ana addan farkli, bilerek):
//  - Kelime sinirli eslesme (ana adla ayni), jenerik koruma yok: adi kullanici
//    elle yazdi, alan adindan tahmin edilmedi.
//  - BUYUK HARF KURALI: ad buyuk harfle yazildiysa CEVAPTA da buyuk harfle
//    baslamali. "Token" ozel adi ile odeme metnindeki "kart bilgisi token'a
//    donusturulur" ayrilsin diye. Ana ada uygulanmaz (eski olcumler degismesin).
//  - SORUDA (brandInQuery) buyuk harf aranmaz: soruda "beko" gecmesi de soruyu
//    markali yapar. Bu tutucu yondur — supheli soru markasiz havuzdan cikar, skor
//    sismez.
//
// SURUM: CITATION_MATCH_VERSION artirilmadi. Kural yalniz diger adi girilmis
// sitelerde degisir; genel surum artsaydi tum musterilerin haftalik kiyasi sahte
// "yontem degisti" gosterirdi. Ad ekleyen sitenin onceki olcumleri dar kuralla
// yapilmistir — rapor/kiyas metni bunu soyler.

/** Diger ad sayisi ve uzunluk siniri — panel ve API ayni kurali kullanir */
export const MAX_BRAND_ALIASES = 15;
export const MAX_BRAND_ALIAS_LEN = 60;

export interface BrandFamily {
  /** Ana ad (resolveSiteBrand sonucu) */
  readonly name: string;
  /** Diger adlar (cleanBrandAliases'tan gecmis) */
  readonly aliases: readonly string[];
}

/** Eski cagiranlar yalin ad gecer; marka ailesini bilenler BrandFamily */
export type BrandRef = string | BrandFamily;

export function brandNameOf(ref: BrandRef | null | undefined): string {
  if (!ref) return '';
  return typeof ref === 'string' ? ref : ref.name;
}

export function brandAliasesOf(ref: BrandRef | null | undefined): readonly string[] {
  return ref && typeof ref !== 'string' ? ref.aliases : [];
}

/**
 * Diger adlar listesini temizler: dize olmayan, cok kisa (MIN_BRAND_LEN, katlanmis),
 * cok uzun, ana adla ya da birbiriyle (katlanmis) ayni olanlar atilir; en fazla
 * MAX_BRAND_ALIASES. Girdi DB'deki JSON ya da panelden gelen dizi olabilir.
 */
export function cleanBrandAliases(raw: unknown, primary?: string | null): string[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const primaryFolded = foldForMatch(primary || '').trim();
  if (primaryFolded) seen.add(primaryFolded);
  const out: string[] = [];
  for (const v of raw) {
    if (typeof v !== 'string') continue;
    const ad = v.replace(/\s+/g, ' ').trim();
    if (!ad || ad.length > MAX_BRAND_ALIAS_LEN) continue;
    const folded = foldForMatch(ad).trim();
    if (folded.length < MIN_BRAND_LEN || seen.has(folded)) continue;
    seen.add(folded);
    out.push(ad);
    if (out.length >= MAX_BRAND_ALIASES) break;
  }
  return out;
}

/** Sitenin marka ailesi — olcum ve rapor ayni yoldan okur */
export function resolveSiteBrandFamily(site: { name: string | null; url: string; brandAliases?: unknown }): BrandFamily {
  const name = resolveSiteBrand(site.name, site.url);
  return { name, aliases: cleanBrandAliases(site.brandAliases, name) };
}

/** Ad buyuk harfle mi yaziliyor (ilk harf) — buyuk harf kuralinin tetigi */
function startsUpper(s: string): boolean {
  const c = s.trim().charAt(0);
  return !!c && c !== c.toLocaleLowerCase('tr') && c === c.toLocaleUpperCase('tr');
}

/**
 * Katlanmis metinde `foldedName` in kelime sinirli TUM eslesmeleri; `accept(start)` false
 * donen eslesme atlanir. Doner: adin GERCEK baslangic indeksi (sol sinir karakteri haric).
 */
function firstWordMatch(folded: string, foldedName: string, accept?: (start: number) => boolean): number | null {
  if (foldedName.length < MIN_BRAND_LEN) return null;
  const re = new RegExp(`(?:^|[^${WORD_CHARS}])(${escapeRegex(foldedName)})(?=$|[^${WORD_CHARS}])`, 'g');
  for (const m of (folded || '').matchAll(re)) {
    const start = (m.index ?? 0) + m[0].length - m[1].length;
    if (!accept || accept(start)) return start;
  }
  return null;
}

export type BrandMatchMode = 'word' | 'domain';

/**
 * 'domain' = jenerik marka + dayandigi alan adi koku TEK jenerik kelime
 * (eticaret.com, emlak.com, blog.ornek.com): yalniz alan adi gecisi sayilir.
 * Bilesik kok ("yapikredi", "emlakkonut", "aksigorta") her zaman 'word'.
 */
export function brandMatchMode(brand: string, host?: string | null): BrandMatchMode {
  if (!host || !isGenericBrandWord(brand)) return 'word';
  return derivedStems(brand, host).some((s) => isGenericToken(s)) ? 'domain' : 'word';
}

/** Cevaptaki ilk marka eslesmesi (ana ad ya da diger ad) */
export interface BrandHit {
  /** indexInFolded ile ayni anlam: ana adda sol sinir karakteri dahil, diger adda adin basi */
  readonly index: number;
  /** Adin metindeki gercek baslangici */
  readonly start: number;
  /** Eslesen ad, kullanicinin yazdigi bicimde (alan adi modunda host) */
  readonly name: string;
  /** Eslesmenin uzunlugu — ton penceresi icin */
  readonly length: number;
}

export interface BrandMatcher {
  /** Ana ad */
  readonly brand: string;
  /** Diger adlar (marka ailesi) */
  readonly aliases: readonly string[];
  /** www'suz, kucuk harf; bilinmiyorsa bos */
  readonly host: string;
  /** Ana adin esleme modu (diger adlar her zaman kelime modunda) */
  readonly mode: BrandMatchMode;
  /**
   * ONCEDEN KATLANMIS metinde ilk eslesme indeksi (word modunda brandMatchIndexFolded ile ayni
   * anlam). Diger adlar buyuk harf kuralSIZ aranir — soru tarafinin (brandInQuery) davranisi.
   */
  indexInFolded(foldedText: string): number | null;
  /**
   * Cevap tarafi: ilk eslesme ve HANGI adin gectigi. `original` katlanmis metinle ayni
   * uzunlukta katlanmamis metinse buyuk harf kurali uygulanir; verilmezse uygulanmaz.
   */
  matchInFolded(foldedText: string, original?: string | null): BrandHit | null;
  /** Ana adin eslesme uzunlugu — ton penceresi icin (diger ad eslesmesinde BrandHit.length) */
  readonly matchLength: number;
  /** Ham metinde marka (ailesinden bir ad) geciyor mu — buyuk harf kuralsiz */
  inText(text: string): boolean;
}

/**
 * Cevapta anilma ve soruda marka — IKISI de bu nesneden gecmeli; yoksa
 * markasiz havuz kendi icinde tutarsiz olur (dosya basindaki not).
 * `brand` yalin ad ya da marka ailesi (BrandFamily) olabilir.
 */
export function brandMatcher(brandRef: BrandRef, host?: string | null): BrandMatcher {
  const brand = brandNameOf(brandRef);
  const aliases = brandAliasesOf(brandRef);
  const h = (host || '').toLowerCase().replace(/^www\./, '').replace(/\.$/, '');
  const mode = brandMatchMode(brand, h);
  const brandFolded = foldForMatch(brand || '').trim();
  const primaryIndex = mode === 'domain'
    ? (folded: string) => hostMentionIndex(folded || '', h)
    : (folded: string) => brandMatchIndexFolded(folded, brandFolded);
  const primaryLength = mode === 'domain' ? h.length : brandFolded.length;
  const aliasRules = aliases.map((ad) => ({ ad, folded: foldForMatch(ad).trim(), upper: startsUpper(ad) }));

  const matchInFolded = (folded: string, original?: string | null): BrandHit | null => {
    let best: BrandHit | null = null;
    const pIdx = primaryIndex(folded);
    if (pIdx !== null) {
      const needle = mode === 'domain' ? h : brandFolded;
      const s = (folded || '').indexOf(needle, pIdx);
      best = { index: pIdx, start: s === -1 ? pIdx : s, name: mode === 'domain' ? h : brand, length: primaryLength };
    }
    const caseOk = !!original && original.length === (folded || '').length;
    for (const r of aliasRules) {
      const start = firstWordMatch(folded, r.folded, r.upper && caseOk
        ? (st) => { const c = original!.charAt(st); return c !== c.toLocaleLowerCase('tr'); }
        : undefined);
      if (start === null) continue;
      if (!best || start < best.start) best = { index: start, start, name: r.ad, length: r.folded.length };
    }
    return best;
  };

  const indexInFolded = aliasRules.length === 0
    ? primaryIndex
    : (folded: string) => matchInFolded(folded)?.index ?? null;

  return {
    brand,
    aliases,
    host: h,
    mode,
    indexInFolded,
    matchInFolded,
    matchLength: primaryLength,
    inText: (text: string) => indexInFolded(foldForMatch(text || '')) !== null,
  };
}

/**
 * Public kontrolun {BRAND_HINT} sablonu icin: jenerik + turetilmis markada
 * soruya yalin kelime yerine alan adi konmali; aksi halde "Emlak alternatifi"
 * gibi bir soru markali sayilmaz (brandMatcher alan adi arar) ve markasiz
 * havuza girer.
 */
export function brandHintFor(brand: string, host?: string | null): string {
  const m = brandMatcher(brand, host);
  return m.mode === 'domain' ? m.host : brand;
}

/**
 * Marka adinin metinde ilk gectigi indeks; yoksa null.
 *
 * DIKKAT — donen indeks markanin ilk harfini degil, ONUNDEKI sinir
 * karakterini gosterir (metin basindaki eslesme haric). Bu davranis
 * ai-citation.service.ts'ten devralindi; position ve sentiment penceresi
 * hesaplari bu indekse gore ayarli, degistirilirse ikisi de kayar.
 */
export function brandMatchIndex(text: string, brand: string): number | null {
  const brandFolded = foldForMatch(brand || '').trim();
  return brandMatchIndexFolded(foldForMatch(text || ''), brandFolded);
}

/**
 * ONCEDEN KATLANMIS metin icin hizli yol. buildProbe cevabin tamamini zaten
 * katliyor (cited/position/sentiment icin ayni katlanmis metni kullaniyor);
 * marka aramasi icin ikinci bir tam-metin katlamasi modulun en sicak yolunda
 * saf israfti. Kural degismedi — brandMatchIndex bunun ince sarmalayicisi.
 */
export function brandMatchIndexFolded(foldedText: string, foldedBrand: string): number | null {
  const brandFolded = (foldedBrand || '').trim();
  if (brandFolded.length < MIN_BRAND_LEN) return null;
  const re = new RegExp(
    `(?:^|[^${WORD_CHARS}])${escapeRegex(brandFolded)}(?:$|[^${WORD_CHARS}])`,
  );
  const m = (foldedText || '').match(re);
  return m && m.index !== undefined ? m.index : null;
}

/**
 * Metinde marka adi geciyor mu?
 *
 * Sorgu metni icin kullanildiginda cevabi dogrudan GeoPromptRun.brandInQuery
 * alanina yazilir; bu alan markasiz manset metriklerinin suzgecidir.
 *
 * `host` verilirse jenerik marka korumasi uygulanir (brandMatcher) — olcumle
 * AYNI karari vermesi icin alan adi bilinen her yerde verilmeli. Verilmezse
 * eski davranis: yalin, kelime sinirli eslesme.
 */
export function containsBrand(text: string, brand: BrandRef, host?: string | null): boolean {
  if (host || brandAliasesOf(brand).length > 0) return brandMatcher(brand, host).inText(text);
  return brandMatchIndex(text, brandNameOf(brand)) !== null;
}

/**
 * Manset-metrik suzgeci: sorusunda marka adi GECMEYEN probe/satirlar.
 *
 * Tek yerde durmasinin sebebi skor zinciri: scoreFromProbes, aggregateProbes,
 * per-page kirilimi, roadmap ve snapshot sayaclari ayni suzgeci kullanmali —
 * biri unutulursa o metrik sessizce sisik kalir (taramada 18 bulgunun kokeni
 * tam olarak buydu).
 *
 * `brandInQuery` tanimsizsa satir MARKASIZ sayilir: canli akista her probe
 * buildProbe'dan gectigi icin alan daima dolu; tanimsizlik yalnizca eski
 * (backfill gormemis) JSON'dan okunan kayitlarda olur ve onlari toptan
 * dislamak metrigi bosaltirdi.
 */
export function unbrandedOnly<T extends { brandInQuery?: boolean }>(rows: T[]): T[] {
  return rows.filter((r) => r.brandInQuery !== true);
}
