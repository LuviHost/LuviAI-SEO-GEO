import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { JobQueueService } from '../jobs/job-queue.service.js';

/**
 * Content Pivot — yayinlanmis makalelerden 30 gun gectikten sonra
 * performansa gore aksiyon kararlari verir:
 *
 *   1. Position 4-15 arasinda → on-page guclendirme (FAQ ekle, schema gozden gecir)
 *   2. CTR < 2%, impression > 500 → meta_title + meta_description yeniden yaz
 *   3. AI citation snapshot'larda 14 gundur alinti yok → makale yeniden yaz (revize cikti)
 *   4. Position > 30 ve impression > 100 → tamamen yeniden yaz (yeni angle)
 *
 * Cron: haftada 1 (Pazartesi 02:00 UTC, AI citation snapshot'tan once)
 */
@Injectable()
export class ContentPivotService {
  private readonly log = new Logger(ContentPivotService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jobQueue: JobQueueService,
  ) {}

  async scanAllSites(): Promise<{ scanned: number; flagged: number; queued: number }> {
    const sites = await this.prisma.site.findMany({
      where: { status: { in: ['ACTIVE', 'AUDIT_COMPLETE'] as any[] } },
      select: { id: true, userId: true, autopilot: true },
    });

    let scanned = 0;
    let flagged = 0;
    let queued = 0;

    for (const site of sites) {
      try {
        const r = await this.scanSite(site.id);
        scanned += r.scanned;
        flagged += r.flagged.length;
        // Otopilot ON ise pivot'lari otomatik kuyruga at
        if ((site as any).autopilot) {
          for (const f of r.flagged) {
            await this.jobQueue.enqueue({
              type: 'GENERATE_ARTICLE',
              userId: site.userId,
              siteId: site.id,
              payload: {
                siteId: site.id,
                topic: f.pivotTopic,
                articleId: f.articleId, // var olan kayit overwrite
                skipImages: true,
                autoPublish: true,
                pivotReason: f.reason,
              } as any,
            });
            queued++;
          }
        }
      } catch (err: any) {
        this.log.warn(`[${site.id}] pivot scan fail: ${err.message}`);
      }
    }

    this.log.log(`Content pivot: ${sites.length} site, ${scanned} makale incelendi, ${flagged} flag, ${queued} kuyruga eklendi`);
    return { scanned, flagged, queued };
  }

  /**
   * Tek bir site icin pivot taramasi.
   */
  async scanSite(siteId: string): Promise<{
    scanned: number;
    flagged: Array<{ articleId: string; reason: string; pivotTopic: string; severity: 'low' | 'medium' | 'high' }>;
  }> {
    const cutoff = new Date(Date.now() - 30 * 86400000);
    const articles = await this.prisma.article.findMany({
      where: {
        siteId,
        status: 'PUBLISHED' as any,
        publishedAt: { lte: cutoff },
      },
      select: {
        id: true,
        slug: true,
        topic: true,
        title: true,
        publishedAt: true,
        performanceMetrics: true,
        performanceCheckedAt: true,
      },
      take: 50,
    });

    const flagged: Array<{ articleId: string; reason: string; pivotTopic: string; severity: 'low' | 'medium' | 'high' }> = [];

    for (const a of articles) {
      const metrics: any = a.performanceMetrics ?? {};
      const impressions = Number(metrics.impressions ?? 0);
      const clicks = Number(metrics.clicks ?? 0);
      const ctr = impressions > 0 ? clicks / impressions : 0;
      const position = Number(metrics.position ?? 0);

      // 1) Yuksek impression dusuk CTR — meta yeniden yaz
      if (impressions > 500 && ctr < 0.02) {
        flagged.push({
          articleId: a.id,
          reason: `Imp=${impressions}, CTR=${(ctr * 100).toFixed(1)}% (cok dusuk) — meta_title + meta_description yenile`,
          pivotTopic: a.topic,
          severity: 'medium',
        });
        continue;
      }

      // 2) Position 4-15 — on-page guclendirme (FAQ + schema)
      if (position >= 4 && position <= 15 && impressions > 100) {
        flagged.push({
          articleId: a.id,
          reason: `Position=${position.toFixed(1)} (1.sayfa esiginde) — FAQ ekle + schema'yi gozden gecir`,
          pivotTopic: a.topic,
          severity: 'low',
        });
        continue;
      }

      // 3) Position > 30 ama imp > 100 — tamamen yeni angle
      if (position > 30 && impressions > 100) {
        flagged.push({
          articleId: a.id,
          reason: `Position=${position.toFixed(1)} (cok gerilerde) — yeni angle ile tamamen yeniden yaz`,
          pivotTopic: a.topic,
          severity: 'high',
        });
        continue;
      }
    }

    // 4) AI citation drop kontrol — son 14 gun her gun yok ise flag
    const since = new Date(Date.now() - 14 * 86400000);
    since.setHours(0, 0, 0, 0);
    const recentSnapshots = await this.prisma.aiCitationSnapshot.findMany({
      where: { siteId, date: { gte: since } },
      select: { date: true, score: true, citedCount: true },
    });
    if (recentSnapshots.length >= 7) {
      const totalCited = recentSnapshots.reduce((a, s) => a + s.citedCount, 0);
      const avgScore = recentSnapshots.reduce((a, s) => a + (s.score ?? 0), 0) / recentSnapshots.length;
      if (totalCited === 0 && avgScore < 20) {
        // Tum site icin "AI gorunurluk dusuk" flag — pillar makaleye pivot
        const pillar = articles[0];
        if (pillar) {
          flagged.push({
            articleId: pillar.id,
            reason: `AI citation 14 gundur sifir, ortalama skor ${avgScore.toFixed(0)}/100 — pillar makaleyi GEO odakli yeniden yaz`,
            pivotTopic: pillar.topic,
            severity: 'high',
          });
        }
      }
    }

    return { scanned: articles.length, flagged };
  }
}
