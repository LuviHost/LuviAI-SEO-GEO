import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { decrypt } from '@luviai/shared';
import {
  EU_POLITICAL_ADVERTISING,
  describeGoogleAdsError,
  envLoginCustomerId,
  googleAdsHeaders,
  googleAdsOAuthClient,
  googleAdsRequest,
  googleAdsUserReason,
  isAdGroupAdResourceName,
  isCampaignBudgetResourceName,
  isNumericId,
  normalizeCustomerId,
  partialFailureOutcome,
  type GoogleAdsErrorInfo,
} from './google-ads-api.js';
import { sameBudget, type BudgetWriteResult, type LiveBudgetResult, type LiveCampaignBudget, type LiveCampaignStatus } from './live-budget.js';
import type { AdStatusWriteResult, AdVariant } from './ads-client.service.js';

/**
 * Google Ads API client — resmi REST API.
 * Docs: https://developers.google.com/google-ads/api/rest/overview
 *
 * SURUM: google-ads-api.ts → GOOGLE_ADS_API_VERSION (su an v26). Surum, v21 →
 * v26 denetimi ve bir sonraki yukseltme notu orada. Bu dosyada sabit surumlu
 * adres yazilmaz (google-ads-api.spec.ts denetler).
 *
 * Auth: kullanicinin OAuth yenileme belirteci (site.googleAdsRefreshToken) +
 * istege bagli yonetici hesap basligi. Developer token 9 Eylul 2026'dan beri
 * kullanilmiyor; erisim seviyesi (Test / Explorer / Basic / Standard) OAuth
 * istemcisinin Google Cloud projesine bagli (google-ads-api.ts googleAdsHeaders).
 *
 * Env:
 *   GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET — baglanti akisiyla AYNI istemci
 *     (yoksa GOOGLE_OAUTH_CLIENT_ID / GOOGLE_OAUTH_CLIENT_SECRET)
 *   GOOGLE_ADS_LOGIN_CUSTOMER_ID — yonetici (MCC) hesap, istege bagli
 *   GOOGLE_ADS_DEV_TOKEN — ARTIK OKUNMUYOR (Google kaldirdi)
 *
 * Mutate sonuclari { ok, error? } doner: error yalniz nedeni ve cozumu kesin
 * olan durumlarda musteriye gosterilebilir Turkce metindir (panelde "Yayına al"
 * bunu gosterir); ayrintili Google hatasi (kod + requestId) loga gider.
 */

// Yol paneldeki gercek adlar: sayfa "Bağlantılar" (sites/[id]/connections), kart "Reklam Hesapları"
const NOT_CONNECTED = 'Google Ads bağlı değil; Bağlantılar sayfasındaki Reklam Hesapları kartından bağla.';
const NO_CUSTOMER = 'Google Ads reklam hesabı seçilmemiş; Bağlantılar sayfasındaki Reklam Hesapları kartından bir hesap seç.';
const TOKEN_FAILED = 'Google Ads erişim izni yenilenemedi; sorun sürerse Bağlantılar sayfasındaki Reklam Hesapları kartından Google Ads\'i yeniden bağla.';
const BAD_CAMPAIGN_ID = 'Google Ads kampanya kimliği geçersiz; kimlik yalnız rakamlardan oluşmalı.';
const BUDGET_SHARED = 'Bu kampanyanın bütçesi Google Ads\'te başka kampanyalarla paylaşılıyor; değişiklik diğer kampanyaların harcamasını da etkileyeceği için bütçe değiştirilmedi.';
const BUDGET_NOT_DAILY = 'Bu kampanyanın Google Ads bütçesi günlük değil (toplam bütçe); yalnız günlük bütçe değiştirilebilir.';
const CAMPAIGN_REMOVED = 'Kampanya Google Ads\'te kaldırılmış; bütçesi değiştirilmedi.';
const BUDGET_STALE = 'Kampanyanın bütçesi Google Ads\'te değişmiş; RanksUp yazmadan önce yeniden okudu ve değişikliği yapmadı.';

/** campaign.status (v26 enums/campaign_status.proto: ENABLED, PAUSED, REMOVED) → RanksUp kumesi */
const GOOGLE_CAMPAIGN_STATUS: Record<string, LiveCampaignStatus> = {
  ENABLED: 'ACTIVE',
  PAUSED: 'PAUSED',
  REMOVED: 'ENDED',
};

/**
 * campaign.serving_status degerleri icin musteriye gosterilebilir durum adi
 * (yalniz enum adinin karsiligi; neden iddia edilmez — resmi enum aciklamasi
 * yalniz "Ended." / "Pending." / "Suspended." diyor).
 */
const GOOGLE_NOT_SERVING_LABEL: ReadonlyMap<string, string> = new Map([
  ['ENDED', 'sona erdi'],
  ['PENDING', 'henüz başlamadı'],
  ['SUSPENDED', 'askıya alındı'],
]);

