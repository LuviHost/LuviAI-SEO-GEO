import { containsBrand } from '../audit/brand-in-query.js';

/**
 * Organik (GSC) trafikte markali / markasiz ayrimi — tek formul.
 *
 * NEDEN: Faz 1'de AI probe'larinda sorguda marka gecen satirlar mansetten
 * cikarildi (brandInQuery). Ayni ayrim organik tarafta yoktu: GSC sorgulari
 * ham yaziliyor, "tiklama" tek toplam gosteriliyordu. Oysa markali sorgu
 * (insanlar adini yazip seni ariyor) HAFIZA olcer, markasiz sorgu KESIF —
 * ikisini ayni sayida toplamak "SEO kanalin var mi?" sorusunu gizler.
 * Google da ayni ayrimi Search Console'a filtre olarak ekledi (Kas 2025,
 * tum sitelere Mar 2026) ama API'de dimension olarak belgelenmedi; bu yuzden
 * kendi tespitimizle (brand-in-query.ts — AI tarafiyla AYNI kural) boluyoruz.
 *
 * SINIR: AnalyticsSnapshot.queryDetails gun basina ilk 100 sorgu (tiklama
 * sirali). Pay bir ORNEKLEM uzerinden hesaplanir; UI bunu soyler.
 */

export interface OrganicQueryRow {
  query: string;
  clicks: number;
  impressions: number;
}

export interface BrandBucket {
  clicks: number;
  impressions: number;
  queries: number;
}

export interface OrganicBrandSplit {
  branded: BrandBucket;
  unbranded: BrandBucket;
  /** markasiz tiklama / toplam tiklama (orneklem); tiklama yoksa null */
  unbrandedClickSharePct: number | null;
  /** orneklemdeki benzersiz sorgu sayisi */
  sampledQueries: number;
}

const EMPTY: BrandBucket = { clicks: 0, impressions: 0, queries: 0 };

/** Ayni sorgu birden fazla gunde/sayfada gecer — sorgu bazinda topla */
export function aggregateQueries(rows: OrganicQueryRow[]): OrganicQueryRow[] {
  const map = new Map<string, OrganicQueryRow>();
  for (const r of rows) {
    const q = (r.query ?? '').trim();
    if (!q) continue;
    const cur = map.get(q) ?? { query: q, clicks: 0, impressions: 0 };
    cur.clicks += Number(r.clicks ?? 0);
    cur.impressions += Number(r.impressions ?? 0);
    map.set(q, cur);
  }
  return [...map.values()];
}

export function splitQueriesByBrand(rows: OrganicQueryRow[], brand: string): OrganicBrandSplit {
  const agg = aggregateQueries(rows);
  const branded = { ...EMPTY };
  const unbranded = { ...EMPTY };
  for (const r of agg) {
    const b = containsBrand(r.query, brand) ? branded : unbranded;
    b.clicks += r.clicks;
    b.impressions += r.impressions;
    b.queries += 1;
  }
  const totalClicks = branded.clicks + unbranded.clicks;
  return {
    branded,
    unbranded,
    unbrandedClickSharePct: totalClicks > 0 ? Math.round((unbranded.clicks / totalClicks) * 1000) / 10 : null,
    sampledQueries: agg.length,
  };
}

/**
 * Gunluk seri: queryDetails'i dolu her snapshot icin markasiz tiklama payi.
 * Bos listeli gunler (backfill yalnizca son gune liste ilistirir) atlanir.
 */
export function dailyUnbrandedShare(
  snapshots: Array<{ date: Date; queryDetails: unknown }>,
  brand: string,
): Array<{ date: string; unbrandedSharePct: number | null; sampledQueries: number }> {
  const out: Array<{ date: string; unbrandedSharePct: number | null; sampledQueries: number }> = [];
  for (const s of snapshots) {
    const rows = Array.isArray(s.queryDetails) ? (s.queryDetails as OrganicQueryRow[]) : [];
    if (rows.length === 0) continue;
    const split = splitQueriesByBrand(rows, brand);
    out.push({ date: s.date.toISOString().slice(0, 10), unbrandedSharePct: split.unbrandedClickSharePct, sampledQueries: split.sampledQueries });
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}
