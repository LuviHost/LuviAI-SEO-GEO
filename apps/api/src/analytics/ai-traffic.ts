import { AI_SOURCES, analyticsSourceDomains, classifySessionSource } from '../audit/ai-source.js';
import { escapeRegex } from '../common/text-normalize.js';

/**
 * "AI'dan gelen trafik" raporu — saf katman (GEO Faz 3). I/O ai-traffic.service.ts.
 *
 * Iki bagimsiz olcum, AYRI gosterilir (toplanmaz):
 *  1) GA4: sessionSource bir AI asistaninin alan adi olan oturumlar. Kaynak
 *     listesi audit/ai-source.ts'ten (tracker.js ile ortak tek liste); regex
 *     buradan uretilir, elle yazilmaz.
 *  2) RanksUp izleme kodu: ai_referrer_hits (referer host'u ya da utm_source,
 *     oturum basina bir kez). GA4 bagli degilse ya da cerez onayi GA4'u
 *     kisitliyorsa tek veri budur.
 */

export const AI_TRAFFIC_DAYS = [28, 90] as const;
export const MAX_LANDING_PAGES = 20;
export const GA_PAGE_ROW_LIMIT = 1000;
export const GA_DAILY_ROW_LIMIT = 5000;
export const MAX_TRACKER_PAGES = 10;

/** ?days= degeri: yalniz 28 ya da 90 (baska deger 28'e duser) */
export function aiTrafficDays(raw: unknown): number {
  // Yalniz sayi ya da dize: qs `?days=90&days=30` girdisini diziye cevirir
  const n = typeof raw === 'number' ? raw : typeof raw === 'string' ? parseInt(raw, 10) : NaN;
  return (AI_TRAFFIC_DAYS as readonly number[]).includes(n) ? n : 28;
}

const isoDay = (d: Date) => d.toISOString().slice(0, 10);

/**
 * Pencere: dun dahil son N tam gun (UTC). Bugun yarim gun oldugu ve GA4
 * verisi gecikmeli islendigi icin disarida; tracker serisi de ayni pencereyle
 * okunur ki iki kaynak ayni gunleri kapsasin.
 */
export function aiTrafficRange(now: Date, days: number): { startDate: string; endDate: string } {
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 1));
  const start = new Date(end.getTime() - (days - 1) * 86400000);
  return { startDate: isoDay(start), endDate: isoDay(end) };
}

/** Penceredeki gunler (YYYY-MM-DD, artan) */
export function rangeDays(range: { startDate: string; endDate: string }): string[] {
  const out: string[] = [];
  const end = Date.parse(`${range.endDate}T00:00:00Z`);
  for (let t = Date.parse(`${range.startDate}T00:00:00Z`); t <= end; t += 86400000) out.push(isoDay(new Date(t)));
  return out;
}

/**
 * GA4 FULL_REGEXP (RE2) — "chatgpt.com" ve alt alanlari ("www.perplexity.ai").
 * Tek kaynak: analyticsSourceDomains (ai-source.ts).
 */
export function aiSessionSourceRegex(domains: readonly string[] = analyticsSourceDomains()): string {
  const alts = [...new Set(domains.map((d) => d.trim().toLowerCase()).filter(Boolean))].map(escapeRegex);
  return `^(?:[a-z0-9-]+\\.)*(?:${alts.join('|')})$`;
}

function sourceFilter() {
  return {
    filter: {
      fieldName: 'sessionSource',
      stringFilter: { matchType: 'FULL_REGEXP', value: aiSessionSourceRegex(), caseSensitive: false },
    },
  };
}

/**
 * Uc runReport govdesi (boyut/metrik adlari GA4 Data API semasindan):
 *  - daily: date x sessionSource — asistan toplamlari ve gunluk seri bundan
 *    (en fazla 90 gun x ~10 kaynak; satir siniri kesmez)
 *  - pages: sessionSource x landingPage — en cok AI ziyareti alan sayfalar.
 *    landingPage sorgusuz yol: landingPagePlusQueryString utm_source'lu
 *    adresleri ayri satirlara bolerdi.
 *  - total: boyutsuz sessions — AI payinin paydasi
 * totalRevenue yalniz withRevenue'da istenir (gelir izlemeyen mulkte cagiran
 * hatayi yakalayip gelirsiz tekrar dener).
 */
