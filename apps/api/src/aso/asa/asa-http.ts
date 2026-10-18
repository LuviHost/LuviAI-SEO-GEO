import { createPrivateKey, sign as cryptoSign } from 'node:crypto';
import { AsaApiError, asaErrorFromResponse, type AsaAccessToken, type AsaApiVersion } from './asa-types.js';

/**
 * Apple Ads ortak HTTP + OAuth katmani (v5 ve Platform API ayni akisi kullanir).
 *
 * Kimlik dogrulama iki surumde AYNI: client-credentials, client secret = ES256 JWT
 *   header  { alg: ES256, kid: keyId }
 *   payload { iss: teamId, sub: clientId, aud: https://appleid.apple.com, iat, exp }
 *   POST https://appleid.apple.com/auth/oauth2/token  scope=searchadsorg
 * Kaynak 1: https://developer.apple.com/documentation/apple-ads-platform-api/implementing-oauth-for-the-apple-ads-platform-api
 * Kaynak 2: Apple'in Node istemcisi src/auth/constants.ts + ephemeral-client-secret-provider.ts
 *           (github.com/apple/apple-ads-platform-api-node) — ayni degerler.
 *
 * Hiz siniri: 429'da Retry-After (yoksa RateLimit-Reset, o da yoksa 2→4→8→16 sn
 * ustel bekleme), Platform her cevapta RateLimit-* basliklari doner; kalan kota
 * azsa bir sonraki istekten once pencere sifirlanana kadar beklenir.
 *   https://developer.apple.com/documentation/apple-ads-platform-api/rate-limits
 *   https://developer.apple.com/documentation/apple_ads/calling-the-apple-search-ads-api (v5: 2→16 sn)
 */

export const APPLE_AUTH_URL = 'https://appleid.apple.com/auth/oauth2/token';
const AUTH_AUDIENCE = 'https://appleid.apple.com';
const OAUTH_SCOPE = 'searchadsorg';

export interface AsaCredentials {
  /** Apple clientId (SEARCHADS.xxx). Tarihsel nedenle DB'de "orgId" adiyla tutuluyor. */
  orgId: string;
  /** Apple keyId (UUID) — JWT header kid */
  keyId: string;
  /** PEM ozel anahtar (PKCS8 "PRIVATE KEY" ya da SEC1 "EC PRIVATE KEY") */
  privateKeyPem: string;
  /** Apple teamId (SEARCHADS.xxx) — JWT iss. Verilmezse clientId kullanilir. */
  teamId?: string;
}

export interface AsaClientDeps {
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  /** Tek istek zaman asimi (ms) */
  timeoutMs?: number;
  /** 429 sonrasi en fazla tekrar */
  maxRateLimitRetries?: number;
  /** 5xx / ag hatasi sonrasi en fazla tekrar (yalnizca idempotent istekler) */
  maxServerRetries?: number;
  /** Tek beklemenin ust siniri; Retry-After bundan buyukse beklenmez, hata doner */
  maxWaitMs?: number;
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function base64UrlEncode(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * Client secret JWT. iss = teamId: Apple iki surumde de boyle istiyor; eski kod
 * iss'e clientId yaziyordu — cogu hesapta ikisi ayni oldugu icin calisiyordu,
 * farkli olan hesaplarda invalid_client donerdi.
 */
export function buildClientSecretJwt(creds: AsaCredentials, nowSec: number, expSeconds = 60 * 60): string {
  const clientId = creds.orgId;
  const header = { alg: 'ES256', kid: creds.keyId };
  const payload = {
    iss: creds.teamId && creds.teamId.trim() ? creds.teamId.trim() : clientId,
    sub: clientId,
    aud: AUTH_AUDIENCE,
    iat: nowSec,
    exp: nowSec + expSeconds, // Apple ust siniri 180 gun; kisa tutuyoruz
  };
  const signingInput = `${base64UrlEncode(Buffer.from(JSON.stringify(header)))}.${base64UrlEncode(Buffer.from(JSON.stringify(payload)))}`;
  const key = createPrivateKey({ key: creds.privateKeyPem, format: 'pem' });
  // ES256 JWT imzasi DER degil ham R||S (64 bayt) olmali → ieee-p1363
  const signature = cryptoSign('sha256', Buffer.from(signingInput), { key, dsaEncoding: 'ieee-p1363' });
  return `${signingInput}.${base64UrlEncode(signature)}`;
}

/** Access token takasi (1 saat gecerli). */
export async function fetchAppleAccessToken(
  creds: AsaCredentials,
  apiVersion: AsaApiVersion,
  deps: AsaClientDeps = {},
): Promise<AsaAccessToken> {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const nowMs = (deps.now ?? Date.now)();
  const clientSecret = buildClientSecretJwt(creds, Math.floor(nowMs / 1000));
  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: creds.orgId,
    client_secret: clientSecret,
    scope: OAUTH_SCOPE,
  });

