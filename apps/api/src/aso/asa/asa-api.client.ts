import { createPrivateKey, createSign } from 'node:crypto';

/**
 * Apple Search Ads API Client
 * ===========================
 *
 * Apple'in Search Ads Campaign Management API'si için low-level REST wrapper.
 *
 * Auth: ES256 JWT (private key + Apple-issued IDs)
 *   - Client Secret = JWT (signed with .p8 private key, ES256)
 *   - JWT 'sub' = client_id (= Key ID), 'iss' = team_id (Org ID), 'aud' = 'https://appleid.apple.com'
 *   - JWT max exp = 180 gün
 *
 * Token swap:
 *   POST https://appleid.apple.com/auth/oauth2/token
 *     grant_type=client_credentials
 *     client_id={KEY_ID}
 *     client_secret={JWT}
 *     scope=searchadsorg
 *   → access_token (1 saat geçerli)
 *
 * API calls:
 *   Header: Authorization: Bearer {access_token}
 *           X-AP-Context: orgId={ORG_ID}
 *
 * Doc: https://developer.apple.com/documentation/apple_search_ads
 */

const APPLE_AUTH_URL = 'https://appleid.apple.com/auth/oauth2/token';
const ASA_API_BASE = 'https://api.searchads.apple.com/api/v5';

export interface AsaCredentials {
  orgId: string;        // Apple Organization ID (used as JWT iss)
  keyId: string;        // Apple Key ID (used as JWT sub + client_id)
  privateKeyPem: string; // .p8 file content (PEM-encoded EC private key)
  teamId?: string;      // Opsiyonel — multi-team setup
}

export interface AsaAccessToken {
  accessToken: string;
  expiresAt: Date; // UTC
  tokenType: string; // 'Bearer'
}

export class AsaApiClient {
  private cachedToken: AsaAccessToken | null = null;
  private cachedNumericOrgId: number | null = null;

  constructor(private readonly creds: AsaCredentials) {}

