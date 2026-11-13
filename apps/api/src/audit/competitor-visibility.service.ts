import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { resolveSiteBrand } from './brand-in-query.js';
import { hostOf } from './source-domain-types.js';
import {
  PREVIOUS_LOOKBACK_DAYS,
  aggregateCompetitorVisibility,
  competitorVisibilityDays,
  type ListedCompetitor,
  type VisibilityResult,
  type VisibilityRun,
} from './competitor-visibility.js';

/** Okunan satir tavani (cited-sources.service ile ayni): asilirsa yanit `truncated` tasir */
const MAX_RUNS = 10_000;

const day = (d: Date) => d.toISOString().slice(0, 10);
/** Bugun DAHIL `days` takvim gununun ilki (UTC gece yarisi) */
const firstDay = (now: Date, days: number) =>
  new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - (days - 1)));

/** Brain.competitors: ['Ad'] ya da [{ name, url }] */
export function listedCompetitorsFrom(raw: unknown): ListedCompetitor[] {
  if (!Array.isArray(raw)) return [];
  const out: ListedCompetitor[] = [];
  for (const c of raw) {
    if (typeof c === 'string') {
      if (c.trim()) out.push({ name: c.trim() });
    } else if (c && typeof c === 'object') {
      const name = (c as { name?: unknown }).name;
      const url = (c as { url?: unknown }).url;
      if (typeof name === 'string' && name.trim()) out.push({ name: name.trim(), url: typeof url === 'string' ? url : null });
    }
  }
  return out;
}

/** GeoPromptRun.competitors: [{ name, mentions, positionFirst }] → adlar */
export function competitorNamesFrom(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((c) => (typeof c === 'string' ? c : c && typeof c === 'object' ? (c as { name?: unknown }).name : null))
    .filter((n): n is string => typeof n === 'string' && n.trim().length > 0);
}

/** GeoPromptRun.sources: [{ url, domain }] → tekil host listesi */
export function sourceHostsFrom(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const hosts = new Set<string>();
  for (const s of raw) {
    if (!s || typeof s !== 'object') continue;
    const host = hostOf((s as { url?: string }).url) ?? hostOf((s as { domain?: string }).domain);
    if (host) hosts.add(host);
  }
  return [...hosts];
}

/**
 * AI cevaplarinda rakip gorunurlugu — I/O katmani (toplama saf competitor-visibility.ts).
 * Yalniz SITE Prompt Lab'inin aktif, ana (dal olmayan) ve markasiz sorularini okur;
 * App Prompt Lab (trackedAppId dolu) uygulamayi olcer, buraya karismaz.
 */
@Injectable()
export class CompetitorVisibilityService {
  constructor(private readonly prisma: PrismaService) {}

  async get(siteId: string, daysRaw?: unknown, now = new Date()): Promise<VisibilityResult & { truncated: boolean }> {
    const days = competitorVisibilityDays(daysRaw);
    const since = firstDay(now, days);
    const lookback = firstDay(now, Math.max(days, PREVIOUS_LOOKBACK_DAYS));

    const [site, rows] = await Promise.all([
      this.prisma.site.findUnique({
        where: { id: siteId },
        select: { name: true, url: true, brain: { select: { competitors: true } } },
      }),
      this.prisma.geoPromptRun.findMany({
        where: {
          siteId,
          fanoutId: null,
          brandInQuery: false,
          date: { gte: lookback },
          prompt: { trackedAppId: null, isActive: true },
          // HATA satirlari toplama girmez (cited-sources.service ile ayni suzgec)
          OR: [{ excerpt: null }, { NOT: { excerpt: { startsWith: 'HATA:' } } }],
        },
        select: {
          promptId: true, provider: true, date: true, createdAt: true,
          brandMentioned: true, cited: true, competitors: true, sources: true,
          prompt: { select: { text: true } },
        },
        orderBy: { date: 'desc' },
        take: MAX_RUNS,
      }),
    ]);

    const runs: VisibilityRun[] = rows.map((r) => ({
      promptId: r.promptId,
      promptText: r.prompt?.text ?? '',
      provider: r.provider,
      date: day(r.date),
      createdAt: r.createdAt.getTime(),
      brandMentioned: r.brandMentioned,
      cited: r.cited,
      competitors: competitorNamesFrom(r.competitors),
      sourceHosts: sourceHostsFrom(r.sources),
    }));

    const result = aggregateCompetitorVisibility({
      days,
      since: day(since),
      brand: site ? resolveSiteBrand(site.name, site.url) : '',
      ownHost: hostOf(site?.url ?? null),
      listed: listedCompetitorsFrom(site?.brain?.competitors),
      runs,
    });
    return { ...result, truncated: rows.length >= MAX_RUNS };
  }
}
