/**
 * Apple Ads istemcileri icin ortak (surumden bagimsiz) tipler + normalizasyon.
 *
 * AsaService yalnizca bu tiplerle konusur. v5 (Campaign Management API,
 * asa-api.client.ts) ve Platform API (asa-platform.client.ts) adaptorleri
 * Apple'in cevaplarini buraya cevirir; ASA_API_VERSION degistiginde servis,
 * cron ve DB tarafi degismez.
 *
 * Kaynaklar (alan adlari iki kaynaktan dogrulandi: resmi dokuman + Apple'in
 * kendi urettigi Node istemcisi github.com/apple/apple-ads-platform-api-node):
 *   v5:       https://developer.apple.com/documentation/apple_ads
 *   Platform: https://developer.apple.com/documentation/apple-ads-platform-api
 */

export type AsaApiVersion = 'v5' | 'platform';

export interface AsaMoney {
  amount: string; // Apple tutarlari ondalik string ister ("1.50")
  currency: string;
}

export interface AsaAccessToken {
  accessToken: string;
  expiresAt: Date; // UTC
  tokenType: string; // 'Bearer'
}

/** X-AP-Context ile secilen hesap. v5: sayisal orgId, Platform: adAccountId. */
export interface AsaAccountInfo {
  contextId: string;
  name: string | null;
  currency: string | null;
  orgId: string | null;
}

export interface AsaCampaign {
  id: string;
  name: string;
  /** Reklamverenin niyeti: ENABLED | PAUSED */
  status: string;
  displayStatus: string | null;
  /** Gunluk butce (hesap para biriminde) */
  dailyBudget: number | null;
  /** v5'in eski omur boyu butcesi (5.6'da kaldirildi); Platform'da yok → null */
  totalBudget: number | null;
  currency: string | null;
  countriesOrRegions: string[];
  /** Yerlesimler (APPSTORE_SEARCH_RESULTS ...) — iki surumde de ayni degerler */
  supplySources: string[];
  adamId: string | null;
  deleted: boolean;
}

export interface AsaCreateCampaignInput {
  name: string;
  dailyBudget: AsaMoney;
  countriesOrRegions: string[];
  adamId: number;
  supplySources?: string[];
}

export interface AsaAdGroup {
  id: string;
  campaignId: string;
  name: string;
  defaultBid: number | null;
  status: string;
}

export interface AsaCreateAdGroupInput {
  name: string;
  defaultBid: AsaMoney;
  startTime?: Date;
}

/** DB'de (asa_keyword_bids.status) v5 sozlugu tutulur: ACTIVE | PAUSED */
export type AsaKeywordStatus = 'ACTIVE' | 'PAUSED';

export interface AsaKeyword {
  id: string;
  adGroupId: string | null;
  campaignId: string | null;
  text: string;
  matchType: string;
  bid: number | null;
  status: string;
  deleted: boolean;
}

export interface AsaKeywordInput {
  text: string;
  matchType: 'EXACT' | 'BROAD';
  bid: AsaMoney;
}

export interface AsaKeywordCreateResult {
  created: AsaKeyword[];
  failed: Array<{ text: string; reason: string }>;
}

export interface AsaKeywordUpdate {
  bid?: AsaMoney;
  status?: AsaKeywordStatus;
}

export interface AsaDateRange {
  startDate: string; // YYYY-MM-DD
  endDate: string; // YYYY-MM-DD
}

/** Rapor metrikleri. installs = dokunma sonrasi (tap-through) yukleme. */
export interface AsaMetrics {
  impressions: number;
  taps: number;
  installs: number;
  totalInstalls: number;
  spend: number;
  currency: string | null;
  avgCpt: number | null;
  avgCpa: number | null;
  ttr: number | null;
  conversionRate: number | null;
}

export interface AsaCampaignDailyRow extends AsaMetrics {
  campaignId: string;
  date: string; // YYYY-MM-DD
}

export interface AsaKeywordReportRow extends AsaMetrics {
  keywordId: string;
  adGroupId: string | null;
  text: string | null;
  matchType: string | null;
}

