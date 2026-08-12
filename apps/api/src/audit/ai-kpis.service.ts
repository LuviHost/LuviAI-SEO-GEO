import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';

/**
 * AI KPI seridi — Overview dashboard'un ust blogu.
 *
 * Mention Rate / Citation Rate / Sentiment / Share of Voice / AI crawler
 * ziyaretleri tek cagriyla, 7 gunluk delta ve 14 gunluk sparkline ile.
 * Veri zaten GeoPromptRun + AiCrawlerHit + AiReferrerHit tablolarinda —
 * bu servis yalnizca vitrin hesabi yapar, yeni olcum KOSMAZ (maliyet yok).
 */

export interface KpiValue {
  value: number | null; // yuzde veya adet; null = veri yok
  deltaPct: number | null; // onceki 7 gune gore degisim (yuzde puani veya %)
  series: Array<{ date: string; value: number }>; // 14 gunluk sparkline
}

export interface AiKpis {
  mentionRate: KpiValue;      // % — marka AI cevaplarinda gecti
  citationRate: KpiValue;     // % — site URL'i kaynak gosterildi
  sentiment: KpiValue;        // % pozitif (pozitif / etiketli)
  shareOfVoice: KpiValue;     // % — marka mention / (marka + rakip mention)
  aiCrawlerHits: KpiValue;    // adet — AI bot istekleri
  aiReferrerHits: KpiValue;   // adet — ChatGPT/Perplexity'den gelen insan trafigi
  citeFetches: KpiValue;      // adet — canli cite sinyali (ChatGPT-User vb. on-demand fetch)
  agentReadiness: { score: number | null; status: string | null };
  generatedAt: string;
}

const DAY_MS = 86_400_000;

@Injectable()
export class AiKpisService {
  private readonly log = new Logger(AiKpisService.name);

  constructor(private readonly prisma: PrismaService) {}

