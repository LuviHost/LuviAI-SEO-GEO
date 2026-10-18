import { Logger } from '@nestjs/common';
import {
  AsaHttp,
  fetchAppleAccessToken,
  type AsaClientDeps,
  type AsaCredentials,
} from './asa-http.js';
import {
  AsaApiError,
  normalizeKeywordStatus,
  normalizeMetrics,
  normalizeReportDate,
  parseAmount,
  toApiId,
  toAppleDateTime,
  toStr,
  toStrArray,
  type AsaAccessToken,
  type AsaAccountInfo,
  type AsaAdGroup,
  type AsaAdsClient,
  type AsaCampaign,
  type AsaCampaignDailyRow,
  type AsaCreateAdGroupInput,
  type AsaCreateCampaignInput,
  type AsaDateRange,
  type AsaImpressionShareQuery,
  type AsaImpressionShareRow,
  type AsaKeyword,
  type AsaKeywordCreateResult,
  type AsaKeywordInput,
  type AsaKeywordReportRow,
  type AsaKeywordUpdate,
  type AsaPopularityQuery,
  type AsaSearchTermPopularityRow,
  type AsaSearchTermRow,
  type AsaServingPrep,
} from './asa-types.js';

/**
 * Apple Ads Platform API istemcisi (AsaAdsClient adaptoru)
 * ========================================================
 *
 * v5'in yerini alan API (1.0, Agustos 2026). Kok dokuman:
 *   https://developer.apple.com/documentation/apple-ads-platform-api
 * Uc yollari ve alan adlari ayrica Apple'in urettigi Node istemcisiyle
 * (github.com/apple/apple-ads-platform-api-node, src/api/apple-ads-api.ts)
 * karsilastirildi.
 *
 * v5 → Platform eslemesi (bu sinifin uyguladigi):
 *   GET  /acls                                  → GET  /v1/acls (+ GET /v1/ad-accounts/{id})
 *   X-AP-Context: orgId=…                       → X-AP-Context: adAccountId=…
 *   GET  /campaigns                             → POST /v1/campaigns/query
 *   POST /campaigns                             → POST /v1/campaigns (dailyBudget.value, targeting, bidStrategy)
 *   POST /campaigns/{c}/adgroups                → POST /v1/adgroups (pricingModel CPT, bidStrategy.bid)
 *   POST …/targetingkeywords/bulk               → POST /v1/keywords/bulk-create (items + correlationId)
 *   GET  …/targetingkeywords                    → POST /v1/keywords/query (adGroupId filtresi)
 *   PUT  …/targetingkeywords/bulk               → PUT  /v1/keywords/{id} (yalniz bid + status)
 *   POST /reports/campaigns                     → POST /v1/reports/apps/campaigns/query
 *   POST /reports/campaigns/{c}/keywords        → POST /v1/reports/apps/keywords/query (campaignId filtresi zorunlu)
 *   POST /reports/campaigns/{c}/…/searchterms   → POST /v1/reports/apps/searchterms/query (yalniz ORTZ)
 *   (yok)                                       → POST /v1/insights/apps/search-term-popularity/query
 *   (v5'te asenkron ozel rapor)                 → POST /v1/insights/apps/impression-share/query
 *
 * Sozluk farklari normalize edilir: anahtar kelime durumu ENABLED → ACTIVE (DB
 * v5 sozlugunu tutar), ad group pricingModel CPC → CPT, defaultBidAmount →
 * bidStrategy.bid, kampanyada omur boyu butce yok.
 *
 * Reklam hesabi: Platform'da bir org altinda birden fazla ad account olabilir.
 * Kimlik /v1/acls'ten cozulur; App Store yetkili (APPSTORE_APP_MANUAL) en kucuk
 * id secilir ve onAdAccountResolved ile kalici yazilir — secim her calismada
 * degisirse senkron baska hesabin kampanyalarini "silinmis" sayardi.
 */

