/**
 * Google Ads API — REST surumu ve ortak istek yardimcilari. TEK kaynak:
 * google-ads-client.service.ts ve oauth/oauth.service.ts butun Google Ads
 * isteklerini buradan kurar. Surum baska yerde yazilmaz;
 * google-ads-api.spec.ts kaynakta sabit surumlu bir Google Ads adresi
 * kalmadigini denetler.
 *
 * NEDEN v26 (2026-10-18'de dogrulandi):
 *  - Google'in kapanis tablosu en yeni surum olarak v26'yi gosteriyor: yayin
 *    14 Ekim 2026, kapanis Kasim 2027 (v23 Subat 2027, v24 Mayis 2027, v25
 *    Agustos 2027). https://developers.google.com/google-ads/api/docs/sunset-dates
 *  - Eski kod v21'e gidiyordu. Google Ads Developer Blog: v21 5 Agustos 2026'da,
 *    v22 7 Ekim 2026'da kapandi, o tarihten sonra butun istekleri basarisiz olur
 *    (https://ads-developers.googleblog.com/2026/06/google-ads-api-v21-sunset-reminder.html,
 *    https://ads-developers.googleblog.com/2026/09/google-ads-api-v22-sunset-reminder.html).
 *    googleapis/googleapis deposunda da yalniz v23-v26 protolari kaldi (v21
 *    silme commit'i d94a97ef9fe659acbf87a1c2739b2809c50bc908, 2026-08-07).
 *
 * v21 → v26 DENETIMI: googleapis protolari karsilastirildi (v21 = 443c807d,
 * silmeden onceki commit; v26 = master). Kodun kullandigi uclar
 * (googleAds:search, customers:listAccessibleCustomers, :generateKeywordIdeas,
 * campaigns / campaignBudgets / campaignCriteria / adGroups / adGroupAds /
 * adGroupCriteria :mutate), bu uclarin istek-yanit alanlari, GAQL alanlari
 * (customer, campaign, campaign_budget, search_term_view, ad_group_ad,
 * metrics.*, segments.date) ve gonderilen enum degerleri AYNI kaldi. Aradaki
 * kirici degisiklikler (Campaign.start_date/end_date → *_date_time,
 * url_expansion_opt_out, video_brand_safety_suitability, call ads, feed
 * varliklari, keyword forecast alanlari, video metrik adlari) bu kodda
 * kullanilmiyor. Surumle gelen DAVRANIS degisiklikleri ise asagida:
 * AB siyasi reklam beyani (EU_DECLARATION_*) ve developer token'in kalkmasi
 * (googleAdsHeaders).
 *
 * YUKSELTME: v26 Kasim 2027'de kapanacak. Google surumu yayindan yaklasik bir
 * yil sonra kapatir, v27 Ocak 2027'de bekleniyor. En gec 2027 yazinda: kapanis
 * tablosunu ve aradaki her surumun "Upgrade from vX to vY" rehberini okuyun,
 * yalniz bu sabiti degistirin, google-ads-*.spec.ts'yi calistirin ve canli bir
 * hesapla dogrulayin.
 */
export const GOOGLE_ADS_API_VERSION = 'v26';

export const GOOGLE_ADS_API_HOST = 'https://googleads.googleapis.com';

/** Asili kalan bir Google istegi 6 saatlik otopilot turunu kilitlemesin */
export const GOOGLE_ADS_TIMEOUT_MS = 30_000;

export function googleAdsUrl(path: string): string {
  return `${GOOGLE_ADS_API_HOST}/${GOOGLE_ADS_API_VERSION}/${path.replace(/^\/+/, '')}`;
}

/**
 * Musteri kimligi: tire ve bosluklar atilir ("123-456-7890" → "1234567890").
 * Google kimligi hem adreste hem login-customer-id basliginda tiresiz ister
 * (https://developers.google.com/google-ads/api/rest/auth,
 * https://developers.google.com/google-ads/api/docs/concepts/call-structure).
 * Rakam disi bir sey kalirsa null: kimlik adrese ya da basliga ham girmez.
 */
export function normalizeCustomerId(raw: unknown): string | null {
  if (typeof raw !== 'string' && typeof raw !== 'number') return null;
  const id = String(raw).replace(/[\s-]/g, '');
  return /^\d{1,20}$/.test(id) ? id : null;
}