export function buildAiTrafficRequests(range: { startDate: string; endDate: string }, opts: { withRevenue: boolean }) {
  const dateRanges = [range];
  const metrics = [
    { name: 'sessions' },
    { name: 'engagedSessions' },
    { name: 'keyEvents' },
    ...(opts.withRevenue ? [{ name: 'totalRevenue' }] : []),
  ];
  return {
    daily: {
      dateRanges,
      dimensions: [{ name: 'date' }, { name: 'sessionSource' }],
      metrics,
      dimensionFilter: sourceFilter(),
      limit: String(GA_DAILY_ROW_LIMIT),
    },
    pages: {
      dateRanges,
      dimensions: [{ name: 'sessionSource' }, { name: 'landingPage' }],
      metrics: [{ name: 'sessions' }, { name: 'engagedSessions' }, { name: 'keyEvents' }],
      dimensionFilter: sourceFilter(),
      orderBys: [{ metric: { metricName: 'sessions' }, desc: true }],
      limit: String(GA_PAGE_ROW_LIMIT),
    },
    total: {
      dateRanges,
      metrics: [{ name: 'sessions' }],
    },
  };
}

/** GA4 rapor satiri (Data API ham bicimi) */
export interface GaRow {
  dimensionValues?: Array<{ value?: string | null }> | null;
  metricValues?: Array<{ value?: string | null }> | null;
}

export interface AiTrafficMetrics {
  sessions: number;
  engagedSessions: number;
  keyEvents: number;
  /** Yalniz gelir okunabildiyse; aksi halde null */
  revenue: number | null;
}

export interface AiTrafficGa {
  totals: AiTrafficMetrics & { engagementRate: number | null };
  byAssistant: Array<AiTrafficMetrics & { key: string; label: string; engagementRate: number | null }>;
  landingPages: Array<{ page: string; sessions: number; engagedSessions: number; keyEvents: number; byAssistant: Record<string, number> }>;
  daily: Array<{ date: string; total: number; byAssistant: Record<string, number> }>;
  /** Ayni pencerede sitenin tum oturumlari */
  siteSessions: number;
  /** AI oturumlari / tum oturumlar (0..1); site oturumu yoksa null */
  aiShare: number | null;
  revenueAvailable: boolean;
  /** Sayfa raporu satir sinirina takildiysa true (sayfa listesi kismi) */
  pagesTruncated: boolean;
  /** Regex'e uyup asistana eslenemeyen oturumlar (beklenen 0) */
  unclassifiedSessions: number;
}

const num = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const dim = (r: GaRow, i: number) => String(r.dimensionValues?.[i]?.value ?? '');
const met = (r: GaRow, i: number) => num(r.metricValues?.[i]?.value);
const rate = (engaged: number, sessions: number) => (sessions > 0 ? engaged / sessions : null);

/** "20261024" → "2026-10-24" */
export function gaDate(raw: string): string {
  return /^\d{8}$/.test(raw) ? `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}` : raw;
}