const PLATFORM_API_BASE = 'https://api.ads.apple.com/v1';
const QUERY_PAGE_SIZE = 1000; // /campaigns/query pageSize ust siniri 1000
const MAX_PAGES = 50;
const log = new Logger('AsaPlatformClient');

export interface AsaPlatformOptions extends AsaClientDeps {
  /** Daha once cozulup saklanmis reklam hesabi kimligi */
  adAccountId?: string | null;
  /** Ilk cozumlemede cagrilir — cagiran kalici yazar */
  onAdAccountResolved?: (adAccountId: string) => void | Promise<void>;
}

export function normalizePlatformCampaign(c: any): AsaCampaign {
  const promotedApp = c?.promotedObjectType === undefined || c?.promotedObjectType === 'APPSTORE_APP';
  return {
    id: String(c?.id),
    name: c?.name ?? '',
    status: c?.status ?? 'ENABLED',
    displayStatus: toStr(c?.displayStatus),
    dailyBudget: parseAmount(c?.dailyBudget?.value),
    totalBudget: null,
    currency: toStr(c?.dailyBudget?.value?.currency),
    countriesOrRegions: toStrArray(c?.targeting?.countryOrRegion?.include),
    supplySources: toStrArray(c?.targeting?.supplyPlacement?.include),
    adamId: promotedApp && c?.promotedObjectId !== undefined && c?.promotedObjectId !== null ? String(c.promotedObjectId) : null,
    deleted: c?.deleted === true || c?.displayStatus === 'DELETED',
  };
}

export function normalizePlatformKeyword(k: any): AsaKeyword {
  return {
    id: String(k?.id),
    adGroupId: toStr(k?.adGroupId),
    campaignId: toStr(k?.campaignId),
    text: k?.text ?? '',
    matchType: k?.matchType ?? 'EXACT',
    bid: parseAmount(k?.bid),
    status: normalizeKeywordStatus(k?.status),
    deleted: k?.deleted === true,
  };
}

function rowsOf(body: any): any[] {
  if (Array.isArray(body?.result)) return body.result;
  if (Array.isArray(body?.result?.rows)) return body.result.rows;
  return [];
}

export class AsaPlatformClient implements AsaAdsClient {
  readonly version = 'platform' as const;
  private cachedToken: AsaAccessToken | null = null;
  private cachedAccount: AsaAccountInfo | null = null;
  private presetAdAccountId: string | null;
  private readonly onAdAccountResolved?: (adAccountId: string) => void | Promise<void>;
  private readonly http: AsaHttp;
  private readonly deps: AsaClientDeps;

  constructor(private readonly creds: AsaCredentials, opts: AsaPlatformOptions = {}) {
    const { adAccountId, onAdAccountResolved, ...deps } = opts;
    this.deps = deps;
    this.presetAdAccountId = adAccountId ? String(adAccountId) : null;
    this.onAdAccountResolved = onAdAccountResolved;
    this.http = new AsaHttp('platform', deps);
  }

  async getAccessToken(forceRefresh = false): Promise<AsaAccessToken> {
    const now = (this.deps.now ?? Date.now)();
    if (!forceRefresh && this.cachedToken && this.cachedToken.expiresAt.getTime() - now > 60_000) {
      return this.cachedToken;
    }
    this.cachedToken = await fetchAppleAccessToken(this.creds, 'platform', this.deps);
    return this.cachedToken;
  }

  private async token(force: boolean): Promise<string> {
    return (await this.getAccessToken(force)).accessToken;
  }

  /** Hesap baglami gerektirmeyen cagrilar (/acls, /me). */
  private async callNoContext<T>(path: string): Promise<T> {
    return this.http.send<T>({ method: 'GET', url: `${PLATFORM_API_BASE}${path}`, path, idempotent: true }, (f) => this.token(f));
  }

  private async callWithContext<T>(
    adAccountId: string,
    method: 'GET' | 'POST' | 'PUT' | 'DELETE',
    path: string,
    body: unknown,
    idempotent: boolean,
  ): Promise<T> {
    return this.http.send<T>(
      {
        method,
        url: `${PLATFORM_API_BASE}${path}`,
        path,
        headers: { 'X-AP-Context': `adAccountId=${adAccountId}` },
        body,
        idempotent,
      },
      (f) => this.token(f),
    );
  }

