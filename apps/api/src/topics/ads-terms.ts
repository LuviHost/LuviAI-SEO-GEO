import { containsBrand } from '../audit/brand-in-query.js';

/**
 * Google Ads arama terimlerinden icerik konusu (18.11.2026, sahip: "yapalim").
 *
 * NEDEN: musteri reklamda para odedigi ve tiklama / donusum getiren terimlerde organik aramada ve
 * yapay zeka cevaplarinda da gorunmeli; o terimler icin yazilan icerik reklam bagimliligini azaltir.
 * Konu motoru (topics.service) bu listeyi besinci kaynak olarak siralayiciya verir. Reklam
 * hesabinda HICBIR degisiklik yapilmaz — yalniz okuma (GAQL search_term_view).
 *
 * Secim (saf): ayni terim birden cok reklam grubunda gelirse toplanir; marka adi gecen terim
 * cikarilir (o aramada zaten bulunuyorsun); en az 1 donusum ya da 5 tiklama; donusum, sonra
 * harcama sirasiyla en cok 25 terim.
 */
export interface AdsTermRow {
  term: string;
  impressions: number;
  clicks: number;
  conversions: number;
  cost: number;
}

export interface AdsContentTerm extends AdsTermRow {
  source: 'google_ads';
}

export const ADS_TERM_LIMIT = 25;
export const ADS_TERM_MIN_CLICKS = 5;

/** Hesap duzeyinde son 30 gun, tiklama alan arama terimleri (kampanya filtresi yok) */
export const ADS_TERMS_GAQL = `
  SELECT
    search_term_view.search_term,
    metrics.impressions, metrics.clicks, metrics.conversions, metrics.cost_micros
  FROM search_term_view
  WHERE segments.date DURING LAST_30_DAYS
    AND metrics.clicks > 0
  ORDER BY metrics.conversions DESC
  LIMIT 500
`;

/** GAQL satirlari → terim satirlari */
export function parseAdsTermRows(rows: any[]): AdsTermRow[] {
  return (rows ?? []).map((r: any) => ({
    term: String(r?.searchTermView?.searchTerm ?? '').trim(),
    impressions: parseInt(r?.metrics?.impressions ?? '0', 10) || 0,
    clicks: parseInt(r?.metrics?.clicks ?? '0', 10) || 0,
    conversions: Number(r?.metrics?.conversions ?? 0) || 0,
    cost: (Number(r?.metrics?.costMicros ?? 0) || 0) / 1_000_000,
  }));
}

export function selectContentTerms(rows: AdsTermRow[], brand: string, host?: string | null): AdsContentTerm[] {
  const toplam = new Map<string, AdsTermRow>();
  for (const r of rows) {
    const term = r.term.trim();
    if (term.length < 3) continue;
    const key = term.toLocaleLowerCase('tr');
    const cur = toplam.get(key) ?? { term, impressions: 0, clicks: 0, conversions: 0, cost: 0 };
    cur.impressions += r.impressions;
    cur.clicks += r.clicks;
    cur.conversions += r.conversions;
    cur.cost += r.cost;
    toplam.set(key, cur);
  }
  return [...toplam.values()]
    .filter((t) => !(brand && containsBrand(t.term, brand, host)))
    .filter((t) => t.conversions > 0 || t.clicks >= ADS_TERM_MIN_CLICKS)
    .sort((a, b) => b.conversions - a.conversions || b.cost - a.cost || b.clicks - a.clicks)
    .slice(0, ADS_TERM_LIMIT)
    .map((t) => ({ ...t, cost: Math.round(t.cost * 100) / 100, source: 'google_ads' as const }));
}