  let res: Response;
  try {
    res = await fetchImpl(APPLE_AUTH_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
      signal: AbortSignal.timeout(deps.timeoutMs ?? 30_000),
    });
  } catch (err: any) {
    throw new AsaApiError(`Apple token swap failed: ağ hatası (${err?.message ?? err})`, {
      kind: err?.name === 'TimeoutError' ? 'timeout' : 'network',
      apiVersion,
    });
  }
  if (!res.ok) {
    const errBody = await res.text().catch(() => '');
    // Mesaj bicimi korunuyor: web baglanti ekrani "invalid_client|400" arar
    throw new AsaApiError(`Apple token swap failed: ${res.status} ${errBody.slice(0, 300)}`, {
      kind: 'auth',
      status: res.status,
      apiVersion,
    });
  }
  const data = (await res.json().catch(() => null)) as { access_token?: string; expires_in?: number; token_type?: string } | null;
  if (!data?.access_token) {
    throw new AsaApiError('Apple token swap failed: access_token dönmedi', { kind: 'auth', status: res.status, apiVersion });
  }
  const expiresIn = Number.isFinite(data.expires_in) && (data.expires_in as number) > 0 ? (data.expires_in as number) : 3600;
  return {
    accessToken: data.access_token,
    expiresAt: new Date(nowMs + Math.max(expiresIn - 60, 30) * 1000),
    tokenType: data.token_type ?? 'Bearer',
  };
}

export interface AsaRequestSpec {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  url: string;
  /** Hata mesajinda gorunen kisa yol */
  path: string;
  headers?: Record<string, string>;
  body?: unknown;
  /**
   * Tekrar denemek guvenli mi? Olusturma (POST /campaigns vb.) 5xx sonrasi
   * TEKRARLANMAZ: Apple islemis olabilir, ikinci deneme kopya kampanya acar.
   * 429 her zaman tekrarlanir — istek islenmeden reddedilmistir.
   */
  idempotent: boolean;
}

function headerSeconds(headers: Headers, name: string, nowMs: number): number | null {
  const raw = headers.get(name);
  if (raw === null || raw.trim() === '') return null;
  const n = Number(raw.trim());
  if (Number.isFinite(n) && n >= 0) return n;
  // Retry-After HTTP-date de olabilir
  const at = Date.parse(raw);
  return Number.isFinite(at) ? Math.max(0, (at - nowMs) / 1000) : null;
}

/** Tek bir API surumune bagli istek yurutucu: tempo, tekrar, 401 yenileme, hata normalizasyonu. */
export class AsaHttp {
  private nextAllowedAt = 0;
  private readonly fetchImpl: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly now: () => number;
  private readonly timeoutMs: number;
  private readonly maxRateLimitRetries: number;
  private readonly maxServerRetries: number;
  private readonly maxWaitMs: number;

  constructor(private readonly apiVersion: AsaApiVersion, deps: AsaClientDeps = {}) {
    this.fetchImpl = deps.fetchImpl ?? fetch;
    this.sleep = deps.sleep ?? defaultSleep;
    this.now = deps.now ?? Date.now;
    this.timeoutMs = deps.timeoutMs ?? 30_000;
    this.maxRateLimitRetries = deps.maxRateLimitRetries ?? 3;
    this.maxServerRetries = deps.maxServerRetries ?? 2;
    this.maxWaitMs = deps.maxWaitMs ?? 30_000;
  }

