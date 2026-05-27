import { createPrivateKey, createSign } from 'node:crypto';

/**
 * App Store Connect API Client
 * ============================
 *
 * App Store Connect API — Apple Developer'ın resmi REST API'si.
 * Reviews, releases, metadata, sales data, vs. erişim.
 *
 * Auth: ES256 JWT (max 20 dakika expiry — ASA'dan farklı, çok daha kısa)
 *
 * JWT format:
 *   Header:  { alg: ES256, kid: keyId, typ: JWT }
 *   Payload: { iss: issuerId, exp: now+20min, aud: "appstoreconnect-v1" }
 *
 * Header'da bearer olarak gönderilir; her API call için yeniden imzalanabilir
 * veya 20 dk önbelleğe alınır.
 *
 * Endpoints:
 *   GET /v1/apps                              — kullanıcının app'leri
 *   GET /v1/apps/{id}                         — app detayı
 *   GET /v1/apps/{id}/appStoreVersions        — versiyonlar
 *   GET /v1/apps/{id}/customerReviews         — yorumlar
 *   GET /v1/customerReviewResponses/{id}      — yanıt
 *
 * Doc: https://developer.apple.com/documentation/appstoreconnectapi
 */

const ASC_API_BASE = 'https://api.appstoreconnect.apple.com';

export interface AscCredentials {
  issuerId: string;           // App Store Connect Issuer ID (UUID)
  keyId: string;              // .p8 key ID
  privateKeyPem: string;      // .p8 dosya içeriği
}

export class AscApiClient {
  private cachedToken: { token: string; expAt: number } | null = null;

  constructor(private readonly creds: AscCredentials) {}

  /** ES256 JWT üret — max 20 dk exp */
  private signJwt(expSeconds = 19 * 60): string {
    const now = Math.floor(Date.now() / 1000);
    const header = { alg: 'ES256', kid: this.creds.keyId, typ: 'JWT' };
    const payload = {
      iss: this.creds.issuerId,
      exp: now + expSeconds,
      aud: 'appstoreconnect-v1',
    };
    const enc = (s: string) => Buffer.from(s).toString('base64')
      .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    const headerEnc = enc(JSON.stringify(header));
    const payloadEnc = enc(JSON.stringify(payload));
    const signingInput = `${headerEnc}.${payloadEnc}`;

    const key = createPrivateKey({ key: this.creds.privateKeyPem, format: 'pem' });
    const signer = createSign('SHA256');
    signer.update(signingInput);
    signer.end();
    const derSig = signer.sign(key);
    const rawSig = derToRawEcdsa(derSig, 32);
    const sigEnc = rawSig.toString('base64')
      .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

    return `${signingInput}.${sigEnc}`;
  }

  private getToken(): string {
    const now = Date.now();
    if (this.cachedToken && this.cachedToken.expAt - now > 60_000) return this.cachedToken.token;
    const token = this.signJwt();
    this.cachedToken = { token, expAt: now + 19 * 60 * 1000 };
    return token;
  }

  async request<T = any>(method: 'GET' | 'POST' | 'PATCH' | 'DELETE', path: string, body?: any): Promise<T> {
    const token = this.getToken();
    const url = path.startsWith('http') ? path : `${ASC_API_BASE}${path.startsWith('/') ? path : `/${path}`}`;
    const res = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      throw new Error(`ASC ${method} ${path} → ${res.status}: ${errText.slice(0, 400)}`);
    }
    return (await res.json()) as T;
  }

  // ─── Endpoint wrappers ────────────────────────────────

  /** Kullanıcının erişimi olan tüm app'leri listele */
  async listApps(limit = 200) {
    return this.request<{ data: any[] }>('GET', `/v1/apps?limit=${limit}`);
  }

  /** Tek app detayı */
  async getApp(appleAppId: string) {
    return this.request<{ data: any }>('GET', `/v1/apps/${appleAppId}`);
  }

  /** App'in store versiyonları (release'ler) */
  async listAppStoreVersions(appleAppId: string, limit = 50) {
    return this.request<{ data: any[] }>('GET', `/v1/apps/${appleAppId}/appStoreVersions?limit=${limit}&sort=-createdDate`);
  }

  /** App'in müşteri yorumları */
  async listCustomerReviews(appleAppId: string, opts: { limit?: number; sort?: 'createdDate' | '-createdDate' } = {}) {
    const qs = new URLSearchParams();
    if (opts.limit) qs.set('limit', String(opts.limit));
    qs.set('sort', opts.sort ?? '-createdDate');
    return this.request<{ data: any[]; meta?: any }>(
      'GET',
      `/v1/apps/${appleAppId}/customerReviews?${qs.toString()}`,
    );
  }

  /** Müşteri yorumuna yanıt verebilirsin */
  async replyToReview(reviewId: string, responseBody: string) {
    return this.request<{ data: any }>('POST', `/v1/customerReviewResponses`, {
      data: {
        type: 'customerReviewResponses',
        attributes: { responseBody },
        relationships: {
          review: { data: { type: 'customerReviews', id: reviewId } },
        },
      },
    });
  }
}

// ─── Utilities (ASA'dakinin aynısı) ───────────────────

function derToRawEcdsa(der: Buffer, byteLength: number): Buffer {
  let offset = 0;
  if (der[offset++] !== 0x30) throw new Error('Invalid DER signature: missing sequence');
  if (der[offset] & 0x80) offset += 1 + (der[offset] & 0x7f);
  else offset += 1;
  if (der[offset++] !== 0x02) throw new Error('Invalid DER signature: missing R INTEGER');
  let rLen = der[offset++];
  let r = der.subarray(offset, offset + rLen);
  offset += rLen;
  if (der[offset++] !== 0x02) throw new Error('Invalid DER signature: missing S INTEGER');
  let sLen = der[offset++];
  let s = der.subarray(offset, offset + sLen);
  r = padOrTrim(r, byteLength);
  s = padOrTrim(s, byteLength);
  return Buffer.concat([r, s]);
}

function padOrTrim(buf: Buffer, len: number): Buffer {
  if (buf.length === len) return buf;
  if (buf.length > len) return buf.subarray(buf.length - len);
  const padded = Buffer.alloc(len);
  buf.copy(padded, len - buf.length);
  return padded;
}
