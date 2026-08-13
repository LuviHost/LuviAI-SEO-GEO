/**
 * Magaza sorgulari icin ulke -> dil cozumlemesi.
 *
 * NEDEN: app-store-scraper ve google-play-scraper, dil belirtilmediginde
 * sirasiyla 'en-us' ve 'en' varsayar (bkz. node_modules/app-store-scraper/lib/search.js
 * satir `const lang = opts.lang || 'en-us'` ve google-play-scraper/lib/search.js
 * `lang: opts.lang || 'en'`). Biz bugune kadar sadece `country` geciyorduk;
 * yani TR storefront'unda Turkce bir keyword icin olctugumuz sira,
 * INGILIZCE arayuz dilinde olusan siraydi. Musterinin gordugu sira bu degil.
 * Bu modul, olcumun her yerde AYNI ve dogru lokalle yapilmasini saglar.
 */

/** Bir magaza cagrisi icin cozumlenmis lokal bilgisi. */
export type StoreLocale = {
  /** ISO 3166-1 alpha-2, kucuk harf. Storefront/gl parametresi. */
  country: string;
  /**
   * app-store-scraper `search` icin: Accept-Language basligina yazilir.
   * Siralamayi degil, donen metadata'nin dilini etkiler (storefront belirleyici).
   * Apple bu baslikta tireli-kucuk harf bekler ('tr-tr', 'en-us').
   */
  appleSearchLang: string;
  /**
   * app-store-scraper `app`/`similar` icin: iTunes lookup API'sinin `&lang=`
   * parametresi. Apple burada alt cizgili form belgeler ('en_us', 'ja_jp').
   */
  appleLookupLang: string;
  /** google-play-scraper icin `hl` parametresi ('tr', 'en-US', 'pt-BR'). */
  googleLang: string;
  /** Kullaniciya donen seffaflik alani, BCP-47 ('tr-TR'). */
  measuredLocale: string;
};

/** Ulke verilmediginde kullandigimiz varsayilan storefront. */
export const DEFAULT_COUNTRY = 'tr';

/**
 * Bilinmeyen ulkede dusulen dil.
 * NEDEN 'en-us': iki scraper kutuphanesinin de kendi varsayilani bu.
 * Tanimadigimiz bir storefront icin dil uydurmak yerine kutuphanenin
 * davranisini acikca tekrarliyoruz — boylece surpriz olmuyor ve
 * measuredLocale alani kullaniciya "en-US ile olctuk" diye durustce donuyor.
 */
export const FALLBACK_LANG_TAG = 'en-us';

/**
 * Ulke -> o storefront'ta baskin magaza arayuz dili.
 * Deger ya sade dil kodu ('tr') ya da bolgeli etiket ('pt-br') olur;
 * bolge yazilmissa google `hl` icin de bolgeli gonderilir.
 */
const COUNTRY_LANG: Record<string, string> = {
  // Gorev kapsaminda acikca istenenler
  tr: 'tr',
  us: 'en-us',
  de: 'de',
  gb: 'en-gb',
  fr: 'fr',
  es: 'es',
  it: 'it',
  nl: 'nl',
  ru: 'ru',
  sa: 'ar',
  jp: 'ja',
  kr: 'ko',
  cn: 'zh',
  br: 'pt-br',

  // Sik karsilastigimiz diger storefront'lar
  at: 'de',
  ch: 'de',
  be: 'nl',
  ie: 'en-ie',
  ca: 'en-ca',
  au: 'en-au',
  nz: 'en-nz',
  in: 'en-in',
  za: 'en-za',
  mx: 'es-mx',
  ar: 'es-ar',
  cl: 'es-cl',
  co: 'es-co',
  pt: 'pt-pt',
  pl: 'pl',
  se: 'sv',
  no: 'nb',
  dk: 'da',
  fi: 'fi',
  gr: 'el',
  cz: 'cs',
  hu: 'hu',
  ro: 'ro',
  ua: 'uk',
  il: 'he',
  ae: 'ar',
  eg: 'ar',
  id: 'id',
  th: 'th',
  vn: 'vi',
  my: 'ms',
  ph: 'en-ph',
  tw: 'zh-tw',
  hk: 'zh-hk',
  sg: 'en-sg',
};

/**
 * Girdiyi 2 harfli kucuk ulke koduna indirger.
 * 'TR', ' tr ', 'tr-TR', 'tr_TR' gibi formlari tolere eder; NEDEN: ulke degeri
 * bazen kullanici URL'inden ('?gl=TR') parse edilerek geliyor ve bicimi garanti degil.
 */
function normalizeCountry(input?: string | null): string {
  if (!input) return DEFAULT_COUNTRY;
  const first = String(input).trim().toLowerCase().split(/[-_]/)[0];
  if (!/^[a-z]{2}$/.test(first)) return DEFAULT_COUNTRY;
  return first;
}

/** Ulke kodundan tum magaza dil parametrelerini turetir. */
export function resolveStoreLocale(country?: string | null): StoreLocale {
  const c = normalizeCountry(country);
  const tag = COUNTRY_LANG[c] ?? FALLBACK_LANG_TAG;

  const [base, tagRegion] = tag.split('-');
  // Tabloda bolge yoksa storefront ulkesini bolge kabul et:
  // 'de' + country 'at' -> 'de-AT'. Boylece Avusturya'da Almanca ama
  // Avusturya storefront'u oldugu bilgisi de kaybolmuyor.
  const region = (tagRegion ?? c).toUpperCase();

  const measuredLocale = `${base}-${region}`;
  const lower = measuredLocale.toLowerCase();

  return {
    country: c,
    appleSearchLang: lower,
    appleLookupLang: lower.replace('-', '_'),
    // Google'a bolgeyi yalnizca tabloda acikca yazdiysak gonderiyoruz;
    // 'tr' gibi tek dilli pazarlarda sade kod Play tarafinda daha guvenli.
    googleLang: tagRegion ? `${base}-${region}` : base,
    measuredLocale,
  };
}

/** Bilinen (acikca eslenmis) bir ulke mi? Uyari/teshis icin. */
export function isKnownCountry(country?: string | null): boolean {
  return normalizeCountry(country) in COUNTRY_LANG;
}