/**
 * Kampanya su an YAYINDA mi: campaign.status ENABLED olsa bile bitis tarihi
 * gecmis, baslangici gelmemis ya da askiya alinmis kampanya harcama yapmaz.
 *
 * NEDEN: canli okuma yalniz campaign.status seciyordu; bitis tarihi gecen
 * kampanya ENABLED kaldigi icin 'ACTIVE' sayiliyordu. Kaydirici yayindaki Meta
 * kampanyasinin butcesini harcayamayan bu kampanyaya aktariyor, orchestrator
 * onu "iyi performans" diye x2'ye kadar artiriyordu; musteri bitis tarihini
 * uzatirsa kampanya kendi belirledigi butcenin iki katiyla calisirdi.
 *
 * Alan: campaign.serving_status — "Output only. The ad serving status of the
 * campaign", ENUM ENDED / NONE / PENDING / SERVING / SUSPENDED / UNKNOWN /
 * UNSPECIFIED, Selectable True (resmi alan referansi
 * https://developers.google.com/google-ads/api/fields/v26/campaign) ve
 * googleapis/googleapis google/ads/googleads/v26/resources/campaign.proto
 * (`serving_status = 21`, OUTPUT_ONLY) + v26/enums/campaign_serving_status.proto.
 * campaign.status'tan AYRI bir alandir.
 *
 * Yalniz SERVING 'ACTIVE' sayilir; ENABLED + baska her deger (alan gelmezse
 * de) 'OTHER': otopilot (autopilotDailyBudget), kaydirici ve updateBudget
 * dokunmaz. 'ENDED' DEGIL: liveSyncPatch ENDED'i kayda KALICI yazar ve kampanya
 * senkrondan duser; musteri bitis tarihini uzatinca kampanya yeniden SERVING
 * olur ve otopilot kaldigi yerden devam eder.
 */
function googleLiveStatus(status: string, servingStatus: string): { status: LiveCampaignStatus; platformStatus: string } {
  const base = GOOGLE_CAMPAIGN_STATUS[status] ?? 'OTHER';
  if (base !== 'ACTIVE') return { status: base, platformStatus: status };
  if (servingStatus === 'SERVING') return { status: 'ACTIVE', platformStatus: status };
  return { status: 'OTHER', platformStatus: `${status}/${servingStatus}` };
}

/** int64 mikro (JSON'da dize) → hesap para birimindeki tutar; yok/0/gecersiz → null */
function microsToAmount(v: unknown): number | null {
  const n = typeof v === 'string' || typeof v === 'number' ? Number(v) : Number.NaN;
  return Number.isFinite(n) && n > 0 ? n / 1_000_000 : null;
}

/**
 * A/B'de karsilastirilan reklam turleri: arama sonuclarindaki metin reklamlari
 * (v26 enums/ad_type.proto RESPONSIVE_SEARCH_AD, EXPANDED_TEXT_AD — ikincisi
 * artik olusturulamiyor ama eski reklamlar yayinda olabiliyor).
 */
const GOOGLE_AB_AD_TYPES: ReadonlySet<unknown> = new Set(['RESPONSIVE_SEARCH_AD', 'EXPANDED_TEXT_AD']);

/** int64 sayac (JSON'da dize) → negatif olmayan tamsayi; yok/gecersiz → null (bilinmiyor) */
function countOrNull(v: unknown): number | null {
  if (typeof v === 'number') return Number.isSafeInteger(v) && v >= 0 ? v : null;
  return typeof v === 'string' && /^\d{1,15}$/.test(v) ? Number(v) : null;
}