  private async call<T>(method: 'GET' | 'POST' | 'PUT' | 'DELETE', path: string, body: unknown, idempotent: boolean): Promise<T> {
    const { contextId } = await this.getAccountInfo();
    return this.callWithContext<T>(contextId, method, path, body, idempotent);
  }

  /**
   * Reklam hesabini coz. Kayitli kimlik varsa onu kullanir ve erisilemiyorsa
   * SESSIZCE baska hesaba gecmez (hata doner) — yeniden baglanti kimligi tazeler.
   */
  async getAccountInfo(): Promise<AsaAccountInfo> {
    if (this.cachedAccount) return this.cachedAccount;

    if (this.presetAdAccountId) {
      const acc = await this.callWithContext<any>(
        this.presetAdAccountId,
        'GET',
        `/ad-accounts/${this.presetAdAccountId}`,
        undefined,
        true,
      );
      const r = acc?.result ?? {};
      this.cachedAccount = {
        contextId: this.presetAdAccountId,
        name: toStr(r.name),
        currency: toStr(r.currency),
        orgId: toStr(r.orgId),
      };
      return this.cachedAccount;
    }

    const aclBody = await this.callNoContext<any>('/acls');
    const acls: any[] = Array.isArray(aclBody?.result?.acls) ? aclBody.result.acls : [];
    // Kararli secim: int64 kimlikler sayisal sirayla (soldan sifir dolgulu string karsilastirma)
    const sortKey = (id: unknown) => String(id).padStart(24, '0');
    const candidates = acls
      .map((a) => a?.adAccount)
      .filter((a) => a && a.id !== undefined && a.id !== null)
      .sort((a, b) => sortKey(a.id).localeCompare(sortKey(b.id)));
    if (candidates.length === 0) {
      throw new AsaApiError('Bu API anahtarının erişebildiği bir Apple Ads reklam hesabı yok.', {
        kind: 'config',
        apiVersion: 'platform',
      });
    }

    type Candidate = { id: string; name: string | null; currency: string | null; orgId: string | null };
    let chosen: Candidate | null = null;
    let unknownFeatures: Candidate | null = null;
    for (const cand of candidates) {
      const id = String(cand.id);
      // Ayrinti alinamazsa DUR: eksik bilgiyle yapilan secim kalici yazilip
      // sonraki kosularda baska hesaba kaymaya yol acardi
      const detail = await this.callWithContext<any>(id, 'GET', `/ad-accounts/${id}`, undefined, true);
      const r = detail?.result;
      const info = {
        id,
        name: toStr(r?.name ?? cand.name),
        currency: toStr(r?.currency),
        orgId: toStr(r?.orgId ?? cand.orgId),
      };
      const features = toStrArray(r?.productFeatures);
      if (features.includes('APPSTORE_APP_MANUAL')) {
        chosen = info;
        break;
      }
      if (features.length === 0 && !unknownFeatures) unknownFeatures = info;
    }
    chosen = chosen ?? unknownFeatures;
    if (!chosen) {
      throw new AsaApiError(
        'Bu API anahtarının erişebildiği reklam hesaplarında App Store reklam yetkisi (APPSTORE_APP_MANUAL) yok.',
        { kind: 'config', apiVersion: 'platform' },
      );
    }

    this.cachedAccount = { contextId: chosen.id, name: chosen.name, currency: chosen.currency, orgId: chosen.orgId };
    this.presetAdAccountId = chosen.id;
    if (this.onAdAccountResolved) await this.onAdAccountResolved(chosen.id);
    return this.cachedAccount;
  }

  // ─── Kampanyalar ─────────────────────────────────────

