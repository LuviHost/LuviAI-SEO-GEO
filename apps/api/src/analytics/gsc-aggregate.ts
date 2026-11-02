/**
 * GSC (Search Console) verisinden toplam / karsilastirma — SAF fonksiyonlar.
 *
 * NEDEN AYRI DOSYA: panelde gosterilen sayilarin GSC ile ayni cikmasi icin
 * tek bir tanim gerekiyordu. Gercek bir sc-domain property'de (~340 sayfa,
 * ayda ~23 bin sorgu) olculen sapmalar:
 *
 *   - Gunluk toplam ILK 50 SAYFANIN toplamiydi: tiklama %6-12, gosterim
 *     %30-40 eksik; pozisyon 50 sayfanin DUZ ortalamasiydi (5,4-6,8 yerine
 *     gercekte 7,0-7,8 — oldugundan iyi gorunuyordu). Backfill ise dogru
 *     `dimensions: ['date']` toplamini yaziyordu; seri iki tanimi karistiriyordu.
 *   - Siralama takibi gun basina ilk 100 sorgu+sayfa satirindan
 *     hesaplaniyordu: 30 gunde 23.914 sorgu yerine 354 sorgu, ortalama sira
 *     6,86 yerine 3,7; "Degisim" eksik gunler yuzunden hep bostu.
 *   - "Yukselen sorgular" eksik gunlerle kiyaslaniyordu: gercekte %88 DUSEN
 *     bir sorgu +%31.386 "yukselen" gorunuyordu.
 *
 * KURAL: toplamlar ve pozisyon her zaman GSC'nin KENDI agregasyonundan
 * (gun boyutu ya da boyutsuz istek) gelir; ilk-N liste yalnizca DETAYDIR,
 * asla toplam diye toplanmaz. Donem karsilastirmasi ayni uzunlukta, hemen
 * onceki doneme ve ayni sorguya karsi yapilir; esik altindaki gurultu
 * "yukselen/dusen" sayilmaz.
 */

export interface GscRow {
  keys?: string[] | null;
  clicks?: number | null;
  impressions?: number | null;
  ctr?: number | null;
  position?: number | null;
}

/**
 * webmasters.searchanalytics'in kullandigimiz dar yuzu — testte sahte
 * istemci verilebilsin diye (ag yok).
 */
export interface SearchAnalyticsApi {
  query(
    params: { siteUrl: string; requestBody: Record<string, unknown> },
    options?: { timeout?: number },
  ): Promise<{ data?: { rows?: GscRow[] | null } | null }>;
}

export interface Metric {
  clicks: number;
  impressions: number;
  /** 0..1 */
  ctr: number;
  /** GSC ortalama pozisyonu; olcum yoksa 0 */
  position: number;
}

export interface QueryMetric extends Metric {
  query: string;
}

export interface DayTotals extends Metric {
  /** YYYY-MM-DD */
  date: string;
}

/** GSC tek istekte en fazla bu kadar satir dondurur; fazlasi startRow ile sayfalanir */
export const GSC_MAX_ROW_LIMIT = 25_000;

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

export function toMetric(r: GscRow | null | undefined): Metric {
  return {
    clicks: num(r?.clicks),
    impressions: num(r?.impressions),
    ctr: num(r?.ctr),
    position: num(r?.position),
  };
}

/**
 * Sayfalayarak tum satirlari ceker. `maxRows` bellek/kota emniyeti: GSC
 * satirlari tiklamaya gore sirali dondurur, kesilen kuyruk en az trafikli
 * satirlardir — yine de `truncated` ile bildirilir.
 */
export async function fetchAllRows(
  api: SearchAnalyticsApi,
  siteUrl: string,
  body: Record<string, unknown>,
  opts: { maxRows?: number; timeoutMs?: number } = {},
): Promise<{ rows: GscRow[]; truncated: boolean }> {
  const max = Math.max(1, opts.maxRows ?? 100_000);
  const rows: GscRow[] = [];
  let startRow = 0;
  while (rows.length < max) {
    const rowLimit = Math.min(GSC_MAX_ROW_LIMIT, max - rows.length);
    const res = await api.query(
      { siteUrl, requestBody: { ...body, rowLimit, startRow } },
      opts.timeoutMs ? { timeout: opts.timeoutMs } : undefined,
    );
    const page = res?.data?.rows ?? [];
    for (const r of page) rows.push(r);
    if (page.length < rowLimit) return { rows, truncated: false };
    startRow += page.length;
  }
  return { rows, truncated: true };
}