/** double metrik → negatif olmayan sayi; yok/gecersiz → null (bilinmiyor) */
function amountOrNull(v: unknown): number | null {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : Number.NaN;
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/** Kampanyanin canli durum + butce satiri (getLiveBudget ve updateBudget ortak okur) */
interface GoogleBudgetRow {
  /** Bu musterinin campaign_budget kaynak adi; dogrulanamazsa null */
  resourceName: string | null;
  shared: boolean;
  period: string;
  live: LiveCampaignBudget;
}

type SiteContext =
  | { ok: true; accessToken: string; customerId: string }
  | { ok: false; error: string };

@Injectable()
export class GoogleAdsClientService {
  private readonly log = new Logger(GoogleAdsClientService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Site icin erisim: secili musteri kimligi (tiresiz) + yenilenmis access
   * token. Hesap secilmemisse token hic yenilenmez (eskiden bos kimlikle
   * "customers//..." adresine istek gidiyordu).
   */
  private async siteContext(siteId: string): Promise<SiteContext> {
    const site: any = await this.prisma.site.findUniqueOrThrow({ where: { id: siteId } });
    if (!site.googleAdsRefreshToken) return { ok: false, error: NOT_CONNECTED };
    const customerId = normalizeCustomerId(site.googleAdsCustomerId);
    if (!customerId) return { ok: false, error: NO_CUSTOMER };

    const { clientId, clientSecret } = googleAdsOAuthClient();
    if (!clientId || !clientSecret) {
      this.log.warn('Google Ads OAuth istemcisi yok (GOOGLE_CLIENT_ID/SECRET ya da GOOGLE_OAUTH_CLIENT_ID/SECRET)');
      return { ok: false, error: TOKEN_FAILED };
    }
    const accessToken = await this.refreshAccessToken(this.tryDecrypt(site.googleAdsRefreshToken), clientId, clientSecret, siteId);
    if (!accessToken) return { ok: false, error: TOKEN_FAILED };
    return { ok: true, accessToken, customerId };
  }

  /**
   * Yenileme belirtecinden access token. Google'in hata govdesinden yalniz
   * "error" alani (invalid_grant gibi) loga gider.
   */
  private async refreshAccessToken(refreshToken: string, clientId: string, clientSecret: string, label: string): Promise<string | null> {
    try {
      const res = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: clientId,
          client_secret: clientSecret,
          refresh_token: refreshToken,
          grant_type: 'refresh_token',
        }),
        signal: AbortSignal.timeout(15_000),
      });
      const data = (await res.json().catch(() => ({}))) as any;
      if (!res.ok || typeof data?.access_token !== 'string') {
        this.log.warn(`[${label}] Google access token yenilenemedi: HTTP ${res.status} ${String(data?.error ?? '').slice(0, 60)}`);
        return null;
      }
      return data.access_token;
    } catch (err: any) {
      this.log.warn(`[${label}] Google access token: ${String(err?.message ?? err).slice(0, 160)}`);
      return null;
    }
  }

  /** GAQL aramasi, hazir erisimle. Hata → Error (mesaj: kod + requestId, loglar icin) */
  private async searchWith(ctx: { accessToken: string; customerId: string }, gaqlQuery: string): Promise<any[]> {
    const r = await googleAdsRequest(`customers/${ctx.customerId}/googleAds:search`, {
      headers: googleAdsHeaders(ctx.accessToken, { loginCustomerId: envLoginCustomerId() }),
      body: { query: gaqlQuery },
    });
    if (!r.ok) throw new Error(`GAQL ${describeGoogleAdsError(r.error)}`);
    return Array.isArray(r.data?.results) ? r.data.results : [];
  }

  /**
   * Search query (GAQL) — campaigns, ad groups, search terms vs.
   * Sayfa boyu Google'da sabit 10.000 satir; buradaki sorgular tek sayfada kalir.
   */
  async query(siteId: string, gaqlQuery: string): Promise<any[]> {
    const ctx = await this.siteContext(siteId);
    if (!ctx.ok) throw new Error(ctx.error);
    return this.searchWith(ctx, gaqlQuery);
  }

  /** Mutate istegi; hata loglanir ve musteriye gosterilebilir neden (varsa) doner */
  private async mutate(
    ctx: { accessToken: string; customerId: string },
    resourcePath: string,
    body: unknown,
    label: string,
  ): Promise<{ ok: true; data: any } | { ok: false; error?: string; info: GoogleAdsErrorInfo }> {
    const r = await googleAdsRequest(`customers/${ctx.customerId}/${resourcePath}`, {
      headers: googleAdsHeaders(ctx.accessToken, { loginCustomerId: envLoginCustomerId() }),
      body,
    });
    if (r.ok) return { ok: true, data: r.data };
    this.log.warn(`[${ctx.customerId}] ${label} reddedildi: ${describeGoogleAdsError(r.error)}`);
    return { ok: false, error: googleAdsUserReason(r.error), info: r.error };
  }

  /**
   * Refresh token'dan access token (site-bagimsiz — keyword research icin).
   * Bu belirtec (GOOGLE_ADS_REFRESH_TOKEN) baglanti akisinda degil elle
   * uretiliyor; istemci onceligi eskisi gibi GOOGLE_OAUTH_CLIENT_* once.
   */
  private async getAccessTokenFromRefresh(refreshToken: string): Promise<string | null> {
    const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID || process.env.GOOGLE_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET || process.env.GOOGLE_CLIENT_SECRET;
    if (!clientId || !clientSecret) {
      this.log.warn('Ads OAuth client env yok (GOOGLE_OAUTH_CLIENT_ID/SECRET veya GOOGLE_CLIENT_ID/SECRET)');
      return null;
    }
    return this.refreshAccessToken(refreshToken, clientId, clientSecret, 'keyword-ideas');
  }

  /**
   * Keyword Planner — anahtar kelime arama hacimleri (site-bagimsiz, keyword research).
   * Docs: customers.generateKeywordIdeas (KeywordPlanIdeaService); istek ve
   * yanit alanlari v21 → v26 degismedi.
   *
   * Varsayilanlar: Turkiye (geoTargetConstants/2792) + Turkce (languageConstants/1037).
   * customerId/refreshToken verilmezse env'den okunur
   * (GOOGLE_ADS_CUSTOMER_ID / GOOGLE_ADS_REFRESH_TOKEN; customerId fallback = LOGIN_CUSTOMER_ID).
   *
   * NOT: OAuth istemcisinin Google Cloud projesi Explorer, Basic ya da Standard
   * erisimde olmali; Test erisimi yalniz test hesaplarina acik.
   */
  async generateKeywordIdeas(opts: {
    keywords: string[];
    refreshToken?: string;
    customerId?: string;
    geoTargetId?: string;
    languageId?: string;
  }): Promise<Array<{ keyword: string; avgMonthlySearches: number; competition: string; competitionIndex: number | null }>> {
    const refresh = opts.refreshToken ?? process.env.GOOGLE_ADS_REFRESH_TOKEN;
    const customerId = normalizeCustomerId(opts.customerId ?? process.env.GOOGLE_ADS_CUSTOMER_ID ?? process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID ?? '');
    if (!refresh) throw new Error('GOOGLE_ADS_REFRESH_TOKEN yok (Google Ads yetkilendirilmeli)');
    if (!customerId) throw new Error('Google Ads customerId yok ya da gecersiz');
    const geo = opts.geoTargetId ?? '2792';
    const lang = opts.languageId ?? '1037';
    if (!isNumericId(geo) || !isNumericId(lang)) throw new Error('Gecersiz konum/dil kimligi');

    const accessToken = await this.getAccessTokenFromRefresh(refresh);
    if (!accessToken) throw new Error('Ads access token alinamadi (OAuth client env eksik olabilir)');

    const r = await googleAdsRequest(`customers/${customerId}:generateKeywordIdeas`, {
      headers: googleAdsHeaders(accessToken, { loginCustomerId: envLoginCustomerId() }),
      body: {
        keywordSeed: { keywords: opts.keywords },
        geoTargetConstants: [`geoTargetConstants/${geo}`],
        language: `languageConstants/${lang}`,
        keywordPlanNetwork: 'GOOGLE_SEARCH',
      },
    });
    if (!r.ok) throw new Error(`generateKeywordIdeas ${describeGoogleAdsError(r.error)}`);

    return (r.data?.results ?? []).map((x: any) => ({
      keyword: x.text,
      avgMonthlySearches: Number(x.keywordIdeaMetrics?.avgMonthlySearches ?? 0),
      competition: x.keywordIdeaMetrics?.competition ?? 'UNKNOWN',
      competitionIndex: x.keywordIdeaMetrics?.competitionIndex != null ? Number(x.keywordIdeaMetrics.competitionIndex) : null,
    }));
  }

  /**
   * Mevcut kampanyalarin metriklerini cek (son 30g).
   */
  async getCampaignMetrics(siteId: string, externalId: string) {
    if (!isNumericId(externalId)) throw new Error(`Gecersiz Google kampanya kimligi: ${String(externalId).slice(0, 40)}`);
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
    // int64 alanlar (costMicros, impressions, clicks) JSON'da dize gelir
    const cost = Number(r.metrics?.costMicros ?? 0) / 1_000_000;
    const conversions = Number(r.metrics?.conversions ?? 0);
    const conversionsValue = Number(r.metrics?.conversionsValue ?? 0);
    return {
      impressions: parseInt(r.metrics?.impressions ?? '0', 10),
      clicks: parseInt(r.metrics?.clicks ?? '0', 10),
      spend: cost,
      conversions: Math.round(conversions),
      ctr: Number(r.metrics?.ctr ?? 0),
      cpc: Number(r.metrics?.averageCpc ?? 0) / 1_000_000,
      roas: cost > 0 ? conversionsValue / cost : 0,
    };
  }

  /**
   * Search terms report — son 30g, impressions > 50.
   */
  async getSearchTerms(siteId: string, externalId: string) {
    if (!isNumericId(externalId)) throw new Error(`Gecersiz Google kampanya kimligi: ${String(externalId).slice(0, 40)}`);
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
      conversions: Number(r.metrics?.conversions ?? 0),
      cost: Number(r.metrics?.costMicros ?? 0) / 1_000_000,
    }));
  }

  /**
   * Negative keyword ekle (campaign-level).
   *
   * partialFailure ile gonderilir: Google gecerli olanlari ekler, digerleri
   * icin bos sonuc doner ve HTTP yine 200'dur. Eskiden HTTP 200 "hepsi eklendi"
   * sayiliyordu; otopilot gecmisi panelde reddedilen kelimeleri de "eklendi"
   * gosteriyordu. Artik added/addedKeywords yalniz Google'in kabul ettikleri.
   */
  async addNegativeKeywords(
    siteId: string,
    externalId: string,
    keywords: string[],
  ): Promise<{ ok: boolean; added: number; addedKeywords?: string[]; error?: string }> {
    if (!isNumericId(externalId)) return { ok: false, added: 0, error: BAD_CAMPAIGN_ID };
    // Ayni kelime iki kez gonderilmez (ikincisi Google'da hata olurdu)
    const seen = new Set<string>();
    const unique = (Array.isArray(keywords) ? keywords : [])
      .map((k) => (typeof k === 'string' ? k.trim() : ''))
      .filter((k) => {
        const key = k.toLocaleLowerCase('tr-TR');
        if (!k || seen.has(key)) return false;
        seen.add(key);
        return true;
      });
    if (unique.length === 0) return { ok: false, added: 0, addedKeywords: [] };

    const ctx = await this.siteContext(siteId);
    if (!ctx.ok) return { ok: false, added: 0, error: ctx.error };

    const operations = unique.map((kw) => ({
      create: {
        campaign: `customers/${ctx.customerId}/campaigns/${externalId}`,
        negative: true,
        keyword: { text: kw, matchType: 'BROAD' },
      },
    }));

    try {
      const r = await this.mutate(ctx, 'campaignCriteria:mutate', { operations, partialFailure: true }, 'negatif anahtar kelime');
      if (!r.ok) return { ok: false, added: 0, ...(r.error ? { error: r.error } : {}) };
      const { succeeded, error } = partialFailureOutcome(r.data, operations.length);
      const addedKeywords = succeeded.map((i) => unique[i]);
      if (error) {
        this.log.warn(`[${siteId}] negatif anahtar kelime: ${addedKeywords.length}/${unique.length} eklendi; reddedilenler: ${describeGoogleAdsError(error)}`);
      }
      const reason = addedKeywords.length === 0 ? googleAdsUserReason(error) : undefined;
      return { ok: addedKeywords.length > 0, added: addedKeywords.length, addedKeywords, ...(reason ? { error: reason } : {}) };
    } catch (err: any) {
      this.log.warn(`Negative keyword add fail: ${err.message}`);
      return { ok: false, added: 0 };
    }
  }

  /**
   * Kampanya pause/enable.
   */
  async setCampaignStatus(siteId: string, externalId: string, status: 'PAUSED' | 'ENABLED'): Promise<{ ok: boolean; error?: string }> {
    if (!isNumericId(externalId)) return { ok: false, error: BAD_CAMPAIGN_ID };
    const ctx = await this.siteContext(siteId);
    if (!ctx.ok) return { ok: false, error: ctx.error };

    try {
      const r = await this.mutate(ctx, 'campaigns:mutate', {
        operations: [{
          update: {
            resourceName: `customers/${ctx.customerId}/campaigns/${externalId}`,
            status,
          },
          updateMask: 'status',
        }],
      }, `kampanya durumu (${status})`);
      return r.ok ? { ok: true } : { ok: false, ...(r.error ? { error: r.error } : {}) };
    } catch (err: any) {
      this.log.warn(`Campaign status fail: ${err.message}`);
      return { ok: false };
    }
  }

  /**
   * Reklam hesabinin para birimi (ISO 4217). customer.currency_code: "The
   * currency in which the account operates." Butce de bu birimdedir:
   * campaign_budget.amount_micros "in micros in the account's local currency"
   * (googleapis/googleapis google/ads/googleads/v23/resources/customer.proto ve
   * campaign_budget.proto; v26'da ayni). Okunamazsa null — cagiran para
   * birimine dayanan islemi (ornegin iki hesap arasinda butce kaydirma) yapmaz.
   */
  async getAccountCurrency(siteId: string): Promise<string | null> {
    try {
      const rows = await this.query(siteId, 'SELECT customer.currency_code FROM customer LIMIT 1');
      const code = rows[0]?.customer?.currencyCode;
      return typeof code === 'string' && /^[A-Z]{3}$/.test(code) ? code : null;
    } catch (err: any) {
      this.log.warn(`[${siteId}] Google Ads para birimi alinamadi: ${err?.message ?? err}`);
      return null;
    }
  }

  /**
   * Kampanyanin canli durumu ve butcesi tek GAQL sorgusunda. campaign_budget,
   * campaign'in "attributed resource"u oldugu icin ayni sorguda secilebilir;
   * amount_micros / total_amount_micros / period "Selectable with: campaign"
   * (https://developers.google.com/google-ads/api/fields/v26/campaign_budget ve
   * v26 resources/campaign_budget.proto). amount_micros "the average daily
   * amount ... in micros in the account's local currency"; total_amount_micros
   * yalniz period CUSTOM_PERIOD (toplam butce) iken kullanilir, ikisi "mutually
   * exclusive". period alani yoksa DAILY sayilir (proto: "Defaults to DAILY").
   * Durum campaign.status + campaign.serving_status ile (googleLiveStatus).
   * Satir yoksa null (kampanya bu musteride yok).
   */
  private async readCampaignBudget(ctx: { accessToken: string; customerId: string }, externalId: string): Promise<GoogleBudgetRow | null> {
    const rows = await this.searchWith(ctx,
      'SELECT campaign.status, campaign.serving_status, campaign.campaign_budget, campaign_budget.amount_micros, campaign_budget.total_amount_micros, ' +
      'campaign_budget.explicitly_shared, campaign_budget.reference_count, campaign_budget.period ' +
      `FROM campaign WHERE campaign.id = ${externalId}`);
    const row = rows[0];
    if (!row) return null;
    const rawStatus = typeof row.campaign?.status === 'string' ? row.campaign.status : 'UNKNOWN';
    // REST JSON alan adi lowerCamelCase (servingStatus); enum adi dize olarak gelir
    const servingStatus = typeof row.campaign?.servingStatus === 'string' ? row.campaign.servingStatus : 'UNKNOWN';
    const { status, platformStatus } = googleLiveStatus(rawStatus, servingStatus);
    const rn: unknown = row.campaign?.campaignBudget;
    const resourceName = isCampaignBudgetResourceName(rn, ctx.customerId) ? rn : null;
    const b = row.campaignBudget ?? {};
    const shared = b.explicitlyShared === true || Number(b.referenceCount ?? 0) > 1;
    const period = typeof b.period === 'string' ? b.period : 'DAILY';

    let budgetType: LiveCampaignBudget['budgetType'] = null;
    let amount: number | null = null;
    if (resourceName) {
      if (period === 'DAILY') {
        amount = microsToAmount(b.amountMicros);
        if (amount !== null) budgetType = shared ? 'shared' : 'daily';
      } else if (period === 'CUSTOM_PERIOD') {
        amount = microsToAmount(b.totalAmountMicros);
        if (amount !== null) budgetType = 'lifetime';
      }
    }
    return {
      resourceName,
      shared,
      period,
      live: { status, platformStatus, budgetType, amount },
    };
  }

  /** Kampanyanin canli durumu ve gunluk butcesi (otopilot her degisiklikten once okur) */
  async getLiveBudget(siteId: string, externalId: string): Promise<LiveBudgetResult> {
    if (!isNumericId(externalId)) return { ok: false, error: BAD_CAMPAIGN_ID };
    const ctx = await this.siteContext(siteId);
    if (!ctx.ok) return { ok: false, error: ctx.error };
    try {
      const row = await this.readCampaignBudget(ctx, externalId);
      if (!row) {
        this.log.warn(`[${siteId}/${externalId}] Google kampanyasi bulunamadi (canli butce okunamadi)`);
        return { ok: false };
      }
      return { ok: true, live: row.live };
    } catch (err: any) {
      this.log.warn(`[${siteId}/${externalId}] Google canli butce okunamadi: ${err?.message ?? err}`);
      return { ok: false };
    }
  }

  /**
   * Gunluk butceyi yazar — YALNIZ canli butce hala expectedCurrent ise.
   * dailyBudget ve expectedCurrent hesabin para birimindedir (mikro = tutar x
   * 1.000.000, her birimde ayni).
   *
   * expectedCurrent ZORUNLU: cagiran yeni tutari hangi canli degerden
   * hesapladiysa onu verir; yazmadan hemen once ayni sorgu yeniden okunur ve
   * deger degismisse yazilmaz (stale). Eski kod butceyi hic okumadan RanksUp'in
   * bayat kopyasindan hesaplanan MUTLAK tutari yaziyordu (canli 50 → 600).
   *
   * Butce YALNIZ bu kampanyaya ait gunluk butceyse degistirilir:
   *  - campaign_budget.explicitly_shared / reference_count > 1: paylasilan
   *    butceyi artirmak diger kampanyalarin harcamasini da artirir, oysa
   *    budget-guard tavani ve bildirim tek kampanya icindir.
   *  - campaign_budget.period != DAILY (CUSTOM_PERIOD = toplam butce):
   *    toplam butceye gunluk tutar yazilmaz.
   *  - Kaldirilmis (REMOVED) kampanyanin butcesine dokunulmaz.
   *  - ENABLED olup YAYINDA olmayan (serving_status SERVING degil: sona ermis,
   *    baslamamis, askiya alinmis) kampanyanin butcesine dokunulmaz
   *    (googleLiveStatus); duraklatilmis kampanyaya istemci duzeyinde yazilabilir.
   */
  async updateBudget(siteId: string, externalId: string, dailyBudget: number, expectedCurrent: number): Promise<BudgetWriteResult> {
    if (!isNumericId(externalId)) return { ok: false, error: BAD_CAMPAIGN_ID };
    if (!Number.isFinite(dailyBudget) || dailyBudget <= 0) return { ok: false };
    if (!Number.isFinite(expectedCurrent) || expectedCurrent <= 0) return { ok: false };
    const ctx = await this.siteContext(siteId);
    if (!ctx.ok) return { ok: false, error: ctx.error };

    try {
      // 1. Canli butceyi, turunu ve kampanya durumunu oku
      const row = await this.readCampaignBudget(ctx, externalId);
      if (!row || !row.resourceName) {
        this.log.warn(`[${siteId}/${externalId}] Google butce bulunamadi`);
        return { ok: false };
      }
      if (row.live.status !== 'ACTIVE' && row.live.status !== 'PAUSED') {
        // REMOVED ve yayin durumu (serving_status) kesin neden; bilinmeyen
        // durumda (UNKNOWN) da yazilmaz ama nedeni iddia edilmez
        this.log.log(`[${siteId}/${externalId}] Google kampanyasi ${row.live.platformStatus}; butce degistirilmedi`);
        if (row.live.status === 'ENDED') return { ok: false, error: CAMPAIGN_REMOVED };
        const serving = row.live.platformStatus.startsWith('ENABLED/') ? row.live.platformStatus.slice('ENABLED/'.length) : '';
        const label = GOOGLE_NOT_SERVING_LABEL.get(serving);
        return label
          ? { ok: false, error: `Google Ads kampanyanın yayında olmadığını bildiriyor (yayın durumu: ${label}); bütçesi değiştirilmedi.` }
          : { ok: false };
      }
      if (row.shared) {
        this.log.log(`[${siteId}/${externalId}] Google butcesi paylasimli; degistirilmedi`);
        return { ok: false, error: BUDGET_SHARED };
      }
      if (row.period !== 'DAILY') {
        this.log.log(`[${siteId}/${externalId}] Google butcesi gunluk degil (${row.period}); degistirilmedi`);
        return { ok: false, error: BUDGET_NOT_DAILY };
      }
      const live = row.live.amount;
      if (live === null) {
        this.log.warn(`[${siteId}/${externalId}] Google gunluk butce tutari okunamadi; degistirilmedi`);
        return { ok: false };
      }
      if (!sameBudget(live, expectedCurrent)) {
        this.log.warn(`[${siteId}/${externalId}] Google butcesi ${expectedCurrent} beklenirken ${live}; yazilmadi`);
        return { ok: false, stale: true, live, error: BUDGET_STALE };
      }

      // 2. Butceyi guncelle (micros)
      const micros = Math.round(dailyBudget * 1_000_000);
      const r = await this.mutate(ctx, 'campaignBudgets:mutate', {
        operations: [{
          update: { resourceName: row.resourceName, amountMicros: String(micros) },
          updateMask: 'amount_micros',
        }],
      }, 'butce');
      if (r.ok) return { ok: true, applied: micros / 1_000_000 };
      // httpStatus 0: istek gitti mi bilinmiyor (zaman asimi / ag hatasi) → sonuc belirsiz
      return { ok: false, ...(r.error ? { error: r.error } : {}), ...(r.info.httpStatus === 0 ? { uncertain: true } : {}) };
    } catch (err: any) {
      this.log.warn(`Google budget update fail: ${err.message}`);
      return { ok: false };
    }
  }

  // ────────────────────────────────────────────────────────────────
  // Faz 11.3 — Campaign Creation API
  // (Panelden cagrilmiyor: kampanya kurulumu 0db5a1c'de kaldirildi.)
  // ────────────────────────────────────────────────────────────────

  /**
   * End-to-end kampanya olusturur:
   *   1. campaign_budget create (daily, micros)
   *   2. campaign create (SEARCH, MAXIMIZE_CONVERSIONS bidding, AB siyasi reklam beyani)
   *   3. ad_group create
   *   4. ad_group_ad create (Responsive Search Ad — 15 headline + 4 description)
   *   5. ad_group_criterion create (keywords) + campaign_criterion (geo + language)
   *
   * containsEuPoliticalAdvertising ZORUNLU: v21'den beri Google beyansiz yeni
   * kampanyayi FieldError.REQUIRED ile reddeder (v26'da muafiyet yalniz AB
   * disini hedefleyen kampanyalar icin; burada konum hedeflemesi kampanyadan
   * SONRA eklendigi icin olusturma aninda muafiyet yok). Beyan reklam verenin
   * yasal oz beyanidir; varsayilan verilmez, cagiran musteriden almalidir.
   * Kaynak: google-ads-api.ts EU_POLITICAL_ADVERTISING notu.
   *
   * Donus: campaignId (resourceName'in son segmenti)
   */
  async createCampaign(siteId: string, payload: {
    name: string;
    dailyBudget: number;      // reklam hesabinin para biriminde
    headlines: string[];      // up to 15
    descriptions: string[];   // up to 4
    finalUrl: string;
    containsEuPoliticalAdvertising: boolean;
    keywords?: string[];      // broad match
    locationIds?: number[];   // geo target constants e.g. [2792] = Turkey
    languageIds?: number[];   // e.g. [1037] = Turkish
  }): Promise<{ ok: boolean; campaignId?: string; error?: string }> {
    if (typeof payload?.containsEuPoliticalAdvertising !== 'boolean') {
      return { ok: false, error: 'AB siyasi reklam beyanı zorunlu (containsEuPoliticalAdvertising)' };
    }
    if (!Number.isFinite(payload.dailyBudget) || payload.dailyBudget <= 0) {
      return { ok: false, error: 'Günlük bütçe pozitif bir sayı olmalı' };
    }
    const ctx = await this.siteContext(siteId);
    if (!ctx.ok) return { ok: false, error: ctx.error };
    const { customerId } = ctx;

    const step = async (resourcePath: string, body: unknown, label: string): Promise<any> => {
      const r = await googleAdsRequest(`customers/${customerId}/${resourcePath}`, {
        headers: googleAdsHeaders(ctx.accessToken, { loginCustomerId: envLoginCustomerId() }),
        body,
      });
      if (!r.ok) throw new Error(`${label} ${describeGoogleAdsError(r.error)}`);
      return r.data;
    };

    try {
      // 1) Budget
      const budgetMicros = Math.round(payload.dailyBudget * 1_000_000);
      const budgetData = await step('campaignBudgets:mutate', {
        operations: [{
          create: {
            name: `${payload.name} - Budget - ${Date.now()}`,
            amountMicros: String(budgetMicros),
            deliveryMethod: 'STANDARD',
          },
        }],
      }, 'budget');
      const budgetResourceName: string = budgetData.results[0].resourceName;

      // 2) Campaign
      const campaignData = await step('campaigns:mutate', {
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
            containsEuPoliticalAdvertising: payload.containsEuPoliticalAdvertising
              ? EU_POLITICAL_ADVERTISING.CONTAINS
              : EU_POLITICAL_ADVERTISING.DOES_NOT_CONTAIN,
          },
        }],
      }, 'campaign');
      const campaignResourceName: string = campaignData.results[0].resourceName;
      const campaignId = campaignResourceName.split('/').pop()!;

      // 3) Ad group
      const adGroupData = await step('adGroups:mutate', {
        operations: [{
          create: {
            name: `${payload.name} - AdGroup`,
            campaign: campaignResourceName,
            type: 'SEARCH_STANDARD',
            status: 'ENABLED',
            cpcBidMicros: '1000000', // 1 birim (hesap para birimi); MAXIMIZE_CONVERSIONS teklifi kendisi belirler
          },
        }],
      }, 'adgroup');
      const adGroupResourceName: string = adGroupData.results[0].resourceName;

      // 4) Responsive Search Ad
      const headlineAssets = payload.headlines.slice(0, 15).map((h) => ({ text: h.slice(0, 30) }));
      const descAssets = payload.descriptions.slice(0, 4).map((d) => ({ text: d.slice(0, 90) }));
      while (headlineAssets.length < 3) headlineAssets.push({ text: payload.name.slice(0, 30) });
      while (descAssets.length < 2) descAssets.push({ text: payload.name.slice(0, 90) });

      await step('adGroupAds:mutate', {
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
      }, 'ad');

      // 5) Keywords (ad_group_criterion) — kismi basari loglanir
      if (payload.keywords && payload.keywords.length > 0) {
        const kwOps = payload.keywords.slice(0, 50).map((kw) => ({
          create: {
            adGroup: adGroupResourceName,
            status: 'ENABLED',
            keyword: { text: kw, matchType: 'BROAD' },
          },
        }));
        const kwData = await step('adGroupCriteria:mutate', { operations: kwOps, partialFailure: true }, 'keywords');
        const kw = partialFailureOutcome(kwData, kwOps.length);
        if (kw.error) this.log.warn(`[${siteId}] kampanya ${campaignId}: ${kw.succeeded.length}/${kwOps.length} anahtar kelime eklendi; ${describeGoogleAdsError(kw.error)}`);
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
        const critData = await step('campaignCriteria:mutate', { operations: campaignCriteriaOps, partialFailure: true }, 'targeting');
        const crit = partialFailureOutcome(critData, campaignCriteriaOps.length);
        if (crit.error) this.log.warn(`[${siteId}] kampanya ${campaignId}: ${crit.succeeded.length}/${campaignCriteriaOps.length} hedefleme eklendi; ${describeGoogleAdsError(crit.error)}`);
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
   * A/B adimi icin kampanyadaki ETKIN reklamlarin son 7 gunluk metrikleri,
   * reklam grubu ve yayin uygunluguyla (AdVariant, ads-client.service.ts).
   * Kimlik/kaynak adi eksik ya da tutarsiz satir varsa null: yanit guvenilmez,
   * A/B o kampanyada hicbir sey yapmaz. GAQL hatasi firlar (ads-client yakalar).
   *
   * NEDEN: eski sorgu reklam grubunu secmiyor, reklam grubunun ve kampanyanin
   * durumuna bakmiyordu. A/B tum kampanyadaki reklamlari tek havuzda siraliyor,
   * baska reklam gruplarinin TEK reklamini duraklatip o gruplari yayindan
   * dusuruyordu; musterinin duraklattigi reklam grubundaki (reklami hala
   * ENABLED) bir reklam da kazanan secilip yayindaki reklamlar duraklatiliyordu.
   *
   * Alanlar v26'da iki kaynakla dogrulandi — resmi alan referansi
   * (https://developers.google.com/google-ads/api/fields/v26/ad_group_ad,
   * .../fields/v26/ad_group, .../fields/v26/campaign) ve googleapis/googleapis
   * google/ads/googleads/v26 resources/ad_group_ad.proto, resources/ad_group.proto,
   * enums/ad_group_ad_primary_status(_reason).proto, enums/ad_type.proto,
   * enums/advertising_channel_type.proto, common/metrics.proto:
   *  - ad_group, campaign ve customer ad_group_ad'in "Attributed resources"u:
   *    alanlari ayni SELECT'te secilebilir ve metrikleri bolmez. ad_group.id
   *    INT64 (JSON'da dize), ad_group.status ENABLED / PAUSED / REMOVED.
   *  - ad_group_ad.primary_status: "Provides aggregated view into why an ad
   *    group ad is not serving or not serving optimally"; ELIGIBLE "The ad group
   *    ad is eligible to serve". Kampanya ya da reklam grubu duraklatilmis,
   *    reklam reddedilmis / incelemede / sinirli ise ELIGIBLE olmaz.
   *  - ad_group_ad.ad.type: yalniz arama metin reklamlari (RESPONSIVE_SEARCH_AD,
   *    EXPANDED_TEXT_AD); arama reklamiyla CALL_AD ya da dinamik arama reklaminin
   *    tiklama orani ayni seyi olcmez.
   *  - campaign.advertising_channel_type: yalniz SEARCH; goruntulu / video
   *    kampanyasinda tiklama orani kampanyanin hedefi degil.
   *  - metrics.conversions / conversions_value: "This only includes conversion
   *    actions which include_in_conversions_metric attribute is set to true. If
   *    you use conversion-based bidding, your bid strategies will optimize for
   *    these conversions." A/B gosterim basina daha cok donusum getireni
   *    duraklatmaz (ab-test-manager).
   * Uygunluk WHERE'de degil kodda denetlenir: alan gelmezse ya da beklenen deger
   * degilse reklam eligible olmaz. ad_group_ad.status WHERE'de de kalir:
   * duraklatilmis reklamlar her turda yeniden okunmasin.
   */
  async getAdVariantMetrics(siteId: string, campaignExternalId: string): Promise<AdVariant[] | null> {
    if (!isNumericId(campaignExternalId)) throw new Error(`Gecersiz Google kampanya kimligi: ${String(campaignExternalId).slice(0, 40)}`);
    const ctx = await this.siteContext(siteId);
    if (!ctx.ok) throw new Error(ctx.error);
    const gaql = `
      SELECT
        campaign.advertising_channel_type,
        ad_group.id, ad_group.name, ad_group.status,
        ad_group_ad.resource_name, ad_group_ad.ad.id, ad_group_ad.ad.type,
        ad_group_ad.status, ad_group_ad.primary_status,
        metrics.impressions, metrics.clicks,
        metrics.conversions, metrics.conversions_value
      FROM ad_group_ad
      WHERE campaign.id = ${campaignExternalId}
        AND ad_group_ad.status = 'ENABLED'
        AND segments.date DURING LAST_7_DAYS
    `;
    const rows = await this.searchWith(ctx, gaql);
    const out: AdVariant[] = [];
    for (const r of rows) {
      const target: unknown = r?.adGroupAd?.resourceName;
      const adId: unknown = r?.adGroupAd?.ad?.id;
      const groupId: unknown = r?.adGroup?.id;
      // Kaynak adi bu musterinin reklami olmali ve icindeki grup~reklam kimlikleri satirla ayni
      if (
        !isAdGroupAdResourceName(target, ctx.customerId)
        || typeof adId !== 'string' || !isNumericId(adId)
        || typeof groupId !== 'string' || !isNumericId(groupId)
        || !target.endsWith(`/adGroupAds/${groupId}~${adId}`)
      ) {
        this.log.warn(`[${siteId}/${campaignExternalId}] A/B: beklenmeyen reklam satiri (${String(target).slice(0, 80)}); kampanya atlandi`);
        return null;
      }
      const eligible =
        r.campaign?.advertisingChannelType === 'SEARCH'
        && r.adGroup?.status === 'ENABLED'
        && r.adGroupAd?.status === 'ENABLED'
        && r.adGroupAd?.primaryStatus === 'ELIGIBLE'
        && GOOGLE_AB_AD_TYPES.has(r.adGroupAd?.ad?.type);
      out.push({
        adId,
        target,
        groupId,
        groupName: typeof r.adGroup?.name === 'string' ? r.adGroup.name.slice(0, 120) : '',
        eligible,
        impressions: countOrNull(r.metrics?.impressions),
        clicks: countOrNull(r.metrics?.clicks),
        conversions: amountOrNull(r.metrics?.conversions),
        conversionValue: amountOrNull(r.metrics?.conversionsValue),
      });
    }
    return out;
  }

  /**
   * Tek bir ad'i pause/enable et. Kaynak adi bu musterinin reklami olmali
   * (customers/{cid}/adGroupAds/{ad_group}~{ad}).
   *
   * uncertain: istek gitti ama sonucu bilinmiyor — yanit yok (zaman asimi / ag
   * hatasi, httpStatus 0), 5xx ya da 2xx ama okunamayan govde. A/B bu reklami
   * "duraklatilmis olabilir" sayar, bir daha dokunmaz ve gecmise
   * "doğrulanamadı" yazar ("duraklatılamadı" yanlis olabilirdi).
   */
  async setAdStatus(siteId: string, adResourceName: string, status: 'PAUSED' | 'ENABLED'): Promise<AdStatusWriteResult> {
    const ctx = await this.siteContext(siteId);
    if (!ctx.ok) return { ok: false, error: ctx.error };
    if (!isAdGroupAdResourceName(adResourceName, ctx.customerId)) {
      this.log.warn(`[${siteId}] gecersiz reklam kaynak adi: ${String(adResourceName).slice(0, 80)}`);
      return { ok: false };
    }
    try {
      const r = await this.mutate(ctx, 'adGroupAds:mutate', {
        operations: [{
          update: { resourceName: adResourceName, status },
          updateMask: 'status',
        }],
      }, `reklam durumu (${status})`);
      if (r.ok) return { ok: true };
      const h = r.info.httpStatus;
      const uncertain = h === 0 || h >= 500 || (h >= 200 && h < 300);
      return { ok: false, ...(r.error ? { error: r.error } : {}), ...(uncertain ? { uncertain: true } : {}) };
    } catch (err: any) {
      // Istegin gidip gitmedigi bilinmiyor
      this.log.warn(`Google ad status fail: ${err.message}`);
      return { ok: false, uncertain: true };
    }
  }

  private tryDecrypt(token: string): string {
    try { return decrypt(token); } catch { return token; }
  }
}
