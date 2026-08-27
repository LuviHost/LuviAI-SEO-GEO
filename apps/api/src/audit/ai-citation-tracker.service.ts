import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { citationCounts } from './citation-score.js';
import { buildHeadline, providerHeadline } from './citation-headline.js';
import { assessStability } from './visibility-variance.js';
import { compareCitationRuns, headlineOfProviders, type RunProvider, type RunSummary } from './citation-run-compare.js';
import { AiCitationService } from './ai-citation.service.js';

/**
 * AI Citation Tracker — gunluk cron, her aktif site icin Claude/Gemini/OpenAI/Perplexity
 * gorunurluk testi yap, sonucu ai_citation_snapshots tablosuna yaz.
 *
 * Frontend'de 30/90/365 gunluk trend grafigi cizilir.
 * Drop tespit edilirse alert gonderilir (ChatGPT 2 hafta once alintililiyordu, artik degil).
 */
/** snapshotSite'in saglayici basina probe sayisi — runForSite(siteId, 5) ile ayni */
const SNAPSHOT_PROBES = 5;

@Injectable()
export class AiCitationTrackerService {
  private readonly log = new Logger(AiCitationTrackerService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly citation: AiCitationService,
  ) {}

  /**
   * Tek bir site icin snapshot al ve DB'ye yaz.
   *
   * @param opts.trigger 'user' (VARSAYILAN) kullanicinin acikca istedigi
   *   snapshot — aylik citation kotasi dayatilir ve tuketilir.
   *   'system' platformun kendi otomatik izlemesi (gunluk cron, onboarding
   *   baseline) — kota ne kontrol edilir ne de tuketilir; aksi halde kullanici
   *   hicbir sey yapmadan kotasi bitiyordu (bkz. ai-citation.service.ts).
   */
  async snapshotSite(
    siteId: string,
    opts: { trigger?: 'user' | 'system' } = {},
  ): Promise<{ saved: number; results: any[]; runAt: string; runId: string | null }> {
    const results = await this.citation.runForSite(siteId, SNAPSHOT_PROBES, { trigger: opts.trigger ?? 'user' });
    const runAt = new Date().toISOString();
    // UTC midnight — server timezone'a bagli kalmamak icin (TR'de setHours(0,0,0,0) bir onceki UTC gunune kayar)
    const now = new Date();
    const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));

    let saved = 0;
    for (const r of results) {
      try {
        const probes = r.probes ?? [];
        // Sayaclar markasiz sorgulardan, skorla AYNI fonksiyondan
        // (citationCounts) — sayac tanimi baska yerde tekrarlanmaz. probes
        // JSON'una TUM probe'lar (brandInQuery damgasiyla) yazilir: veri
        // kaybolmaz ve eski/yeni yontem kayittan ayirt edilebilir.
        const { cited, mentioned } = citationCounts(probes as any[]);

        await this.prisma.aiCitationSnapshot.upsert({
          where: { siteId_date_provider: { siteId, date: today, provider: r.provider } },
          update: {
            available: r.available,
            score: r.score,
            probes: probes as any,
            citedCount: cited,
            mentionedCount: mentioned,
          },
          create: {
            siteId,
            date: today,
            provider: r.provider,
            available: r.available,
            score: r.score,
            probes: probes as any,
            citedCount: cited,
            mentionedCount: mentioned,
          },
        });
        saved++;
      } catch (err: any) {
        this.log.warn(`[${siteId}] Snapshot kaydedilemedi (${r.provider}): ${err.message}`);
      }
    }

    // HER KOSUM KALICI: ayni gun ikinci "Yeniden Test" gunluk snapshot'i
    // (siteId+date+provider unique) uzerine yazar; musteri onceki sonucu
    // kaybetmesin ve iki testi kiyaslayabilsin diye kosumlar AiCitationRun'a
    // append-only yazilir (excerpt kirpilmis). Basarisizlik olcumu bozmaz.
    const providersJson: RunProvider[] = results.map((r) => ({
      provider: r.provider,
      label: r.label,
      available: r.available,
      score: r.score,
      reason: r.reason ?? null,
      probes: (r.probes ?? []).map((pr) => ({
        query: pr.query,
        cited: !!pr.cited,
        brandMentioned: !!pr.brandMentioned,
        brandInQuery: pr.brandInQuery ?? false,
        position: pr.position ?? null,
        sentiment: pr.sentiment ?? null,
        excerpt: pr.excerpt?.slice(0, 400) ?? null,
        ...(pr.citedPages?.length ? { citedPages: pr.citedPages } : {}),
      })),
    }));
    const counts = citationCounts(results.flatMap((r) => r.probes ?? []) as any[]);
    let runId: string | null = null;
    try {
      const run = await this.prisma.aiCitationRun.create({
        data: {
          siteId,
          runAt: new Date(runAt),
          trigger: opts.trigger ?? 'user',
          headlineScore: headlineOfProviders(providersJson),
          citedCount: counts.cited,
          mentionedCount: counts.mentioned,
          poolSize: counts.poolSize,
          providers: providersJson as any,
        },
        select: { id: true },
      });
      runId = run.id;
    } catch (err: any) {
      this.log.warn(`[${siteId}] Kosum kaydi yazilamadi: ${err.message}`);
    }

    return { saved, results, runAt, runId };
  }

  /**
   * Tum aktif siteler icin snapshot — gunluk cron tarafindan cagrilir.
   * Platformun kendi izlemesi oldugu icin SISTEM modunda kosar: kullanicinin
   * citation kotasini ne kontrol eder ne de tuketir.
   */
  async snapshotAllActive(): Promise<{ sites: number; snapshots: number }> {
    const sites = await this.prisma.site.findMany({
      where: { status: { in: ['ACTIVE', 'AUDIT_COMPLETE'] as any[] } },
      select: { id: true, name: true },
    });

    let totalSnapshots = 0;
    for (const site of sites) {
      try {
        const r = await this.snapshotSite(site.id, { trigger: 'system' });
        totalSnapshots += r.saved;
      } catch (err: any) {
        this.log.warn(`[${site.id}] AI citation daily fail: ${err.message}`);
      }
    }
    this.log.log(`AI Citation daily: ${sites.length} site, ${totalSnapshots} snapshot kaydedildi`);
    return { sites: sites.length, snapshots: totalSnapshots };
  }

  // ── Test gecmisi (append-only kosumlar) ──────────────────────

  async listRuns(siteId: string, limit = 30) {
    const runs = await this.prisma.aiCitationRun.findMany({
      where: { siteId },
      orderBy: { runAt: 'desc' },
      take: Math.min(Math.max(limit, 1), 100),
      select: { id: true, runAt: true, trigger: true, headlineScore: true, citedCount: true, mentionedCount: true, poolSize: true, providers: true },
    });
    return runs.map((r) => ({
      id: r.id,
      runAt: r.runAt.toISOString(),
      trigger: r.trigger,
      headlineScore: r.headlineScore,
      citedCount: r.citedCount,
      mentionedCount: r.mentionedCount,
      poolSize: r.poolSize,
      // Liste hafif kalsin: saglayici skorlari, probe'lar yok
      providers: ((r.providers as any[]) ?? []).map((p) => ({ provider: p.provider, label: p.label, available: p.available, score: p.score })),
    }));
  }

  async getRun(siteId: string, id: string): Promise<RunSummary | null> {
    const r = await this.prisma.aiCitationRun.findFirst({ where: { id, siteId } });
    if (!r) return null;
    return { id: r.id, runAt: r.runAt.toISOString(), trigger: r.trigger, headlineScore: r.headlineScore, providers: (r.providers as any[]) ?? [] };
  }

  /** a = onceki, b = sonraki (siralama gonderen tarafa bagli degil; runAt'e gore duzeltilir) */
  async compareRuns(siteId: string, aId: string, bId: string) {
    const [ra, rb] = await Promise.all([this.getRun(siteId, aId), this.getRun(siteId, bId)]);
    if (!ra || !rb) return null;
    const [first, second] = ra.runAt <= rb.runAt ? [ra, rb] : [rb, ra];
    return compareCitationRuns(first, second);
  }

  /**
   * Frontend icin: bir site icin son N gun trend.
   *
   * @param headlineOnly true ise probe JSON'lari cekilmez ve byProvider /
   *   latestResults donmez — overview kartlari gibi yalnizca manset sayiya
   *   ihtiyac duyan yuzeyler icin (30 gun x 7 saglayici x 5 probe excerpt
   *   megabaytlara varabiliyor).
   */
  async getHistory(siteId: string, days = 30, headlineOnly = false) {
    const since = new Date(Date.now() - days * 86400000);
    since.setHours(0, 0, 0, 0);

    const snapshots = await this.prisma.aiCitationSnapshot.findMany({
      where: { siteId, date: { gte: since } },
      orderBy: { date: 'asc' },
      select: {
        provider: true, date: true, score: true, citedCount: true, mentionedCount: true,
        available: true, createdAt: true,
        probes: !headlineOnly,
      },
    });

    // Group by provider
    const byProvider: Record<string, Array<{ date: string; score: number | null; cited: number; mentioned: number }>> = {};
    for (const s of snapshots) {
      const key = s.provider;
      if (!byProvider[key]) byProvider[key] = [];
      byProvider[key].push({
        date: s.date.toISOString().slice(0, 10),
        score: s.score,
        cited: s.citedCount,
        mentioned: s.mentionedCount,
      });
    }

    // Trend: ilk vs son (drop tespit) + 7g ortalama (manset — bkz. citation-headline.ts)
    const trends: Array<{
      provider: string; first: number | null; last: number | null; delta: number | null;
      last7Avg: number | null; runCount: number;
    }> = [];
    for (const [provider, series] of Object.entries(byProvider)) {
      const first = series[0]?.score ?? null;
      const last = series[series.length - 1]?.score ?? null;
      const delta = (first !== null && last !== null) ? last - first : null;
      const h = providerHeadline(series);
      trends.push({ provider, first, last, delta, last7Avg: h.last7Avg, runCount: h.runCount });
    }
    // Manset: chart, overview ve analytics-row AYNI sayiyi soylemeli — tek kaynak burasi.
    const headline = buildHeadline(byProvider);

    // Oynaklik: gunluk saglayicilar-arasi ortalama + o gun skora giren probe
    // sayisi (saglayici x SNAPSHOT_PROBES). Beklenen orneklem gurultusune
    // oranlanir — bkz. visibility-variance.ts. Son 14 gunle sinirli: daha
    // uzun pencere gercek trendi "oynaklik" diye okur.
    const providersByDay = new Map<string, number>();
    for (const series of Object.values(byProvider)) {
      for (const pt of series) {
        if (typeof pt.score !== 'number') continue;
        providersByDay.set(pt.date, (providersByDay.get(pt.date) ?? 0) + 1);
      }
    }
    const stability = assessStability(
      headline.daily.slice(-14).map((d) => ({ score: d.score, n: (providersByDay.get(d.date) ?? 0) * SNAPSHOT_PROBES })),
    );

    // Son snapshot detaylarini da don — F5 sonrasi detay panelinin yeniden hidrate olabilmesi icin
    const latestByProvider = new Map<string, typeof snapshots[number]>();
    for (const s of snapshots) {
      const cur = latestByProvider.get(s.provider);
      if (!cur || s.date.getTime() > cur.date.getTime()) latestByProvider.set(s.provider, s);
    }
    const latestRunAt = snapshots.length > 0
      ? snapshots.reduce((a, b) => (a.createdAt.getTime() > b.createdAt.getTime() ? a : b)).createdAt.toISOString()
      : null;

    if (headlineOnly) {
      return { days, since: since.toISOString(), trends, headline, stability, latestRunAt };
    }

    const latestResults = Array.from(latestByProvider.values()).map((s) => ({
      provider: s.provider,
      available: s.available,
      score: s.score,
      probes: (s as { probes?: unknown }).probes ?? [],
    }));

    return {
      days,
      since: since.toISOString(),
      byProvider,
      trends,
      headline,
      stability,
      latestResults,
      latestRunAt,
    };
  }
}
