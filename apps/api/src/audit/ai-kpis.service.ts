import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { brandSharePct, rivalsFromCompetitors } from './share-of-voice.js';
import { unbrandedOnly } from './brand-in-query.js';

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
  // ── MANSET: yalnizca MARKASIZ sorulardan hesaplanir ──
  // Sorguda markanin adi gecince asistanin markayi anmasi neredeyse
  // totolojik (sektor olcumu: %68,9'a karsi %2,1). Ikisi ayni havuzda
  // toplanirsa sayi gorunurlugu degil prompt bilesimini olcer.
  mentionRate: KpiValue;      // % — markasiz soruda marka AI cevabinda gecti
  citationRate: KpiValue;     // % — markasiz soruda site URL'i kaynak gosterildi
  sentiment: KpiValue;        // % pozitif (pozitif / etiketli)
  shareOfVoice: KpiValue;     // % — marka mention / (marka + rakip mention)

  // ── TANINIRLIK: marka adi gecen sorular. Gorunurluk DEGIL ──
  // "Adimizi bilen sorunca ne cikiyor" sorusunun cevabi. Ayri tutulur
  // cunku manset sayiyla ayni sey degil ve kendi basina da anlamli.
  // (Yalnizca UI'nin fiilen kullandigi alan tutulur — tuketicisiz alan
  // API'de curur; citation karsiligi ihtiyac dogunca eklenir.)
  brandedMentionRate: KpiValue;

  /**
   * Olcum bilesimi — son 7 gunde kac satir markali/markasiz.
   *
   * TESHIS AMACLI: fan-out uretimi basarisiz olup sablona dustugunde
   * uretilen dallarin tamami markali oluyor. Bu oran sessizce kayarsa
   * manset sayi da kayar; burada gorunur olsun diye tasiniyor.
   */
  queryMix: { branded: number; unbranded: number };

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
        select: {
          date: true, cited: true, brandMentioned: true, sentiment: true, competitors: true,
          brandInQuery: true,
        },
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

    // MANSET SUZGECI: sorusunda marka adi gecen satirlar disarida kalir.
    // Bu satirlar kaldirilmiyor, ayri raporlaniyor (brandedMentionRate).
    const unbranded = unbrandedOnly(runs);
    const branded = runs.filter((r) => r.brandInQuery);

    const recent = unbranded.filter((r) => r.date >= d7);
    const prev = unbranded.filter((r) => r.date < d7);
    const brandedRecent = branded.filter((r) => r.date >= d7);
    const brandedPrev = branded.filter((r) => r.date < d7);

    // ── Mention & citation rate
    const rate = (rows: typeof runs, key: 'brandMentioned' | 'cited') =>
      rows.length ? Math.round((rows.filter((r) => r[key]).length / rows.length) * 1000) / 10 : null;

    const mentionNow = rate(recent, 'brandMentioned');
    const mentionPrev = rate(prev, 'brandMentioned');
    const citedNow = rate(recent, 'cited');
    const citedPrev = rate(prev, 'cited');

    // Taninirlik — marka adi gecen sorularda
    const bMentionNow = rate(brandedRecent, 'brandMentioned');
    const bMentionPrev = rate(brandedPrev, 'brandMentioned');

    // ── Sentiment: pozitif / etiketli
    const sentimentPct = (rows: typeof runs) => {
      const labeled = rows.filter((r) => r.sentiment);
      if (!labeled.length) return null;
      return Math.round((labeled.filter((r) => r.sentiment === 'positive').length / labeled.length) * 1000) / 10;
    };
    const sentNow = sentimentPct(recent);
    const sentPrev = sentimentPct(prev);

    // ── Share of Voice ──
    // Hesap share-of-voice.ts'te; ai-citation.service.ts de ayni fonksiyonu
    // cagirir. Iki servis eskiden farkli birimlerle sayip ayni site icin
    // farkli sayi donuyordu.
    //
    // NOT: burada rakip kumesi yalnizca yapilandirilmis listedir — cevaptan
    // kesfedilen domainler GeoPromptRun'a yazilmiyor. Formul ayni, girdi
    // genisligi farkli.
    const sov = (rows: typeof runs) =>
      brandSharePct(
        rows.map((r) => ({
          brandPresent: r.brandMentioned,
          rivals: rivalsFromCompetitors(r.competitors as any[]),
        })),
      );
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
      // Seriler de markasiz havuzdan — manset sayi ile sparkline ayni seyi
      // anlatmali, yoksa grafik sayiyi yalanlar.
      mentionRate: {
        value: mentionNow,
        deltaPct: this.delta(mentionNow, mentionPrev),
        series: dailySeries((rows) => rate(rows, 'brandMentioned'), unbranded),
      },
      citationRate: {
        value: citedNow,
        deltaPct: this.delta(citedNow, citedPrev),
        series: dailySeries((rows) => rate(rows, 'cited'), unbranded),
      },
      sentiment: {
        value: sentNow,
        deltaPct: this.delta(sentNow, sentPrev),
        series: dailySeries(sentimentPct, unbranded),
      },
      shareOfVoice: {
        value: sovNow,
        deltaPct: this.delta(sovNow, sovPrev),
        series: dailySeries(sov, unbranded),
      },
      brandedMentionRate: {
        value: bMentionNow,
        deltaPct: this.delta(bMentionNow, bMentionPrev),
        series: dailySeries((rows) => rate(rows, 'brandMentioned'), branded),
      },
      queryMix: { branded: brandedRecent.length, unbranded: recent.length },
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
