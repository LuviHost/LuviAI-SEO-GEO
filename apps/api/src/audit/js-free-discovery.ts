/**
 * JS'siz kesif — Google disindaki AI crawler'lari (GPTBot, ClaudeBot,
 * PerplexityBot...) JavaScript CALISTIRMAZ; sayfada yalniz JS ile olusan
 * linkleri gormezler (defter: non-google-ai-crawlers-dont-execute-javascript-
 * links, 2 bagimsiz kaynak). Ham HTML'deki <a href> grafigi sitemap'le
 * karsilastirilir: sitemap'teki URL'lerin ana sayfanin ham HTML'inden
 * ulasilabilir olup olmadigi.
 *
 * Saf fonksiyonlar; agent-readiness.service.ts scan()'de zaten cekilmis
 * homepage HTML + sitemap ile calisir — sifir ek fetch.
 *
 * ILK SURUMDE PUANSIZ (impact 'info'): esikler gercek dagilim gorulmeden
 * puanlanirsa az linkli ama SPA olmayan landing'lerde sahte FAIL uretir.
 */

export interface JsFreeDiscovery {
  /** sitemapindex / sitemap yok / homepage yok → olculemedi */
  applicable: boolean;
  reason: string;
  /** Ham HTML'de bulunan benzersiz origin-ici link sayisi */
  internalLinks: number;
  /** Sitemap'teki toplam URL */
  sitemapUrls: number;
  /** Karsilastirmaya alinan sitemap URL'si (ilk 50) */
  sampled: number;
  /** Orneklemden ham HTML'de linki bulunan URL sayisi */
  overlap: number;
  ok: boolean;
  /** homepage HTML fetch tavaninda (500 KB) kirpildiysa alt yari kayip */
  truncated: boolean;
}

export const SITEMAP_SAMPLE = 50;
export const MIN_OVERLAP_RATIO = 0.2;
export const MIN_INTERNAL_LINKS = 10;
const HTML_CAP = 500_000;

/** Karsilastirma anahtari: protokol/www/hash/sondaki slash farklarini yok say */
export function normalizeUrlKey(raw: string): string | null {
  try {
    const u = new URL(raw);
    const host = u.hostname.toLowerCase().replace(/^www\./, '');
    let path = u.pathname.replace(/\/+$/, '');
    if (path === '') path = '/';
    return `${host}${path}${u.search}`;
  } catch {
    return null;
  }
}

function hostKey(raw: string): string | null {
  try { return new URL(raw).hostname.toLowerCase().replace(/^www\./, ''); } catch { return null; }
}

/** Ham HTML'deki <a href> origin-ici linkleri (mutlaklastirilmis, normalize, benzersiz) */
export function extractRawAnchors(html: string, baseUrl: string): string[] {
  const base = hostKey(baseUrl);
  if (!base) return [];
  const out = new Set<string>();
  const re = /<a\b[^>]*?\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const href = (m[1] ?? m[2] ?? m[3] ?? '').trim();
    if (!href || /^(#|mailto:|tel:|javascript:|data:)/i.test(href)) continue;
    let abs: string;
    try { abs = new URL(href, baseUrl).toString(); } catch { continue; }
    if (hostKey(abs) !== base) continue;
    const key = normalizeUrlKey(abs);
    if (key) out.add(key);
  }
  return [...out];
}

/** sitemap.xml'den <loc> listesi; sitemapindex ise isaretler (loc'lar alt-sitemap, sayfa degil) */
export function sitemapLocs(xml: string): { isIndex: boolean; locs: string[] } {
  const isIndex = /<sitemapindex[\s>]/i.test(xml);
  const locs: string[] = [];
  const re = /<loc>\s*([^<\s]+)\s*<\/loc>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) locs.push(m[1]);
  return { isIndex, locs };
}

export function assessJsFreeDiscovery(html: string, sitemapXml: string, baseUrl: string): JsFreeDiscovery {
  const truncated = html.length >= HTML_CAP;
  const base = { internalLinks: 0, sitemapUrls: 0, sampled: 0, overlap: 0, ok: false, truncated };

  if (!html) return { ...base, applicable: false, reason: 'Ana sayfa HTML\'i alınamadı' };
  const anchors = extractRawAnchors(html, baseUrl);
  const internalLinks = anchors.length;

  const { isIndex, locs } = sitemapLocs(sitemapXml ?? '');
  if (isIndex) {
    return { ...base, internalLinks, applicable: false, reason: `Sitemap index — alt sitemap'ler taranmadı; ham HTML'de ${internalLinks} iç link` };
  }
  if (locs.length === 0) {
    return { ...base, internalLinks, applicable: false, reason: `Sitemap URL'si yok; ham HTML'de ${internalLinks} iç link` };
  }

  const anchorSet = new Set(anchors);
  const sample = locs.slice(0, SITEMAP_SAMPLE);
  let overlap = 0;
  for (const loc of sample) {
    const key = normalizeUrlKey(loc);
    if (key && anchorSet.has(key)) overlap++;
  }
  const ratio = overlap / sample.length;
  const ok = ratio >= MIN_OVERLAP_RATIO || internalLinks >= MIN_INTERNAL_LINKS;
  return {
    applicable: true,
    reason: ok
      ? `Ham HTML'de ${internalLinks} iç link; sitemap örnekleminin %${Math.round(ratio * 100)}'i JS'siz ulaşılabilir`
      : `Ham HTML'de yalnız ${internalLinks} iç link; sitemap örnekleminin %${Math.round(ratio * 100)}'i JS'siz ulaşılabilir — linkler muhtemelen JS ile oluşuyor`,
    internalLinks,
    sitemapUrls: locs.length,
    sampled: sample.length,
    overlap,
    ok,
    truncated,
  };
}