export interface AsaSearchTermRow extends AsaMetrics {
  searchTerm: string | null;
  keywordId: string | null;
  keyword: string | null;
  matchType: string | null;
  adGroupId: string | null;
  source: string | null;
}

export interface AsaPopularityQuery {
  countryOrRegion: string;
  genre?: string;
  searchTerms?: string[];
  startDate: string;
  endDate: string;
}

/** Apple'in goreli populerlik puanlari — mutlak arama hacmi DEGIL. */
export interface AsaSearchTermPopularityRow {
  searchTerm: string;
  countryOrRegion: string | null;
  genre: string | null;
  period: string | null;
  popularity1to100: number | null;
  popularityInGenre: number | null;
  popularity1to5: number | null;
  rankInGenre: number | null;
}

export interface AsaImpressionShareQuery {
  adamId: string;
  countryOrRegion?: string;
  startDate: string;
  endDate: string;
}

export interface AsaImpressionShareRow {
  date: string | null;
  searchTerm: string | null;
  countryOrRegion: string | null;
  /** 0..1 — %91-100 tek kova olarak doner (low 0.91, high 1) */
  lowShare: number | null;
  highShare: number | null;
  rank: number | null;
  popularity1to5: number | null;
}

export interface AsaServingPrep {
  adId: string | null;
  created: boolean;
}

/**
 * AsaService'in kullandigi tek arayuz. Her iki surum de bunu uygular;
 * opsiyonel uclar yalnizca Platform API'de var.
 */
export interface AsaAdsClient {
  readonly version: AsaApiVersion;
  getAccessToken(forceRefresh?: boolean): Promise<AsaAccessToken>;
  getAccountInfo(): Promise<AsaAccountInfo>;
  listCampaigns(): Promise<AsaCampaign[]>;
  createCampaign(input: AsaCreateCampaignInput): Promise<AsaCampaign>;
  createAdGroup(campaignId: string, input: AsaCreateAdGroupInput): Promise<AsaAdGroup>;
  addTargetingKeywords(campaignId: string, adGroupId: string, keywords: AsaKeywordInput[]): Promise<AsaKeywordCreateResult>;
  listTargetingKeywords(campaignId: string, adGroupId: string): Promise<AsaKeyword[]>;
  updateTargetingKeyword(campaignId: string, adGroupId: string, keywordId: string, update: AsaKeywordUpdate): Promise<AsaKeyword | null>;
  /** Ad group'un yayina girmesi icin gereken ek adim (Platform: varsayilan urun sayfasi reklami). */
  prepareAdGroupForServing(campaignId: string, adGroupId: string, adamId: string): Promise<AsaServingPrep>;
  getCampaignDailyReport(range: AsaDateRange): Promise<AsaCampaignDailyRow[]>;
  getKeywordReport(campaignId: string, range: AsaDateRange): Promise<AsaKeywordReportRow[]>;
  getSearchTermReport(campaignId: string, adGroupId: string | null, range: AsaDateRange): Promise<AsaSearchTermRow[]>;
  getSearchTermPopularity?(query: AsaPopularityQuery): Promise<AsaSearchTermPopularityRow[]>;
  getImpressionShare?(query: AsaImpressionShareQuery): Promise<AsaImpressionShareRow[]>;
}

// ─────────────────────────────────────────────────────
//  Hata modeli — iki surumun hata govdesi tek tipe iner
// ─────────────────────────────────────────────────────

export type AsaErrorKind =
  | 'auth'
  | 'forbidden'
  | 'not_found'
  | 'rate_limited'
  | 'validation'
  | 'duplicate_name'
  | 'payment'
  | 'app_ineligible'
  | 'server'
  | 'network'
  | 'timeout'
  | 'config';

export class AsaApiError extends Error {
  readonly kind: AsaErrorKind;
  readonly status: number | null;
  readonly codes: string[];
  readonly apiVersion: AsaApiVersion;
  readonly retryAfterSeconds: number | null;

  constructor(
    message: string,
    info: {
      kind: AsaErrorKind;
      status?: number | null;
      codes?: string[];
      apiVersion: AsaApiVersion;
      retryAfterSeconds?: number | null;
    },
  ) {
    super(message);
    this.name = 'AsaApiError';
    this.kind = info.kind;
    this.status = info.status ?? null;
    this.codes = info.codes ?? [];
    this.apiVersion = info.apiVersion;
    this.retryAfterSeconds = info.retryAfterSeconds ?? null;
  }
}

