/**
 * Arama firsatlari — GSC sayfa performansi × GA4 organik acilis sayfalari (saf).
 *
 * Kaynak: open-seo SearchOpportunityService (MIT, every-app/open-seo) —
 * aday filtresi, URL anahtari, yuzdelik siralar ve bilesenler oradan port
 * edildi. Iki bilincli fark:
 *  1) Ayni anahtara dusen satirlar BIRLESTIRILIR (open-seo sonuncuyu tutup
 *     digerlerini dusuruyordu: /a ve /a/, http ve https).
 *  2) Agirliklar (talep 0.5, deger 0.3, erisilebilirlik 0.2) tek kaynakli
 *     (iki-kaynak kurali) → sayi olarak "skor" GOSTERILMEZ; yalniz varsayilan
 *     siralamayi belirler, bilesenler ayri kolon olarak doner.
 *
 * Aday = ortalama pozisyonu 4–20 arasindaki sayfa (ilk 3'te degil ama
 * itilebilir). Esikler open-seo'nun urun parametresi; olcum iddiasi degil.
 */

export const OPPORTUNITY_POSITION_MIN = 4;
export const OPPORTUNITY_POSITION_MAX = 20;
/** open-seo varsayilani — siralamayi belirler, kullaniciya sayi olarak gosterilmez */
const ORDER_WEIGHTS = { demand: 0.5, value: 0.3, reachability: 0.2 } as const;

export interface GscPageRow {
  page: string;
  clicks: number;
  impressions: number;
  position: number;
}

export interface GaLandingRow {
  hostName: string;
  landingPage: string;
  sessions: number;
  engagementRate: number;      // 0..1
  keyEvents: number;
  sessionKeyEventRate: number; // 0..1
}

export type OpportunityValueMetric = 'sessionKeyEventRate' | 'engagementRate';

export interface SearchOpportunity {
  page: string;
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
  ga: { sessions: number; engagementRate: number; keyEvents: number; sessionKeyEventRate: number } | null;
  /** 0..1 yuzdelik siralar (adaylarin yuzde kacindan yuksek); GA eslesmeyende null */
  components: { demand: number; value: number; reachability: number } | null;
}

export interface SearchOpportunityResult {
  rows: SearchOpportunity[];
  totalCandidates: number;
  valueMetric: OpportunityValueMetric;
  coverage: { gscPages: number; gaPages: number; joined: number; gscOnly: number; invalidGaRows: number };
}

/**
 * Host + yol anahtari: protokol, sorgu ve fragman atilir; host kucuk harf,
 * sondaki egik cizgi atilir (kok haric), yuzde kodlamasi buyuk harfe
 * cekilir (%c5%9f ≡ %C5%9F). Yol harf duyarli kalir.
 */
export function normalizePageKey(value: string): string | null {
  const trimmed = (value ?? '').trim();
  if (!trimmed || trimmed === '(not set)') return null;
  try {
    const url = new URL(trimmed.includes('://') ? trimmed : `https://${trimmed}`);
    let host = url.hostname.toLowerCase();
    if (!host) return null;
    const defaultPort = (url.protocol === 'http:' && url.port === '80') || (url.protocol === 'https:' && url.port === '443');
    if (url.port && !defaultPort) host += `:${url.port}`;
    let path = (url.pathname || '/').replace(/%[0-9a-f]{2}/gi, (m) => m.toUpperCase());
    if (path.length > 1) path = path.replace(/\/+$/, '') || '/';
    return `${host}${path}`;
  } catch {
    return null;
  }
}

/** Her deger icin: kendisinden kesin kucuk olanlarin orani (0..1); tek deger → 1 */
export function percentileRanks(values: number[]): number[] {
  if (values.length === 0) return [];
  if (values.length === 1) return [1];
  return values.map((v) => values.filter((x) => x < v).length / (values.length - 1));
}

/** Son analiz gunu = bugun − 3 (GSC ~2-3 gun gecikmeli), 28 gunluk pencere */
export function opportunityDateRange(now: Date): { startDate: string; endDate: string } {
  const day = (offset: number) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + offset)).toISOString().slice(0, 10);
  return { startDate: day(-30), endDate: day(-3) };
}

const round4 = (n: number) => Math.round(n * 10_000) / 10_000;
const num = (n: unknown) => (typeof n === 'number' && Number.isFinite(n) ? n : 0);

interface MergedGsc { page: string; topImpressions: number; clicks: number; impressions: number; positionWeight: number; positionSum: number; rows: number }

