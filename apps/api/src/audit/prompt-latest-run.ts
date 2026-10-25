import type { CitationSource } from './citation-sources.js';
import { classifySource, type SourceType, type SourceTypeContext } from './source-domain-types.js';

/**
 * GEO Lab soru satiri — "son olcum" gorunumu (saf; I/O prompt-lab.service'te).
 *
 * NEDEN: soru satiri acilinca yalniz fan-out dallari gorunuyordu; her
 * asistanin cevabi (kaynak gosterdi mi, adimizi andi mi, hangi siteleri
 * kaynak gosterdi) DB'de vardi ama sayfada yoktu (25.10.2026 geri bildirimi).
 *
 * Kurallar:
 *  - Yalniz ANA soru (fanoutId null) ve sorunun EN SON olculdugu gun.
 *  - Ayni gun ayni saglayici birden cok kez olculduyse en yeni satir.
 *  - HATA probe'lari zaten yazilmiyor (persistRuns) — listede olmayan
 *    saglayici o gun olculemedi demektir.
 *  - sources null + sourcesVersion dolu = saglayici web aramasi yapmadi;
 *    sourcesVersion null = satir kaynak kaydindan once yazildi.
 */

export const LATEST_RUN_EXCERPT_MAX = 400;
export const LATEST_RUN_SOURCES_MAX = 10;

/** Panelde sabit sira — ai-citation.service varsayilan saglayici listesiyle ayni aile */
const PROVIDER_ORDER = ['openai', 'anthropic', 'gemini', 'perplexity', 'xai', 'deepseek', 'meta'];

export interface LatestRunRow {
  provider: string;
  date: Date;
  createdAt: Date;
  cited: boolean;
  brandMentioned: boolean;
  brandInQuery: boolean;
  position: number | null;
  sentiment: string | null;
  excerpt: string | null;
  competitors: unknown;
  sources: unknown;
  sourcesVersion: number | null;
}

export type LatestRunSourcesStatus = 'listed' | 'no_search' | 'not_recorded';

export interface LatestRunProvider {
  provider: string;
  label: string;
  cited: boolean;
  mentioned: boolean;
  brandInQuery: boolean;
  position: number | null;
  sentiment: string | null;
  excerpt: string | null;
  /** Cevapta adi gecen rakipler */
  competitors: string[];
  sourcesStatus: LatestRunSourcesStatus;
  sources: Array<CitationSource & { type: SourceType }>;
  /** LATEST_RUN_SOURCES_MAX'i asan kaynak sayisi */
  moreSources: number;
}

export interface LatestRunView {
  /** YYYY-MM-DD; hic olcum yoksa null */
  date: string | null;
  providers: LatestRunProvider[];
}

const day = (d: Date) => d.toISOString().slice(0, 10);

function competitorNames(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const c of raw) {
    if (!c || typeof c !== 'object') continue;
    const { name, mentions } = c as { name?: unknown; mentions?: unknown };
    if (typeof name !== 'string' || !name.trim()) continue;
    if (typeof mentions === 'number' && mentions <= 0) continue;
    if (!out.includes(name)) out.push(name);
  }
  return out;
}

function sourceList(raw: unknown, ctx: SourceTypeContext) {
  if (!Array.isArray(raw)) return [];
  const out: Array<CitationSource & { type: SourceType }> = [];
  for (const s of raw) {
    if (!s || typeof s !== 'object') continue;
    const src = s as CitationSource;
    if (typeof src.url !== 'string' || typeof src.domain !== 'string') continue;
    // Panel bunu <a href> olarak basar: yazarken normalize edilse de (yalniz
    // https) okurken de javascript:/data: gibi semalari kesin disarida tut
    if (!/^https?:\/\//i.test(src.url)) continue;
    const type = classifySource(src.url, ctx, src.domain)?.type ?? 'other';
    out.push({
      url: src.url,
      domain: src.domain,
      ...(typeof src.title === 'string' && src.title ? { title: src.title } : {}),
      ...(src.originOnly ? { originOnly: true as const } : {}),
      type,
    });
  }
  return out;
}

function trimExcerpt(text: string | null): string | null {
  if (!text) return null;
  const t = text.trim();
  if (!t) return null;
  return t.length > LATEST_RUN_EXCERPT_MAX ? `${t.slice(0, LATEST_RUN_EXCERPT_MAX - 1)}…` : t;
}

export function buildLatestRun(
  rows: readonly LatestRunRow[],
  ctx: SourceTypeContext,
  labels: Readonly<Record<string, string>>,
): LatestRunView {
  if (rows.length === 0) return { date: null, providers: [] };

  const latestDay = rows.reduce((max, r) => (day(r.date) > max ? day(r.date) : max), day(rows[0].date));
  const newest = new Map<string, LatestRunRow>();
  for (const r of rows) {
    if (day(r.date) !== latestDay) continue;
    const cur = newest.get(r.provider);
    if (!cur || r.createdAt.getTime() > cur.createdAt.getTime()) newest.set(r.provider, r);
  }

  const rank = (p: string) => {
    const i = PROVIDER_ORDER.indexOf(p);
    return i === -1 ? PROVIDER_ORDER.length : i;
  };

  const providers = [...newest.values()]
    .sort((a, b) => rank(a.provider) - rank(b.provider) || a.provider.localeCompare(b.provider))
    .map((r): LatestRunProvider => {
      const all = sourceList(r.sources, ctx);
      // Kendi site ve rakip once — kullanicinin aradigi bunlar
      const weight = (t: SourceType) => (t === 'own' ? 0 : t === 'competitor' ? 1 : 2);
      const ordered = all
        .map((s, i) => ({ s, i }))
        .sort((a, b) => weight(a.s.type) - weight(b.s.type) || a.i - b.i)
        .map((x) => x.s);
      const sourcesStatus: LatestRunSourcesStatus = r.sourcesVersion == null
        ? 'not_recorded'
        : Array.isArray(r.sources) ? 'listed' : 'no_search';
      return {
        provider: r.provider,
        label: labels[r.provider] ?? r.provider,
        cited: r.cited,
        mentioned: r.brandMentioned,
        brandInQuery: r.brandInQuery,
        position: r.position,
        sentiment: r.sentiment,
        excerpt: trimExcerpt(r.excerpt),
        competitors: competitorNames(r.competitors),
        sourcesStatus,
        sources: ordered.slice(0, LATEST_RUN_SOURCES_MAX),
        moreSources: Math.max(0, ordered.length - LATEST_RUN_SOURCES_MAX),
      };
    });

  return { date: latestDay, providers };
}
