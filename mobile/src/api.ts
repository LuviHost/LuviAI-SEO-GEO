/**
 * RanksUp API istemcisi — gerçek üretim uçları (api.ranksup.ai).
 * Şimdilik yalnızca public (kimlik gerektirmeyen) site analizi.
 * Web'in landing'de yaptığı "Markanız AI'da görünüyor mu?" testinin aynısı.
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
}
export interface QueryResult {
  query: string;
  providers: ProbeResult[];
  citedCount: number;
  totalProviders: number;
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
 * Bir alan adını 7 AI motorunda gerçek olarak analiz eder.
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
 */
export async function subscribeCitation(input: {
  email: string;
  domain: string;
  brand?: string;
  niche?: string;
  customNiche?: string;
  locale?: string;
}): Promise<{ ok: true; status: string; alreadyActive: boolean }> {
  const res = await fetch(`${API_BASE}/api/public/citation-check/subscribe`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'User-Agent': UA,
    },
    body: JSON.stringify({ ...input, consent: true }),
  });
  if (!res.ok) {
    let reason = '';
    try {
      reason = (await res.json())?.message ?? '';
    } catch {
      /* yut */
    }
    throw new Error(reason || `Abonelik başarısız (${res.status}).`);
  }
  return (await res.json()) as { ok: true; status: string; alreadyActive: boolean };
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
    return (await res.json())?.message ?? '';
  } catch {
    return '';
  }
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

export interface StudioTextResult {
  ok: boolean;
  assetId: string;
  text: string;
  costUsd: number;
  tokens: number;
}

/** Studio — gerçek LLM ile metin üretimi (kimlik gerektirir). */
export async function studioGenerateText(
  token: string,
  siteId: string,
  input: { prompt: string; format?: 'short' | 'medium' | 'long'; tone?: string; language?: 'tr' | 'en' },
): Promise<StudioTextResult> {
  const res = await authedFetch(token, `/sites/${siteId}/studio/text`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
  if (res.status === 401) throw new Error('Oturum geçersiz. Tekrar bağlan.');
  if (!res.ok) throw new Error((await reason(res)) || `Üretim başarısız (${res.status}).`);
  return (await res.json()) as StudioTextResult;
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