  /**
   * Tum kampanyalar + Apple'da silinmis olanlar. Platform silinmisleri yalnizca
   * filtreyle doner ("It returns deleted entities only when the filters specify
   * them"); v5 ise listede deleted=true ile verir. Ikisi ayni davransin diye
   * silinmisler ayrica sorgulanir — servis bunlari DELETED isaretler, performans
   * gecmisi korunur. Bu ikinci sorgu basarisiz olursa eski davranisa (yalniz
   * canli kampanyalar) duser.
   *   https://developer.apple.com/documentation/apple-ads-platform-api/post-campaigns-query
   */
  async listCampaigns(): Promise<AsaCampaign[]> {
    const live = await this.queryCampaigns(undefined);
    let deleted: AsaCampaign[] = [];
    try {
      deleted = await this.queryCampaigns([{ field: 'deleted', operator: 'EQUALS', value: true }]);
    } catch (err: any) {
      // Gecici hata (429/5xx/ag) → senkron dussun, sonra tekrar denensin; yoksa
      // silinmisler "yetim" sayilip performans gecmisiyle birlikte silinirdi.
      // Yalniz filtre reddedilirse (dogrulama hatasi) canli listeyle devam.
      if (!(err instanceof AsaApiError) || err.kind !== 'validation') throw err;
      log.warn(`silinmiş kampanya filtresi reddedildi, yalnız canlı kampanyalar dönüyor: ${err.message}`);
    }
    const seen = new Set(live.map((c) => c.id));
    return [...live, ...deleted.filter((c) => !seen.has(c.id)).map((c) => ({ ...c, deleted: true }))];
  }

  private async queryCampaigns(filters: Array<Record<string, unknown>> | undefined): Promise<AsaCampaign[]> {
    const out: AsaCampaign[] = [];
    for (let page = 0; page < MAX_PAGES; page++) {
      const offset = page * QUERY_PAGE_SIZE;
      const body = await this.call<any>(
        'POST',
        '/campaigns/query',
        { ...(filters ? { filters } : {}), pagination: { offset, pageSize: QUERY_PAGE_SIZE, fetchTotalCount: true } },
        true,
      );
      const rows = rowsOf(body);
      // Apple Maps (BUSINESS_BRAND) kampanyalari RanksUp ASO kapsami disinda
      out.push(...rows.filter((c) => !c?.promotedObjectType || c.promotedObjectType === 'APPSTORE_APP').map(normalizePlatformCampaign));
      const total = Number(body?.pagination?.totalCount);
      if (rows.length < QUERY_PAGE_SIZE || (Number.isFinite(total) && offset + rows.length >= total)) break;
    }
    return out;
  }

  /**
   * App Store arama sonucu kampanyasi. endTime gonderilmez: CampaignCreate
   * semasinda opsiyonel ("Omit to keep the campaign running indefinitely");
   * Apple Node istemcisinin modelinde de `endTime?: string | null`.
   *   https://developer.apple.com/documentation/apple-ads-platform-api/campaigncreate
   */
  async createCampaign(input: AsaCreateCampaignInput): Promise<AsaCampaign> {
    const { contextId } = await this.getAccountInfo();
    const body = {
      name: input.name,
      adAccountId: toApiId(contextId),
      billingEvent: 'TAPS',
      promotedObjectType: 'APPSTORE_APP',
      promotedObjectId: String(input.adamId),
      status: 'ENABLED',
      dailyBudget: { value: input.dailyBudget },
      targeting: {
        supplySource: { include: ['APPSTORE'] },
        supplyPlacement: { include: input.supplySources ?? ['APPSTORE_SEARCH_RESULTS'] },
        countryOrRegion: { include: input.countriesOrRegions },
      },
      // Kampanya olustururken tur + hedef cifti zorunlu (MANUAL_CPT ↔ TAP)
      bidStrategy: { bidStrategyType: 'MANUAL_CPT', bidStrategyGoal: 'TAP' },
    };
    const res = await this.callWithContext<any>(contextId, 'POST', '/campaigns', body, false);
    return normalizePlatformCampaign(res?.result ?? {});
  }

