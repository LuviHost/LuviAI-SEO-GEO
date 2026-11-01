/**
 * AI gorunurluk trend grafigi — saglayici serilerini olcum yontemi degisim
 * gununden ikiye boler (saf).
 *
 * NEDEN: grafik her saglayici icin tek cizgi ciziyordu (connectNulls). Yontem
 * (CITATION_MATCH_VERSION) degisince eski ve yeni olcum ayni cizgiyle
 * baglaniyor, kartlar "kiyas yok" derken grafik bir egilim varmis gibi
 * gosteriyordu. Simdi yontem degisiminden ONCEKI noktalar ayri bir seride
 * (`<saglayici>__eski`) durur; iki seri birbirine baglanmaz.
 *
 * Kesim gunu saglayici basina API'nin trends[].methodChangedAt degeridir
 * (guncel yontemin pencerede ilk gorundugu gun); o gun ve sonrasi guncel seri.
 */

export interface ChartPoint { date: string; score: number | null }
export interface ChartTrend { provider: string; methodChangedAt?: string | null }

export interface ChartSeries {
  /** recharts dataKey */
  key: string;
  provider: string;
  /** Yontem degisiminden onceki (kiyaslanmayan) olcumler */
  legacy: boolean;
}

export const LEGACY_SUFFIX = '__eski';

const day = (d: string) => d.slice(0, 10);

export function splitSeriesByMethod(
  byProvider: Record<string, ChartPoint[]>,
  trends: ChartTrend[],
): { rows: Array<Record<string, string | number | null>>; series: ChartSeries[] } {
  const providers = Object.keys(byProvider).filter((p) => (byProvider[p] ?? []).length > 0);
  const cut: Record<string, string | null> = {};
  for (const t of trends) {
    if (typeof t.methodChangedAt === 'string' && t.methodChangedAt) cut[t.provider] = day(t.methodChangedAt);
  }

  const dates = [...new Set(providers.flatMap((p) => byProvider[p].map((pt) => day(pt.date))))].sort();
  const values: Record<string, Record<string, number | null>> = {};
  const series: ChartSeries[] = [];

  for (const p of providers) {
    const legacyKey = `${p}${LEGACY_SUFFIX}`;
    let hasLegacy = false;
    let hasCurrent = false;
    for (const pt of byProvider[p]) {
      const d = day(pt.date);
      const legacy = !!cut[p] && d < cut[p]!;
      const key = legacy ? legacyKey : p;
      (values[key] ??= {})[d] = pt.score;
      if (legacy) hasLegacy = true; else hasCurrent = true;
    }
    if (hasLegacy) series.push({ key: legacyKey, provider: p, legacy: true });
    if (hasCurrent) series.push({ key: p, provider: p, legacy: false });
  }

  const rows = dates.map((d) => {
    const row: Record<string, string | number | null> = { date: d.slice(5) };
    for (const s of series) row[s.key] = values[s.key]?.[d] ?? null;
    return row;
  });
  return { rows, series };
}
