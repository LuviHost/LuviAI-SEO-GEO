import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { brandSharePct, rivalsFromCompetitors } from './share-of-voice.js';
import { unbrandedOnly } from './brand-in-query.js';
import { compareCells, type TrendState } from './comparable-trend.js';

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
  /**
   * % — atif VAR ama marka adi cevapta ANILMADI: site cevabin malzemesi
   * olmus, onerisi olmamis ("kaynak oldun, oneri degilsin"). Yalniz anilmayi
   * olcen rapor bunu goremez; ayri sayilir. Yon 2 bagimsiz kaynak (Featured
   * atif raporu + Surfer 5M analizi); sayilar tasinmaz.
   */
  citedNotMentionedRate: KpiValue;
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

  /**
   * Deltalarin karsilastirilabilirligi (comparable-trend.ts). 'comparable'
   * degilse GEO deltalari null'dur: prompt seti/saglayici degisti
   * (scope_changed) ya da alinti olcum yontemi guncellendi (method_changed)
   * — fark sitenin degil olcunun degisimi olurdu.
   */
  comparability: {
    mentions: TrendState;
    citations: TrendState;
    /** ortak hucre orani, % */
    coveragePct: number;
    matchedCells: number;
  };

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
          brandInQuery: true, promptId: true, fanoutId: true, provider: true, matchVersion: true,
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

    // ── Mention & citation rate
    const rate = (rows: typeof runs, key: 'brandMentioned' | 'cited') =>
      rows.length ? Math.round((rows.filter((r) => r[key]).length / rows.length) * 1000) / 10 : null;

    const mentionNow = rate(recent, 'brandMentioned');
    const citedNow = rate(recent, 'cited');

    // Atif var, marka anilmadi — cited && !brandMentioned (citation-score.ts ile ayni tanim)
    const cnmRate = (rows: typeof runs) =>
      rows.length ? Math.round((rows.filter((r) => r.cited && !r.brandMentioned).length / rows.length) * 1000) / 10 : null;
    const cnmNow = cnmRate(recent);

    // Taninirlik — marka adi gecen sorularda
    const bMentionNow = rate(brandedRecent, 'brandMentioned');

    // ── Sentiment: pozitif / etiketli
    const sentimentPct = (rows: typeof runs) => {
      const labeled = rows.filter((r) => r.sentiment);
      if (!labeled.length) return null;
      return Math.round((labeled.filter((r) => r.sentiment === 'positive').length / labeled.length) * 1000) / 10;
    };
    const sentNow = sentimentPct(recent);

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

    // ── Karsilastirilabilir deltalar (comparable-trend.ts) ──
    // Hucre = prompt|fan-out × saglayici; yalnizca IKI donemde de olculen
    // hucreler kiyaslanir. Manset deger (value) havuzdan kalir; delta bundan.
    // matchVersion yalnizca ALINTI olcumunu etkiler (host-match) → anilma
    // metrikleri surume baglanmaz.
    const cellOf = (r: (typeof runs)[number]) => `${r.promptId}|${r.fanoutId ?? ''}|${r.provider}`;
    const trend = (pool: typeof runs, value: (r: (typeof runs)[number]) => number, versioned: boolean) =>
      compareCells(pool.map((r) => ({ cell: cellOf(r), current: r.date >= d7, value: value(r), version: versioned ? r.matchVersion : 1 })));
    const pp = (t: ReturnType<typeof compareCells>) => (t.state === 'comparable' && t.delta !== null ? Math.round(t.delta * 1000) / 10 : null);
    const mentionTrend = trend(unbranded, (r) => (r.brandMentioned ? 1 : 0), false);
    const citedTrend = trend(unbranded, (r) => (r.cited ? 1 : 0), true);
    const cnmTrend = trend(unbranded, (r) => (r.cited && !r.brandMentioned ? 1 : 0), true);
    const bMentionTrend = trend(branded, (r) => (r.brandMentioned ? 1 : 0), false);
    const sentTrend = trend(unbranded.filter((r) => r.sentiment), (r) => (r.sentiment === 'positive' ? 1 : 0), false);
    const sameScope = mentionTrend.state === 'comparable';

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
        deltaPct: pp(mentionTrend),
        series: dailySeries((rows) => rate(rows, 'brandMentioned'), unbranded),
      },
      citationRate: {
        value: citedNow,
        deltaPct: pp(citedTrend),
        series: dailySeries((rows) => rate(rows, 'cited'), unbranded),
      },
      citedNotMentionedRate: {
        value: cnmNow,
        deltaPct: pp(cnmTrend),
        series: dailySeries(cnmRate, unbranded),
      },
      sentiment: {
        value: sentNow,
        deltaPct: pp(sentTrend),
        series: dailySeries(sentimentPct, unbranded),
      },
      shareOfVoice: {
        value: sovNow,
        // SoV hucre bazli tanimlanamaz (rakip sayimi); kapsam ayniysa havuz farki
        deltaPct: sameScope ? this.delta(sovNow, sovPrev) : null,
        series: dailySeries(sov, unbranded),
      },
      brandedMentionRate: {
        value: bMentionNow,
        deltaPct: pp(bMentionTrend),
        series: dailySeries((rows) => rate(rows, 'brandMentioned'), branded),
      },
      queryMix: { branded: brandedRecent.length, unbranded: recent.length },
      comparability: {
        mentions: mentionTrend.state,
        citations: citedTrend.state,
        coveragePct: Math.round(mentionTrend.coverage * 100),
        matchedCells: mentionTrend.matchedCells,
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
