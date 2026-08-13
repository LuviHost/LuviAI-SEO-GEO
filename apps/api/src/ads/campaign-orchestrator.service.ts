import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { AdsClientService } from './ads-client.service.js';
import { GoogleAdsClientService } from './google-ads-client.service.js';
import { MetaAdsClientService } from './meta-ads-client.service.js';
import { WebhookNotifierService } from '../audit/webhook-notifier.service.js';

export interface CampaignBuildRequest {
  siteId: string;
  platform: 'google_ads' | 'meta_ads' | 'both';
  objective: 'traffic' | 'leads' | 'conversions' | 'brand_awareness' | 'sales';
  productOrService: string;
  keyBenefit?: string;
  landingUrl: string;
  budgetType: 'daily' | 'lifetime';
  budgetAmount: number;     // TL
  startDate?: string;
  endDate?: string;
  autoLaunch?: boolean;     // true ise MCP uzerinden launch
}

export interface CampaignBuildResult {
  campaigns: any[];          // DB kayitlari
  audience: any;
  adCopy: any;
  images: any[];
  estimatedCostUsd: number;
  launchResults: any[];
}

/**
 * Campaign Orchestrator — end-to-end kampanya kurulumu.
 *
 * Adimlar:
 *   1. Audience build (interest + keyword + lookalike onerileri)
 *   2. Ad copy generate (Google + Meta varyantlari)
 *   3. Image generate (3 format)
 *   4. DB'ye DRAFT campaign kaydi
 *   5. autoLaunch=true ise MCP araciligiyla canli yayina al (manuel onay = false default)
 */
@Injectable()
export class CampaignOrchestratorService {
  private readonly log = new Logger(CampaignOrchestratorService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly adsClient: AdsClientService,
    private readonly google: GoogleAdsClientService,
    private readonly meta: MetaAdsClientService,
    private readonly webhook: WebhookNotifierService,
  ) {}

  /**
   * Cron — otopilot ON sitelerde aktif kampanyalari analiz et + optimize et.
   * ROAS dusuk ise pause, yuksek ise butce arttir.
   */
  async optimizeAutopilotCampaigns(): Promise<{ scanned: number; actions: number }> {
    const sites = await this.prisma.site.findMany({
      where: { adsAutopilot: true } as any,
    });

    let scanned = 0;
    let actions = 0;

    for (const site of sites) {
      const activeCampaigns = await this.prisma.adCampaign.findMany({
        where: { siteId: site.id, status: 'ACTIVE' },
      });

      for (const c of activeCampaigns) {
        scanned++;
        const decisions: string[] = [];

        // ROAS < 1.5 -> pause
        if (c.roas !== null && c.roas < 1.5 && c.spend && Number(c.spend) > 100) {
          decisions.push('pause-low-roas');
          if (c.externalId) {
            await this.adsClient.setStatus(site.id, c.platform as any, c.externalId, true).catch(() => {});
          }
          await this.prisma.adCampaign.update({
            where: { id: c.id },
            data: { status: 'PAUSED' },
          });
          // Webhook bildirim
          this.webhook.notify({
            siteId: site.id,
            siteName: site.name,
            event: 'ai_citation_drop' as any,
            title: '⚠ Kampanya Pause Edildi',
            message: `${c.name} (${c.platform}) ROAS ${c.roas.toFixed(2)} olduğu için otomatik pause edildi. ${Number(c.spend).toFixed(0)} TL harcanmıştı.`,
            url: `https://ranksup.ai/sites/${site.id}`,
            meta: { roas: c.roas, spend: Number(c.spend) },
          }).catch(() => {});
          actions++;
        }

        // CTR > 3% + ROAS > 5 -> butce %20 artir
        if (c.ctr > 0.03 && c.roas > 5) {
          const newBudget = Number(c.budgetAmount) * 1.2;
          decisions.push('budget-up-20%');
          if (c.externalId) {
            await this.adsClient.updateBudget(site.id, c.platform as any, c.externalId, newBudget).catch(() => {});
          }
          await this.prisma.adCampaign.update({
            where: { id: c.id },
            data: { budgetAmount: newBudget },
          });
          // Webhook bildirim — pozitif event
          this.webhook.notify({
            siteId: site.id,
            siteName: site.name,
            event: 'ai_citation_rise' as any,
            title: '🚀 Kampanya Bütçesi Artırıldı',
            message: `${c.name} mükemmel performans gösteriyor (CTR ${(c.ctr * 100).toFixed(1)}%, ROAS ${c.roas.toFixed(2)}x). Bütçe ${c.budgetAmount} → ${newBudget.toFixed(0)} TL.`,
            url: `https://ranksup.ai/sites/${site.id}`,
            meta: { ctr: c.ctr, roas: c.roas, oldBudget: Number(c.budgetAmount), newBudget },
          }).catch(() => {});
          actions++;
        }

        // History'ye yaz
        if (decisions.length > 0) {
          const history: any[] = Array.isArray(c.autopilotActions) ? (c.autopilotActions as any[]) : [];
          history.push({ time: new Date().toISOString(), actions: decisions, ctr: c.ctr, roas: c.roas });
          await this.prisma.adCampaign.update({
            where: { id: c.id },
            data: { autopilotActions: history.slice(-20) as any },
          });
        }
      }
    }

    this.log.log(`Ad autopilot: ${scanned} kampanya tarandi, ${actions} aksiyon`);
    return { scanned, actions };
  }
}