export function isAsaApiError(err: unknown): err is AsaApiError {
  return err instanceof AsaApiError;
}

/**
 * Apple hata govdesini kod + mesaj listesine indirger.
 *   v5:       { error: { errors: [{ messageCode, message, field }] } }
 *   Platform: { error: { code, message, details: [{ code, message, info }] } }
 */
export function parseAppleErrorBody(body: unknown): { codes: string[]; messages: string[] } {
  const codes: string[] = [];
  const messages: string[] = [];
  const err = (body as any)?.error;
  if (!err || typeof err !== 'object') return { codes, messages };

  if (Array.isArray(err.errors)) {
    for (const e of err.errors) {
      if (e?.messageCode) codes.push(String(e.messageCode));
      if (e?.message) messages.push(e.field && e.field !== 'null' ? `${e.message} (${e.field})` : String(e.message));
    }
  }
  if (typeof err.code === 'string' && err.code) codes.push(err.code);
  if (typeof err.message === 'string' && err.message) messages.push(err.message);
  if (Array.isArray(err.details)) {
    for (const d of err.details) {
      if (d?.code) codes.push(String(d.code));
      const field = d?.info && typeof d.info === 'object' && d.info.field ? ` (${d.info.field})` : '';
      if (d?.message) messages.push(`${d.message}${field}`);
    }
  }
  return { codes, messages };
}

/** HTTP durum + Apple kodlarindan servis tarafinin anlayacagi tur. */
export function classifyAsaError(status: number | null, codes: string[], messages: string[]): AsaErrorKind {
  // Her kod/mesaj AYRI sinanir: birlesik metinde "INVALID_FIELD" + "paymentModel"
  // gibi iki ayri parca yanlislikla eslesiyordu
  const items = [...codes, ...messages];
  const has = (re: RegExp) => items.some((s) => re.test(s));
  if (status === 401) return 'auth';
  if (status === 429) return 'rate_limited';
  if (status !== null && status >= 500) return 'server';
  // Gercek Apple kodlari: DUPLICATE_NAME (Platform), DUPLICATE_CAMPAIGN_NAME (v5)
  if (has(/DUPLICATE|not unique|already exists/i)) return 'duplicate_name';
  // Odeme kodlari Apple'in AdAccount.systemStatusReasons / servingStateReasons listesinden
  if (has(/NO_PAYMENT_METHOD|MISSING_PAYMENT|PAYMENT_DECLINED|PAYMENT_TYPE_DECLINED|PAYMENT_METHOD_|INVALID_PAYMENT_PROFILE|CREDIT_CARD_|no payment method/i)) return 'payment';
  // \bapp\b: "Apple ... not found" gibi mesajlar uygulama hatasi sanilmasin
  if (has(/ADAM_?ID|APP_NOT_ELIGIBLE|INVALID_ADAM|\bapp\b.*not.*found/i)) return 'app_ineligible';
  if (status === 403) return 'forbidden';
  if (status === 404) return 'not_found';
  return 'validation';
}

/** Hata mesaji eski bicimi korur ("ASA METHOD path → status: ...") — loglar ve UI ayni kalsin. */
export function asaErrorFromResponse(args: {
  status: number;
  bodyText: string;
  method: string;
  path: string;
  apiVersion: AsaApiVersion;
  retryAfterSeconds?: number | null;
}): AsaApiError {
  let parsed: unknown = null;
  try {
    parsed = args.bodyText ? JSON.parse(args.bodyText) : null;
  } catch {
    parsed = null;
  }
  const { codes, messages } = parseAppleErrorBody(parsed);
  const summaryParts = [...new Set([...codes, ...messages])];
  const summary = summaryParts.length > 0 ? summaryParts.join('; ') : args.bodyText;
  return new AsaApiError(`ASA ${args.method} ${args.path} → ${args.status}: ${summary.slice(0, 400)}`, {
    kind: classifyAsaError(args.status, codes, messages),
    status: args.status,
    codes,
    apiVersion: args.apiVersion,
    retryAfterSeconds: args.retryAfterSeconds ?? null,
  });
}

