/**
 * RanksUp API istemcisi — gerçek üretim uçları (api.ranksup.ai).
 * Kimliksiz: web landing'deki "Markanız AI'da görünüyor mu?" testinin aynısı ve
 * 90 gün e-posta takibi. Kimlikli (Bearer): hesap özeti, bildirimler, ASO, hesap silme.
 * Uygulama yalnız bu uçlardan gelen veriyi gösterir; uydurma/örnek sayı yok.
 */

export const API_BASE = 'https://api.ranksup.ai';

// Tarayıcı benzeri UA — sunucunun bot filtresine takılmamak için
const UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 RanksUp-iOS/1.0';

export type ProviderKey = 'openai' | 'anthropic' | 'gemini' | 'perplexity' | 'xai' | 'deepseek' | 'meta';

export interface ProbeResult {
  provider: ProviderKey;
  label: string;
  cited: boolean;
  brandMentioned: boolean;
  excerpt?: string;
  /**
   * false = bu saglayici bu soruda OLCULMEDI (anahtar yok / saglayici hatasi).
   * Sunucu olculmeyeni ya hic gondermez ya da bu bayrakla isaretler; iki bicim de
   * desteklenir (bkz. visibility.ts). Alan yoksa olculmus sayilir.
   */
  measured?: boolean;
  /** measured ile ayni anlam — eski taslak alan adi; false ise olculmemis sayilir */
  available?: boolean;
}
export interface QueryResult {
  query: string;
  category?: string;
  /** true = soru listelendi ama OLCULMEDI (ucretsiz test kilidi); providers bos gelir */
  locked?: boolean;
  providers: ProbeResult[];
  citedCount: number;
  totalProviders: number;
  /** Sorunun kendisinde marka adi geciyor — manset skora katilmaz (web summarize() ile ayni) */
  brandInQuery?: boolean;
}
export interface Competitor {
  name: string;
  mentions: number;
  pct: number;
  isBrand?: boolean;
}
export interface AnalyzeResult {
  domain: string;
  brand: string;
  niche?: string;
  customNiche?: string;
  queries: QueryResult[];
  competitorRanking: Competitor[];
  totalLlmCalls: number;
  fromCache: boolean;
  cachedAt?: string;
  /** Olcum yontemi surumu (CITATION_MATCH_VERSION); eski onbellek kaydinda yok */
  matchVersion?: number;
  /** Ucretsiz test kilidi: kac soru olculdu / kac soru kilitli */
  access?: {
    tier?: 'anon' | 'member';
    unlockedQueries: number;
    totalQueries: number;
    lockedQueries: number;
  };
}

/** Provider anahtarı → görünen ad, kısa mono harf, marka rengi */
export const PROVIDER_META: Record<ProviderKey, { name: string; mono: string; color: string }> = {
  openai: { name: 'ChatGPT', mono: 'G', color: '#10A37F' },
  anthropic: { name: 'Claude', mono: 'C', color: '#D97757' },
  gemini: { name: 'Gemini', mono: 'G', color: '#4E86F5' },
  perplexity: { name: 'Perplexity', mono: 'P', color: '#20B8CD' },
  xai: { name: 'Grok', mono: 'X', color: '#E8E4DE' },
  deepseek: { name: 'DeepSeek', mono: 'D', color: '#4D6BFE' },
  meta: { name: 'Meta AI', mono: 'M', color: '#0668E1' },
};

/**
 * Bir alan adını olculen AI motorlarinda (6 asistan; Llama yalniz sunucuda GROQ_LLAMA_MODEL
 * tanimliyken) gerçek olarak analiz eder. Saglayici listesi cevaptan okunur.
 * Sunucu 24 saat cache'ler; ilk çağrı ~30-60 sn sürebilir.
 */
export async function analyzeSite(domain: string): Promise<AnalyzeResult> {
  const clean = domain.trim().replace(/^https?:\/\//i, '').replace(/\/+$/, '');
  const res = await fetch(`${API_BASE}/api/public/citation-check`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'User-Agent': UA,
    },
    body: JSON.stringify({ domain: clean }),
  });

  if (!res.ok) {
    let reason = '';
    try {
      const body = await res.json();
      reason = body?.message ?? '';
    } catch {
      /* yut */
    }
    if (res.status === 429) throw new Error(reason || 'Günlük analiz hakkınız doldu. Yarın tekrar deneyin.');
    if (res.status === 403) throw new Error(reason || 'İstek reddedildi.');
    throw new Error(reason || `Analiz başarısız (${res.status}).`);
  }
  return (await res.json()) as AnalyzeResult;
}