  /** Ad group: pricingModel CPT (TAPS faturalamasiyla eslesmeli), varsayilan teklif bidStrategy.bid. */
  async createAdGroup(campaignId: string, input: AsaCreateAdGroupInput): Promise<AsaAdGroup> {
    const body: Record<string, unknown> = {
      name: input.name,
      campaignId: toApiId(campaignId),
      pricingModel: 'CPT',
      // AdGroupCreate.status icin varsayilan uygulanmiyor → acikca gonder
      status: 'ENABLED',
      automatedKeywordsOptIn: false,
      bidStrategy: { bidStrategyType: 'MANUAL_CPT', bidStrategyGoal: 'TAP', bid: input.defaultBid },
    };
    // startTime opsiyonel; verilirse Apple bicimi
    if (input.startTime) body.startTime = toAppleDateTime(input.startTime);
    const res = await this.call<any>('POST', '/adgroups', body, false);
    const g = res?.result ?? {};
    return {
      id: String(g.id),
      campaignId: String(g.campaignId ?? campaignId),
      name: g.name ?? input.name,
      defaultBid: parseAmount(g.bidStrategy?.bid),
      status: g.status ?? 'ENABLED',
    };
  }

  // ─── Anahtar kelimeler ───────────────────────────────

  /** Toplu ekleme (kismi basari acik): her kalemin sonucu correlationId ile eslenir. */
  async addTargetingKeywords(_campaignId: string, adGroupId: string, keywords: AsaKeywordInput[]): Promise<AsaKeywordCreateResult> {
    const created: AsaKeyword[] = [];
    const failed: Array<{ text: string; reason: string }> = [];
    for (let i = 0; i < keywords.length; i += 100) {
      const chunk = keywords.slice(i, i + 100);
      const res = await this.call<any>(
        'POST',
        '/keywords/bulk-create',
        {
          allowPartialSuccess: true,
          items: chunk.map((k, idx) => ({
            correlationId: idx,
            data: { adGroupId: toApiId(adGroupId), text: k.text, matchType: k.matchType, bid: k.bid, status: 'ENABLED' },
          })),
        },
        false,
      );
      const results: any[] = Array.isArray(res?.result) ? res.result : [];
      if (results.length === 0 && res?.error) {
        const msg = res.error.message ?? res.error.code ?? 'toplu ekleme reddedildi';
        throw new AsaApiError(`ASA POST /keywords/bulk-create → 200: ${String(msg).slice(0, 300)}`, {
          kind: 'validation',
          status: 200,
          codes: res.error.code ? [String(res.error.code)] : [],
          apiVersion: 'platform',
        });
      }
      const seen = new Set<number>();
      for (const item of results) {
        const idx = Number(item?.correlationId);
        const input = chunk[idx];
        if (!input) continue;
        seen.add(idx);
        if (item?.success && item?.result?.id !== undefined && item?.result?.id !== null) {
          created.push(normalizePlatformKeyword(item.result));
        } else {
          const reason = item?.error?.message ?? item?.error?.code ?? 'Apple bu anahtar kelimeyi kabul etmedi';
          failed.push({ text: input.text, reason: String(reason).slice(0, 200) });
        }
      }
      chunk.forEach((k, idx) => {
        if (!seen.has(idx)) failed.push({ text: k.text, reason: 'Apple bu anahtar kelime için sonuç döndürmedi' });
      });
    }
    return { created, failed };
  }

  async listTargetingKeywords(_campaignId: string, adGroupId: string): Promise<AsaKeyword[]> {
    const out: AsaKeyword[] = [];
    for (let page = 0; page < MAX_PAGES; page++) {
      const offset = page * QUERY_PAGE_SIZE;
      const body = await this.call<any>(
        'POST',
        '/keywords/query',
        {
          filters: [{ field: 'adGroupId', operator: 'EQUALS', value: toApiId(adGroupId) }],
          pagination: { offset, pageSize: QUERY_PAGE_SIZE, fetchTotalCount: true },
        },
        true,
      );
      const rows = rowsOf(body);
      out.push(...rows.map(normalizePlatformKeyword));
      const total = Number(body?.pagination?.totalCount);
      if (rows.length < QUERY_PAGE_SIZE || (Number.isFinite(total) && offset + rows.length >= total)) break;
    }
    return out;
  }

