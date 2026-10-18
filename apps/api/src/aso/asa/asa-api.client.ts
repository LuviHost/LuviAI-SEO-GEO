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
  type AsaKeyword,
  type AsaKeywordCreateResult,
  type AsaKeywordInput,
  type AsaKeywordReportRow,
  type AsaKeywordUpdate,
  type AsaSearchTermRow,
  type AsaServingPrep,
} from './asa-types.js';

// Geri uyum: bu tipler eskiden bu dosyadan disari aciliyordu
export type { AsaCredentials } from './asa-http.js';
export type { AsaAccessToken } from './asa-types.js';

/**
 * Apple Ads Campaign Management API v5 istemcisi (AsaAdsClient adaptoru)
 * =====================================================================
 *
 * Apple bu API'yi 26 Ocak 2027'de kapatiyor; yerine Platform API geliyor
 * (asa-platform.client.ts). Secim ASA_API_VERSION ile (asa-client.factory.ts).
 *   https://developer.apple.com/documentation/apple_ads/apple-search-ads-campaign-management-api-5
 *
 * Auth: asa-http.ts (client-credentials + ES256 client secret, scope searchadsorg)
 * Cagrilar:
 *   Authorization: Bearer {access_token}
 *   X-AP-Context: orgId={sayisal orgId}   ← /acls'ten gelir, clientId DEGIL
 *
 * Bu dosyada duzeltilen v5 hatalari (resmi dokumanla karsilastirildi):
 *   - Tek anahtar kelime PUT ucu v5'te YOK; guncelleme yalnizca
 *     PUT .../targetingkeywords/bulk (dizi govde) ile yapilir.
 *     https://developer.apple.com/documentation/apple_ads/update-targeting-keywords
 *   - API 5 ile rapor alanlari yeniden adlandirildi (installs→tapInstalls,
 *     avgCPA→tapInstallCPI, conversionRate→tapInstallRate); eski adlar okununca
 *     yukleme hep 0 geliyordu.  https://developer.apple.com/documentation/apple_ads/spendrow
 *   - 5.6 (Haziran 2026) ile budgetAmount (omur boyu butce) API'den kaldirildi;
 *     gunluk butce dailyBudgetAmount.
 *   - Olmayan GET /adgroups/{id}/searchterms yerine gercek arama terimi raporu.
 */

const ASA_API_BASE = 'https://api.searchads.apple.com/api/v5';
// v5 sayfa basina en fazla 1000 kayit kabul ediyor; kampanya listesinde onceki
// kodun kullandigi (calistigi bilinen) 100 korunup sayfalanir.
const CAMPAIGN_PAGE_SIZE = 100;
const REPORT_PAGE_SIZE = 1000;
const MAX_PAGES = 50;

/** v5 cevaplari { data, pagination, error } zarfiyla gelir; bazi orneklerde ciplak dizi. */
function unwrapList(body: any): any[] {
  if (Array.isArray(body)) return body;
  if (Array.isArray(body?.data)) return body.data;
  return [];
}

export function normalizeV5Campaign(c: any): AsaCampaign {
  return {
    id: String(c?.id),
    name: c?.name ?? '',
    status: c?.status ?? 'ENABLED',
    displayStatus: toStr(c?.displayStatus),
    dailyBudget: parseAmount(c?.dailyBudgetAmount),
    totalBudget: parseAmount(c?.budgetAmount),
    currency: toStr(c?.dailyBudgetAmount?.currency),
    countriesOrRegions: toStrArray(c?.countriesOrRegions),
    supplySources: toStrArray(c?.supplySources),
    adamId: c?.adamId !== undefined && c?.adamId !== null ? String(c.adamId) : null,
    deleted: c?.deleted === true || c?.displayStatus === 'DELETED',
  };
}

export function normalizeV5Keyword(k: any): AsaKeyword {
  return {
    id: String(k?.id),
    adGroupId: toStr(k?.adGroupId),
    campaignId: toStr(k?.campaignId),
    text: k?.text ?? '',
    matchType: k?.matchType ?? 'EXACT',
    bid: parseAmount(k?.bidAmount),
    status: normalizeKeywordStatus(k?.status),
    deleted: k?.deleted === true,
  };
}

export class AsaApiClient implements AsaAdsClient {
  readonly version = 'v5' as const;
  private cachedToken: AsaAccessToken | null = null;
  private cachedNumericOrgId: number | null = null;
  private cachedAccount: AsaAccountInfo | null = null;
  private readonly http: AsaHttp;

  constructor(private readonly creds: AsaCredentials, private readonly deps: AsaClientDeps = {}) {
    this.http = new AsaHttp('v5', deps);
  }