/**
 * 90 gün takip aboneliği — web'deki e-posta yakalama (double-opt-in) ile aynı uç.
 * Onay maili gönderir; kullanıcı linke tıklayınca aktifleşir.
 *
 * consent CAGIRANDAN gelir: sunucu onay anini (consentAt) kayda yaziyor; eskiden
 * burada sabit `consent: true` gonderiliyordu, yani kullanicinin hic gormedigi bir
 * onay kutusu "isaretlendi" diye saklaniyordu (KVKK). Govdeye yalniz sunucunun
 * bildigi alanlar yazilir — DTO'ya gecilirse forbidNonWhitelisted fazla alani reddeder.
 */
export async function subscribeCitation(input: {
  email: string;
  domain: string;
  brand?: string;
  niche?: string;
  customNiche?: string;
  locale?: string;
  consent: boolean;
}): Promise<{ ok: true; status: string; alreadyActive: boolean }> {
  if (!input.consent) throw new Error(SUBSCRIBE_CONSENT_REQUIRED);
  let res: Response;
  try {
    res = await fetch(`${API_BASE}/api/public/citation-check/subscribe`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'User-Agent': UA,
      },
      body: JSON.stringify({
        email: input.email,
        domain: input.domain,
        brand: input.brand,
        niche: input.niche,
        customNiche: input.customNiche,
        locale: input.locale,
        consent: input.consent,
      }),
    });
  } catch {
    throw new Error('Bağlantı kurulamadı. İnternet bağlantını kontrol edip tekrar dene.');
  }
  if (!res.ok) throw new Error(subscribeErrorMessage(res.status, await reason(res)));
  return (await res.json()) as { ok: true; status: string; alreadyActive: boolean };
}

export const SUBSCRIBE_CONSENT_REQUIRED = 'Takibi başlatmak için e-posta onay kutusunu işaretlemelisin.';

/**
 * Abonelik hatasini kullanicinin anlayacagi metne cevirir. Sunucu metni varsa o
 * gosterilir (ornegin gecersiz e-posta); 403/429 gibi durumlarda metin bos ya da
 * teknik olabildigi icin acik bir yonlendirme verilir. Uc kotuye kullanima karsi
 * sertlestiriliyor (dogrulama/limit) — o durumda ne oldugu acikca soylenir.
 */
export function subscribeErrorMessage(status: number, serverMessage: string): string {
  if (status === 429) return 'Kısa sürede çok fazla deneme yapıldı. Biraz bekleyip tekrar dene.';
  if (status === 403) {
    return serverMessage
      ? `Takip isteği doğrulanamadı: ${serverMessage}`
      : 'Takip isteği doğrulanamadı. Biraz sonra tekrar dene.';
  }
  return serverMessage || `Abonelik başarısız (${status}).`;
}

/* ══════════════ Kimlikli (authed) uçlar — Bearer <token> ══════════════ */
/**
 * Token bir NextAuth JWT'si (Google girişinden) ya da bir `luvi_` API anahtarı olabilir;
 * backend AuthGuard ikisini de kabul ediyor.
 */

export interface Site {
  id: string;
  name: string;
  url: string;
  niche?: string | null;
  language?: string;
  status?: string;
}