  async getKpis(siteId: string): Promise<AiKpis> {
    const now = Date.now();
    const d14 = new Date(now - 14 * DAY_MS);
    const d7 = new Date(now - 7 * DAY_MS);

    const [runs, crawlerHits, referrerHits, citeEvents, readiness] = await Promise.all([
      this.prisma.geoPromptRun.findMany({
        // App Prompt Lab olcumleri (trackedAppId dolu prompt'lar) site KPI'sina
        // karismasin — app gorunurlugu ASO ekraninda ayri raporlanir.
        where: { siteId, date: { gte: d14 }, prompt: { trackedAppId: null } },
        select: { date: true, cited: true, brandMentioned: true, sentiment: true, competitors: true },
      }),
      this.prisma.aiCrawlerHit.findMany({
        where: { siteId, date: { gte: d14 } },
        select: { date: true, hits: true },
      }),
      this.prisma.aiReferrerHit.findMany({
        where: { siteId, date: { gte: d14 } },
        select: { date: true, hits: true },
      }),
      // Canli cite sinyalleri — ham event tablosundan (istek bazli)
      this.prisma.crawlerHitEvent.findMany({
        where: { siteId, isCiteFetch: true, ts: { gte: d14 } },
        select: { ts: true },
      }),
      this.prisma.agentReadinessScan.findFirst({
        where: { siteId },
        orderBy: { ranAt: 'desc' },
        select: { overallScore: true, status: true },
      }),
    ]);

    const recent = runs.filter((r) => r.date >= d7);
    const prev = runs.filter((r) => r.date < d7);

    // ── Mention & citation rate
    const rate = (rows: typeof runs, key: 'brandMentioned' | 'cited') =>
      rows.length ? Math.round((rows.filter((r) => r[key]).length / rows.length) * 1000) / 10 : null;

    const mentionNow = rate(recent, 'brandMentioned');
    const mentionPrev = rate(prev, 'brandMentioned');
    const citedNow = rate(recent, 'cited');
    const citedPrev = rate(prev, 'cited');

    // ── Sentiment: pozitif / etiketli
    const sentimentPct = (rows: typeof runs) => {
      const labeled = rows.filter((r) => r.sentiment);
      if (!labeled.length) return null;
      return Math.round((labeled.filter((r) => r.sentiment === 'positive').length / labeled.length) * 1000) / 10;
    };
    const sentNow = sentimentPct(recent);
    const sentPrev = sentimentPct(prev);

    // ── Share of Voice: marka mention sayisi vs rakip mention toplami
    const sov = (rows: typeof runs) => {
      let brand = 0;
      let competitors = 0;
      for (const r of rows) {
        if (r.brandMentioned) brand++;
        const comps: any[] = Array.isArray(r.competitors) ? (r.competitors as any[]) : [];
        for (const c of comps) competitors += Number(c?.mentions ?? 0) > 0 ? 1 : 0;
      }
      const total = brand + competitors;
      return total > 0 ? Math.round((brand / total) * 1000) / 10 : null;
    };
    const sovNow = sov(recent);
    const sovPrev = sov(prev);

    // ── Crawler / referrer hit toplamlari
    const sumHits = (rows: Array<{ date: Date; hits: number }>, from: Date, to?: Date) =>
      rows.filter((r) => r.date >= from && (!to || r.date < to)).reduce((a, r) => a + r.hits, 0);
    const crawlerNow = sumHits(crawlerHits, d7);
    const crawlerPrev = sumHits(crawlerHits, d14, d7);
    const refNow = sumHits(referrerHits, d7);
    const refPrev = sumHits(referrerHits, d14, d7);

    // Cite fetch: event bazli — ts alanindan gunluk kovalara ayrilir
    const citeRows = citeEvents.map((e) => ({ date: e.ts, hits: 1 }));
    const citeNow = citeRows.filter((r) => r.date >= d7).length;
    const citePrev = citeRows.filter((r) => r.date >= d14 && r.date < d7).length;

    // ── Sparkline serileri (gunluk)
    const dailySeries = (
      compute: (rows: typeof runs) => number | null,
      rows: typeof runs,
    ) => this.groupDaily(rows, (dayRows) => compute(dayRows) ?? 0);

    const hitSeries = (rows: Array<{ date: Date; hits: number }>) =>
      this.groupDaily(rows as any[], (dayRows: any[]) => dayRows.reduce((a, r) => a + r.hits, 0));

    return {
      mentionRate: {
        value: mentionNow,
        deltaPct: this.delta(mentionNow, mentionPrev),
        series: dailySeries((rows) => rate(rows, 'brandMentioned'), runs),
      },
      citationRate: {
        value: citedNow,
        deltaPct: this.delta(citedNow, citedPrev),
        series: dailySeries((rows) => rate(rows, 'cited'), runs),
      },
      sentiment: {
        value: sentNow,
        deltaPct: this.delta(sentNow, sentPrev),
        series: dailySeries(sentimentPct, runs),
      },
      shareOfVoice: {
        value: sovNow,
        deltaPct: this.delta(sovNow, sovPrev),
        series: dailySeries(sov, runs),
      },
      aiCrawlerHits: {
        value: crawlerNow,
        deltaPct: crawlerPrev > 0 ? Math.round(((crawlerNow - crawlerPrev) / crawlerPrev) * 1000) / 10 : null,
        series: hitSeries(crawlerHits),
      },
      aiReferrerHits: {
        value: refNow,
        deltaPct: refPrev > 0 ? Math.round(((refNow - refPrev) / refPrev) * 1000) / 10 : null,
        series: hitSeries(referrerHits),
      },
      citeFetches: {
        value: citeNow,
        deltaPct: citePrev > 0 ? Math.round(((citeNow - citePrev) / citePrev) * 1000) / 10 : null,
        series: hitSeries(citeRows),
      },
      agentReadiness: {
        score: readiness?.overallScore ?? null,
        status: readiness?.status ?? null,
      },
      generatedAt: new Date().toISOString(),
    };
  }

  // ────────────────────────────────────────────────────────────

  /** Yuzde-puan delta (her ikisi de olculebildiyse) */
  private delta(now: number | null, prev: number | null): number | null {
    if (now === null || prev === null) return null;
    return Math.round((now - prev) * 10) / 10;
  }

  private groupDaily<T extends { date: Date }>(
    rows: T[],
    compute: (dayRows: T[]) => number,
  ): Array<{ date: string; value: number }> {
    const byDate = new Map<string, T[]>();
    for (const r of rows) {
      const key = r.date.toISOString().slice(0, 10);
      const arr = byDate.get(key) ?? [];
      arr.push(r);
      byDate.set(key, arr);
    }
    return Array.from(byDate.entries())
      .map(([date, dayRows]) => ({ date, value: compute(dayRows) }))
      .sort((a, b) => a.date.localeCompare(b.date));
  }
}