  /**
   * Apple Search Ads API'nin X-AP-Context header'ı **numeric** orgId bekler
   * (NOT clientId / "SEARCHADS.uuid"). Bu ID'yi /acls endpoint'i döner.
   * /acls çağrısı X-AP-Context gerektirmez (yetkilendirme listesi).
   */
  private async getNumericOrgId(): Promise<number> {
    if (this.cachedNumericOrgId) return this.cachedNumericOrgId;
    const token = await this.getAccessToken();
    const res = await fetch(`${ASA_API_BASE}/acls`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${token.accessToken}` },
    });
    if (!res.ok) {
      const errBody = await res.text().catch(() => '');
      throw new Error(`ASA /acls → ${res.status}: ${errBody.slice(0, 300)}`);
    }
    const data = (await res.json()) as { data?: Array<{ orgId?: number; orgName?: string }> };
    const first = data?.data?.[0];
    if (!first?.orgId) {
      throw new Error('ASA /acls: numeric orgId bulunamadı (response: ' + JSON.stringify(data).slice(0, 200) + ')');
    }
    this.cachedNumericOrgId = first.orgId;
    return first.orgId;
  }

  /** Public: explicit numeric orgId fetch (initial setup için kullanılır) */
  async fetchNumericOrgId(): Promise<number> {
    return this.getNumericOrgId();
  }

  /**
   * ES256 JWT oluştur (client_secret olarak kullanılır).
   *
   * Apple Search Ads "Open API" JWT spec (resmi doc):
   *   Header:  { alg: ES256, kid: keyId }              ← keyId = UUID
   *   Payload: { iss: clientId, sub: clientId,         ← Apple: iss=sub=clientId
   *              aud: "https://appleid.apple.com",
   *              iat: now, exp: now + N seconds }
   *
   * NOT: RanksUp form'unda "Organization ID" = clientId olarak kullanılıyor.
   * "Key ID" = UUID formatlı keyId (NOT clientId).
   */
  private generateClientSecretJwt(expSeconds = 60 * 60): string {
    const now = Math.floor(Date.now() / 1000);
    const clientId = this.creds.orgId; // "Organization ID" form alanı clientId değerini taşır
    const header = { alg: 'ES256', kid: this.creds.keyId };
    const payload = {
      iss: clientId,                             // Apple: iss = clientId
      sub: clientId,                             // Apple: sub = clientId (iss ile aynı)
      aud: 'https://appleid.apple.com',
      iat: now,
      exp: now + expSeconds,
    };

    const encodedHeader = base64UrlEncode(Buffer.from(JSON.stringify(header)));
    const encodedPayload = base64UrlEncode(Buffer.from(JSON.stringify(payload)));
    const signingInput = `${encodedHeader}.${encodedPayload}`;

    // ES256 sign (private key PEM .p8)
    const key = createPrivateKey({ key: this.creds.privateKeyPem, format: 'pem' });
    const sign = createSign('SHA256');
    sign.update(signingInput);
    sign.end();
    const derSignature = sign.sign(key);
    // ES256: DER → raw R||S (64 bytes)
    const rawSignature = derToRawEcdsa(derSignature, 32);
    const encodedSignature = base64UrlEncode(rawSignature);

    return `${signingInput}.${encodedSignature}`;
  }

  /**
   * Access token al + cache. Apple'in dönüşü 1 saat geçerli.
   */
  async getAccessToken(forceRefresh = false): Promise<AsaAccessToken> {
    const now = new Date();
    if (
      !forceRefresh &&
      this.cachedToken &&
      this.cachedToken.expiresAt.getTime() - now.getTime() > 60_000 // 1 dk margin
    ) {
      return this.cachedToken;
    }

    const clientSecret = this.generateClientSecretJwt();
    const body = new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: this.creds.orgId, // Apple Open API: client_id = clientId (orgId form alanında)
      client_secret: clientSecret,
      scope: 'searchadsorg',
    });

    const res = await fetch(APPLE_AUTH_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });
    if (!res.ok) {
      const errBody = await res.text().catch(() => '');
      throw new Error(`Apple token swap failed: ${res.status} ${errBody.slice(0, 300)}`);
    }
    const data = (await res.json()) as { access_token: string; expires_in: number; token_type: string };
    this.cachedToken = {
      accessToken: data.access_token,
      expiresAt: new Date(now.getTime() + (data.expires_in - 60) * 1000),
      tokenType: data.token_type ?? 'Bearer',
    };
    return this.cachedToken;
  }

  /**
   * Authenticated REST çağrısı. Apple'in standart cevap formu: { data: ..., pagination: ..., error: ... }
   */
  async request<T = any>(
    method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
    path: string,
    body?: any,
  ): Promise<T> {
    const token = await this.getAccessToken();
    const url = path.startsWith('http') ? path : `${ASA_API_BASE}${path.startsWith('/') ? path : `/${path}`}`;

    const numericOrgId = await this.getNumericOrgId();
    const res = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${token.accessToken}`,
        'X-AP-Context': `orgId=${numericOrgId}`,
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!res.ok) {
      const errBody = await res.text().catch(() => '');
      throw new Error(`ASA ${method} ${path} → ${res.status}: ${errBody.slice(0, 400)}`);
    }

    return (await res.json()) as T;
  }

  // ─── Helper endpoint wrappers ─────────────────────────

  /** Mevcut kampanyaları listele */
  async listCampaigns(opts: { limit?: number; offset?: number } = {}) {
    const qs = new URLSearchParams();
    if (opts.limit) qs.set('limit', String(opts.limit));
    if (opts.offset) qs.set('offset', String(opts.offset));
    const tail = qs.toString() ? `?${qs.toString()}` : '';
    return this.request<{ data: any[]; pagination: any }>('GET', `/campaigns${tail}`);
  }

  /** Yeni kampanya oluştur */
  async createCampaign(payload: {
    name: string;
    budgetAmount: { amount: string; currency: string };
    dailyBudgetAmount?: { amount: string; currency: string };
    countriesOrRegions: string[];
    adamId: number;                // Apple App ID
    supplySources?: string[];
    paymentModel?: 'PAYG' | 'LOC';
    adChannelType?: 'SEARCH' | 'DISPLAY';
    billingEvent?: 'TAPS' | 'IMPRESSIONS';
  }) {
    // adChannelType + billingEvent Apple'da zorunlu.
    // SEARCH ads için billingEvent = TAPS (cost per tap = en yaygın).
    const body = { adChannelType: 'SEARCH' as const, billingEvent: 'TAPS' as const, ...payload };
    return this.request<{ data: any }>('POST', '/campaigns', body);
  }

