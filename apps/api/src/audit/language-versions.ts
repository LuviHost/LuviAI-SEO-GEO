/**
 * Sitenin birden cok DIL SURUMU var mi? — saf, hreflang kontrolunun onkosulu.
 *
 * NEDEN VAR: hreflang kontrolu (audit-checks.service checkHreflang) eskiden her
 * siteye kosulsuz "gecti / 100" yaziyordu ("tek dilli site, gerekmiyor"
 * varsayimi). Iki dilli bir sitede (labenko.com: "/" Turkce, "/EN" Ingilizce,
 * hic hreflang yok — 12.11.2026) musteri raporu "Hreflang: gecti" dedi.
 * Kontrolun bir hukum verebilmesi icin once sitede dil surumu olup olmadigini
 * bilmek gerekir.
 *
 * IKI BAGIMSIZ ISARET (hreflang'in kendisi isaret DEGIL — olculen sey o):
 *  1. <html lang>: taranan sayfalarda en az iki farkli dil (birincil alt etiket;
 *     "en-US" ve "en-GB" ayni dil sayilir).
 *  2. Adres yolu: ilk yol parcasi bir dil kodu olan sayfalar ("/en", "/de-de/…").
 *     Ya iki farkli kod gorulmeli ya da bir kodun yaninda kodsuz (varsayilan
 *     dil) sayfalar olmali.
 *
 * YANLIS ALARMA KARSI:
 *  - Kod listesi DAR ve bilerek eksik: "it" (bilgi teknolojileri), "hr" (insan
 *    kaynaklari), "no", "is", "id", "to", "my" gibi baska anlama gelen iki
 *    harfli parcalar listede yok. Listede olmayan dil yalniz <html lang> ile
 *    yakalanir.
 *  - Sayfanin YONLENDIRME SONRASI adresi kullanilir (CrawledPage.finalUrl):
 *    anasayfasi "/" → "/tr/" yonlendiren tek dilli sitede butun sayfalar "/tr/"
 *    altindadir; kodsuz sayfa kalmaz ve site tek dilli sayilir.
 *  - Kodsuz ve kodlu sayfalarin <html lang> degeri AYNI dili soyluyorsa (ör.
 *    hepsi "tr") adres yolu isareti yok sayilir: yol parcasi dil degil baska
 *    bir seydir.
 *
 * Tarama orneklemle calisir (en fazla N sayfa): dil surumu sayfalari ornekleme
 * girmediyse site tek dilli gorunur — bu yuzden "tek dilli" bir KANIT degil
 * "dil surumu gorulmedi" demektir (kontrol o durumda puan kirmaz).
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
  /** Gorulen diller (kucuk harf birincil alt etiket), sirali. Varsayilan (kodsuz) surum listede yok. */
  languages: string[];
  /** Hukmun dayandigi isaret; dil surumu gorulmediyse null */
  evidence: 'html-lang' | 'url-path' | null;
  /** Adres yolu isaretinde ornek dil surumu adresleri (en fazla 5) */
  samples: string[];
}

/** Adres yolunda dil kodu olarak kabul edilen ISO 639-1 kodlari (dar liste — bkz. dosya basi) */
export const PATH_LANGUAGE_CODES: ReadonlySet<string> = new Set([
  'en', 'tr', 'de', 'fr', 'es', 'ru', 'ar', 'zh', 'ja', 'ko', 'pt', 'nl', 'pl', 'el', 'bg', 'ro', 'uk', 'fa', 'az', 'ka',
  'sv', 'da', 'fi', 'cs', 'hu', 'he',
]);

const LANG_SEGMENT = /^([a-z]{2})(?:[-_][a-z]{2})?$/i;

/** "en-US" → "en"; gecersiz / bos → null */
export function primaryLanguage(tag: string | null | undefined): string | null {
  const m = /^([a-z]{2,3})(?:[-_][a-z0-9]+)*$/i.exec((tag ?? '').trim());
  return m ? m[1].toLowerCase() : null;
}

/** Adresin ilk yol parcasi dil koduysa o kod; degilse null */
export function pathLanguage(url: string): string | null {
  let path: string;
  try {
    path = new URL(url).pathname;
  } catch {
    return null;
  }
  const first = path.split('/').filter(Boolean)[0] ?? '';
  const m = LANG_SEGMENT.exec(first);
  if (!m) return null;
  const code = m[1].toLowerCase();
  return PATH_LANGUAGE_CODES.has(code) ? code : null;
}

export function detectLanguageVersions(pages: readonly LanguagePage[]): LanguageVersions {
  // 1) <html lang>
  const htmlLangs = new Set<string>();
  for (const p of pages) {
    const l = primaryLanguage(p.lang);
    if (l) htmlLangs.add(l);
  }
  if (htmlLangs.size >= 2) {
    return { multilingual: true, languages: [...htmlLangs].sort(), evidence: 'html-lang', samples: [] };
  }

  // 2) Adres yolu (yonlendirme sonrasi adres)
  const pathLangs = new Map<string, string[]>();
  const prefixedHtml = new Set<string>();
  const plainHtml = new Set<string>();
  let plainPages = 0;
  for (const p of pages) {
    const adres = p.finalUrl || p.url;
    const code = pathLanguage(adres);
    const html = primaryLanguage(p.lang);
    if (code) {
      const list = pathLangs.get(code) ?? [];
      if (list.length < 5) list.push(adres);
      pathLangs.set(code, list);
      if (html) prefixedHtml.add(html);
    } else {
      plainPages++;
      if (html) plainHtml.add(html);
    }
  }
  const codes = [...pathLangs.keys()].sort();
  const twoCodes = codes.length >= 2;
  const codePlusDefault = codes.length === 1 && plainPages > 0;
  if (!twoCodes && !codePlusDefault) return { multilingual: false, languages: [], evidence: null, samples: [] };

  // Kodlu ve kodsuz sayfalar <html lang> ile AYNI dili bildiriyorsa yol parcasi dil degildir
  if (codePlusDefault && htmlLangs.size === 1 && prefixedHtml.size === 1 && plainHtml.size === 1) {
    return { multilingual: false, languages: [], evidence: null, samples: [] };
  }

  return {
    multilingual: true,
    languages: codes,
    evidence: 'url-path',
    samples: codes.flatMap((c) => pathLangs.get(c) ?? []).slice(0, 5),
  };
}