/**
 * Kampanya gibi sayisal kimlikler GAQL'e ve kaynak adina YALNIZ rakamsa girer.
 * externalId paneldeki "launch" govdesinden gelebiliyor; eskiden sorguya ham
 * ekleniyordu.
 */
export function isNumericId(v: unknown): v is string {
  return typeof v === 'string' && /^\d{1,20}$/.test(v);
}

/** customers/{cid}/adGroupAds/{ad_group_id}~{ad_id} — yalniz bu musterinin reklami */
export function isAdGroupAdResourceName(v: unknown, customerId: string): v is string {
  return typeof v === 'string' && new RegExp(`^customers/${customerId}/adGroupAds/\\d{1,20}~\\d{1,20}$`).test(v);
}

/** customers/{cid}/campaignBudgets/{id} — yalniz bu musterinin butcesi */
export function isCampaignBudgetResourceName(v: unknown, customerId: string): v is string {
  return typeof v === 'string' && new RegExp(`^customers/${customerId}/campaignBudgets/\\d{1,20}$`).test(v);
}

/**
 * GOOGLE_ADS_LOGIN_CUSTOMER_ID: istege bagli yonetici (MCC) hesap. Tiresiz
 * gonderilir (eskiden ham deger gidiyordu; "123-456-7890" yazilmissa her
 * istek basliktan reddedilirdi). Gecersiz deger yok sayilir.
 */
export function envLoginCustomerId(): string | null {
  const raw = process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID;
  if (!raw || !raw.trim()) return null;
  return normalizeCustomerId(raw);
}

/**
 * REST istek basliklari. developer-token GONDERILMEZ: Google developer
 * token'lari 9 Eylul 2026'da kaldirdi. Baslik artik "optional and ignored",
 * erisim seviyesi OAuth istemcisinin Google Cloud projesinden gelir ve Google
 * gelecekteki bir ana surumde token iceren istekleri REDDEDECEK
 * (https://developers.google.com/google-ads/api/docs/api-policy/developer-token;
 * ayrica https://www.corewebuk.co.uk/google-ads-api-developer-tokens/).
 * Google'in v26 REST ornekleri de yalniz Authorization + login-customer-id
 * gonderir (https://developers.google.com/google-ads/api/rest/examples).
 * Eskiden GOOGLE_ADS_DEV_TOKEN yoksa hicbir istek atilmiyordu; Google artik
 * yeni projeye token vermedigi icin bu kosul entegrasyonu tamamen kilitlerdi.
 */
export function googleAdsHeaders(
  accessToken: string,
  opts: { loginCustomerId?: string | null; json?: boolean } = {},
): Record<string, string> {
  const h: Record<string, string> = { Authorization: `Bearer ${accessToken}` };
  if (opts.json !== false) h['Content-Type'] = 'application/json';
  const login = opts.loginCustomerId ? normalizeCustomerId(opts.loginCustomerId) : null;
  if (login) h['login-customer-id'] = login;
  return h;
}

/**
 * Google Ads OAuth istemcisi. Baglanti akisi (oauth/oauth.service.ts) yenileme
 * belirtecini bu istemciyle uretir ve belirtec YALNIZ onu ureten istemciyle
 * yenilenebilir. Eskiden site istekleri yalniz GOOGLE_OAUTH_CLIENT_ID'yi
 * okuyordu: .env.example yalniz GOOGLE_CLIENT_ID'yi tanimladigi icin her
 * istek "bagli degil"e dusuyor, iki degisken farkliysa yanlis istemciyle
 * yenileme deneniyordu. Developer token kalktigi icin Ads API erisim seviyesi
 * de bu istemcinin Google Cloud projesine bagli.
 * Bos dize tanimsiz sayilir (dotenv'de "GOOGLE_CLIENT_ID=" satiri).
 */
export function googleAdsOAuthClient(): { clientId: string | null; clientSecret: string | null } {
  return {
    clientId: process.env.GOOGLE_CLIENT_ID || process.env.GOOGLE_OAUTH_CLIENT_ID || null,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET || process.env.GOOGLE_OAUTH_CLIENT_SECRET || null,
  };
}

// ─────────────────────────────────────────────────────────────
//  Hata modeli
// ─────────────────────────────────────────────────────────────

