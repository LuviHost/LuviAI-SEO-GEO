/**
 * Sitenin birden cok DIL SURUMU var mi? — saf, hreflang kontrolunun onkosulu.
 *
 * NEDEN VAR: hreflang kontrolu (audit-checks.service checkHreflang) eskiden her
 * siteye kosulsuz "gecti / 100" yaziyordu ("tek dilli site, gerekmiyor"
 * varsayimi). Iki dilli bir sitede (labenko.com: "/" Turkce, "/EN" Ingilizce,
 * hic hreflang ve <html lang> yok — 12.11.2026) musteri raporu "Hreflang:
 * gecti" dedi. Kontrolun bir hukum verebilmesi icin once sitede dil surumu
 * olup olmadigini bilmek gerekir.
 *
 * IKI BAGIMSIZ ISARET (hreflang'in kendisi isaret DEGIL — olculen sey o):
 *  1. <html lang>: taranan sayfalarda en az iki farkli dil (birincil alt etiket;
 *     "en-US" ve "en-GB" ayni dil). Her dil sayfalarin anlamli bir payinda
 *     gorulmeli (LANG_MIN_SHARE): 28 sayfasi "tr", tek sayfasi "en-US" olan
 *     site (ör. varsayilan dili degistirilmemis bir blog eklentisi) iki dilli
 *     sayilmaz.
 *  2. Adres yolu: ilk yol parcasi bir dil kodu olan sayfalar ("/en", "/de-de/…").
 *     Ya iki farkli kod gorulur, ya da tek kod + KODSUZ ANASAYFA (varsayilan dil
 *     kokte, diger dil kod altinda).
 *
 * YANLIS ALARMA KARSI:
 *  - Kod listesi DAR ve bilerek eksik: "it" (bilgi teknolojileri), "hr" (insan
 *    kaynaklari), "uk" (Birlesik Krallik), "no", "is", "id", "az", "da" gibi
 *    baska anlama gelen parcalar listede yok. Listede olmayan dil yalniz
 *    <html lang> ile yakalanir.
 *  - "xx-yy" bicimi yalniz BILINEN yerel ayarlarda kabul edilir (KNOWN_LOCALES):
 *    "/ar-ge" (arastirma-gelistirme) Arapca-Gurcistan degildir.
 *  - Sayfanin YONLENDIRME SONRASI adresi kullanilir (CrawledPage.finalUrl):
 *    anasayfasi "/" → "/tr/" yonlendiren sitede anasayfa kodludur; tek tuk
 *    kodsuz sayfa (ör. "/kvkk") ikinci bir dil sayilmaz.
 *  - Tek kod + kodsuz sayfalar ve kodsuz sayfalar <html lang> ile O KODUN dilini
 *    bildiriyorsa (ör. hepsi "tr", yol "/tr/…") kodlu bolum ayni dildir.
 *
 * BILEREK YAPILMAYAN: kodlu ve kodsuz sayfalar ayni <html lang> degerini
 * tasiyor diye siteyi tek dilli saymak. Sablonu her sayfaya sabit lang="tr"
 * yazan iki dilli site yaygin bir hatadir ve tam da hreflang'i eksik olan
 * sitedir; "/en" altindaki sayfalar yine Ingilizce surumdur.
 *
 * Tarama orneklemle calisir (en fazla N sayfa) ve adres yolu disindaki dil
 * duzenlerini ("/en.html", "?lang=en", alt alan adi) gormez: dil surumu
 * gorulmediyse bu "tek dilli" KANITI degildir (kontrol o durumda puan kirmaz,
 * rapor "gorulmedi" der).
 */

export interface LanguagePage {
  url: string;
  /** Yonlendirme sonrasi varilan adres (istenen adresten farkliysa) */
  finalUrl?: string | null;
  /** <html lang> */
  lang?: string | null;
}

export interface LanguageVersions {
  multilingual: boolean;
  /** Gorulen diller (kucuk harf birincil alt etiket), sirali. Adres yolu isaretinde kodsuz (varsayilan) surum listede yok. */
  languages: string[];
  /** Hukmun dayandigi isaret; dil surumu gorulmediyse null */
  evidence: 'html-lang' | 'url-path' | null;
  /** Adres yolu isaretinde ornek dil surumu adresleri (en fazla 5) */
  samples: string[];
}

/** Adres yolunda dil kodu olarak kabul edilen ISO 639-1 kodlari (dar liste — bkz. dosya basi) */
export const PATH_LANGUAGE_CODES: ReadonlySet<string> = new Set([
  'en', 'tr', 'de', 'fr', 'es', 'ru', 'ar', 'zh', 'ja', 'ko', 'pt', 'nl', 'pl', 'bg', 'ro', 'el', 'fa',
]);

