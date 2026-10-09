/**
 * Karsilastirilabilir trend — "elma ile elma" (saf).
 *
 * NEDEN: KPI deltasi, alarm ve rapor iki donemi HAVUZ olarak kiyasliyordu.
 * Prompt seti degisince (beyin yenilendi, kullanici prompt ekledi/sildi),
 * saglayici eklenince ya da olcum yontemi degisince fark "gorunurluk degisti"
 * diye gosteriliyordu — musteriye sahte dusus e-postasi dahil.
 *
 * Kural (open-seo'nun yaklasimi, MIT — kod port edilmedi, yeniden yazildi):
 *  - Hucre = ayni sey olculen birim (prompt|fan-out × saglayici, ya da
 *    sorgu × saglayici). Donem degeri = hucre ortalamalarinin ortalamasi,
 *    YALNIZCA iki donemde de olculen hucreler uzerinden.
 *  - Ortak hucre orani esigin altindaysa → 'scope_changed', delta yok.
 *  - Olcum yontemi surumu farkliysa → 'method_changed', delta yok.
 *
 * Esik (0.9) open-seo'dan gelen bir URUN PARAMETRESI — iddia degil, gosterim
 * politikasi (iki-kaynak kurali: sayisal iddia olarak sunulmaz).
 */

export type TrendState = 'comparable' | 'scope_changed' | 'method_changed' | 'no_previous' | 'no_data';

export interface TrendRow {
  cell: string;
  /** true = guncel donem, false = onceki donem */
  current: boolean;
  /** Hucre icin olcum (0..1 oran ya da 0..100 puan — tutarli olsun) */
  value: number;
  /** Olcum yontemi surumu (yoksa 1) */
  version?: number | null;
}

export interface TrendResult {
  state: TrendState;
  /** comparable: ortak hucrelerin ortalamasi; aksi halde donem havuz ortalamasi */
  current: number | null;
  previous: number | null;
  /** Yalnizca comparable'da: current - previous */
  delta: number | null;
  matchedCells: number;
  currentCells: number;
  previousCells: number;
  /** ortak hucre / buyuk donemin hucre sayisi */
  coverage: number;
}

export const DEFAULT_MIN_COVERAGE = 0.9;

type Agg = Map<string, { sum: number; n: number }>;

function add(m: Agg, cell: string, v: number) {
  const a = m.get(cell) ?? { sum: 0, n: 0 };
  a.sum += v;
  a.n += 1;
  m.set(cell, a);
}

const cellMean = (m: Agg, k: string) => { const a = m.get(k)!; return a.sum / a.n; };

function poolMean(m: Agg): number | null {
  let sum = 0, n = 0;
  for (const a of m.values()) { sum += a.sum; n += a.n; }
  return n ? sum / n : null;
}

function sameSet(a: Set<number>, b: Set<number>): boolean {
  if (a.size !== b.size) return false;
  for (const x of a) if (!b.has(x)) return false;
  return true;
}

export function compareCells(rows: TrendRow[], opts: { minCoverage?: number } = {}): TrendResult {
  const minCoverage = opts.minCoverage ?? DEFAULT_MIN_COVERAGE;
  const cur: Agg = new Map();
  const prev: Agg = new Map();
  const curV = new Set<number>();
  const prevV = new Set<number>();
  for (const r of rows) {
    if (!Number.isFinite(r.value)) continue;
    if (r.current) { add(cur, r.cell, r.value); curV.add(r.version ?? 1); }
    else { add(prev, r.cell, r.value); prevV.add(r.version ?? 1); }
  }

  const base = { currentCells: cur.size, previousCells: prev.size };
  if (cur.size === 0) {
    return { state: 'no_data', current: null, previous: poolMean(prev), delta: null, matchedCells: 0, coverage: 0, ...base };
  }
  if (prev.size === 0) {
    return { state: 'no_previous', current: poolMean(cur), previous: null, delta: null, matchedCells: 0, coverage: 0, ...base };
  }

  const matched = [...cur.keys()].filter((k) => prev.has(k));
  const coverage = matched.length / Math.max(cur.size, prev.size);

  if (!sameSet(curV, prevV)) {
    return { state: 'method_changed', current: poolMean(cur), previous: poolMean(prev), delta: null, matchedCells: matched.length, coverage, ...base };
  }
  if (matched.length === 0 || coverage < minCoverage) {
    return { state: 'scope_changed', current: poolMean(cur), previous: poolMean(prev), delta: null, matchedCells: matched.length, coverage, ...base };
  }

  const c = matched.reduce((s, k) => s + cellMean(cur, k), 0) / matched.length;
  const p = matched.reduce((s, k) => s + cellMean(prev, k), 0) / matched.length;
  return { state: 'comparable', current: c, previous: p, delta: c - p, matchedCells: matched.length, coverage, ...base };
}
