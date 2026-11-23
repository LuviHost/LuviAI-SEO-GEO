/**
 * PageSpeed Insights SAHA verisi (CrUX) — gercek Chrome kullanicilarinin son
 * 28 gundeki 75. yuzdelik degerleri. Saf, I/O yok.
 *
 * NEDEN: tarama yalniz Lighthouse LAB olcumunu (tek bir yavas mobil profil)
 * sakliyordu. kobipratik.com'da lab puani 38–41 iken gercek kullanicilar Core
 * Web Vitals'i geciyordu (LCP 2,0 sn, INP 190 ms, CLS 0). Google siralamada
 * saha verisine bakar (developers.google.com/search/docs/appearance/core-web-vitals);
 * PSI ayni yanitta bu veriyi zaten dondurur (loadingExperience), ek istek yok.
 *
 * Esikler (web.dev/articles/vitals, 75. yuzdelik): LCP ≤ 2500 ms, INP ≤ 200 ms,
 * CLS ≤ 0,1. PSI CLS yuzdeligini 100 ile carpilmis verir (10 → 0,10).
 * Sayfa icin yeterli veri yoksa PSI sitenin genelini verir (origin_fallback)
 * ya da hic vermez (dusuk trafik): o zaman null.
 */

// type (interface degil): Prisma Json alanina yazilir, interface'in index imzasi yok
export type PageSpeedField = {
  /** 'sayfa': olculen adresin kendi verisi; 'site': sitenin geneli (origin) */
  kapsam: 'sayfa' | 'site';
  /** PSI'nin genel kategorisi */
  genel: 'FAST' | 'AVERAGE' | 'SLOW' | null;
  lcpMs: number | null;
  inpMs: number | null;
  cls: number | null;
  fcpMs: number | null;
  ttfbMs: number | null;
  /**
   * Core Web Vitals degerlendirmesi: olculen her metrik esigin icinde. LCP ya da
   * CLS yoksa degerlendirme yapilmaz (null); INP yoksa LCP + CLS ile.
   */
  gecti: boolean | null;
};

export const CWV_ESIK = { lcpMs: 2500, inpMs: 200, cls: 0.1 } as const;

type Metrics = Record<string, { percentile?: unknown; category?: unknown } | undefined>;

function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

function fromBlock(block: any, kapsam: 'sayfa' | 'site'): PageSpeedField | null {
  const m: Metrics | undefined = block?.metrics;
  if (!m || typeof m !== 'object' || Object.keys(m).length === 0) return null;
  const p = (k: string) => num(m[k]?.percentile);
  const clsRaw = p('CUMULATIVE_LAYOUT_SHIFT_SCORE');
  const f = {
    lcpMs: p('LARGEST_CONTENTFUL_PAINT_MS'),
    inpMs: p('INTERACTION_TO_NEXT_PAINT'),
    cls: clsRaw === null ? null : Math.round(clsRaw) / 100,
    fcpMs: p('FIRST_CONTENTFUL_PAINT_MS'),
    ttfbMs: p('EXPERIMENTAL_TIME_TO_FIRST_BYTE'),
  };
  const gecti = f.lcpMs === null || f.cls === null
    ? null
    : f.lcpMs <= CWV_ESIK.lcpMs && f.cls <= CWV_ESIK.cls && (f.inpMs === null || f.inpMs <= CWV_ESIK.inpMs);
  const g = block?.overall_category;
  return { kapsam, genel: g === 'FAST' || g === 'AVERAGE' || g === 'SLOW' ? g : null, ...f, gecti };
}

/** PSI v5 yanitindan saha verisi; yoksa null */
export function pageSpeedField(data: any): PageSpeedField | null {
  const le = data?.loadingExperience;
  const page = fromBlock(le, le?.origin_fallback === true ? 'site' : 'sayfa');
  if (page) return page;
  return fromBlock(data?.originLoadingExperience, 'site');
}