  /** Adgroup ekle (kampanya altına) */
  async createAdGroup(campaignId: string, payload: {
    name: string;
    defaultBidAmount: { amount: string; currency: string };
    startTime: string; // ISO
    endTime?: string;
    targetingDimensions?: any;
    pricingModel?: 'CPC' | 'CPM';
    automatedKeywordsOptIn?: boolean;
  }) {
    // pricingModel Apple'da zorunlu. CPC = cost per click/tap (SEARCH ads default).
    const body = { pricingModel: 'CPC' as const, automatedKeywordsOptIn: false, ...payload };
    return this.request<{ data: any }>('POST', `/campaigns/${campaignId}/adgroups`, body);
  }

  /** Adgroup'a keyword ekle (bid bazlı) */
  async addTargetingKeywords(
    campaignId: string,
    adGroupId: string,
    keywords: Array<{ text: string; matchType: 'EXACT' | 'BROAD'; bidAmount: { amount: string; currency: string } }>,
  ) {
    return this.request<{ data: any[] }>(
      'POST',
      `/campaigns/${campaignId}/adgroups/${adGroupId}/targetingkeywords/bulk`,
      keywords,
    );
  }

  /** Adgroup keyword'lerini listele */
  async listTargetingKeywords(campaignId: string, adGroupId: string) {
    return this.request<{ data: any[] }>(
      'GET',
      `/campaigns/${campaignId}/adgroups/${adGroupId}/targetingkeywords`,
    );
  }

  /** Bid güncelle */
  async updateTargetingKeyword(
    campaignId: string,
    adGroupId: string,
    keywordId: string,
    payload: { bidAmount: { amount: string; currency: string }; status?: 'ACTIVE' | 'PAUSED' },
  ) {
    return this.request<{ data: any }>(
      'PUT',
      `/campaigns/${campaignId}/adgroups/${adGroupId}/targetingkeywords/${keywordId}`,
      payload,
    );
  }

  /** Performance raporu (campaigns) */
  async getCampaignReport(payload: {
    startTime: string; // 'YYYY-MM-DD'
    endTime: string;
    selector?: any;
    groupBy?: string[];
    timeZone?: 'UTC' | 'ORTZ';
    returnRowTotals?: boolean;
    returnRecordsWithNoMetrics?: boolean;
    granularity?: 'HOURLY' | 'DAILY' | 'WEEKLY' | 'MONTHLY';
  }) {
    return this.request<{ data: { reportingDataResponse: { row: any[] } } }>(
      'POST',
      '/reports/campaigns',
      payload,
    );
  }

  /** Keyword search volume / suggestion (popularity index) — Apple internal */
  async getKeywordSuggestions(adGroupId: string, payload: {
    keywords?: string[];
    locale?: string;
  }) {
    // Apple endpoint: GET /search-terms/{adgroupId} — opsiyonel, sadece bazı hesaplarda
    return this.request<{ data: any[] }>('GET', `/adgroups/${adGroupId}/searchterms`);
  }
}

// ─────────────────────────────────────────────────────
//  Utilities — base64url + ECDSA DER→raw
// ─────────────────────────────────────────────────────

function base64UrlEncode(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * Node crypto.sign() ES256 sonucu DER-encoded (variable length).
 * JWT spec ise R||S formatında raw 64 byte ister.
 * Bu function DER'i parse edip raw 64-byte buffer döner.
 */
function derToRawEcdsa(der: Buffer, byteLength: number): Buffer {
  let offset = 0;
  if (der[offset++] !== 0x30) throw new Error('Invalid DER signature: missing sequence');
  // Length (short or long form)
  if (der[offset] & 0x80) {
    offset += 1 + (der[offset] & 0x7f); // skip long-form length bytes
  } else {
    offset += 1;
  }
  if (der[offset++] !== 0x02) throw new Error('Invalid DER signature: missing R INTEGER');
  let rLen = der[offset++];
  let r = der.subarray(offset, offset + rLen);
  offset += rLen;
  if (der[offset++] !== 0x02) throw new Error('Invalid DER signature: missing S INTEGER');
  let sLen = der[offset++];
  let s = der.subarray(offset, offset + sLen);

  // Strip leading zeros + left-pad to byteLength
  r = padOrTrim(r, byteLength);
  s = padOrTrim(s, byteLength);

  return Buffer.concat([r, s]);
}

function padOrTrim(buf: Buffer, len: number): Buffer {
  if (buf.length === len) return buf;
  if (buf.length > len) return buf.subarray(buf.length - len); // strip leading 0x00
  const padded = Buffer.alloc(len);
  buf.copy(padded, len - buf.length);
  return padded;
}
