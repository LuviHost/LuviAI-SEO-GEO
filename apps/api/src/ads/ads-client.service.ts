import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { GoogleAdsClientService } from './google-ads-client.service.js';
import { MetaAdsClientService } from './meta-ads-client.service.js';

export interface CampaignMetrics {
  impressions: number;
  clicks: number;
  spend: number;
  conversions: number;
  ctr: number;
  cpc: number;
  roas: number;
}

/**
 * AdsClientService — platform router.
 *
 * Eski AdsMcpClientService (Ryze AI MCP) yerine geldi. Direkt resmi
 * Google Ads + Meta Marketing API'lerini cagirir.
 *
 * Hicbir 3. parti bagimliligi yok. Sifir SaaS aboneligi.
 */
@Injectable()
export class AdsClientService {
  private readonly log = new Logger(AdsClientService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly google: GoogleAdsClientService,
    private readonly meta: MetaAdsClientService,
  ) {}

  /**
   * Bir kampanyanin gercek metriklerini ceker.
   */
  async getMetrics(siteId: string, platform: 'google_ads' | 'meta_ads', externalId: string): Promise<CampaignMetrics | null> {
    try {
      if (platform === 'google_ads') {
        return await this.google.getCampaignMetrics(siteId, externalId);
      }
      return await this.meta.getCampaignInsights(siteId, externalId);
    } catch (err: any) {
      this.log.warn(`[${siteId}/${platform}/${externalId}] Metrics fail: ${err.message}`);
      return null;
    }
  }

  /**
   * Pause/enable.
   */
  async setStatus(siteId: string, platform: 'google_ads' | 'meta_ads', externalId: string, paused: boolean): Promise<{ ok: boolean }> {
    if (platform === 'google_ads') {
      return this.google.setCampaignStatus(siteId, externalId, paused ? 'PAUSED' : 'ENABLED');
    }
    return this.meta.setCampaignStatus(siteId, externalId, paused ? 'PAUSED' : 'ACTIVE');
  }

  /**
   * Daily butce.
   */
  async updateBudget(siteId: string, platform: 'google_ads' | 'meta_ads', externalId: string, dailyTRY: number): Promise<{ ok: boolean }> {
    if (platform === 'google_ads') return this.google.updateBudget(siteId, externalId, dailyTRY);
    return this.meta.updateDailyBudget(siteId, externalId, dailyTRY);
  }

  /**
   * Negative keywords (Google'a ozel).
   */
  async addNegativeKeywords(siteId: string, externalId: string, keywords: string[]) {
    return this.google.addNegativeKeywords(siteId, externalId, keywords);
  }

  /**
   * Search terms report (Google'a ozel).
   */
  async getSearchTerms(siteId: string, externalId: string) {
    return this.google.getSearchTerms(siteId, externalId);
  }

  /**
   * Site icin hangi platform bagli? Frontend'in MCP yerine bunu kullanmasi icin.
   */
  async getConnectedPlatforms(siteId: string): Promise<{ google: boolean; meta: boolean }> {
    const site: any = await this.prisma.site.findUniqueOrThrow({ where: { id: siteId } });
    return {
      google: !!site.googleAdsRefreshToken && !!site.googleAdsCustomerId,
      meta: !!site.metaAdsAccessToken && !!site.metaAdsAccountId,
    };
  }

  /**
   * Faz 11.3 — Ad-level varyant metrikleri (A/B test winner picker icin).
   */
  async getAdVariants(siteId: string, platform: 'google_ads' | 'meta_ads', externalId: string) {
    if (platform === 'google_ads') return this.google.getAdVariantMetrics(siteId, externalId);
    return this.meta.getAdVariantMetrics(siteId, externalId);
  }

  /**
   * Faz 11.3 — Ad-level pause/enable.
   */
  async setAdStatus(siteId: string, platform: 'google_ads' | 'meta_ads', adIdOrResource: string, paused: boolean): Promise<{ ok: boolean }> {
    if (platform === 'google_ads') {
      return this.google.setAdStatus(siteId, adIdOrResource, paused ? 'PAUSED' : 'ENABLED');
    }
    return this.meta.setAdStatus(siteId, adIdOrResource, paused ? 'PAUSED' : 'ACTIVE');
  }
}
