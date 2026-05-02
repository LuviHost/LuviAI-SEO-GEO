import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { GoogleAdsClientService } from './google-ads-client.service.js';
import { MetaAdsClientService } from './meta-ads-client.service.js';
import type { AccountSnapshot, Platform } from './rules/types.js';

/**
 * Reklam hesabı için audit'in ihtiyaç duyduğu structured snapshot'ı toplar.
 *
 * Şu an yarı entegre: AdCampaign tablosu + Google/Meta client'tan toplanabilen
 * temel alanları doldurur, henüz API'ye konmamış alanlar için makul default'lar verir.
 * Gelecekte snapshot'a daha fazla veri eklendikçe kurallar otomatik daha doğru sonuç verir.
 */
@Injectable()
export class AdsSnapshotCollectorService {
  private readonly log = new Logger(AdsSnapshotCollectorService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly google: GoogleAdsClientService,
    private readonly meta: MetaAdsClientService,
  ) {}

  async collect(siteId: string, platform: Platform): Promise<AccountSnapshot> {
    const campaigns = await this.prisma.adCampaign.findMany({
      where: { siteId, platform: platform === 'google' ? 'google_ads' : 'meta_ads' },
    });

    // Aggregate metrics
    const monthlySpendUsd = campaigns.reduce((a, c) => a + Number(c.spend ?? 0), 0);
    const totalImpressions = campaigns.reduce((a, c) => a + c.impressions, 0);
    const totalClicks = campaigns.reduce((a, c) => a + c.clicks, 0);
    const totalConversions = campaigns.reduce((a, c) => a + c.conversions, 0);

    if (platform === 'google') {
      const namingSamples = campaigns.map(c => c.name);
      const adCopySamples = campaigns
        .flatMap(c => Array.isArray(c.headlines) ? (c.headlines as any[]).map(h => ({ headline: h.text ?? String(h) })) : [])
        .slice(0, 30);

      // Google client'tan extra data (varsa)
      const enriched = await this.tryEnrichGoogle(siteId).catch(() => null);

      return {
        monthlySpendUsd,
        ga4Linked: enriched?.ga4Linked,
        enhancedConversionsActive: enriched?.enhancedConversionsActive,
        consentModeV2: enriched?.consentModeV2,
        conversionActions: enriched?.conversionActions,
        searchTerms: enriched?.searchTerms,
        searchTermLastReviewedAt: enriched?.searchTermLastReviewedAt,
        negativeKeywordLists: enriched?.negativeKeywordLists,
        campaigns: campaigns.map(c => ({
          id: c.id,
          name: c.name,
          objective: c.objective ?? undefined,
          budget: Number(c.budgetAmount ?? 0),
          spendToday: Number(c.spend ?? 0),
          bidStrategy: (c.performanceMetrics as any)?.bidStrategy ?? 'unknown',
          learningStatus: (c.performanceMetrics as any)?.learningStatus,
          qualityScore: (c.performanceMetrics as any)?.qualityScore,
          network: (c.performanceMetrics as any)?.network,
          geoTargeting: (c.performanceMetrics as any)?.geoTargeting ?? 'people_in',
          sitelinks: (c.performanceMetrics as any)?.sitelinks ?? 0,
          callouts: (c.performanceMetrics as any)?.callouts ?? 0,
          structuredSnippets: (c.performanceMetrics as any)?.structuredSnippets ?? 0,
          rsa: {
            count: 1,
            headlines: Array.isArray(c.headlines) ? c.headlines.length : 0,
            descriptions: Array.isArray(c.descriptions) ? c.descriptions.length : 0,
            adStrength: (c.performanceMetrics as any)?.adStrength ?? 'average',
          },
        })),
        pmaxCampaigns: enriched?.pmaxCampaigns ?? [],
        campaignNamingSamples: namingSamples,
        adCopySamples,
        landingPageThemes: enriched?.landingPageThemes,
      };
    } else {
      const enriched = await this.tryEnrichMeta(siteId).catch(() => null);

      return {
        monthlySpendUsd,
        pixel: enriched?.pixel,
        capi: enriched?.capi,
        emq: enriched?.emq,
        domainVerified: enriched?.domainVerified,
        aem: enriched?.aem,
        attributionWindow: enriched?.attributionWindow,
        metaCampaigns: campaigns.map(c => ({
          id: c.id,
          budget: Number(c.budgetAmount ?? 0),
          cbo: (c.performanceMetrics as any)?.cbo ?? false,
          adSets: (c.performanceMetrics as any)?.adSets ?? [{
            learningStatus: 'active' as const,
            frequency7d: c.impressions > 0 ? totalImpressions / Math.max(totalClicks, 1) : 0,
            creatives: ((c.creativeAssets as any[]) ?? []).map(a => ({
              format: a.type === 'video' ? 'video' as const : 'image' as const,
              ageDays: c.createdAt ? Math.floor((Date.now() - new Date(c.createdAt).getTime()) / 86400000) : 30,
              ctr: c.ctr,
              isUgc: false,
            })),
            audienceOverlap: (c.performanceMetrics as any)?.audienceOverlap,
          }],
        })),
      };
    }
  }

  private async tryEnrichGoogle(siteId: string): Promise<Partial<AccountSnapshot> | null> {
    // İleride: Google Ads client'tan customers + GAQL ile detay çek
    // Şu an conservative defaults
    return {
      ga4Linked: undefined,
      enhancedConversionsActive: undefined,
      consentModeV2: undefined,
    };
  }

  private async tryEnrichMeta(siteId: string): Promise<Partial<AccountSnapshot> | null> {
    return {
      pixel: undefined,
      capi: undefined,
      emq: undefined,
    };
  }
}