function mergeGsc(rows: GscPageRow[]): Map<string, MergedGsc> {
  const map = new Map<string, MergedGsc>();
  for (const r of rows) {
    const key = normalizePageKey(r.page);
    if (!key) continue;
    const imp = num(r.impressions);
    const m = map.get(key) ?? { page: r.page, topImpressions: -1, clicks: 0, impressions: 0, positionWeight: 0, positionSum: 0, rows: 0 };
    if (imp > m.topImpressions) { m.page = r.page; m.topImpressions = imp; }
    m.clicks += num(r.clicks);
    m.impressions += imp;
    // Ortalama pozisyon gosterim agirlikli birlesir (GSC ortalamasi gosterim basinadir)
    m.positionWeight += imp;
    m.positionSum += num(r.position) * imp;
    m.rows += 1;
    map.set(key, m);
  }
  return map;
}

interface MergedGa { sessions: number; keyEvents: number; engaged: number; keyEventSessions: number }

/**
 * Bir oturumun TEK acilis sayfasi var → satirlar ayrik oturum kumeleri;
 * oranlarin oturum agirlikli ortalamasi bu yuzden kesin (yaklasik degil).
 */
function mergeGa(rows: GaLandingRow[]): { map: Map<string, MergedGa>; invalid: number } {
  const map = new Map<string, MergedGa>();
  let invalid = 0;
  for (const r of rows) {
    const host = (r.hostName ?? '').trim();
    const landing = (r.landingPage ?? '').trim();
    const key = host && host !== '(not set)' && landing.startsWith('/') ? normalizePageKey(`${host}${landing}`) : null;
    if (!key) { invalid += 1; continue; }
    const s = num(r.sessions);
    const m = map.get(key) ?? { sessions: 0, keyEvents: 0, engaged: 0, keyEventSessions: 0 };
    m.sessions += s;
    m.keyEvents += num(r.keyEvents);
    m.engaged += num(r.engagementRate) * s;
    m.keyEventSessions += num(r.sessionKeyEventRate) * s;
    map.set(key, m);
  }
  return { map, invalid };
}

export function buildSearchOpportunities(
  gscRows: GscPageRow[],
  gaRows: GaLandingRow[],
  opts: { limit?: number } = {},
): SearchOpportunityResult {
  const raw = typeof opts.limit === 'number' && Number.isFinite(opts.limit) ? opts.limit : 50;
  const limit = Math.max(1, Math.min(100, Math.floor(raw)));
  const gsc = mergeGsc(gscRows);
  const ga = mergeGa(gaRows);

  type Cand = SearchOpportunity & { order: number | null };
  const candidates: Cand[] = [];
  for (const [key, m] of gsc) {
    const position = m.positionWeight > 0 ? m.positionSum / m.positionWeight : 0;
    if (m.impressions <= 0 || position < OPPORTUNITY_POSITION_MIN || position > OPPORTUNITY_POSITION_MAX) continue;
    const g = ga.map.get(key);
    candidates.push({
      page: m.page,
      clicks: m.clicks,
      impressions: m.impressions,
      ctr: round4(m.clicks / m.impressions),
      position: Math.round(position * 10) / 10,
      ga: g && g.sessions > 0
        ? { sessions: g.sessions, engagementRate: round4(g.engaged / g.sessions), keyEvents: g.keyEvents, sessionKeyEventRate: round4(g.keyEventSessions / g.sessions) }
        : null,
      components: null,
      order: null,
    });
  }

  const joined = candidates.filter((c) => c.ga !== null);
  // Hic anahtar olay yoksa (olcum kurulmamis olabilir) deger = etkilesim orani
  const valueMetric: OpportunityValueMetric =
    joined.length > 0 && joined.every((c) => c.ga!.keyEvents === 0) ? 'engagementRate' : 'sessionKeyEventRate';
  const demand = percentileRanks(joined.map((c) => c.impressions));
  const value = percentileRanks(joined.map((c) => c.ga![valueMetric]));
  const reach = percentileRanks(joined.map((c) => OPPORTUNITY_POSITION_MAX - c.position));
  joined.forEach((c, i) => {
    c.components = { demand: round4(demand[i]), value: round4(value[i]), reachability: round4(reach[i]) };
    c.order = ORDER_WEIGHTS.demand * demand[i] + ORDER_WEIGHTS.value * value[i] + ORDER_WEIGHTS.reachability * reach[i];
  });

  candidates.sort((a, b) => {
    if (a.order == null && b.order != null) return 1;
    if (a.order != null && b.order == null) return -1;
    return (b.order ?? 0) - (a.order ?? 0) || b.impressions - a.impressions;
  });

  return {
    rows: candidates.slice(0, limit).map(({ order: _order, ...row }) => row),
    totalCandidates: candidates.length,
    valueMetric,
    coverage: {
      gscPages: gsc.size,
      gaPages: ga.map.size,
      joined: joined.length,
      gscOnly: candidates.length - joined.length,
      invalidGaRows: ga.invalid,
    },
  };
}
