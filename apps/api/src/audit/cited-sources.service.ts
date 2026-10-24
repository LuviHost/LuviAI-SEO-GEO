import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { isErrorProbe } from './citation-score.js';
import type { CitationSource } from './citation-sources.js';
import { aggregateCitedSources, CITED_SOURCES_DAYS, type AnswerRecord, type CitedSourcesResult } from './cited-sources.js';
import { buildCompetitorMatchers, hostOf, type CompetitorMatcher } from './source-domain-types.js';

/**
 * Prompt Lab kosum satiri tavani. 90 gunluk pencerede 50 soru x 6 saglayici
 * gunluk olculurse ~27 bin satir olur (haftalik olcumde ~4 bin). Tavan en
 * yeni 10 bin satiri okur; asilirsa yanit `promptRunsTruncated` tasir ve
 * panel bunu kapsam notunda yazar.
 */
const MAX_PROMPT_RUNS = 10_000;

/** ?days= degeri: yalniz 30 ya da 90 (baska deger 30'a duser) */
export function citedSourcesDays(raw: unknown): number {
  // Yalniz sayi ya da dize: qs `?days=90&days=30` girdisini diziye cevirir
  const n = typeof raw === 'number' ? raw : typeof raw === 'string' ? parseInt(raw, 10) : NaN;
  return (CITED_SOURCES_DAYS as readonly number[]).includes(n) ? n : 30;
}

/**
 * Pencerenin ilk gunu (UTC gece yarisi): bugun DAHIL tam `days` takvim gunu.
 * "30 gun" etiketi 30 gun kapsasin (eskiden bugun + 30 gun = 31 gundu).
 */
export function citedSourcesSince(now: Date, days: number): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - (days - 1)));
}

const day = (d: Date) => d.toISOString().slice(0, 10);

/**
 * Brain.competitors [{ name, url }] → rakip eslestiricileri (url'siz rakip
 * atlanir; platformdaki rakip yol onekiyle eslenir — source-domain-types.ts).
 */
export function competitorMatchersFrom(raw: unknown): CompetitorMatcher[] {
  if (!Array.isArray(raw)) return [];
  const urls: string[] = [];
  for (const c of raw) {
    const url = c && typeof c === 'object' ? (c as { url?: unknown }).url : null;
    if (typeof url === 'string' && url.trim()) urls.push(url);
  }
  return buildCompetitorMatchers(urls);
}

/**
 * Alintilanan dis kaynaklar — I/O katmani (toplama saf cited-sources.ts).
 * Okur: AiCitationSnapshot.probes (gunluk olcum) + GeoPromptRun (yalniz SITE
 * Prompt Lab'i). App Prompt Lab (trackedAppId dolu prompt'lar) uygulamayi
 * olcer, site raporuna KARISMAZ — prompt-lab.service, ai-kpis.service,
 * client-report.service ile ayni kural. Yazmaz, dis servise gitmez.
 */
@Injectable()
export class CitedSourcesService {
  constructor(private readonly prisma: PrismaService) {}

  async get(siteId: string, daysRaw?: unknown, now = new Date()): Promise<CitedSourcesResult & { promptRunsTruncated: boolean }> {
    const days = citedSourcesDays(daysRaw);
    const since = citedSourcesSince(now, days);

    const [site, snapshots, runs] = await Promise.all([
      this.prisma.site.findUnique({ where: { id: siteId }, select: { url: true, brain: { select: { competitors: true } } } }),
      this.prisma.aiCitationSnapshot.findMany({
        where: { siteId, date: { gte: since } },
        select: { provider: true, date: true, probes: true },
        orderBy: { date: 'asc' },
      }),
      this.prisma.geoPromptRun.findMany({
        where: {
          siteId,
          date: { gte: since },
          prompt: { trackedAppId: null },
          // HATA satirlari DB'de elenir; excerpt (TEXT) okunmaz. excerpt NULL olan
          // satir gecerlidir — NOT LIKE tek basina NULL'u da elerdi.
          OR: [{ excerpt: null }, { NOT: { excerpt: { startsWith: 'HATA:' } } }],
        },
        select: {
          provider: true, date: true, sources: true, sourcesVersion: true, brandInQuery: true,
          prompt: { select: { text: true } },
          fanout: { select: { text: true } },
        },
        orderBy: { date: 'desc' },
        take: MAX_PROMPT_RUNS,
      }),
    ]);

    const answers: AnswerRecord[] = [];
    let snapshotsWithVersion = 0;
    for (const s of snapshots) {
      const probes = Array.isArray(s.probes) ? (s.probes as any[]) : [];
      let versioned = false;
      for (const p of probes) {
        if (!p || typeof p !== 'object' || isErrorProbe(p)) continue;
        const sourcesVersion = typeof p.sourcesVersion === 'number' ? p.sourcesVersion : null;
        if (sourcesVersion) versioned = true;
        answers.push({
          origin: 'snapshot',
          provider: s.provider,
          query: typeof p.query === 'string' ? p.query : '',
          date: day(s.date),
          sourcesVersion,
          sources: Array.isArray(p.sources) ? (p.sources as CitationSource[]) : null,
          mentionedDomains: Array.isArray(p.mentionedDomains) ? p.mentionedDomains : null,
          brandInQuery: p.brandInQuery === true,
        });
      }
      if (versioned) snapshotsWithVersion++;
    }

    let runsWithVersion = 0;
    for (const r of runs) {
      if (typeof r.sourcesVersion === 'number') runsWithVersion++;
      answers.push({
        origin: 'prompt',
        provider: r.provider,
        query: r.fanout?.text ?? r.prompt?.text ?? '',
        date: day(r.date),
        sourcesVersion: r.sourcesVersion,
        sources: Array.isArray(r.sources) ? (r.sources as unknown as CitationSource[]) : null,
        brandInQuery: r.brandInQuery === true,
      });
    }

    const result = aggregateCitedSources({
      days,
      answers,
      ctx: {
        ownHost: hostOf(site?.url ?? null),
        competitors: competitorMatchersFrom(site?.brain?.competitors),
      },
      rowCounts: {
        snapshots: { total: snapshots.length, withSourcesVersion: snapshotsWithVersion },
        promptRuns: { total: runs.length, withSourcesVersion: runsWithVersion },
      },
    });
    return { ...result, promptRunsTruncated: runs.length >= MAX_PROMPT_RUNS };
  }
}