  /** Access token al + cache (1 saat gecerli, 1 dk pay). */
  async getAccessToken(forceRefresh = false): Promise<AsaAccessToken> {
    const now = (this.deps.now ?? Date.now)();
    if (!forceRefresh && this.cachedToken && this.cachedToken.expiresAt.getTime() - now > 60_000) {
      return this.cachedToken;
    }
    this.cachedToken = await fetchAppleAccessToken(this.creds, 'v5', this.deps);
    return this.cachedToken;
  }

  private async token(force: boolean): Promise<string> {
    return (await this.getAccessToken(force)).accessToken;
  }

  /**
   * X-AP-Context **sayisal** orgId bekler; /acls (context istemez) doner.
   * Birden fazla org varsa eskisi gibi ILK kayit — secimi degistirmek mevcut
   * musterilerde baska org'a gecip DB'deki kampanyalari "silinmis" saydirirdi.
   */
  async getAccountInfo(): Promise<AsaAccountInfo> {
    if (this.cachedAccount) return this.cachedAccount;
    const body = await this.http.send<any>(
      { method: 'GET', url: `${ASA_API_BASE}/acls`, path: '/acls', idempotent: true },
      (f) => this.token(f),
    );
    // Dokuman ornegi data'yi tek nesne gosteriyor, tip adi liste — ikisini de kabul et
    const list = Array.isArray(body?.data) ? body.data : body?.data ? [body.data] : [];
    const first = list[0];
    if (!first?.orgId) {
      throw new AsaApiError(
        'ASA /acls: numeric orgId bulunamadı (response: ' + JSON.stringify(body).slice(0, 200) + ')',
        { kind: 'config', apiVersion: 'v5' },
      );
    }
    this.cachedNumericOrgId = Number(first.orgId);
    this.cachedAccount = {
      contextId: String(first.orgId),
      name: toStr(first.orgName ?? first.displayName),
      currency: toStr(first.currency),
      orgId: String(first.orgId),
    };
    return this.cachedAccount;
  }

  /** Public: explicit numeric orgId fetch (initial setup için kullanılır) */
  async fetchNumericOrgId(): Promise<number> {
    if (this.cachedNumericOrgId) return this.cachedNumericOrgId;
    await this.getAccountInfo();
    return this.cachedNumericOrgId as number;
  }

  /**
   * Dusuk seviye kimlikli REST cagrisi (geri uyum). Standart zarf: { data, pagination, error }.
   * GET/PUT/DELETE idempotent sayilir; POST yalnizca 429'da tekrar edilir.
   */
  async request<T = any>(method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', path: string, body?: any): Promise<T> {
    return this.call<T>(method, path, body, method !== 'POST' && method !== 'PATCH');
  }

  private async call<T>(method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', path: string, body: unknown, idempotent: boolean): Promise<T> {
    const url = path.startsWith('http') ? path : `${ASA_API_BASE}${path.startsWith('/') ? path : `/${path}`}`;
    const orgId = await this.fetchNumericOrgId();
    return this.http.send<T>(
      { method, url, path, headers: { 'X-AP-Context': `orgId=${orgId}` }, body, idempotent },
      (f) => this.token(f),
    );
  }

  // ─── Kampanyalar ─────────────────────────────────────

  /** Tum kampanyalar (sayfalanir; eski kod yalniz ilk 100'u aliyordu, kalanlar "silindi" sayiliyordu). */
  async listCampaigns(): Promise<AsaCampaign[]> {
    const out: AsaCampaign[] = [];
    for (let page = 0; page < MAX_PAGES; page++) {
      const offset = page * CAMPAIGN_PAGE_SIZE;
      const body = await this.call<any>('GET', `/campaigns?limit=${CAMPAIGN_PAGE_SIZE}&offset=${offset}`, undefined, true);
      const rows = unwrapList(body);
      out.push(...rows.map(normalizeV5Campaign));
      const total = Number(body?.pagination?.totalResults);
      if (rows.length < CAMPAIGN_PAGE_SIZE || (Number.isFinite(total) && out.length >= total)) break;
    }
    return out;
  }

  /**
   * Kampanya olustur. Resmi ornekle ayni alanlar; budgetAmount (5.6'da kaldirildi)
   * ve paymentModel (hesap ayari, ornekte yok) gonderilmez.
   *   https://developer.apple.com/documentation/apple_ads/create-a-campaign
   */
  async createCampaign(input: AsaCreateCampaignInput): Promise<AsaCampaign> {
    const body = {
      name: input.name,
      adamId: input.adamId,
      countriesOrRegions: input.countriesOrRegions,
      dailyBudgetAmount: input.dailyBudget,
      supplySources: input.supplySources ?? ['APPSTORE_SEARCH_RESULTS'],
      adChannelType: 'SEARCH',
      billingEvent: 'TAPS',
      status: 'ENABLED',
    };
    const res = await this.call<any>('POST', '/campaigns', body, false);
    return normalizeV5Campaign(res?.data ?? res);
  }