/** Ortak authed fetch — /api ön eki + Bearer başlığı + tarayıcı UA. */
export async function authedFetch(token: string, path: string, init?: RequestInit): Promise<Response> {
  return fetch(`${API_BASE}/api${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'User-Agent': UA,
      Authorization: `Bearer ${token}`,
      ...(init?.headers ?? {}),
    },
  });
}

async function reason(res: Response): Promise<string> {
  try {
    // Nest dogrulama hatasinda message bir dizi olabilir
    const m = (await res.json())?.message;
    if (Array.isArray(m)) return m.filter((x) => typeof x === 'string').join(' ');
    return typeof m === 'string' ? m : '';
  } catch {
    return '';
  }
}

/** Kimlikli GET — 401'de oturum mesaji, diger hatalarda sunucu metni ya da durum kodu */
async function authedGetJson<T>(token: string, path: string, what: string): Promise<T> {
  const res = await authedFetch(token, path);
  if (res.status === 401) throw new Error((await reason(res)) || 'Oturum geçersiz. Tekrar bağlan.');
  if (!res.ok) throw new Error((await reason(res)) || `${what} alınamadı (${res.status}).`);
  return (await res.json()) as T;
}

/**
 * Native Google girişi — cihazdan gelen Google ID token'ı sunucuda doğrulanır (imza+audience),
 * karşılığında session JWT döner. Token doğrudan Google'dan geldiği için phishing riski yok.
 */
export async function mobileGoogleLogin(idToken: string): Promise<string> {
  const res = await fetch(`${API_BASE}/api/auth/mobile/google`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'User-Agent': UA },
    body: JSON.stringify({ idToken }),
  });
  if (!res.ok) throw new Error((await reason(res)) || `Google girişi başarısız (${res.status}).`);
  const data = (await res.json()) as { token?: string };
  if (!data.token) throw new Error('Token alınamadı.');
  return data.token;
}

/**
 * Native Apple girişi — Apple identity token'ı sunucuda Apple JWKS ile doğrulanır (imza+audience+nonce),
 * karşılığında session JWT döner. email/fullName yalnızca ilk girişte gönderilir.
 */
export async function mobileAppleLogin(input: {
  identityToken: string;
  rawNonce: string;
  fullName?: string;
  /** Sunucu Apple'dan refresh token alıp saklar — hesap silmede Apple token'ı iptal edilebilsin */
  authorizationCode?: string;
}): Promise<string> {
  const res = await fetch(`${API_BASE}/api/auth/mobile/apple`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'User-Agent': UA },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error((await reason(res)) || `Apple girişi başarısız (${res.status}).`);
  const data = (await res.json()) as { token?: string };
  if (!data.token) throw new Error('Token alınamadı.');
  return data.token;
}

/** Kullanıcının siteleri — token doğrulaması da bu uçla yapılır. */
export async function listSites(token: string): Promise<Site[]> {
  const res = await authedFetch(token, '/sites');
  if (res.status === 401) throw new Error('Anahtar geçersiz veya süresi dolmuş.');
  if (!res.ok) throw new Error((await reason(res)) || `Siteler alınamadı (${res.status}).`);
  return (await res.json()) as Site[];
}

/* ══════════════ Hesap özeti ve bildirimler (ana sayfa) ══════════════ */
/**
 * Sunucu: apps/api/src/me/me.controller.ts (GET /me, GET /me/dashboard) ve
 * apps/api/src/notifications/notifications.controller.ts. Ana sayfa yalniz bu
 * uclardan gelen GERCEK veriyi gosterir; eskiden burada sabit "+12 citation",
 * "−23% CPI" cipleri ve uydurma bir akis vardi.
 */

/** GET /me — oturumun ait oldugu hesap (silme ekrani hangi hesabin silinecegini bununla gosterir) */
export interface AccountMe {
  id: string;
  email: string | null;
  name: string | null;
  role?: string;
  plan?: string;
  subscriptionStatus?: string;
}

export function getMe(token: string): Promise<AccountMe> {
  return authedGetJson<AccountMe>(token, '/me', 'Hesap bilgisi');
}

/** GET /me/dashboard — web panelindeki hesap ozetiyle ayni sayilar (admin.service getMyDashboard) */
export interface MyDashboard {
  plan?: string;
  subscriptionStatus?: string;
  sitesCount: number;
  articlesPublished: number;
  /** taslak / uretimde / duzenlemede / yayina hazir yazilar */
  drafts: number;
  articlesUsedThisMonth: number;
  /**
   * Makale kotasi (api billing/article-quota-view.ts): ay basi sifirlamasi uygulanmis
   * sayac + plan limiti; denemede (plan TRIAL) limit omur boyu, aylik sifirlanmaz.
   * Eski sunucuda alan yok, sunucu kotayi okuyamazsa null. article-quota.ts
   * readArticleQuota yine savunmaci okur (sayi uydurulmaz).
   */
  articleQuota?: { limit: number; remaining: number; used: number } | null;
}

export function getMyDashboard(token: string): Promise<MyDashboard> {
  return authedGetJson<MyDashboard>(token, '/me/dashboard', 'Hesap özeti');
}

/** GET /notifications — tarama tamamlandı, AI görünürlük düşüşü gibi gerçek olaylar */
export interface AppNotification {
  id: string;
  type: string;
  title: string;
  body?: string | null;
  readAt?: string | null;
  createdAt: string;
}

export function listNotifications(token: string, limit = 5): Promise<AppNotification[]> {
  return authedGetJson<AppNotification[]>(token, `/notifications?limit=${limit}`, 'Bildirimler');
}

/** GET /notifications/unread-count — sunucu duz sayi doner */
export async function getUnreadCount(token: string): Promise<number> {
  const n = await authedGetJson<unknown>(token, '/notifications/unread-count', 'Bildirim sayısı');
  return typeof n === 'number' && Number.isFinite(n) ? n : 0;
}

/* ══════════════ ASO — takip edilen uygulamalar (gerçek veri) ══════════════ */
/** Sunucu: apps/api/src/aso/aso.controller.ts (listApps / getApp) — sema TrackedApp / TrackedAppKeyword */
export interface AsoTrackedApp {
  id: string;
  name: string;
  appStoreId: string | null;
  playStoreId: string | null;
  country?: string;
  iconUrl: string | null;
  developer: string | null;
  iosRating: number | null;
  iosReviewCount: number | null;
  androidRating: number | null;
  androidReviewCount: number | null;
  lastFetchedAt?: string | null;
  isActive?: boolean;
  _count?: { keywords?: number; reviews?: number };
}

export interface AsoKeyword {
  id: string;
  keyword: string;
  store: 'IOS' | 'ANDROID';
  /** null = son olcumde ilk sonuclarda yok ya da hic olculmedi (lastCheckedAt ayirir) */
  currentRank: number | null;
  previousRank: number | null;
  bestRank: number | null;
  lastCheckedAt: string | null;
  isActive?: boolean;
}

export interface AsoAppDetail extends AsoTrackedApp {
  keywords: AsoKeyword[];
}

export function listAsoApps(token: string, siteId: string): Promise<AsoTrackedApp[]> {
  return authedGetJson<AsoTrackedApp[]>(token, `/sites/${encodeURIComponent(siteId)}/aso/apps`, 'Uygulamalar');
}

export function getAsoApp(token: string, siteId: string, appId: string): Promise<AsoAppDetail> {
  return authedGetJson<AsoAppDetail>(
    token,
    `/sites/${encodeURIComponent(siteId)}/aso/apps/${encodeURIComponent(appId)}`,
    'Uygulama',
  );
}

/** Sunucu: apps/api/src/aso/asa/asa.controller.ts — bagli Apple Search Ads hesaplari */
export interface AsaAccountSummary {
  id: string;
  isActive: boolean;
  lastSyncAt?: string | null;
}

/**
 * GET .../aso/asa/performance — gunluk cron'un (asa.cron.ts) yazdigi satirlarin toplami.
 * spendUsd alani hesabin para biriminde olabilir (asa.service fetchPerformance uyarisi);
 * bu yuzden uygulama harcamayi para birimi simgesiyle gostermez.
 */
export interface AsaPerformanceSummary {
  daysBack: number;
  totals: {
    impressions: number;
    taps: number;
    installs: number;
    spendUsd: number;
    ttr: number;
    conversionRate: number;
  };
  dailyRows: { date: string }[];
}

export function listAsaAccounts(token: string, siteId: string): Promise<AsaAccountSummary[]> {
  return authedGetJson<AsaAccountSummary[]>(token, `/sites/${encodeURIComponent(siteId)}/aso/asa/accounts`, 'Apple Search Ads hesabı');
}

export function getAsaPerformance(token: string, siteId: string, daysBack = 30): Promise<AsaPerformanceSummary> {
  return authedGetJson<AsaPerformanceSummary>(
    token,
    `/sites/${encodeURIComponent(siteId)}/aso/asa/performance?daysBack=${daysBack}`,
    'Apple Search Ads performansı',
  );
}

export interface AsoApp {
  id: string;
  store?: 'IOS' | 'ANDROID';
  name: string;
  developer?: string;
  icon?: string;
  rating?: number | null;
  reviewCount?: number | null;
  category?: string | null;
}

/** ASO — mağaza uygulama araması (gerçek iTunes/Play verisi). Backend `{ results }` döner. */
export async function asoSearch(
  token: string,
  siteId: string,
  term: string,
  store: 'IOS' | 'ANDROID' | 'BOTH' = 'BOTH',
  country = 'tr',
): Promise<AsoApp[]> {
  const q = new URLSearchParams({ term, store, country }).toString();
  const res = await authedFetch(token, `/sites/${siteId}/aso/search?${q}`);
  if (res.status === 401) throw new Error('Oturum geçersiz. Tekrar bağlan.');
  if (!res.ok) throw new Error((await reason(res)) || `Arama başarısız (${res.status}).`);
  const data = (await res.json()) as { results?: AsoApp[] };
  return data.results ?? [];
}

/* ══════════════ Hesap silme (Apple 5.1.1(v)) ══════════════ */
/**
 * Sunucu: apps/api/src/me/me.controller.ts. Uçlar yalnız oturum token'ı kabul eder
 * (`luvi_` API anahtarı 403 alır) — hesap silmek kimliği doğrulanmış sahibin kararı.
 * Politika: erişim hemen kapanır, veriler 30 gün sonra kalıcı silinir.
 */
export const DELETE_ACCOUNT_CONFIRMATION = 'DELETE_MY_ACCOUNT';

export interface AccountDeletionStatus {
  purgeAfterDays: number;
  blockers: { code: 'agency_has_clients' | 'admin_account'; message: string; clientCount?: number }[];
  subscriptionActive: boolean;
  plan: string;
  signInProviders: string[];
  apple: { linked: boolean; configured: boolean; tokenStored: boolean };
}

export type AppleRevokeOutcome = 'not_linked' | 'not_configured' | 'revoked' | 'no_token' | 'failed';

export interface AccountDeletionResult {
  ok: true;
  alreadyRequested: boolean;
  deletionRequestedAt: string;
  purgeAfter: string;
  purgeAfterDays: number;
  apple: AppleRevokeOutcome | null;
}

export async function getAccountDeletionStatus(token: string): Promise<AccountDeletionStatus> {
  const res = await authedFetch(token, '/me/account-deletion');
  // 401 gövdesi silme talebi zaten alındıysa bunu söyler — sunucu mesajı öncelikli
  if (res.status === 401) throw new Error((await reason(res)) || 'Oturum geçersiz. Tekrar giriş yap.');
  if (!res.ok) throw new Error((await reason(res)) || `Bilgiler alınamadı (${res.status}).`);
  return (await res.json()) as AccountDeletionStatus;
}

export async function deleteAccount(token: string, opts: { appleAuthorizationCode?: string } = {}): Promise<AccountDeletionResult> {
  const res = await authedFetch(token, '/me/delete-account', {
    method: 'POST',
    body: JSON.stringify({ confirm: DELETE_ACCOUNT_CONFIRMATION, appleAuthorizationCode: opts.appleAuthorizationCode }),
  });
  if (res.status === 401) throw new Error((await reason(res)) || 'Oturum geçersiz. Tekrar giriş yap.');
  if (!res.ok) throw new Error((await reason(res)) || `Silme talebi gönderilemedi (${res.status}).`);
  return (await res.json()) as AccountDeletionResult;
}

/** Ajans sahibi: müşteri hesaplarını ajanstan ayırır (hesaplar ve verileri silinmez) */
export async function detachAgencyClients(token: string): Promise<{ detached: number }> {
  const res = await authedFetch(token, '/me/agency-clients/detach', { method: 'POST', body: JSON.stringify({ confirm: true }) });
  if (!res.ok) throw new Error((await reason(res)) || `Müşteri bağlantıları kaldırılamadı (${res.status}).`);
  return (await res.json()) as { detached: number };
}