  /** KeywordUpdate yalnizca bid + status kabul eder; bid null olamaz. */
  async updateTargetingKeyword(_campaignId: string, _adGroupId: string, keywordId: string, update: AsaKeywordUpdate): Promise<AsaKeyword | null> {
    const body: Record<string, unknown> = {};
    if (update.bid) body.bid = update.bid;
    if (update.status) body.status = update.status === 'ACTIVE' ? 'ENABLED' : update.status;
    const res = await this.call<any>('PUT', `/keywords/${keywordId}`, body, true);
    return res?.result ? normalizePlatformKeyword(res.result) : null;
  }

  /**
   * Platform'da reklam (ad) sunum birimidir: ad group'a varsayilan urun sayfasi
   * creative'i baglanmadan yayin yapilmaz. Resmi App Store yolculugunda adim
   * "Create a Creative and an Ad" (DEFAULT_PRODUCT_PAGE).
   *   https://developer.apple.com/documentation/apple-ads-platform-api/journey-app-store-ads
   * Ad group'ta zaten ENABLED reklam varsa (tek bir tanesi ENABLED olabilir)
   * yenisi acilmaz; ayni app icin creative varsa yeniden kullanilir.
   */
  async prepareAdGroupForServing(_campaignId: string, adGroupId: string, adamId: string): Promise<AsaServingPrep> {
    const ads = await this.call<any>(
      'POST',
      '/ads/query',
      { filters: [{ field: 'adGroupId', operator: 'EQUALS', value: toApiId(adGroupId) }], pagination: { offset: 0, pageSize: 50 } },
      true,
    );
    const live = rowsOf(ads).find((a) => a?.status === 'ENABLED' && a?.deleted !== true);
    if (live?.id !== undefined) return { adId: String(live.id), created: false };

    const creatives = await this.call<any>(
      'POST',
      '/creatives/query',
      {
        filters: [{ field: 'creativeType', operator: 'EQUALS', value: 'DEFAULT_PRODUCT_PAGE' }],
        pagination: { offset: 0, pageSize: QUERY_PAGE_SIZE },
      },
      true,
    );
    let creativeId: string | null = null;
    const reusable = rowsOf(creatives).find(
      (c) =>
        c?.deleted !== true &&
        c?.systemStatus !== 'INVALID' &&
        String(c?.destination?.parameters?.adamId ?? '') === String(adamId),
    );
    if (reusable?.id !== undefined) {
      creativeId = String(reusable.id);
    } else {
      const made = await this.call<any>(
        'POST',
        '/creatives',
        {
          name: `RanksUp default product page ${adamId}`,
          creativeType: 'DEFAULT_PRODUCT_PAGE',
          creativeSpec: {},
          destination: { destinationType: 'APP_STORE_PRODUCT_PAGE', parameters: { adamId: String(adamId) } },
        },
        false,
      );
      creativeId = toStr(made?.result?.id);
    }
    if (!creativeId) {
      throw new AsaApiError('ASA POST /creatives → creative kimliği dönmedi', { kind: 'server', apiVersion: 'platform' });
    }

    const ad = await this.call<any>(
      'POST',
      '/ads',
      { name: 'RanksUp default product page', adGroupId: toApiId(adGroupId), creativeId: toApiId(creativeId), status: 'ENABLED' },
      false,
    );
    return { adId: toStr(ad?.result?.id), created: true };
  }

  // ─── Raporlar ────────────────────────────────────────