/**
 * Google Ads hatasi: HTTP govdesi { error: google.rpc.Status } ya da
 * partialFailureError (google.rpc.Status). details[] icindeki GoogleAdsFailure
 * { errors: [{ errorCode: { mutateError: "..." }, message }], requestId } tasir
 * (https://developers.google.com/google-ads/api/docs/get-started/handle-errors,
 * v26 errors/errors.proto). requestId Google destegi icin loglanir.
 */
export interface GoogleAdsErrorInfo {
  httpStatus: number;
  /** "mutateError.EU_POLITICAL_ADVERTISING_DECLARATION_REQUIRED" bicimi */
  codes: string[];
  messages: string[];
  requestId?: string;
  /** google.rpc durum adi (INVALID_ARGUMENT, PERMISSION_DENIED ...) */
  status?: string;
}

const MAX_CODES = 10;
const MAX_MESSAGES = 5;
const MAX_TEXT = 300;

export function parseGoogleAdsError(httpStatus: number, body: unknown): GoogleAdsErrorInfo {
  const info: GoogleAdsErrorInfo = { httpStatus, codes: [], messages: [] };
  let obj: any = body;
  if (typeof body === 'string') {
    try {
      obj = JSON.parse(body);
    } catch {
      if (body.trim()) info.messages.push(body.trim().slice(0, MAX_TEXT));
      return info;
    }
  }
  const root = obj && typeof obj === 'object' ? (obj.error && typeof obj.error === 'object' ? obj.error : obj) : null;
  if (!root) return info;
  if (typeof root.status === 'string') info.status = root.status;
  const details: any[] = Array.isArray(root.details) ? root.details : [];
  for (const d of details) {
    if (typeof d?.requestId === 'string' && !info.requestId) info.requestId = d.requestId;
    const errors: any[] = Array.isArray(d?.errors) ? d.errors : [];
    for (const e of errors) {
      const ec = e?.errorCode;
      if (ec && typeof ec === 'object') {
        for (const [k, v] of Object.entries(ec)) {
          if (typeof v === 'string' && info.codes.length < MAX_CODES) {
            const code = `${k}.${v}`;
            if (!info.codes.includes(code)) info.codes.push(code);
          }
        }
      }
      if (typeof e?.message === 'string' && e.message && info.messages.length < MAX_MESSAGES) {
        info.messages.push(e.message.slice(0, MAX_TEXT));
      }
    }
  }
  if (info.messages.length === 0 && typeof root.message === 'string' && root.message) {
    info.messages.push(root.message.slice(0, MAX_TEXT));
  }
  return info;
}

/** Log satiri: "HTTP 400 · mutateError.X · "mesaj" · requestId abc" (sir icermez) */
export function describeGoogleAdsError(info: GoogleAdsErrorInfo): string {
  const parts = [info.httpStatus ? `HTTP ${info.httpStatus}` : 'ag hatasi'];
  if (info.codes.length) parts.push(info.codes.join(', '));
  else if (info.status) parts.push(info.status);
  if (info.messages[0]) parts.push(`"${info.messages[0]}"`);
  if (info.requestId) parts.push(`requestId ${info.requestId}`);
  return parts.join(' · ');
}

/**
 * AB siyasi reklam beyani. v21'den beri yeni kampanya bu alan olmadan
 * FieldError.REQUIRED ile reddedilir (v26: yalniz AB'yi hedeflemeyen
 * kampanyalarda istege bagli). 1 Nisan 2026'dan beri hesapta beyansiz TEK bir
 * kampanya bile varsa Google kampanya yonetimi mutate'lerini (kampanya,
 * butce, kriter, reklam grubu, reklam) MutateError.EU_POLITICAL_ADVERTISING_DECLARATION_REQUIRED
 * ile reddeder; raporlama ve hesap listeleme etkilenmez. Beyan yasal bir
 * oz beyandir: RanksUp musterinin yerine YAPMAZ, nedeni musteriye gosterir.
 * Kaynaklar: https://developers.google.com/google-ads/api/docs/api-policy/eu-par,
 * https://ppc.land/google-ads-api-tightens-eu-political-ads-rules-with-april-1-deadline/
 * ve v26 errors/mutate_error.proto.
 */
export const EU_POLITICAL_ADVERTISING = {
  CONTAINS: 'CONTAINS_EU_POLITICAL_ADVERTISING',
  DOES_NOT_CONTAIN: 'DOES_NOT_CONTAIN_EU_POLITICAL_ADVERTISING',
} as const;

