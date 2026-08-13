import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { AiCitationService } from './ai-citation.service.js';

/**
 * AI Citation Tracker — gunluk cron, her aktif site icin Claude/Gemini/OpenAI/Perplexity
 * gorunurluk testi yap, sonucu ai_citation_snapshots tablosuna yaz.
 *
 * Frontend'de 30/90/365 gunluk trend grafigi cizilir.
 * Drop tespit edilirse alert gonderilir (ChatGPT 2 hafta once alintililiyordu, artik degil).
 */
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
  ): Promise<{ saved: number; results: any[]; runAt: string }> {
    const results = await this.citation.runForSite(siteId, 5, { trigger: opts.trigger ?? 'user' });
    const runAt = new Date().toISOString();
    // UTC midnight — server timezone'a bagli kalmamak icin (TR'de setHours(0,0,0,0) bir onceki UTC gunune kayar)
    const now = new Date();
    const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));

    let saved = 0;
    for (const r of results) {
      try {
        const probes = r.probes ?? [];
        const cited = probes.filter((p: any) => p.cited).length;
        const mentioned = probes.filter((p: any) => p.brandMentioned && !p.cited).length;

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

    return { saved, results, runAt };
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

  /**
   * Frontend icin: bir site icin son N gun trend
   */
  async getHistory(siteId: string, days = 30) {
    const since = new Date(Date.now() - days * 86400000);
    since.setHours(0, 0, 0, 0);

    const snapshots = await this.prisma.aiCitationSnapshot.findMany({
      where: { siteId, date: { gte: since } },
      orderBy: { date: 'asc' },
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

    // Trend: ilk vs son (drop tespit)
    const trends: Array<{ provider: string; first: number | null; last: number | null; delta: number | null }> = [];
    for (const [provider, series] of Object.entries(byProvider)) {
      const first = series[0]?.score ?? null;
      const last = series[series.length - 1]?.score ?? null;
      const delta = (first !== null && last !== null) ? last - first : null;
      trends.push({ provider, first, last, delta });
    }

    // Son snapshot detaylarini da don — F5 sonrasi detay panelinin yeniden hidrate olabilmesi icin
    const latestByProvider = new Map<string, typeof snapshots[number]>();
    for (const s of snapshots) {
      const cur = latestByProvider.get(s.provider);
      if (!cur || s.date.getTime() > cur.date.getTime()) latestByProvider.set(s.provider, s);
    }
    const latestResults = Array.from(latestByProvider.values()).map((s) => ({
      provider: s.provider,
      available: s.available,
      score: s.score,
      probes: s.probes,
    }));
    const latestRunAt = snapshots.length > 0
      ? snapshots.reduce((a, b) => (a.createdAt.getTime() > b.createdAt.getTime() ? a : b)).createdAt.toISOString()
      : null;

    return {
      days,
      since: since.toISOString(),
      byProvider,
      trends,
      latestResults,
      latestRunAt,
    };
  }
}