  /**
   * Gunluk kampanya raporu. Tek gunluk istekte granularity verilmez (Apple
   * kurali); o durumda totalMetrics o gunun satiri olur. groupBy verilmez:
   * kampanya basina tek satir → campaignId_date tekil kisitiyla uyumlu.
   */
  async getCampaignDailyReport(range: AsaDateRange): Promise<AsaCampaignDailyRow[]> {
    const singleDay = range.startDate === range.endDate;
    const out: AsaCampaignDailyRow[] = [];
    for (let page = 0; page < 10; page++) {
      const offset = page * QUERY_PAGE_SIZE;
      const body = await this.call<any>(
        'POST',
        '/reports/apps/campaigns/query',
        {
          timeRange: {
            start: range.startDate,
            end: range.endDate,
            timeZone: 'UTC',
            ...(singleDay ? {} : { granularity: 'DAILY' }),
          },
          pagination: { offset, pageSize: QUERY_PAGE_SIZE },
        },
        true,
      );
      const rows = rowsOf(body);
      for (const r of rows) {
        const campaignId = toStr(r?.metadata?.id);
        if (!campaignId) continue;
        if (singleDay) {
          out.push({ campaignId, date: range.startDate, ...normalizeMetrics(r?.totalMetrics) });
          continue;
        }
        for (const g of r?.granularMetrics ?? []) {
          const date = normalizeReportDate(g?.date);
          if (!date) continue;
          out.push({ campaignId, date, ...normalizeMetrics(g) });
        }
      }
      const total = Number(body?.pagination?.totalCount);
      if (rows.length < QUERY_PAGE_SIZE || (Number.isFinite(total) && offset + rows.length >= total)) break;
    }
    return out;
  }

  async getKeywordReport(campaignId: string, range: AsaDateRange): Promise<AsaKeywordReportRow[]> {
    const out: AsaKeywordReportRow[] = [];
    for (let page = 0; page < 10; page++) {
      const offset = page * QUERY_PAGE_SIZE;
      const body = await this.call<any>(
        'POST',
        '/reports/apps/keywords/query',
        {
          filters: [{ field: 'campaignId', operator: 'EQUALS', value: String(campaignId) }],
          timeRange: { start: range.startDate, end: range.endDate, timeZone: 'UTC' },
          pagination: { offset, pageSize: QUERY_PAGE_SIZE },
        },
        true,
      );
      const rows = rowsOf(body);
      for (const r of rows) {
        const keywordId = toStr(r?.metadata?.id);
        if (!keywordId) continue;
        out.push({
          keywordId,
          adGroupId: toStr(r?.metadata?.adGroupId),
          text: toStr(r?.metadata?.text),
          matchType: toStr(r?.metadata?.matchType),
          ...normalizeMetrics(r?.totalMetrics),
        });
      }
      const total = Number(body?.pagination?.totalCount);
      if (rows.length < QUERY_PAGE_SIZE || (Number.isFinite(total) && offset + rows.length >= total)) break;
    }
    return out;
  }

  async getSearchTermReport(campaignId: string, adGroupId: string | null, range: AsaDateRange): Promise<AsaSearchTermRow[]> {
    const filters: Array<Record<string, unknown>> = [{ field: 'campaignId', operator: 'EQUALS', value: String(campaignId) }];
    if (adGroupId) filters.push({ field: 'adGroupId', operator: 'EQUALS', value: String(adGroupId) });
    const body = await this.call<any>(
      'POST',
      '/reports/apps/searchterms/query',
      {
        filters,
        // Arama terimi raporu yalniz ORTZ kabul eder
        timeRange: { start: range.startDate, end: range.endDate, timeZone: 'ORTZ' },
        pagination: { offset: 0, pageSize: QUERY_PAGE_SIZE },
      },
      true,
    );
    return rowsOf(body).map((r) => ({
      searchTerm: toStr(r?.metadata?.searchTermText),
      keywordId: toStr(r?.metadata?.keyword?.id),
      keyword: toStr(r?.metadata?.keyword?.text),
      matchType: toStr(r?.metadata?.keyword?.matchType),
      adGroupId: toStr(r?.metadata?.adGroupId),
      source: toStr(r?.metadata?.searchTermSource),
      ...normalizeMetrics(r?.totalMetrics),
    }));
  }