/** `dimensions: ['date']` satirlari → gun toplamlari (tarih sirali). Bos/bozuk tarih atlanir. */
export function dailyTotalsFromRows(rows: GscRow[]): DayTotals[] {
  const out: DayTotals[] = [];
  for (const r of rows ?? []) {
    const date = r?.keys?.[0];
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    out.push({ date, ...toMetric(r) });
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

/** Ilk anahtara (sorgu) gore metrik satirlari. Ayni anahtar iki kez gelirse ilk satir kalir. */
export function queryMetricsFromRows(rows: GscRow[]): QueryMetric[] {
  const seen = new Set<string>();
  const out: QueryMetric[] = [];
  for (const r of rows ?? []) {
    const query = (r?.keys?.[0] ?? '').trim();
    if (!query || seen.has(query)) continue;
    seen.add(query);
    out.push({ query, ...toMetric(r) });
  }
  return out;
}

/** Gosterimle agirlikli pozisyon (GSC'nin kendi toplama mantigi); gosterim yoksa 0 */
export function weightedPosition(rows: Array<Pick<Metric, 'impressions' | 'position'>>): number {
  let w = 0;
  let imp = 0;
  for (const r of rows) {
    const i = num(r.impressions);
    const p = num(r.position);
    if (i <= 0 || p <= 0) continue;
    w += p * i;
    imp += i;
  }
  return imp > 0 ? w / imp : 0;
}

/** Gun toplamlarindan donem toplami: tiklama/gosterim toplanir, CTR yeniden hesaplanir, pozisyon agirlikli */
export function sumTotals(days: Array<Pick<Metric, 'clicks' | 'impressions' | 'position'>>): Metric {
  const clicks = days.reduce((s, d) => s + num(d.clicks), 0);
  const impressions = days.reduce((s, d) => s + num(d.impressions), 0);
  return {
    clicks,
    impressions,
    ctr: impressions > 0 ? clicks / impressions : 0,
    position: weightedPosition(days),
  };
}

// ─────────────────────────────────────────────
//  Tarih / donem
// ─────────────────────────────────────────────

export function isoDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function addDays(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return isoDay(d);
}

/** Iki tarih arasindaki gun sayisi, iki uc DAHIL */
export function daysInclusive(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1;
}

export interface DateRange {
  from: string;
  to: string;
}

/**
 * GSC'nin son veri gunune (latest) dayali donem ve hemen onceki ESIT uzunlukta
 * donem. Bugunden geri saymak yanlis: GSC ~2 gun gecikmeli, "son 7 gun"un
 * 2 gunu bos kalir ve onceki doneme gore sahte dusus/yukselis uretir.
 */
export function periodWindows(latest: string, days: number): { current: DateRange; previous: DateRange } {
  const n = Math.max(1, Math.floor(days));
  return {
    current: { from: addDays(latest, -(n - 1)), to: latest },
    previous: { from: addDays(latest, -(2 * n - 1)), to: addDays(latest, -n) },
  };
}

/** `dimensions: ['date']` satirlarindan en son veri gunu */
export function latestDateFromRows(rows: GscRow[]): string | null {
  const days = dailyTotalsFromRows(rows);
  return days.length ? days[days.length - 1].date : null;
}

export interface Coverage {
  /** Ekranin iddia ettigi gun sayisi ("son 30 gun") */
  requestedDays: number;
  /** Pencerede gercekten verisi olan gun sayisi */
  coveredDays: number;
  /** Verisi olan ilk / son gun; hic yoksa null */
  from: string | null;
  to: string | null;
  windowFrom: string;
  windowTo: string;
  /** Pencerenin her gunu veriliyse true */
  complete: boolean;
}

/**
 * Saklanan gunlerin pencereyi ne kadar kapsadigi. "Son 30 gun" diye
 * gosterilen toplam 15 gunluk veriden geliyorsa ekran bunu SOYLEMELI.
 */
export function snapshotCoverage(dates: string[], windowFrom: string, windowTo: string, requestedDays: number): Coverage {
  const inWindow = [...new Set(dates)].filter((d) => d >= windowFrom && d <= windowTo).sort();
  return {
    requestedDays,
    coveredDays: inWindow.length,
    from: inWindow[0] ?? null,
    to: inWindow[inWindow.length - 1] ?? null,
    windowFrom,
    windowTo,
    complete: inWindow.length >= requestedDays,
  };
}

// ─────────────────────────────────────────────
//  Siralama takibi
// ─────────────────────────────────────────────

/** Bir donemde bu kadar gosterimin altindaki sorgunun pozisyon farki gurultudur */
export const RANK_DELTA_MIN_IMPRESSIONS = 10;
/** "Yukselen/Dusen" sayilmak icin en az bu kadar sira degisimi */
export const RANK_MOVE_MIN_POSITIONS = 1;

export type RankTier = 'top3' | 'top10' | 'near' | 'low';

export function classifyTier(position: number): RankTier {
  if (position > 0 && position <= 3) return 'top3';
  if (position > 0 && position <= 10) return 'top10';
  if (position > 0 && position <= 20) return 'near';
  return 'low';
}

const round1 = (n: number) => Math.round(n * 10) / 10;

export interface RankingKeyword {
  query: string;
  page: string;
  position: number;
  previousPosition: number | null;
  /** onceki - simdiki (pozitif = iyilesti); karsilastirilamiyorsa null */
  delta: number | null;
  clicks: number;
  impressions: number;
  /** 0-100 yuzde */
  ctr: number;
  previousClicks: number | null;
  previousImpressions: number | null;
  /** Gunluk pozisyon; veri yoksa bos (sahte duz cizgi CIZILMEZ) */
  sparkline: { date: string; position: number }[];
  tier: RankTier;
}

export interface RankingSummaryCounts {
  total: number;
  winning: number;
  top10: number;
  opportunities: number;
  improving: number;
  declining: number;
  /** Sorgu satirlarindan gosterim-agirlikli pozisyon */
  avgPosition: number;
  /** Sorgu satirlarinin toplami (GSC anonim sorgulari icermez) */
  queryClicks: number;
  queryImpressions: number;
}

export function rankingDelta(
  cur: Pick<Metric, 'impressions' | 'position'>,
  prev: Pick<Metric, 'impressions' | 'position'> | undefined,
  minImpressions = RANK_DELTA_MIN_IMPRESSIONS,
): number | null {
  if (!prev) return null;
  if (cur.impressions < minImpressions || prev.impressions < minImpressions) return null;
  if (!(cur.position > 0) || !(prev.position > 0)) return null;
  return round1(prev.position - cur.position);
}

export function buildRankings(input: {
  current: QueryMetric[];
  previous: QueryMetric[];
  pages?: Map<string, string>;
  sparklines?: Map<string, { date: string; position: number }[]>;
  limit?: number;
  minImpressions?: number;
  moveMin?: number;
}): { keywords: RankingKeyword[]; summary: RankingSummaryCounts; truncated: boolean } {
  const minImp = input.minImpressions ?? RANK_DELTA_MIN_IMPRESSIONS;
  const moveMin = input.moveMin ?? RANK_MOVE_MIN_POSITIONS;
  const prevByQuery = new Map(input.previous.map((p) => [p.query, p]));

  const all: RankingKeyword[] = input.current.map((c) => {
    const prev = prevByQuery.get(c.query);
    return {
      query: c.query,
      page: input.pages?.get(c.query) ?? '',
      position: round1(c.position),
      previousPosition: prev && prev.position > 0 ? round1(prev.position) : null,
      delta: rankingDelta(c, prev, minImp),
      clicks: c.clicks,
      impressions: c.impressions,
      ctr: c.impressions > 0 ? Math.round((c.clicks / c.impressions) * 10000) / 100 : 0,
      previousClicks: prev ? prev.clicks : null,
      previousImpressions: prev ? prev.impressions : null,
      sparkline: input.sparklines?.get(c.query) ?? [],
      tier: classifyTier(c.position),
    };
  });

  // Ozet TUM sorgulardan (liste kesilse bile sayilar GSC ile ayni kalir)
  const summary: RankingSummaryCounts = {
    total: all.length,
    winning: all.filter((k) => k.tier === 'top3').length,
    top10: all.filter((k) => k.tier === 'top3' || k.tier === 'top10').length,
    opportunities: all.filter((k) => k.tier === 'near').length,
    improving: all.filter((k) => k.delta !== null && k.delta >= moveMin).length,
    declining: all.filter((k) => k.delta !== null && k.delta <= -moveMin).length,
    avgPosition: round1(weightedPosition(input.current)),
    queryClicks: input.current.reduce((s, c) => s + c.clicks, 0),
    queryImpressions: input.current.reduce((s, c) => s + c.impressions, 0),
  };

  const sorted = all.sort((a, b) => b.impressions - a.impressions || b.clicks - a.clicks);
  const limit = input.limit ?? sorted.length;
  return { keywords: sorted.slice(0, limit), summary, truncated: sorted.length > limit };
}

/**
 * `dimensions: ['query','page']` satirlarindan her sorgunun en cok tiklanan
 * (esitlikte en cok gosterilen) sayfasi.
 */
export function topPageByQuery(rows: GscRow[]): Map<string, string> {
  const best = new Map<string, { page: string; clicks: number; impressions: number }>();
  for (const r of rows ?? []) {
    const q = (r?.keys?.[0] ?? '').trim();
    const page = r?.keys?.[1] ?? '';
    if (!q || !page) continue;
    const m = toMetric(r);
    const cur = best.get(q);
    if (!cur || m.clicks > cur.clicks || (m.clicks === cur.clicks && m.impressions > cur.impressions)) {
      best.set(q, { page, clicks: m.clicks, impressions: m.impressions });
    }
  }
  return new Map([...best].map(([q, v]) => [q, v.page]));
}

/** `dimensions: ['query','date']` satirlarindan sorgu basina gunluk pozisyon serisi */
export function sparklinesFromRows(rows: GscRow[]): Map<string, { date: string; position: number }[]> {
  const out = new Map<string, { date: string; position: number }[]>();
  for (const r of rows ?? []) {
    const q = (r?.keys?.[0] ?? '').trim();
    const date = r?.keys?.[1] ?? '';
    const position = num(r?.position);
    if (!q || !date || position <= 0) continue;
    const arr = out.get(q) ?? [];
    arr.push({ date, position: round1(position) });
    out.set(q, arr);
  }
  for (const arr of out.values()) arr.sort((a, b) => a.date.localeCompare(b.date));
  return out;
}

const RE2_SPECIAL = /[.*+?^${}()|[\]\\]/g;

/**
 * Sorgu listesini GSC `includingRegex` filtresine bol (RE2, tam eslesme).
 * Ifade uzunlugu sinirli oldugu icin parcalara ayrilir.
 */
export function exactQueryRegexChunks(queries: string[], maxLen = 3500): string[] {
  const chunks: string[] = [];
  let cur: string[] = [];
  let len = 0;
  for (const q of queries) {
    const esc = q.replace(RE2_SPECIAL, '\\$&');
    if (esc.length + 8 > maxLen) continue; // tek basina sigmayan uc sorgu atlanir
    if (cur.length && len + esc.length + 1 + 8 > maxLen) {
      chunks.push(`^(?:${cur.join('|')})$`);
      cur = [];
      len = 0;
    }
    cur.push(esc);
    len += esc.length + 1;
  }
  if (cur.length) chunks.push(`^(?:${cur.join('|')})$`);
  return chunks;
}

// ─────────────────────────────────────────────
//  Yukselen / dusen sorgular
// ─────────────────────────────────────────────

export interface TrendingQuery {
  query: string;
  recentImp: number;
  prevImp: number;
  recentClicks: number;
  prevClicks: number;
  /** Isaretli yuzde (dusus negatif); onceki donem esik altindaysa null */
  growthPct: number | null;
  /** Onceki donemde (neredeyse) yoktu */
  isNew: boolean;
}

export const TRENDING_MIN_CURRENT_IMPRESSIONS = 50;
export const TRENDING_MIN_PREVIOUS_IMPRESSIONS = 10;
export const TRENDING_MIN_GROWTH_PCT = 30;

/**
 * Ayni sorgunun iki esit donemdeki gosterimi. Onceki donem esik altindaysa
 * yuzde UYDURULMAZ (2 → 2.204 "+%110.000" degil "yeni"); bir donem eksik
 * veriyse bu fonksiyon cagrilmamali — iki donem de GSC'den canli gelir.
 */
export function compareQueryPeriods(
  current: QueryMetric[],
  previous: QueryMetric[],
  opts: { minCurrent?: number; minPrevious?: number; minGrowthPct?: number; limit?: number } = {},
): { rising: TrendingQuery[]; falling: TrendingQuery[] } {
  const minCur = opts.minCurrent ?? TRENDING_MIN_CURRENT_IMPRESSIONS;
  const minPrev = opts.minPrevious ?? TRENDING_MIN_PREVIOUS_IMPRESSIONS;
  const minGrowth = opts.minGrowthPct ?? TRENDING_MIN_GROWTH_PCT;
  const limit = opts.limit ?? 10;

  const prevBy = new Map(previous.map((p) => [p.query, p]));
  const curBy = new Map(current.map((c) => [c.query, c]));
  const row = (q: string, c?: QueryMetric, p?: QueryMetric): TrendingQuery => {
    const recentImp = c?.impressions ?? 0;
    const prevImp = p?.impressions ?? 0;
    const isNew = prevImp < minPrev;
    return {
      query: q,
      recentImp,
      prevImp,
      recentClicks: c?.clicks ?? 0,
      prevClicks: p?.clicks ?? 0,
      growthPct: isNew ? null : Math.round(((recentImp - prevImp) / prevImp) * 100),
      isNew,
    };
  };

  const rising: TrendingQuery[] = [];
  for (const c of current) {
    if (c.impressions < minCur) continue;
    const t = row(c.query, c, prevBy.get(c.query));
    if (t.isNew || (t.growthPct !== null && t.growthPct >= minGrowth)) rising.push(t);
  }

  const falling: TrendingQuery[] = [];
  for (const p of previous) {
    if (p.impressions < minCur) continue;
    const t = row(p.query, curBy.get(p.query), p);
    if (t.growthPct !== null && t.growthPct <= -minGrowth) falling.push(t);
  }

  // Mutlak gosterim farkina gore: kucuk tabanli dev yuzdeler one gecmesin
  rising.sort((a, b) => b.recentImp - b.prevImp - (a.recentImp - a.prevImp));
  falling.sort((a, b) => a.recentImp - a.prevImp - (b.recentImp - b.prevImp));
  return { rising: rising.slice(0, limit), falling: falling.slice(0, limit) };
}

// ─────────────────────────────────────────────
//  Haftalik e-posta ozeti
// ─────────────────────────────────────────────

export interface WeeklySnapshotRow {
  date: Date | string;
  totalClicks: number;
  totalImpressions: number;
  avgPosition: number;
}

export interface WeeklySiteSummary {
  current: DateRange;
  previous: DateRange;
  clicks: number;
  impressions: number;
  /** Gosterim-agirlikli */
  position: number;
  coveredDays: number;
  prevClicks: number;
  prevCoveredDays: number;
  /** Onceki hafta en az bu hafta kadar gunle olculduyse true */
  comparable: boolean;
  daily: Array<{ date: string; clicks: number }>;
}

/**
 * Bir sitenin son 7 VERI gunu ve hemen onceki 7 gun. Bugunden geri saymak
 * GSC gecikmesi yuzunden "bu hafta"yi 4-5 gune dusururdu; onceki hafta tam
 * 7 gunken bu "dusus" gibi okunur. Onceki hafta daha az gunle olculduyse
 * karsilastirma yapilmaz (eksik veriye karsi sahte buyume uretmemek icin).
 */
export function weeklySiteSummary(rows: WeeklySnapshotRow[]): WeeklySiteSummary | null {
  const norm = rows
    .map((r) => ({ ...r, day: typeof r.date === 'string' ? r.date.slice(0, 10) : isoDay(r.date) }))
    .sort((a, b) => a.day.localeCompare(b.day));
  if (norm.length === 0) return null;
  const latest = norm[norm.length - 1].day;
  const { current, previous } = periodWindows(latest, 7);
  const cur = norm.filter((r) => r.day >= current.from && r.day <= current.to);
  const prev = norm.filter((r) => r.day >= previous.from && r.day <= previous.to);
  const t = sumTotals(cur.map((r) => ({ clicks: r.totalClicks, impressions: r.totalImpressions, position: r.avgPosition })));
  return {
    current,
    previous,
    clicks: t.clicks,
    impressions: t.impressions,
    position: t.position,
    coveredDays: cur.length,
    prevClicks: prev.reduce((s, r) => s + num(r.totalClicks), 0),
    prevCoveredDays: prev.length,
    comparable: prev.length > 0 && prev.length >= cur.length,
    daily: cur.map((r) => ({ date: r.day, clicks: num(r.totalClicks) })),
  };
}
