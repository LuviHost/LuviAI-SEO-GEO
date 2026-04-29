import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { AdsClientService } from './ads-client.service.js';

/**
 * Performance Sync — her 6 saatte bir aktif kampanyalarin gercek metrik
 * verilerini Google Ads + Meta Marketing API'den ceker, AdCampaign'a yazar.
 *
 * Direkt resmi API entegrasyonu (Faz 11.2 — Ryze AI MCP kaldirildi).
 */
@Injectable()
export class PerformanceSyncService {
  private readonly log = new Logger(PerformanceSyncService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly adsClient: AdsClientService,
  ) {}

  async syncAllActive(): Promise<{ synced: number; failed: number; flagged: number }> {
    const campaigns = await this.prisma.adCampaign.findMany({
      where: {
        status: 'ACTIVE',
        externalId: { not: null },
      },
      include: { site: true },
    });

    let synced = 0;
    let failed = 0;
    let flagged = 0;

    for (const c of campaigns) {
      const site: any = c.site;
      const platform = c.platform as 'google_ads' | 'meta_ads';

      // Bagli mi kontrol et
      const hasCreds = platform === 'google_ads'
        ? !!site.googleAdsRefreshToken && !!site.googleAdsCustomerId
        : !!site.metaAdsAccessToken && !!site.metaAdsAccountId;

      if (!hasCreds || !c.externalId) continue;

      try {
        const metrics = await this.adsClient.getMetrics(site.id, platform, c.externalId);
        if (!metrics) { failed++; continue; }

        await this.prisma.adCampaign.update({
          where: { id: c.id },
          data: {
            impressions: metrics.impressions,
            clicks: metrics.clicks,
            spend: metrics.spend,
            conversions: metrics.conversions,
            ctr: metrics.ctr,
            cpc: metrics.cpc,
            roas: metrics.roas,
            performanceCheckedAt: new Date(),
            performanceMetrics: metrics as any,
          },
        });

        synced++;
      } catch (err: any) {
        this.log.warn(`[${c.id}] sync fail: ${err.message}`);
        failed++;
      }
    }

    this.log.log(`Performance sync: ${synced} ok, ${failed} fail, ${flagged} fraud flag`);
    return { synced, failed, flagged };
  }
}