export function mapAiTraffic(input: {
  range: { startDate: string; endDate: string };
  dailyRows: readonly GaRow[];
  pageRows: readonly GaRow[];
  pageRowCount?: number;
  totalRows: readonly GaRow[];
  withRevenue: boolean;
}): AiTrafficGa {
  const byKey = new Map<string, AiTrafficMetrics>();
  const byDay = new Map<string, Record<string, number>>();
  let unclassified = 0;

  for (const r of input.dailyRows) {
    const cls = classifySessionSource(dim(r, 1));
    const sessions = met(r, 0);
    if (!cls) {
      unclassified += sessions;
      continue;
    }
    const acc = byKey.get(cls.key) ?? { sessions: 0, engagedSessions: 0, keyEvents: 0, revenue: input.withRevenue ? 0 : null };
    acc.sessions += sessions;
    acc.engagedSessions += met(r, 1);
    acc.keyEvents += met(r, 2);
    if (input.withRevenue) acc.revenue = (acc.revenue ?? 0) + met(r, 3);
    byKey.set(cls.key, acc);
    const d = gaDate(dim(r, 0));
    const day = byDay.get(d) ?? {};
    day[cls.key] = (day[cls.key] ?? 0) + sessions;
    byDay.set(d, day);
  }

  const byAssistant = AI_SOURCES.filter((s) => byKey.has(s.key))
    .map((s) => {
      const m = byKey.get(s.key)!;
      return { key: s.key, label: s.label, ...m, engagementRate: rate(m.engagedSessions, m.sessions) };
    })
    .sort((a, b) => b.sessions - a.sessions || a.key.localeCompare(b.key));

  const totals = byAssistant.reduce(
    (t, a) => ({
      sessions: t.sessions + a.sessions,
      engagedSessions: t.engagedSessions + a.engagedSessions,
      keyEvents: t.keyEvents + a.keyEvents,
      revenue: input.withRevenue ? (t.revenue ?? 0) + (a.revenue ?? 0) : null,
    }),
    { sessions: 0, engagedSessions: 0, keyEvents: 0, revenue: input.withRevenue ? 0 : null } as AiTrafficMetrics,
  );

  const pages = new Map<string, { page: string; sessions: number; engagedSessions: number; keyEvents: number; byAssistant: Record<string, number> }>();
  for (const r of input.pageRows) {
    const cls = classifySessionSource(dim(r, 0));
    if (!cls) continue;
    const page = dim(r, 1) || '(not set)';
    const acc = pages.get(page) ?? { page, sessions: 0, engagedSessions: 0, keyEvents: 0, byAssistant: {} };
    const s = met(r, 0);
    acc.sessions += s;
    acc.engagedSessions += met(r, 1);
    acc.keyEvents += met(r, 2);
    acc.byAssistant[cls.key] = (acc.byAssistant[cls.key] ?? 0) + s;
    pages.set(page, acc);
  }
  const landingPages = [...pages.values()]
    .sort((a, b) => b.sessions - a.sessions || a.page.localeCompare(b.page))
    .slice(0, MAX_LANDING_PAGES);

  const daily = rangeDays(input.range).map((date) => {
    const m = byDay.get(date) ?? {};
    return { date, total: Object.values(m).reduce((a, b) => a + b, 0), byAssistant: m };
  });

  const siteSessions = input.totalRows.length > 0 ? met(input.totalRows[0], 0) : 0;
  return {
    totals: { ...totals, engagementRate: rate(totals.engagedSessions, totals.sessions) },
    byAssistant,
    landingPages,
    daily,
    siteSessions,
    aiShare: siteSessions > 0 ? totals.sessions / siteSessions : null,
    revenueAvailable: input.withRevenue,
    pagesTruncated: typeof input.pageRowCount === 'number' && input.pageRowCount > input.pageRows.length,
    unclassifiedSessions: unclassified,
  };
}

// ── RanksUp izleme kodu (ai_referrer_hits) ──────────────────────────

export interface TrackerHitRow {
  date: Date | string;
  referrer: string;
  hits: number;
  topUrls?: unknown;
}

export interface TrackerSeries {
  totalHits: number;
  byAssistant: Array<{ key: string; label: string; hits: number }>;
  daily: Array<{ date: string; total: number; byAssistant: Record<string, number> }>;
  /**
   * En cok ziyaret alan adresler. Gunluk satir yalniz o gunun ilk 10 adresini
   * tuttugu icin toplam YAKLASIKTIR (alt siradaki adresler eksik sayilabilir).
   */
  topPages: Array<{ url: string; count: number }>;
}

export function mapTrackerHits(rows: readonly TrackerHitRow[], range: { startDate: string; endDate: string }): TrackerSeries {
  const byKey = new Map<string, number>();
  const byDay = new Map<string, Record<string, number>>();
  const urls = new Map<string, number>();
  for (const r of rows) {
    const d = typeof r.date === 'string' ? r.date.slice(0, 10) : isoDay(r.date);
    if (d < range.startDate || d > range.endDate) continue;
    const hits = num(r.hits);
    byKey.set(r.referrer, (byKey.get(r.referrer) ?? 0) + hits);
    const day = byDay.get(d) ?? {};
    day[r.referrer] = (day[r.referrer] ?? 0) + hits;
    byDay.set(d, day);
    if (Array.isArray(r.topUrls)) {
      for (const t of r.topUrls as Array<{ url?: unknown; count?: unknown }>) {
        if (typeof t?.url !== 'string') continue;
        urls.set(t.url, (urls.get(t.url) ?? 0) + num(t.count));
      }
    }
  }
  const label = (key: string) => AI_SOURCES.find((s) => s.key === key)?.label ?? key;
  const byAssistant = [...byKey.entries()]
    .map(([key, hits]) => ({ key, label: label(key), hits }))
    .sort((a, b) => b.hits - a.hits || a.key.localeCompare(b.key));
  return {
    totalHits: byAssistant.reduce((a, b) => a + b.hits, 0),
    byAssistant,
    daily: rangeDays(range).map((date) => {
      const m = byDay.get(date) ?? {};
      return { date, total: Object.values(m).reduce((a, b) => a + b, 0), byAssistant: m };
    }),
    topPages: [...urls.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, MAX_TRACKER_PAGES)
      .map(([url, count]) => ({ url, count })),
  };
}
