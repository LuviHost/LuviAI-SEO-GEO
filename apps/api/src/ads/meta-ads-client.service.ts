import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { decrypt } from '@luviai/shared';

/**
 * Meta Marketing API client — resmi Graph API.
 * Docs: https://developers.facebook.com/docs/marketing-api
 *
 * Auth: Long-lived user access token (60 gun).
 *
 * Env:
 *   META_APP_ID
 *   META_APP_SECRET
 */
@Injectable()
export class MetaAdsClientService {
  private readonly log = new Logger(MetaAdsClientService.name);
  private readonly apiVersion = 'v21.0';

  constructor(private readonly prisma: PrismaService) {}

  private async getToken(siteId: string): Promise<string | null> {
    const site: any = await this.prisma.site.findUniqueOrThrow({ where: { id: siteId } });
    if (!site.metaAdsAccessToken) return null;
    try { return decrypt(site.metaAdsAccessToken); } catch { return site.metaAdsAccessToken; }
  }

  /**
   * Kampanya metrikleri (insights) — son 30g.
   */
  async getCampaignInsights(siteId: string, campaignId: string) {
    const token = await this.getToken(siteId);
    if (!token) throw new Error('Meta Ads bagli degil — Reklam Hesaplari sekmesinden bağla');

    const fields = 'impressions,clicks,spend,actions,action_values,ctr,cpc,reach';
    const url = `https://graph.facebook.com/${this.apiVersion}/${campaignId}/insights?fields=${fields}&date_preset=last_30d&access_token=${token}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Meta insights ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const data = await res.json() as any;
    const row = data?.data?.[0];
    if (!row) return null;

    // actions array: [{action_type:"purchase", value:"5"}, ...]
    const actions: any[] = Array.isArray(row.actions) ? row.actions : [];
    const actionValues: any[] = Array.isArray(row.action_values) ? row.action_values : [];
    const purchases = parseInt(actions.find((a) => a.action_type === 'purchase')?.value ?? '0', 10);
    const purchaseValue = parseFloat(actionValues.find((a) => a.action_type === 'purchase')?.value ?? '0');
    const spend = parseFloat(row.spend ?? '0');

    return {
      impressions: parseInt(row.impressions ?? '0', 10),
      clicks: parseInt(row.clicks ?? '0', 10),
      spend,
      conversions: purchases,
      ctr: parseFloat(row.ctr ?? '0') / 100,
      cpc: parseFloat(row.cpc ?? '0'),
      roas: spend > 0 ? purchaseValue / spend : 0,
      reach: parseInt(row.reach ?? '0', 10),
    };
  }

  /**
   * Kampanya status update.
   */
  async setCampaignStatus(siteId: string, campaignId: string, status: 'ACTIVE' | 'PAUSED'): Promise<{ ok: boolean }> {
    const token = await this.getToken(siteId);
    if (!token) return { ok: false };

    try {
      const res = await fetch(`https://graph.facebook.com/${this.apiVersion}/${campaignId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          status,
          access_token: token,
        }),
      });
      return { ok: res.ok };
    } catch (err: any) {
      this.log.warn(`Meta status fail: ${err.message}`);
      return { ok: false };
    }
  }

  /**
   * Daily butce update — ad set'lerinin daily_budget'ini guncelle (Meta'da
   * butce ad set seviyesinde tutuluyor, campaign'da Campaign Budget Optimization
   * kapali ise. CBO acik ise direkt campaign'a yazilir).
   */
  async updateDailyBudget(siteId: string, campaignId: string, dailyBudgetTRY: number): Promise<{ ok: boolean }> {
    const token = await this.getToken(siteId);
    if (!token) return { ok: false };
    try {
      // Meta butce minor units (kurus) cinsinden
      const cents = Math.round(dailyBudgetTRY * 100);
      // Once campaign'da CBO acik mi diye dene
      const cRes = await fetch(`https://graph.facebook.com/${this.apiVersion}/${campaignId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ daily_budget: String(cents), access_token: token }),
      });
      if (cRes.ok) return { ok: true };

      // CBO yoksa ad set'lere yaz
      const adsetUrl = `https://graph.facebook.com/${this.apiVersion}/${campaignId}/adsets?fields=id&access_token=${token}`;
      const adsetRes = await fetch(adsetUrl);
      if (!adsetRes.ok) return { ok: false };
      const adsets = (await adsetRes.json() as any).data ?? [];
      const perAdset = Math.floor(cents / Math.max(1, adsets.length));
      let allOk = true;
      for (const a of adsets) {
        const r = await fetch(`https://graph.facebook.com/${this.apiVersion}/${a.id}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({ daily_budget: String(perAdset), access_token: token }),
        });
        if (!r.ok) allOk = false;
      }
      return { ok: allOk };
    } catch (err: any) {
      this.log.warn(`Meta budget fail: ${err.message}`);
      return { ok: false };
    }
  }

  // ────────────────────────────────────────────────────────────────
  // Faz 11.3 — Campaign Creation
  // ────────────────────────────────────────────────────────────────

  /**
   * End-to-end Meta kampanya olusturur:
   *   1. campaign create (objective + status PAUSED)
   *   2. adset create (audience + budget + placements + dates)
   *   3. adcreative create (image_url + headline + primary_text + cta)
   *   4. ad create (creative + adset)
   *
   * Donus: campaignId
   *
   * Not: Meta API objective kodlari farklidir (OUTCOME_*) — payload.objective
   * frontend friendly mapping yapilir.
   */
  async createCampaign(siteId: string, payload: {
    name: string;
    objective: 'traffic' | 'leads' | 'conversions' | 'brand_awareness' | 'sales';
    dailyBudgetTRY: number;
    primaryText: string;
    headline: string;
    description?: string;
    imageUrl: string;            // public URL — Meta upload ile hash'a cevirilir
    landingUrl: string;
    cta?: string;                // SHOP_NOW, LEARN_MORE, SIGN_UP, BOOK_TRAVEL...
    pageId: string;              // Facebook Page (zorunlu)
    instagramActorId?: string;   // IG account (opsiyonel)
    countries?: string[];        // ['TR']
    ageMin?: number;
    ageMax?: number;
    interests?: { id: string; name: string }[]; // Meta interest IDs
  }): Promise<{ ok: boolean; campaignId?: string; error?: string }> {
    const token = await this.getToken(siteId);
    if (!token) return { ok: false, error: 'Meta Ads bagli degil' };
    const site: any = await this.prisma.site.findUniqueOrThrow({ where: { id: siteId } });
    const accountId = String(site.metaAdsAccountId).replace(/^act_/, '');

    // Objective mapping (yeni "ODAX" kategorileri)
    const objectiveMap: Record<string, string> = {
      traffic: 'OUTCOME_TRAFFIC',
      leads: 'OUTCOME_LEADS',
      conversions: 'OUTCOME_SALES',
      sales: 'OUTCOME_SALES',
      brand_awareness: 'OUTCOME_AWARENESS',
    };
    const metaObjective = objectiveMap[payload.objective] ?? 'OUTCOME_TRAFFIC';

    try {
      // 1) Image upload (URL → hash)
      const imgRes = await fetch(`https://graph.facebook.com/${this.apiVersion}/act_${accountId}/adimages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ url: payload.imageUrl, access_token: token }),
      });
      if (!imgRes.ok) throw new Error(`adimages ${imgRes.status}: ${(await imgRes.text()).slice(0, 200)}`);
      const imgData = await imgRes.json() as any;
      const imgKey = Object.keys(imgData.images ?? {})[0];
      const imageHash = imgData.images?.[imgKey]?.hash;
      if (!imageHash) throw new Error('image hash yok');

      // 2) Campaign
      const campRes = await fetch(`https://graph.facebook.com/${this.apiVersion}/act_${accountId}/campaigns`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          name: payload.name,
          objective: metaObjective,
          status: 'PAUSED',
          special_ad_categories: '[]',
          access_token: token,
        }),
      });
      if (!campRes.ok) throw new Error(`campaign ${campRes.status}: ${(await campRes.text()).slice(0, 200)}`);
      const campData = await campRes.json() as any;
      const campaignId = campData.id;

      // 3) Ad set
      const targeting: any = {
        geo_locations: { countries: payload.countries ?? ['TR'] },
        age_min: payload.ageMin ?? 18,
        age_max: payload.ageMax ?? 65,
      };
      if (payload.interests && payload.interests.length > 0) {
        targeting.flexible_spec = [{ interests: payload.interests }];
      }

      const billingEvent = payload.objective === 'brand_awareness' ? 'IMPRESSIONS' : 'IMPRESSIONS';
      const optimizationGoal =
        payload.objective === 'leads' ? 'LEAD_GENERATION'
        : payload.objective === 'conversions' || payload.objective === 'sales' ? 'OFFSITE_CONVERSIONS'
        : payload.objective === 'brand_awareness' ? 'REACH'
        : 'LINK_CLICKS';

      const adsetParams = new URLSearchParams({
        name: `${payload.name} - AdSet`,
        campaign_id: campaignId,
        daily_budget: String(Math.round(payload.dailyBudgetTRY * 100)),
        billing_event: billingEvent,
        optimization_goal: optimizationGoal,
        targeting: JSON.stringify(targeting),
        status: 'PAUSED',
        start_time: new Date(Date.now() + 60_000).toISOString(),
        access_token: token,
      });
      const adsetRes = await fetch(`https://graph.facebook.com/${this.apiVersion}/act_${accountId}/adsets`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: adsetParams,
      });
      if (!adsetRes.ok) throw new Error(`adset ${adsetRes.status}: ${(await adsetRes.text()).slice(0, 200)}`);
      const adsetData = await adsetRes.json() as any;
      const adsetId = adsetData.id;

      // 4) Ad creative
      const creativeSpec: any = {
        link_data: {
          message: payload.primaryText,
          link: payload.landingUrl,
          name: payload.headline,
          description: payload.description ?? '',
          image_hash: imageHash,
          call_to_action: { type: payload.cta ?? 'LEARN_MORE', value: { link: payload.landingUrl } },
        },
      };
      const creativePayload: any = {
        object_story_spec: {
          page_id: payload.pageId,
          link_data: creativeSpec.link_data,
          ...(payload.instagramActorId ? { instagram_actor_id: payload.instagramActorId } : {}),
        },
      };
      const creativeRes = await fetch(`https://graph.facebook.com/${this.apiVersion}/act_${accountId}/adcreatives`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          name: `${payload.name} - Creative`,
          object_story_spec: JSON.stringify(creativePayload.object_story_spec),
          access_token: token,
        }),
      });
      if (!creativeRes.ok) throw new Error(`creative ${creativeRes.status}: ${(await creativeRes.text()).slice(0, 200)}`);
      const creativeData = await creativeRes.json() as any;
      const creativeId = creativeData.id;

      // 5) Ad
      const adRes = await fetch(`https://graph.facebook.com/${this.apiVersion}/act_${accountId}/ads`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          name: `${payload.name} - Ad`,
          adset_id: adsetId,
          creative: JSON.stringify({ creative_id: creativeId }),
          status: 'PAUSED',
          access_token: token,
        }),
      });
      if (!adRes.ok) throw new Error(`ad ${adRes.status}: ${(await adRes.text()).slice(0, 200)}`);

      this.log.log(`[${siteId}] Meta campaign created: ${campaignId}`);
      return { ok: true, campaignId };
    } catch (err: any) {
      this.log.error(`Meta createCampaign fail: ${err.message}`);
      return { ok: false, error: err.message };
    }
  }

  // ────────────────────────────────────────────────────────────────
  // Faz 11.3 — Page Post Insights + Boost (auto-boost)
  // ────────────────────────────────────────────────────────────────

  /**
   * Bir Facebook page post'unun son 7 gunluk insights'ini ceker.
   * postId formati: {pageId}_{postId} (Graph API page-post ID'si)
   */
  async getPagePostInsights(siteId: string, postId: string) {
    const token = await this.getToken(siteId);
    if (!token) return null;
    try {
      const metric = 'post_impressions,post_engaged_users,post_reach,post_clicks,post_reactions_by_type_total';
      const res = await fetch(`https://graph.facebook.com/${this.apiVersion}/${postId}/insights?metric=${metric}&access_token=${token}`);
      if (!res.ok) return null;
      const data = await res.json() as any;
      const map: Record<string, number> = {};
      for (const m of data.data ?? []) {
        const v = m.values?.[0]?.value;
        map[m.name] = typeof v === 'number' ? v : 0;
      }
      const reach = map.post_reach ?? 0;
      const engaged = map.post_engaged_users ?? 0;
      return {
        impressions: map.post_impressions ?? 0,
        reach,
        engagedUsers: engaged,
        clicks: map.post_clicks ?? 0,
        engagementRate: reach > 0 ? engaged / reach : 0,
      };
    } catch (err: any) {
      this.log.warn(`Meta page post insights fail: ${err.message}`);
      return null;
    }
  }

  /**
   * Bir page post'u boost et — campaign + adset + creative (object_story_id) + ad zinciri.
   */
  async boostPagePost(siteId: string, payload: {
    pageId: string;
    postId: string;          // Page post ID (full: pageId_postId)
    dailyBudgetTRY: number;
    days: number;            // 7
    countries?: string[];
  }): Promise<{ ok: boolean; campaignId?: string; error?: string }> {
    const token = await this.getToken(siteId);
    if (!token) return { ok: false, error: 'Meta Ads bagli degil' };
    const site: any = await this.prisma.site.findUniqueOrThrow({ where: { id: siteId } });
    const accountId = String(site.metaAdsAccountId).replace(/^act_/, '');

    try {
      // 1) Campaign
      const campRes = await fetch(`https://graph.facebook.com/${this.apiVersion}/act_${accountId}/campaigns`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          name: `Boost - ${payload.postId} - ${new Date().toISOString().slice(0, 10)}`,
          objective: 'OUTCOME_ENGAGEMENT',
          status: 'ACTIVE',
          special_ad_categories: '[]',
          access_token: token,
        }),
      });
      if (!campRes.ok) throw new Error(`campaign ${campRes.status}: ${(await campRes.text()).slice(0, 200)}`);
      const campaignId = ((await campRes.json()) as any).id;

      // 2) Ad set (post engagement)
      const targeting = { geo_locations: { countries: payload.countries ?? ['TR'] }, age_min: 18, age_max: 65 };
      const start = new Date(Date.now() + 60_000);
      const end = new Date(start.getTime() + payload.days * 86400000);
      const adsetRes = await fetch(`https://graph.facebook.com/${this.apiVersion}/act_${accountId}/adsets`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          name: `Boost AdSet - ${payload.postId}`,
          campaign_id: campaignId,
          daily_budget: String(Math.round(payload.dailyBudgetTRY * 100)),
          billing_event: 'IMPRESSIONS',
          optimization_goal: 'POST_ENGAGEMENT',
          targeting: JSON.stringify(targeting),
          start_time: start.toISOString(),
          end_time: end.toISOString(),
          status: 'ACTIVE',
          access_token: token,
        }),
      });
      if (!adsetRes.ok) throw new Error(`adset ${adsetRes.status}: ${(await adsetRes.text()).slice(0, 200)}`);
      const adsetId = ((await adsetRes.json()) as any).id;

      // 3) Ad creative — object_story_id (mevcut post)
      const fullPostId = payload.postId.includes('_') ? payload.postId : `${payload.pageId}_${payload.postId}`;
      const creativeRes = await fetch(`https://graph.facebook.com/${this.apiVersion}/act_${accountId}/adcreatives`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          name: `Boost Creative - ${fullPostId}`,
          object_story_id: fullPostId,
          access_token: token,
        }),
      });
      if (!creativeRes.ok) throw new Error(`creative ${creativeRes.status}: ${(await creativeRes.text()).slice(0, 200)}`);
      const creativeId = ((await creativeRes.json()) as any).id;

      // 4) Ad
      const adRes = await fetch(`https://graph.facebook.com/${this.apiVersion}/act_${accountId}/ads`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          name: `Boost Ad - ${fullPostId}`,
          adset_id: adsetId,
          creative: JSON.stringify({ creative_id: creativeId }),
          status: 'ACTIVE',
          access_token: token,
        }),
      });
      if (!adRes.ok) throw new Error(`ad ${adRes.status}: ${(await adRes.text()).slice(0, 200)}`);

      this.log.log(`[${siteId}] Page post boosted: ${fullPostId}, campaign ${campaignId}`);
      return { ok: true, campaignId };
    } catch (err: any) {
      this.log.error(`Meta boostPagePost fail: ${err.message}`);
      return { ok: false, error: err.message };
    }
  }

  // ────────────────────────────────────────────────────────────────
  // Faz 11.3 — Ad-level metrics (A/B test)
  // ────────────────────────────────────────────────────────────────

  /**
   * Kampanya icindeki tum ad varyantlarinin son 7 gunluk insights'ini ceker.
   */
  async getAdVariantMetrics(siteId: string, campaignId: string) {
    const token = await this.getToken(siteId);
    if (!token) return [];
    try {
      const fields = 'ad_id,ad_name,impressions,clicks,ctr,actions,reach';
      const url = `https://graph.facebook.com/${this.apiVersion}/${campaignId}/insights?level=ad&fields=${fields}&date_preset=last_7d&filtering=${encodeURIComponent(JSON.stringify([{ field: 'impressions', operator: 'GREATER_THAN', value: 100 }]))}&access_token=${token}`;
      const res = await fetch(url);
      if (!res.ok) return [];
      const data = await res.json() as any;
      return (data.data ?? []).map((r: any) => {
        const impressions = parseInt(r.impressions ?? '0', 10);
        const actions: any[] = Array.isArray(r.actions) ? r.actions : [];
        const purchases = parseInt(actions.find((a) => a.action_type === 'purchase')?.value ?? '0', 10);
        return {
          adId: r.ad_id,
          name: r.ad_name ?? '',
          impressions,
          clicks: parseInt(r.clicks ?? '0', 10),
          ctr: parseFloat(r.ctr ?? '0') / 100,
          conversions: purchases,
          convRate: impressions > 0 ? purchases / impressions : 0,
        };
      });
    } catch (err: any) {
      this.log.warn(`Meta ad variants fail: ${err.message}`);
      return [];
    }
  }

  /**
   * Tek bir ad'in status'unu degistir.
   */
  async setAdStatus(siteId: string, adId: string, status: 'ACTIVE' | 'PAUSED'): Promise<{ ok: boolean }> {
    const token = await this.getToken(siteId);
    if (!token) return { ok: false };
    try {
      const res = await fetch(`https://graph.facebook.com/${this.apiVersion}/${adId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ status, access_token: token }),
      });
      return { ok: res.ok };
    } catch (err: any) {
      this.log.warn(`Meta ad status fail: ${err.message}`);
      return { ok: false };
    }
  }
}