  /** Ad group: pricingModel CPC (v5 sozlugu), startTime zorunlu, 'Z'siz bicim. */
  async createAdGroup(campaignId: string, input: AsaCreateAdGroupInput): Promise<AsaAdGroup> {
    const body = {
      name: input.name,
      pricingModel: 'CPC',
      defaultBidAmount: input.defaultBid,
      startTime: toAppleDateTime(input.startTime ?? new Date((this.deps.now ?? Date.now)())),
      automatedKeywordsOptIn: false,
      status: 'ENABLED',
    };
    const res = await this.call<any>('POST', `/campaigns/${campaignId}/adgroups`, body, false);
    const g = res?.data ?? res;
    return {
      id: String(g?.id),
      campaignId: String(g?.campaignId ?? campaignId),
      name: g?.name ?? input.name,
      defaultBid: parseAmount(g?.defaultBidAmount),
      status: g?.status ?? 'ENABLED',
    };
  }

  // ─── Anahtar kelimeler ───────────────────────────────

  /**
   * Toplu ekleme. Apple: kopya kelimede cevap 200 doner ama govdede hata olur —
   * id'siz kayitlar "olustu" sayilmaz (eskiden asaKeywordId="undefined" yaziliyordu).
   */
  async addTargetingKeywords(campaignId: string, adGroupId: string, keywords: AsaKeywordInput[]): Promise<AsaKeywordCreateResult> {
    const payload = keywords.map((k) => ({ text: k.text, matchType: k.matchType, bidAmount: k.bid }));
    const res = await this.call<any>('POST', `/campaigns/${campaignId}/adgroups/${adGroupId}/targetingkeywords/bulk`, payload, false);
    const created = unwrapList(res)
      .filter((k: any) => k?.id !== undefined && k?.id !== null)
      .map(normalizeV5Keyword);
    const createdTexts = new Set(created.map((k) => k.text.trim().toLowerCase()));
    const errMessages = toStrArray(
      (res?.error?.errors ?? []).map((e: any) => e?.message ?? e?.messageCode).filter(Boolean),
    );
    const reason = errMessages.length > 0 ? errMessages.join('; ').slice(0, 200) : 'Apple bu anahtar kelimeyi kabul etmedi';
    const failed = keywords
      .filter((k) => !createdTexts.has(k.text.trim().toLowerCase()))
      .map((k) => ({ text: k.text, reason }));
    return { created, failed };
  }

  async listTargetingKeywords(campaignId: string, adGroupId: string): Promise<AsaKeyword[]> {
    const out: AsaKeyword[] = [];
    for (let page = 0; page < MAX_PAGES; page++) {
      const offset = page * REPORT_PAGE_SIZE;
      const body = await this.call<any>(
        'GET',
        `/campaigns/${campaignId}/adgroups/${adGroupId}/targetingkeywords?limit=${REPORT_PAGE_SIZE}&offset=${offset}`,
        undefined,
        true,
      );
      const rows = unwrapList(body);
      out.push(...rows.map(normalizeV5Keyword));
      if (rows.length < REPORT_PAGE_SIZE) break;
    }
    return out;
  }

  /** Teklif/durum guncelle — v5'te yalnizca toplu PUT ucu var (dizi govde). */
  async updateTargetingKeyword(campaignId: string, adGroupId: string, keywordId: string, update: AsaKeywordUpdate): Promise<AsaKeyword | null> {
    const item: Record<string, unknown> = { id: toApiId(keywordId) };
    if (update.bid) item.bidAmount = update.bid;
    if (update.status) item.status = update.status;
    const res = await this.call<any>('PUT', `/campaigns/${campaignId}/adgroups/${adGroupId}/targetingkeywords/bulk`, [item], true);
    const rows = unwrapList(res);
    if (rows.length === 0 && Array.isArray(res?.error?.errors) && res.error.errors.length > 0) {
      const msg = res.error.errors.map((e: any) => e?.message ?? e?.messageCode).join('; ');
      throw new AsaApiError(`ASA PUT targetingkeywords/bulk → 200: ${String(msg).slice(0, 300)}`, {
        kind: 'validation',
        status: 200,
        apiVersion: 'v5',
      });
    }
    return rows[0] ? normalizeV5Keyword(rows[0]) : null;
  }

  /** v5'te arama sonucu ad group'lari ek reklam nesnesi olmadan yayina girer. */
  async prepareAdGroupForServing(): Promise<AsaServingPrep> {
    return { adId: null, created: false };
  }