/** Adres yolunda kabul edilen "dil-bolge" ciftleri — rastgele "xx-yy" parcasi (ör. "ar-ge") dil degildir */
export const KNOWN_LOCALES: ReadonlySet<string> = new Set([
  'en-us', 'en-gb', 'en-au', 'en-ca', 'en-ie', 'en-in', 'tr-tr', 'de-de', 'de-at', 'de-ch', 'fr-fr', 'fr-be', 'fr-ca', 'fr-ch',
  'es-es', 'es-mx', 'es-ar', 'ru-ru', 'ar-sa', 'ar-ae', 'ar-eg', 'zh-cn', 'zh-tw', 'zh-hk', 'ja-jp', 'ko-kr', 'pt-br', 'pt-pt',
  'nl-nl', 'nl-be', 'pl-pl', 'bg-bg', 'ro-ro', 'el-gr', 'fa-ir',
]);

/** <html lang> icin uc harfli (ISO 639-2) yaygin kodlar → iki harfli karsiligi */
const THREE_LETTER: Readonly<Record<string, string>> = {
  tur: 'tr', eng: 'en', deu: 'de', ger: 'de', fra: 'fr', fre: 'fr', spa: 'es', rus: 'ru', ara: 'ar', zho: 'zh', chi: 'zh',
  jpn: 'ja', kor: 'ko', por: 'pt', nld: 'nl', dut: 'nl', pol: 'pl', ita: 'it',
};

/** <html lang> isaretinde bir dilin sayilmasi icin, dili bildirilen sayfalar icindeki en az payi */
export const LANG_MIN_SHARE = 0.15;

/** "en-US" → "en", "tur" → "tr"; gecersiz / bos / bilinmeyen uc harfli deger ("utf-8") → null */
export function primaryLanguage(tag: string | null | undefined): string | null {
  const m = /^([a-z]{2,3})(?:[-_][a-z0-9]+)*$/i.exec((tag ?? '').trim());
  if (!m) return null;
  const p = m[1].toLowerCase();
  return p.length === 2 ? p : THREE_LETTER[p] ?? null;
}

/** Adresin ilk yol parcasi dil koduysa ("/en", "/de-de/…") o dil; degilse null */
export function pathLanguage(url: string): string | null {
  let path: string;
  try {
    path = new URL(url).pathname;
  } catch {
    return null;
  }
  const first = (path.split('/').filter(Boolean)[0] ?? '').toLowerCase().replace('_', '-');
  if (/^[a-z]{2}$/.test(first)) return PATH_LANGUAGE_CODES.has(first) ? first : null;
  if (/^[a-z]{2}-[a-z]{2}$/.test(first)) return KNOWN_LOCALES.has(first) ? first.slice(0, 2) : null;
  return null;
}

function isHome(url: string): boolean {
  try {
    return new URL(url).pathname.replace(/\/+$/, '') === '';
  } catch {
    return false;
  }
}

const NONE: LanguageVersions = { multilingual: false, languages: [], evidence: null, samples: [] };

export function detectLanguageVersions(pages: readonly LanguagePage[]): LanguageVersions {
  // 1) <html lang>: her dil, dili bildirilen sayfalarin anlamli bir payinda gorulmeli
  const langCount = new Map<string, number>();
  for (const p of pages) {
    const l = primaryLanguage(p.lang);
    if (l) langCount.set(l, (langCount.get(l) ?? 0) + 1);
  }
  const declared = [...langCount.values()].reduce((a, b) => a + b, 0);
  const minPages = Math.max(1, Math.ceil(declared * LANG_MIN_SHARE));
  const htmlLangs = [...langCount.entries()].filter(([, n]) => n >= minPages).map(([l]) => l).sort();
  if (htmlLangs.length >= 2) {
    return { multilingual: true, languages: htmlLangs, evidence: 'html-lang', samples: [] };
  }

  // 2) Adres yolu (yonlendirme sonrasi adres)
  const pathLangs = new Map<string, string[]>();
  const plainHtml = new Set<string>();
  let homePlain = false;
  for (const p of pages) {
    const adres = p.finalUrl || p.url;
    const code = pathLanguage(adres);
    if (code) {
      const list = pathLangs.get(code) ?? [];
      if (list.length < 5) list.push(adres);
      pathLangs.set(code, list);
    } else {
      const html = primaryLanguage(p.lang);
      if (html) plainHtml.add(html);
      // Anasayfa (istenen adres "/") yonlendirmeden sonra da kodsuz: varsayilan dil kokte
      if (isHome(p.url)) homePlain = true;
    }
  }
  const codes = [...pathLangs.keys()].sort();
  if (codes.length === 0) return NONE;
  if (codes.length === 1) {
    // Tek kod: varsayilan dil kokte olmali; kodsuz sayfalar o kodun dilini bildiriyorsa bolum ayni dildir
    if (!homePlain) return NONE;
    if (plainHtml.size === 1 && plainHtml.has(codes[0])) return NONE;
  }
  return {
    multilingual: true,
    languages: codes,
    evidence: 'url-path',
    samples: codes.flatMap((c) => pathLangs.get(c) ?? []).slice(0, 5),
  };
}
