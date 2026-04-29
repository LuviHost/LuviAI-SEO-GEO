import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { decrypt } from '@luviai/shared';

/**
 * Google Ads API client — resmi REST API.
 * Docs: https://developers.google.com/google-ads/api/rest/overview
 *
 * Auth: OAuth refresh token + developer token + manager customer ID (opsiyonel)
 *
 * Env:
 *   GOOGLE_ADS_DEV_TOKEN — Developer token (Google Ads Manager > Tools > API Center)
 *   GOOGLE_OAUTH_CLIENT_ID
 *   GOOGLE_OAUTH_CLIENT_SECRET
 *   GOOGLE_ADS_LOGIN_CUSTOMER_ID — Manager hesap (opsiyonel)
 */
@Injectable()
export class GoogleAdsClientService {
  private readonly log = new Logger(GoogleAdsClientService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Bir site icin yeni access token al (refresh token kullan).
   */
  private async getAccessToken(siteId: string): Promise<string | null> {
    const site: any = await this.prisma.site.findUniqueOrThrow({ where: { id: siteId } });
    if (!site.googleAdsRefreshToken) return null;

    const refresh = this.tryDecrypt(site.googleAdsRefreshToken);
    const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
    if (!clientId || !clientSecret) {
      this.log.warn('GOOGLE_OAUTH_CLIENT_ID/SECRET env yok');
      return null;
    }

    try {
      const res = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: clientId,
          client_secret: clientSecret,
          refresh_token: refresh,
          grant_type: 'refresh_token',
        }),
      });
      if (!res.ok) throw new Error(`Token refresh ${res.status}`);
      const data = await res.json() as any;
      return data.access_token;
    } catch (err: any) {
      this.log.warn(`[${siteId}] Google access token: ${err.message}`);
      return null;
    }
  }

  /**
   * Search query (GAQL) — campaigns, ad groups, search terms vs.
   */
  async query(siteId: string, gaqlQuery: string): Promise<any[]> {
    const accessToken = await this.getAccessToken(siteId);
    if (!accessToken) throw new Error('Google Ads bagli degil — Reklam Hesaplari sekmesinden bağla');

    const site: any = await this.prisma.site.findUniqueOrThrow({ where: { id: siteId } });
    const customerId = (site.googleAdsCustomerId ?? '').replace(/-/g, '');
    const devToken = process.env.GOOGLE_ADS_DEV_TOKEN;
    if (!devToken) throw new Error('GOOGLE_ADS_DEV_TOKEN env yok');

    const headers: Record<string, string> = {
      'Authorization': `Bearer ${accessToken}`,
      'developer-token': devToken,
      'Content-Type': 'application/json',
    };
    if (process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID) {
      headers['login-customer-id'] = process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID;
    }

    const res = await fetch(`https://googleads.googleapis.com/v21/customers/${customerId}/googleAds:search`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ query: gaqlQuery }),
    });

    if (!res.ok) throw new Error(`GAQL ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const data = await res.json() as any;
    return data.results ?? [];
  }

  /**
   * Mevcut kampanyalarin metriklerini cek (son 30g).
   */
  async getCampaignMetrics(siteId: string, externalId: string) {
    const gaql = `
      SELECT
        campaign.id, campaign.name, campaign.status,
        metrics.impressions, metrics.clicks, metrics.cost_micros,
        metrics.conversions, metrics.conversions_value,
        metrics.ctr, metrics.average_cpc
      FROM campaign
      WHERE campaign.id = ${externalId}
        AND segments.date DURING LAST_30_DAYS
    `;
    const rows = await this.query(siteId, gaql);
    if (rows.length === 0) return null;
    const r = rows[0];
    const cost = (r.metrics?.costMicros ?? 0) / 1_000_000;
    const conversions = r.metrics?.conversions ?? 0;
    const conversionsValue = r.metrics?.conversionsValue ?? 0;
    return {
      impressions: parseInt(r.metrics?.impressions ?? '0', 10),
      clicks: parseInt(r.metrics?.clicks ?? '0', 10),
      spend: cost,
      conversions: Math.round(conversions),
      ctr: r.metrics?.ctr ?? 0,
      cpc: (r.metrics?.averageCpc ?? 0) / 1_000_000,
      roas: cost > 0 ? conversionsValue / cost : 0,
    };
  }

  /**
   * Search terms report — son 30g, impressions > 50.
   */
  async getSearchTerms(siteId: string, externalId: string) {
    const gaql = `
      SELECT
        search_term_view.search_term,
        metrics.impressions, metrics.clicks, metrics.conversions, metrics.cost_micros
      FROM search_term_view
      WHERE campaign.id = ${externalId}
        AND segments.date DURING LAST_30_DAYS
        AND metrics.impressions > 50
    `;
    const rows = await this.query(siteId, gaql);
    return rows.map((r: any) => ({
      term: r.searchTermView?.searchTerm ?? '',
      impressions: parseInt(r.metrics?.impressions ?? '0', 10),
      clicks: parseInt(r.metrics?.clicks ?? '0', 10),
      conversions: r.metrics?.conversions ?? 0,
      cost: (r.metrics?.costMicros ?? 0) / 1_000_000,
    }));
  }

  /**
   * Negative keyword ekle (campaign-level).
   */
  async addNegativeKeywords(siteId: string, externalId: string, keywords: string[]): Promise<{ ok: boolean; added: number }> {
    const accessToken = await this.getAccessToken(siteId);
    if (!accessToken) return { ok: false, added: 0 };
    const site: any = await this.prisma.site.findUniqueOrThrow({ where: { id: siteId } });
    const customerId = (site.googleAdsCustomerId ?? '').replace(/-/g, '');

    const operations = keywords.map((kw) => ({
      create: {
        campaign: `customers/${customerId}/campaigns/${externalId}`,
        negative: true,
        keyword: { text: kw, matchType: 'BROAD' },
      },
    }));

    try {
      const res = await fetch(`https://googleads.googleapis.com/v21/customers/${customerId}/campaignCriteria:mutate`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'developer-token': process.env.GOOGLE_ADS_DEV_TOKEN ?? '',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ operations, partialFailure: true }),
      });
      if (!res.ok) throw new Error(`${res.status}`);
      return { ok: true, added: keywords.length };
    } catch (err: any) {
      this.log.warn(`Negative keyword add fail: ${err.message}`);
      return { ok: false, added: 0 };
    }
  }

  /**
   * Kampanya pause/enable.
   */
  async setCampaignStatus(siteId: string, externalId: string, status: 'PAUSED' | 'ENABLED'): Promise<{ ok: boolean }> {
    const accessToken = await this.getAccessToken(siteId);
    if (!accessToken) return { ok: false };
    const site: any = await this.prisma.site.findUniqueOrThrow({ where: { id: siteId } });
    const customerId = (site.googleAdsCustomerId ?? '').replace(/-/g, '');

    try {
      const res = await fetch(`https://googleads.googleapis.com/v21/customers/${customerId}/campaigns:mutate`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'developer-token': process.env.GOOGLE_ADS_DEV_TOKEN ?? '',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          operations: [{
            update: {
              resourceName: `customers/${customerId}/campaigns/${externalId}`,
              status,
            },
            updateMask: 'status',
          }],
        }),
      });
      return { ok: res.ok };
    } catch (err: any) {
      this.log.warn(`Campaign status fail: ${err.message}`);
      return { ok: false };
    }
  }

  /**
   * Kampanya butce update — campaignBudget resource'unu update eder.
   */
  async updateBudget(siteId: string, externalId: string, dailyBudgetTRY: number): Promise<{ ok: boolean }> {
    const accessToken = await this.getAccessToken(siteId);
    if (!accessToken) return { ok: false };
    const site: any = await this.prisma.site.findUniqueOrThrow({ where: { id: siteId } });
    const customerId = (site.googleAdsCustomerId ?? '').replace(/-/g, '');

    try {
      // 1. campaign'in baglandigi campaign_budget'u bul
      const rows = await this.query(siteId, `SELECT campaign.campaign_budget FROM campaign WHERE campaign.id = ${externalId}`);
      const budgetResourceName: string | undefined = rows[0]?.campaign?.campaignBudget;
      if (!budgetResourceName) return { ok: false };

      // 2. budget'u guncelle (micros)
      const micros = Math.round(dailyBudgetTRY * 1_000_000);
      const res = await fetch(`https://googleads.googleapis.com/v21/customers/${customerId}/campaignBudgets:mutate`, {
        method: 'POST',
        headers: this.headers(accessToken),
        body: JSON.stringify({
          operations: [{
            update: { resourceName: budgetResourceName, amountMicros: String(micros) },
            updateMask: 'amount_micros',
          }],
        }),
      });
      return { ok: res.ok };
    } catch (err: any) {
      this.log.warn(`Google budget update fail: ${err.message}`);
      return { ok: false };
    }
  }

  // ────────────────────────────────────────────────────────────────
  // Faz 11.3 — Campaign Creation API
  // ────────────────────────────────────────────────────────────────

  /**
   * End-to-end kampanya olusturur:
   *   1. campaign_budget create (daily, micros)
   *   2. campaign create (SEARCH, MAXIMIZE_CONVERSIONS bidding)
   *   3. ad_group create
   *   4. ad_group_ad create (Responsive Search Ad — 15 headline + 4 description)
   *   5. ad_group_criterion create (keywords + geo + language)
   *
   * Donus: campaignId (resourceName'in son segmenti)
   */
  async createCampaign(siteId: string, payload: {
    name: string;
    dailyBudgetTRY: number;
    headlines: string[];      // up to 15
    descriptions: string[];   // up to 4
    finalUrl: string;
    keywords?: string[];      // exact + phrase mix
    locationIds?: number[];   // geo target constants e.g. [2792] = Turkey
    languageIds?: number[];   // e.g. [1037] = Turkish
  }): Promise<{ ok: boolean; campaignId?: string; error?: string }> {
    const accessToken = await this.getAccessToken(siteId);
    if (!accessToken) return { ok: false, error: 'Google Ads bagli degil' };
    const site: any = await this.prisma.site.findUniqueOrThrow({ where: { id: siteId } });
    const customerId = (site.googleAdsCustomerId ?? '').replace(/-/g, '');
    const headers = this.headers(accessToken);

    try {
      // 1) Budget
      const budgetMicros = Math.round(payload.dailyBudgetTRY * 1_000_000);
      const budgetRes = await fetch(`https://googleads.googleapis.com/v21/customers/${customerId}/campaignBudgets:mutate`, {
        method: 'POST', headers,
        body: JSON.stringify({
          operations: [{
            create: {
              name: `${payload.name} - Budget - ${Date.now()}`,
              amountMicros: String(budgetMicros),
              deliveryMethod: 'STANDARD',
            },
          }],
        }),
      });
      if (!budgetRes.ok) throw new Error(`budget ${budgetRes.status}: ${(await budgetRes.text()).slice(0, 200)}`);
      const budgetData = await budgetRes.json() as any;
      const budgetResourceName = budgetData.results[0].resourceName;

      // 2) Campaign
      const campaignRes = await fetch(`https://googleads.googleapis.com/v21/customers/${customerId}/campaigns:mutate`, {
        method: 'POST', headers,
        body: JSON.stringify({
          operations: [{
            create: {
              name: payload.name,
              advertisingChannelType: 'SEARCH',
              status: 'PAUSED', // guvenli — kullanici manual ENABLE eder
              campaignBudget: budgetResourceName,
              maximizeConversions: {},
              networkSettings: {
                targetGoogleSearch: true,
                targetSearchNetwork: true,
                targetContentNetwork: false,
                targetPartnerSearchNetwork: false,
              },
            },
          }],
        }),
      });
      if (!campaignRes.ok) throw new Error(`campaign ${campaignRes.status}: ${(await campaignRes.text()).slice(0, 200)}`);
      const campaignData = await campaignRes.json() as any;
      const campaignResourceName: string = campaignData.results[0].resourceName;
      const campaignId = campaignResourceName.split('/').pop()!;

      // 3) Ad group
      const adGroupRes = await fetch(`https://googleads.googleapis.com/v21/customers/${customerId}/adGroups:mutate`, {
        method: 'POST', headers,
        body: JSON.stringify({
          operations: [{
            create: {
              name: `${payload.name} - AdGroup`,
              campaign: campaignResourceName,
              type: 'SEARCH_STANDARD',
              status: 'ENABLED',
              cpcBidMicros: '1000000', // 1 TL default — MAXIMIZE_CONVERSIONS uses dynamic anyway
            },
          }],
        }),
      });
      if (!adGroupRes.ok) throw new Error(`adgroup ${adGroupRes.status}: ${(await adGroupRes.text()).slice(0, 200)}`);
      const adGroupData = await adGroupRes.json() as any;
      const adGroupResourceName: string = adGroupData.results[0].resourceName;

      // 4) Responsive Search Ad
      const headlineAssets = payload.headlines.slice(0, 15).map((h) => ({ text: h.slice(0, 30) }));
      const descAssets = payload.descriptions.slice(0, 4).map((d) => ({ text: d.slice(0, 90) }));
      while (headlineAssets.length < 3) headlineAssets.push({ text: payload.name.slice(0, 30) });
      while (descAssets.length < 2) descAssets.push({ text: payload.name.slice(0, 90) });

      const adRes = await fetch(`https://googleads.googleapis.com/v21/customers/${customerId}/adGroupAds:mutate`, {
        method: 'POST', headers,
        body: JSON.stringify({
          operations: [{
            create: {
              adGroup: adGroupResourceName,
              status: 'ENABLED',
              ad: {
                finalUrls: [payload.finalUrl],
                responsiveSearchAd: {
                  headlines: headlineAssets,
                  descriptions: descAssets,
                },
              },
            },
          }],
        }),
      });
      if (!adRes.ok) throw new Error(`ad ${adRes.status}: ${(await adRes.text()).slice(0, 200)}`);

      // 5) Keywords (ad_group_criterion)
      if (payload.keywords && payload.keywords.length > 0) {
        const kwOps = payload.keywords.slice(0, 50).map((kw) => ({
          create: {
            adGroup: adGroupResourceName,
            status: 'ENABLED',
            keyword: { text: kw, matchType: 'BROAD' },
          },
        }));
        await fetch(`https://googleads.googleapis.com/v21/customers/${customerId}/adGroupCriteria:mutate`, {
          method: 'POST', headers,
          body: JSON.stringify({ operations: kwOps, partialFailure: true }),
        });
      }

      // 6) Geo + language targeting (campaign_criterion)
      const campaignCriteriaOps: any[] = [];
      const locIds = payload.locationIds ?? [2792]; // Turkey default
      for (const lid of locIds) {
        campaignCriteriaOps.push({
          create: {
            campaign: campaignResourceName,
            location: { geoTargetConstant: `geoTargetConstants/${lid}` },
          },
        });
      }
      const langIds = payload.languageIds ?? [1037]; // Turkish default
      for (const lid of langIds) {
        campaignCriteriaOps.push({
          create: {
            campaign: campaignResourceName,
            language: { languageConstant: `languageConstants/${lid}` },
          },
        });
      }
      if (campaignCriteriaOps.length > 0) {
        await fetch(`https://googleads.googleapis.com/v21/customers/${customerId}/campaignCriteria:mutate`, {
          method: 'POST', headers,
          body: JSON.stringify({ operations: campaignCriteriaOps, partialFailure: true }),
        });
      }

      this.log.log(`[${siteId}] Google campaign created: ${campaignId}`);
      return { ok: true, campaignId };
    } catch (err: any) {
      this.log.error(`Google createCampaign fail: ${err.message}`);
      return { ok: false, error: err.message };
    }
  }

  // ────────────────────────────────────────────────────────────────
  // Faz 11.3 — Ad-level metrics (A/B test winner picker)
  // ────────────────────────────────────────────────────────────────

  /**
   * Kampanya icindeki tum ad varyantlarinin son 7 gunluk metriklerini ceker.
   */
  async getAdVariantMetrics(siteId: string, campaignExternalId: string) {
    const gaql = `
      SELECT
        ad_group_ad.ad.id, ad_group_ad.ad.name, ad_group_ad.status,
        ad_group_ad.resource_name,
        metrics.impressions, metrics.clicks, metrics.ctr,
        metrics.conversions, metrics.conversions_value
      FROM ad_group_ad
      WHERE campaign.id = ${campaignExternalId}
        AND segments.date DURING LAST_7_DAYS
        AND metrics.impressions > 100
    `;
    const rows = await this.query(siteId, gaql);
    return rows.map((r: any) => {
      const impressions = parseInt(r.metrics?.impressions ?? '0', 10);
      const conversions = r.metrics?.conversions ?? 0;
      return {
        adId: r.adGroupAd?.ad?.id,
        resourceName: r.adGroupAd?.resourceName,
        name: r.adGroupAd?.ad?.name ?? '',
        status: r.adGroupAd?.status,
        impressions,
        clicks: parseInt(r.metrics?.clicks ?? '0', 10),
        ctr: r.metrics?.ctr ?? 0,
        conversions: Math.round(conversions),
        convRate: impressions > 0 ? conversions / impressions : 0,
      };
    });
  }

  /**
   * Tek bir ad'i pause/enable et.
   */
  async setAdStatus(siteId: string, adResourceName: string, status: 'PAUSED' | 'ENABLED'): Promise<{ ok: boolean }> {
    const accessToken = await this.getAccessToken(siteId);
    if (!accessToken) return { ok: false };
    const site: any = await this.prisma.site.findUniqueOrThrow({ where: { id: siteId } });
    const customerId = (site.googleAdsCustomerId ?? '').replace(/-/g, '');
    try {
      const res = await fetch(`https://googleads.googleapis.com/v21/customers/${customerId}/adGroupAds:mutate`, {
        method: 'POST', headers: this.headers(accessToken),
        body: JSON.stringify({
          operations: [{
            update: { resourceName: adResourceName, status },
            updateMask: 'status',
          }],
        }),
      });
      return { ok: res.ok };
    } catch (err: any) {
      this.log.warn(`Google ad status fail: ${err.message}`);
      return { ok: false };
    }
  }

  private headers(accessToken: string): Record<string, string> {
    const h: Record<string, string> = {
      'Authorization': `Bearer ${accessToken}`,
      'developer-token': process.env.GOOGLE_ADS_DEV_TOKEN ?? '',
      'Content-Type': 'application/json',
    };
    if (process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID) {
      h['login-customer-id'] = process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID;
    }
    return h;
  }

  private tryDecrypt(token: string): string {
    try { return decrypt(token); } catch { return token; }
  }
}