const EU_DECLARATION_REASON =
  'Google Ads hesabında AB siyasi reklam beyanı yapılmamış kampanyalar var. Google, beyan tamamlanana kadar hesaptaki kampanya değişikliklerini (duraklatma, bütçe, anahtar kelime) reddediyor. Google Ads\'te her kampanyanın AB siyasi reklam beyanını yapıp tekrar dene.';

/**
 * Musteriye gosterilebilecek, nedeni ve cozumu kesin olan hatalar icin Turkce
 * aciklama; digerleri icin undefined (cagiran kendi genel mesajini kullanir).
 */
export function googleAdsUserReason(info: GoogleAdsErrorInfo | null | undefined): string | undefined {
  if (!info) return undefined;
  if (info.codes.some((c) => c.includes('EU_POLITICAL_ADVERTISING'))) return EU_DECLARATION_REASON;
  if (info.codes.includes('authorizationError.CUSTOMER_NOT_ENABLED')) {
    return 'Google Ads hesabı etkin değil (henüz etkinleştirilmemiş ya da kapatılmış), bu yüzden değişiklik yapılamadı.';
  }
  // v25+: Google Cloud projesi yalniz test hesaplarina acik (developer-token notu)
  if (info.codes.includes('authorizationError.CLOUD_PROJECT_NOT_APPROVED_FOR_PRODUCTION')) {
    return 'RanksUp\'ın Google Ads API erişimi Google tarafından henüz gerçek reklam hesapları için onaylanmadı; bu değişiklik şu an yapılamıyor.';
  }
  return undefined;
}

/**
 * partialFailure:true mutate yaniti. Google basarisiz islemleri results'ta BOS
 * nesne olarak doner, basarililarda resourceName bulunur; hatalar
 * partialFailureError'da toplanir ve HTTP yine 200'dur. Yani res.ok "hepsi
 * eklendi" demek DEGILDIR. Kaynak: v26 *_service.proto (Mutate*Result
 * resource_name "Returned for successful operations") ve
 * https://developers.google.com/google-ads/api/docs/best-practices/partial-failures
 */
export function partialFailureOutcome(body: unknown, operationCount: number): { succeeded: number[]; error: GoogleAdsErrorInfo | null } {
  const b: any = body ?? {};
  const results: any[] = Array.isArray(b.results) ? b.results : [];
  const succeeded: number[] = [];
  for (let i = 0; i < Math.min(results.length, operationCount); i++) {
    const rn = results[i]?.resourceName;
    if (typeof rn === 'string' && rn) succeeded.push(i);
  }
  const error = b.partialFailureError ? parseGoogleAdsError(200, b.partialFailureError) : null;
  return { succeeded, error };
}

// ─────────────────────────────────────────────────────────────
//  Istek
// ─────────────────────────────────────────────────────────────

export type GoogleAdsResult<T = any> =
  | { ok: true; status: number; data: T }
  | { ok: false; status: number; error: GoogleAdsErrorInfo };

/**
 * Tek istek noktasi: adres surumle kurulur, zaman asimi uygulanir, hata
 * govdesi GoogleAdsErrorInfo'ya cevrilir. Firlatmaz.
 */
export async function googleAdsRequest<T = any>(
  path: string,
  init: { method?: 'GET' | 'POST'; headers: Record<string, string>; body?: unknown; timeoutMs?: number },
): Promise<GoogleAdsResult<T>> {
  let res: Response;
  try {
    res = await fetch(googleAdsUrl(path), {
      method: init.method ?? 'POST',
      headers: init.headers,
      ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
      signal: AbortSignal.timeout(init.timeoutMs ?? GOOGLE_ADS_TIMEOUT_MS),
    });
  } catch (err: any) {
    return { ok: false, status: 0, error: { httpStatus: 0, codes: [], messages: [String(err?.message ?? err).slice(0, MAX_TEXT)] } };
  }
  const text = await res.text().catch(() => '');
  if (!res.ok) return { ok: false, status: res.status, error: parseGoogleAdsError(res.status, text) };
  try {
    return { ok: true, status: res.status, data: (text ? JSON.parse(text) : {}) as T };
  } catch {
    return { ok: false, status: res.status, error: { httpStatus: res.status, codes: [], messages: ['Google Ads yaniti JSON degil'] } };
  }
}