  // ─── Raporlar ────────────────────────────────────────

  /**
   * Gunluk kampanya raporu. Apple selector'i zorunlu kilar (yoksa 400: "Selector is
   * required"); orderBy bir metrik alani — groupBy eklenmez cunku campaignId_date
   * tekil kisiti ulke kiriliminda carpisirdi.
   */
  async getCampaignDailyReport(range: AsaDateRange): Promise<AsaCampaignDailyRow[]> {
    const out: AsaCampaignDailyRow[] = [];
    for (let page = 0; page < 10; page++) {
      const body = await this.call<any>(
        'POST',
        '/reports/campaigns',
        {
          startTime: range.startDate,
          endTime: range.endDate,
          granularity: 'DAILY',
          timeZone: 'UTC',
          returnRowTotals: false,
          returnGrandTotals: false,
          returnRecordsWithNoMetrics: false,
          selector: {
            orderBy: [{ field: 'impressions', sortOrder: 'DESCENDING' }],
            pagination: { offset: page * REPORT_PAGE_SIZE, limit: REPORT_PAGE_SIZE },
          },
        },
        true, // rapor POST'u salt okunur
      );
      const rows: any[] = body?.data?.reportingDataResponse?.row ?? [];
      for (const r of rows) {
        const campaignId = toStr(r?.metadata?.campaignId);
        if (!campaignId) continue;
        for (const g of r?.granularity ?? []) {
          const date = normalizeReportDate(g?.date);
          if (!date) continue;
          out.push({ campaignId, date, ...normalizeMetrics(g) });
        }
      }
      if (rows.length < REPORT_PAGE_SIZE) break;
    }
    return out;
  }

  /** Anahtar kelime raporu (donem toplami). Granularity yoksa returnRowTotals true olmali. */
  async getKeywordReport(campaignId: string, range: AsaDateRange): Promise<AsaKeywordReportRow[]> {
    const out: AsaKeywordReportRow[] = [];
    for (let page = 0; page < 10; page++) {
      const body = await this.call<any>(
        'POST',
        `/reports/campaigns/${campaignId}/keywords`,
        {
          startTime: range.startDate,
          endTime: range.endDate,
          timeZone: 'UTC',
          returnRowTotals: true,
          returnGrandTotals: false,
          returnRecordsWithNoMetrics: false,
          selector: {
            orderBy: [{ field: 'localSpend', sortOrder: 'DESCENDING' }],
            pagination: { offset: page * REPORT_PAGE_SIZE, limit: REPORT_PAGE_SIZE },
          },
        },
        true,
      );
      const rows: any[] = body?.data?.reportingDataResponse?.row ?? [];
      for (const r of rows) {
        const keywordId = toStr(r?.metadata?.keywordId);
        if (!keywordId) continue;
        out.push({
          keywordId,
          adGroupId: toStr(r?.metadata?.adGroupId),
          text: toStr(r?.metadata?.keyword),
          matchType: toStr(r?.metadata?.matchType),
          ...normalizeMetrics(r?.total),
        });
      }
      if (rows.length < REPORT_PAGE_SIZE) break;
    }
    return out;
  }

  /** Arama terimi raporu — Apple yalnizca ORTZ saat dilimini kabul ediyor. */
  async getSearchTermReport(campaignId: string, adGroupId: string | null, range: AsaDateRange): Promise<AsaSearchTermRow[]> {
    const path = adGroupId
      ? `/reports/campaigns/${campaignId}/adgroups/${adGroupId}/searchterms`
      : `/reports/campaigns/${campaignId}/searchterms`;
    const body = await this.call<any>(
      'POST',
      path,
      {
        startTime: range.startDate,
        endTime: range.endDate,
        timeZone: 'ORTZ',
        returnRowTotals: true,
        returnGrandTotals: false,
        returnRecordsWithNoMetrics: false,
        selector: {
          orderBy: [{ field: 'localSpend', sortOrder: 'DESCENDING' }],
          pagination: { offset: 0, limit: REPORT_PAGE_SIZE },
        },
      },
      true,
    );
    const rows: any[] = body?.data?.reportingDataResponse?.row ?? [];
    return rows.map((r) => ({
      searchTerm: toStr(r?.metadata?.searchTermText),
      keywordId: toStr(r?.metadata?.keywordId),
      keyword: toStr(r?.metadata?.keyword),
      matchType: toStr(r?.metadata?.matchType),
      adGroupId: toStr(r?.metadata?.adGroupId),
      source: toStr(r?.metadata?.searchTermSource),
      ...normalizeMetrics(r?.total),
    }));
  }
}
