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
 */
export function resolveSiteBrand(name: string | null, url: string): string {
  const brand = (name || '').trim();
  if (brand.length >= MIN_BRAND_LEN) return brand;
  try {
    const parts = new URL(url).hostname.replace(/^www\./, '').split('.');
    if (parts.length >= 2) return parts[parts.length - 2]; // ranksup.ai -> "ranksup"
  } catch { /* ignore */ }
  return brand;
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
 */
export function containsBrand(text: string, brand: string): boolean {
  return brandMatchIndex(text, brand) !== null;
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