  async send<T = any>(spec: AsaRequestSpec, getToken: (forceRefresh: boolean) => Promise<string>): Promise<T> {
    let rateRetries = 0;
    let serverRetries = 0;
    let authRetried = false;
    let forceToken = false;
    let backoffMs = 2_000;

    for (;;) {
      const waitForWindow = this.nextAllowedAt - this.now();
      if (waitForWindow > 0) await this.sleep(waitForWindow);

      const token = await getToken(forceToken);
      forceToken = false;

      let res: Response;
      try {
        res = await this.fetchImpl(spec.url, {
          method: spec.method,
          headers: {
            Accept: 'application/json',
            ...(spec.headers ?? {}),
            Authorization: `Bearer ${token}`,
            ...(spec.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
          },
          body: spec.body !== undefined ? JSON.stringify(spec.body) : undefined,
          signal: AbortSignal.timeout(this.timeoutMs),
        });
      } catch (err: any) {
        const isTimeout = err?.name === 'TimeoutError' || err?.name === 'AbortError';
        if (spec.idempotent && serverRetries < this.maxServerRetries) {
          serverRetries++;
          await this.sleep(backoffMs);
          backoffMs = Math.min(backoffMs * 2, 16_000);
          continue;
        }
        throw new AsaApiError(
          `ASA ${spec.method} ${spec.path} → ${isTimeout ? 'zaman aşımı' : 'ağ hatası'}: ${err?.message ?? err}`,
          { kind: isTimeout ? 'timeout' : 'network', apiVersion: this.apiVersion },
        );
      }

      this.notePacing(res.headers);

      // Token suresi dolmus/iptal: bir kez yenile, tekrar dene (Apple Node istemcisiyle ayni davranis)
      if (res.status === 401 && !authRetried) {
        authRetried = true;
        forceToken = true;
        await res.text().catch(() => '');
        continue;
      }

      if (res.status === 429) {
        const nowMs = this.now();
        const hinted = headerSeconds(res.headers, 'retry-after', nowMs) ?? headerSeconds(res.headers, 'ratelimit-reset', nowMs);
        const waitMs = hinted !== null ? Math.ceil(hinted * 1000) : backoffMs;
        if (rateRetries < this.maxRateLimitRetries && waitMs <= this.maxWaitMs) {
          rateRetries++;
          await res.text().catch(() => '');
          await this.sleep(waitMs);
          backoffMs = Math.min(backoffMs * 2, 16_000);
          continue;
        }
        const bodyText = await res.text().catch(() => '');
        throw asaErrorFromResponse({
          status: 429,
          bodyText,
          method: spec.method,
          path: spec.path,
          apiVersion: this.apiVersion,
          retryAfterSeconds: hinted !== null ? Math.ceil(hinted) : null,
        });
      }

      if (res.status >= 500 && spec.idempotent && serverRetries < this.maxServerRetries) {
        serverRetries++;
        await res.text().catch(() => '');
        await this.sleep(backoffMs);
        backoffMs = Math.min(backoffMs * 2, 16_000);
        continue;
      }

      const text = await res.text().catch(() => '');
      if (!res.ok) {
        throw asaErrorFromResponse({ status: res.status, bodyText: text, method: spec.method, path: spec.path, apiVersion: this.apiVersion });
      }
      if (!text) return null as T;
      try {
        return JSON.parse(text) as T;
      } catch {
        throw new AsaApiError(`ASA ${spec.method} ${spec.path} → ${res.status}: JSON olmayan cevap`, {
          kind: 'server',
          status: res.status,
          apiVersion: this.apiVersion,
        });
      }
    }
  }

  /** Kalan kota azsa (Apple ornegindeki esik: < 5) pencere sifirlanana kadar sonraki istegi beklet. */
  private notePacing(headers: Headers) {
    const remainingRaw = headers.get('ratelimit-remaining');
    if (remainingRaw === null) return;
    const remaining = Number(remainingRaw);
    const reset = headerSeconds(headers, 'ratelimit-reset', this.now());
    if (Number.isFinite(remaining) && remaining < 5 && reset !== null) {
      this.nextAllowedAt = this.now() + Math.min(Math.ceil(reset * 1000), this.maxWaitMs);
    }
  }
}