  // ─── Insights (yalniz Platform) ──────────────────────

  /**
   * Arama terimi populerligi — GORELI puanlar (1-100, 1-5) ve tur ici sira;
   * mutlak arama hacmi degil. Haftalik veri pazartesi 07:00 UTC'de bir onceki
   * Pazar-Cumartesi haftasi icin uretilir.
   *   https://developer.apple.com/documentation/apple-ads-platform-api/query-app-search-term-popularity-data
   */
  async getSearchTermPopularity(query: AsaPopularityQuery): Promise<AsaSearchTermPopularityRow[]> {
    const filters: Array<Record<string, unknown>> = [
      { field: 'countryOrRegion', operator: 'EQUALS', value: query.countryOrRegion },
    ];
    if (query.genre) filters.push({ field: 'genre', operator: 'EQUALS', value: query.genre });
    if (query.searchTerms && query.searchTerms.length > 0) {
      filters.push({ field: 'searchTerm', operator: 'IN', value: query.searchTerms });
    }
    const body = await this.call<any>(
      'POST',
      '/insights/apps/search-term-popularity/query',
      {
        // Puan alanlari yalnizca fields ile istenince doner
        fields: ['rankInGenre', 'searchPopularityInGenre', 'searchPopularity1to100', 'searchPopularity1to5'],
        filters,
        timeRange: { start: query.startDate, end: query.endDate, granularity: 'WEEKLY_SUN_SAT' },
        sorting: [{ field: 'searchPopularity1to100', order: 'DESC' }],
        pagination: { offset: 0, pageSize: 500 },
      },
      true,
    );
    return rowsOf(body)
      .filter((r) => typeof r?.searchTerm === 'string' && r.searchTerm)
      .map((r) => ({
        searchTerm: String(r.searchTerm),
        countryOrRegion: toStr(r.countryOrRegion),
        genre: toStr(r.genre),
        period: toStr(r.week ?? r.month),
        popularity1to100: Number.isFinite(r.searchPopularity1to100) ? r.searchPopularity1to100 : null,
        popularityInGenre: Number.isFinite(r.searchPopularityInGenre) ? r.searchPopularityInGenre : null,
        popularity1to5: Number.isFinite(r.searchPopularity1to5) ? r.searchPopularity1to5 : null,
        rankInGenre: Number.isFinite(r.rankInGenre) ? r.rankInGenre : null,
      }));
  }

  /**
   * Gosterim payi — Apple'in kademeli kodlamasi: %1-90 tek deger (low = high),
   * %91-100 tek kova (low 0.91, high 1). DAILY en fazla 30 gun, UTC.
   *   https://developer.apple.com/documentation/apple-ads-platform-api/query-app-impression-share-data
   */
  async getImpressionShare(query: AsaImpressionShareQuery): Promise<AsaImpressionShareRow[]> {
    const filters: Array<Record<string, unknown>> = [
      { field: 'promotedObjectId', operator: 'IN', value: [String(query.adamId)] },
    ];
    if (query.countryOrRegion) filters.push({ field: 'countryOrRegion', operator: 'EQUALS', value: query.countryOrRegion });
    const body = await this.call<any>(
      'POST',
      '/insights/apps/impression-share/query',
      {
        filters,
        options: { impressionShareReportType: 'ALL_SLOTS' },
        timeRange: { start: query.startDate, end: query.endDate, granularity: 'DAILY' },
        sorting: [{ field: 'highImpressionShare', order: 'DESC' }],
        pagination: { offset: 0, pageSize: 1000 },
      },
      true,
    );
    const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
    return rowsOf(body).map((r) => ({
      date: toStr(r?.day ?? r?.week),
      searchTerm: toStr(r?.searchTerm),
      countryOrRegion: toStr(r?.countryOrRegion),
      lowShare: num(r?.lowImpressionShare),
      highShare: num(r?.highImpressionShare),
      rank: num(r?.rank),
      popularity1to5: num(r?.searchPopularity1to5),
    }));
  }
}