// ─────────────────────────────────────────────────────
//  Normalizasyon yardimcilari (saf fonksiyonlar)
// ─────────────────────────────────────────────────────

/** Money nesnesinden sayi; gecersizse null. */
export function parseAmount(m: unknown): number | null {
  const raw = (m as any)?.amount;
  if (raw === null || raw === undefined || raw === '' || raw === 'null') return null;
  const n = typeof raw === 'number' ? raw : parseFloat(String(raw));
  return Number.isFinite(n) ? n : null;
}

function toInt(v: unknown): number {
  const n = typeof v === 'number' ? v : parseInt(String(v ?? ''), 10);
  return Number.isFinite(n) ? n : 0;
}

function toNum(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : parseFloat(String(v));
  return Number.isFinite(n) ? n : null;
}

export function toStr(v: unknown): string | null {
  return v === null || v === undefined || v === '' ? null : String(v);
}

export function toStrArray(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x) => x !== null && x !== undefined).map(String) : [];
}

/**
 * Rapor tarihi → YYYY-MM-DD. v5 dokumani "MM-DD-YYYY HH" yaziyor ama ornekleri
 * "YYYY-MM-DD"; Platform "YYYY-MM-DD" (saatlikte " HH" ekli). Uc bicimi de kabul et.
 */
export function normalizeReportDate(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const s = raw.trim();
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const us = /^(\d{2})-(\d{2})-(\d{4})/.exec(s);
  if (us) return `${us[3]}-${us[1]}-${us[2]}`;
  return null;
}

/** Apple tarih-saat bicimi: yyyy-MM-dd'T'HH:mm:ss.SSS (UTC, 'Z' YOK) — iki surumun ornekleri boyle. */
export function toAppleDateTime(d: Date): string {
  return d.toISOString().slice(0, 23);
}

export function formatYmd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Son N gun (bugun dahil) — rapor penceresi. */
export function lastNDaysRange(daysBack: number, now: Date = new Date()): AsaDateRange {
  const start = new Date(now.getTime() - daysBack * 86_400_000);
  return { startDate: formatYmd(start), endDate: formatYmd(now) };
}

/** Platform ENABLED → DB'deki ACTIVE; v5 zaten ACTIVE/PAUSED. */
export function normalizeKeywordStatus(s: unknown): string {
  if (s === 'ENABLED' || s === 'ACTIVE') return 'ACTIVE';
  if (s === 'PAUSED') return 'PAUSED';
  return s ? String(s) : 'ACTIVE';
}

/**
 * Metrik satiri → AsaMetrics. API 5 ile alanlar yeniden adlandirildi
 * (installs→tapInstalls, avgCPA→tapInstallCPI, conversionRate→tapInstallRate;
 * https://developer.apple.com/documentation/apple_ads/spendrow). Platform'da
 * avgCPT yerine cpt var (https://developer.apple.com/documentation/apple-ads-platform-api/appsmetrics).
 * Eski adlar yalnizca geri uyum icin yedek.
 */
export function normalizeMetrics(row: unknown): AsaMetrics {
  const r = (row ?? {}) as any;
  const installs = toInt(r.tapInstalls ?? r.installs);
  return {
    impressions: toInt(r.impressions),
    taps: toInt(r.taps),
    installs,
    totalInstalls: r.totalInstalls !== undefined && r.totalInstalls !== null ? toInt(r.totalInstalls) : installs,
    spend: parseAmount(r.localSpend) ?? 0,
    currency: toStr(r.localSpend?.currency),
    avgCpt: parseAmount(r.avgCPT ?? r.cpt),
    avgCpa: parseAmount(r.tapInstallCPI ?? r.avgCPA),
    ttr: toNum(r.ttr),
    conversionRate: toNum(r.tapInstallRate ?? r.conversionRate),
  };
}

/** Apple ID'leri int64; guvenli tamsayiysa sayi, degilse string gonder (hassasiyet kaybi olmasin). */
export function toApiId(id: string | number): number | string {
  const n = typeof id === 'number' ? id : Number(id);
  return Number.isSafeInteger(n) ? n : String(id);
}
