import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { AdGeneratorService } from './ad-generator.service.js';
import { AdImageGeneratorService } from './ad-image-generator.service.js';
import { AudienceBuilderService } from './audience-builder.service.js';
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
    private readonly adGen: AdGeneratorService,
    private readonly imgGen: AdImageGeneratorService,
    private readonly audience: AudienceBuilderService,
    private readonly adsClient: AdsClientService,
    private readonly google: GoogleAdsClientService,
    private readonly meta: MetaAdsClientService,
    private readonly webhook: WebhookNotifierService,
  ) {}

  async buildCampaign(req: CampaignBuildRequest): Promise<CampaignBuildResult> {
    const site: any = await this.prisma.site.findUniqueOrThrow({
      where: { id: req.siteId },
    });
    const startTime = Date.now();
    let totalCost = 0;

    this.log.log(`[${req.siteId}] Campaign build basliyor: ${req.platform} / ${req.objective}`);

    // 1) Audience
    const audience = await this.audience.build(req.siteId, {
      objective: req.objective,
      productOrService: req.productOrService,
      budget: req.budgetAmount,
    });
    totalCost += 0.05; // Sonnet 4.6 audience build

    // 2) Ad copy
    const adCopy = await this.adGen.generate(req.siteId, {
      objective: req.objective,
      productOrService: req.productOrService,
      keyBenefit: req.keyBenefit,
      landingUrl: req.landingUrl,
    });
    totalCost += 0.08; // Sonnet 4.6 ad copy

    // 3) Images (3 format)
    const slug = (site.name as string).toLowerCase().replace(/\s+/g, '-').slice(0, 30);
    const imagePrompt = `${req.productOrService}, ${req.keyBenefit ?? ''}, ${site.niche ?? ''} reklam gorseli`;
    const images = await this.imgGen.generateSet({
      prompt: imagePrompt,
      siteSlug: slug,
      formats: ['square', 'portrait', 'landscape'],
    }).catch((err) => {
      this.log.warn(`[${req.siteId}] Image gen fail: ${err.message}`);
      return [];
    });
    totalCost += images.length * 0.03;

    // 4) DB kayitlari (platform basina ayri campaign)
    const platforms: ('google_ads' | 'meta_ads')[] =
      req.platform === 'both' ? ['google_ads', 'meta_ads'] : [req.platform];
    const campaigns: any[] = [];

    for (const p of platforms) {
      const isMeta = p === 'meta_ads';
      const baseUrl = (site.url as string).replace(/\/+$/, '');
      const campaignName = `${site.name} - ${req.objective} - ${new Date().toISOString().slice(0, 10)}`;

      const campaign = await this.prisma.adCampaign.create({
        data: {
          siteId: req.siteId,
          platform: p,
          name: campaignName,
          objective: req.objective,
          status: 'DRAFT',
          audience: (isMeta ? audience.meta : audience.google) as any,
          locations: (isMeta ? audience.meta.locations : audience.google.locationsTargeted) as any,
          languages: (isMeta ? audience.meta.languages : audience.google.languagesTargeted) as any,
          headlines: (isMeta ? adCopy.meta.headlines.map((h) => ({ text: h })) : adCopy.google.headlines) as any,
          descriptions: (isMeta ? adCopy.meta.descriptions.map((d) => ({ text: d })) : adCopy.google.descriptions) as any,
          primaryTexts: (isMeta ? adCopy.meta.primaryTexts : null) as any,
          ctaButton: isMeta ? adCopy.meta.callToAction : null,
          creativeAssets: images.map((i) => ({
            url: `${baseUrl}${i.publicUrl}`,
            format: i.format,
            type: 'image',
          })) as any,
          budgetType: req.budgetType,
          budgetAmount: req.budgetAmount,
          startDate: req.startDate ? new Date(req.startDate) : null,
          endDate: req.endDate ? new Date(req.endDate) : null,
        },
      });
      campaigns.push(campaign);
    }

    // 5) autoLaunch — Google Ads + Meta Marketing API ile direkt kampanya olustur
    const launchResults: any[] = [];
    if (req.autoLaunch) {
      for (const c of campaigns) {
        try {
          if (c.platform === 'google_ads') {
            const headlines = (adCopy.google?.headlines ?? []).map((h: any) => h.text ?? h);
            const descriptions = (adCopy.google?.descriptions ?? []).map((d: any) => d.text ?? d);
            const keywords = (audience.google?.keywords ?? []).map((k: any) => k.text ?? k);
            const result = await this.google.createCampaign(req.siteId, {
              name: c.name,
              dailyBudgetTRY: req.budgetType === 'daily' ? req.budgetAmount : Math.round(req.budgetAmount / 30),
              headlines,
              descriptions,
              finalUrl: req.landingUrl,
              keywords,
            });
            launchResults.push({ campaignId: c.id, platform: 'google_ads', ...result });
            if (result.ok && result.campaignId) {
              await this.prisma.adCampaign.update({
                where: { id: c.id },
                data: { status: 'PAUSED', externalId: result.campaignId }, // Google'da PAUSED olarak yaratiyor
              });
            }
          } else {
            // Meta — Page ID ve image gerekli
            const pageId = (site as any).metaPageId ?? undefined;
            const firstImage = images[0]?.publicUrl;
            const baseUrl = (site.url as string).replace(/\/+$/, '');
            const fullImageUrl = firstImage?.startsWith('http') ? firstImage : `${baseUrl}${firstImage}`;

            if (!pageId || !fullImageUrl) {
              launchResults.push({
                campaignId: c.id, platform: 'meta_ads', ok: false,
                error: !pageId ? 'Site.metaPageId yok — Reklam Hesaplari sekmesinden Page ID gir.' : 'Reklam gorseli yok.',
              });
              continue;
            }

            const result = await this.meta.createCampaign(req.siteId, {
              name: c.name,
              objective: req.objective,
              dailyBudgetTRY: req.budgetType === 'daily' ? req.budgetAmount : Math.round(req.budgetAmount / 30),
              primaryText: adCopy.meta?.primaryTexts?.[0] ?? req.productOrService,
              headline: adCopy.meta?.headlines?.[0] ?? c.name,
              description: adCopy.meta?.descriptions?.[0],
              imageUrl: fullImageUrl,
              landingUrl: req.landingUrl,
              cta: adCopy.meta?.callToAction,
              pageId,
              instagramActorId: (site as any).metaInstagramActorId ?? undefined,
              countries: ['TR'],
              interests: (audience.meta?.interests ?? []).slice(0, 10).map((i: any) => ({ id: i.id, name: i.name })).filter((i: any) => i.id),
            });
            launchResults.push({ campaignId: c.id, platform: 'meta_ads', ...result });
            if (result.ok && result.campaignId) {
              await this.prisma.adCampaign.update({
                where: { id: c.id },
                data: { status: 'PAUSED', externalId: result.campaignId },
              });
            }
          }
        } catch (err: any) {
          this.log.error(`[${req.siteId}] autoLaunch ${c.platform} fail: ${err.message}`);
          launchResults.push({ campaignId: c.id, platform: c.platform, ok: false, error: err.message });
        }
      }
    }

    const durationMs = Date.now() - startTime;
    this.log.log(`[${req.siteId}] Campaign build done: ${campaigns.length} kampanya, $${totalCost.toFixed(4)}, ${(durationMs / 1000).toFixed(1)}s`);

    return {
      campaigns,
      audience,
      adCopy,
      images,
      estimatedCostUsd: totalCost,
      launchResults,
    };
  }

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
            url: `https://ai.luvihost.com/sites/${site.id}`,
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
            url: `https://ai.luvihost.com/sites/${site.id}`,
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
