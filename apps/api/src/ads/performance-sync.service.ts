import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { AdsMcpClientService } from './mcp-client.service.js';

/**
 * MCP Performance Sync — her 6 saatte bir aktif kampanyalarin gercek metrik
 * verilerini Google Ads / Meta Ads / GA4'ten ceker, AdCampaign'lara yazar.
 *
 * Calisma:
 *   1. Active kampanyalari listele
 *   2. Her platform icin MCP komutuyla performance fetch:
 *      "Get campaign metrics for ${externalId}: impressions, clicks, spend,
 *       conversions, ctr, cpc, roas — last 24h"
 *   3. Output'u parse et + DB'ye yaz
 *   4. GA4 cross-validate (sadece autopilot ON sitelerde):
 *      "Compare GA4 conversions for source=${platform} vs platform-reported"
 */
@Injectable()
export class PerformanceSyncService {
  private readonly log = new Logger(PerformanceSyncService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly mcp: AdsMcpClientService,
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
      if (!site.adsMcpEndpoint) continue;

      try {
        // 1. Platform metrik
        const metricsCmd = `${c.platform === 'google_ads' ? 'Google Ads' : 'Meta Ads'} kampanyasinin son 24 saatlik metriklerini getir.
Campaign external ID: ${c.externalId}
Donus formati JSON:
{
  "impressions": NUM,
  "clicks": NUM,
  "spend": NUM (TL),
  "conversions": NUM,
  "ctr": FLOAT,
  "cpc": FLOAT,
  "roas": FLOAT,
  "conversionValue": NUM (TL)
}`;

        const result = await this.mcp.runMcpCommand(site.id, metricsCmd);
        if (!result.ok) { failed++; continue; }

        const metrics = this.parseMetrics(result.output);
        if (!metrics) { failed++; continue; }

        // 2. GA4 cross-validate (autopilot ON ise)
        let ga4Match = true;
        let fraudFlag = false;
        if (site.adsAutopilot && site.gaConnectedAt) {
          const ga4Cmd = `GA4'te source=${c.platform === 'google_ads' ? 'google / cpc' : 'facebook'} icin son 24 saatlik conversions sayisini getir. JSON: {"ga4Conversions": NUM, "ga4Bounce": FLOAT}`;
          const ga4Res = await this.mcp.runMcpCommand(site.id, ga4Cmd);
          if (ga4Res.ok) {
            const ga4 = this.parseMetrics(ga4Res.output);
            if (ga4) {
              const platformConv = metrics.conversions ?? 0;
              const ga4Conv = (ga4 as any).ga4Conversions ?? 0;
              // Platform "100 conv" diyor, GA4 "20" goruyor → %80 fark = fraud suspect
              if (platformConv > 10 && ga4Conv < platformConv * 0.4) {
                fraudFlag = true;
                ga4Match = false;
              }
            }
          }
        }

        // 3. DB'ye yaz
        const updates: any = {
          impressions: metrics.impressions ?? c.impressions,
          clicks: metrics.clicks ?? c.clicks,
          spend: metrics.spend ?? Number(c.spend),
          conversions: metrics.conversions ?? c.conversions,
          ctr: metrics.ctr ?? c.ctr,
          cpc: metrics.cpc ?? c.cpc,
          roas: metrics.roas ?? c.roas,
          performanceCheckedAt: new Date(),
          performanceMetrics: { ...metrics, ga4Match, fraudFlag } as any,
        };

        await this.prisma.adCampaign.update({
          where: { id: c.id },
          data: updates,
        });

        if (fraudFlag) {
          flagged++;
          this.log.warn(`[${c.id}] FRAUD FLAG: platform conv ${metrics.conversions}, GA4 cok daha az`);
        }

        synced++;
      } catch (err: any) {
        this.log.warn(`[${c.id}] sync fail: ${err.message}`);
        failed++;
      }
    }

    this.log.log(`Performance sync: ${synced} ok, ${failed} fail, ${flagged} fraud flag`);
    return { synced, failed, flagged };
  }

  private parseMetrics(text: string): Record<string, any> | null {
    try {
      const match = text.match(/\{[\s\S]*?\}/);
      if (!match) return null;
      return JSON.parse(match[0]);
    } catch {
      return null;
    }
  }
}
