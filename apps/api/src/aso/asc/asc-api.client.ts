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
 *   GET /v1/apps/{id}/appInfos, /v1/appInfos/{id}/appInfoLocalizations          — ad, alt baslik
 *   GET /v1/appStoreVersions/{id}/appStoreVersionLocalizations                 — aciklama, keywords, promo, yenilikler
 *   PATCH /v1/appInfoLocalizations/{id}, /v1/appStoreVersionLocalizations/{id} — metadata yazma
 *
 * Parametreler Apple'in endpoint semasindan (developer.apple.com docc JSON)
 * dogrulandi: /v1/apps/{id}/appStoreVersions `sort` KABUL ETMEZ
 * (400 PARAMETER_ERROR.ILLEGAL — kendi uygulamamizda denendi); siralama
 * istemcide createdDate ile yapilir.
 *
 * Doc: https://developer.apple.com/documentation/appstoreconnectapi
 */

const ASC_API_BASE = 'https://api.appstoreconnect.apple.com';

/** Apple'in hata govdesini tasiyan hata — 403 (rol) ve 409 (durum) ayrimi icin */
export class AscApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string | null,
    readonly detail: string | null,
  ) {
    super(message);
    this.name = 'AscApiError';
  }
}

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
      let code: string | null = null;
      let detail: string | null = null;
      try {
        const first = JSON.parse(errText)?.errors?.[0];
        code = typeof first?.code === 'string' ? first.code : null;
        detail = typeof first?.detail === 'string' ? first.detail : typeof first?.title === 'string' ? first.title : null;
      } catch { /* JSON degil */ }
      throw new AscApiError(`ASC ${method} ${path} → ${res.status}: ${errText.slice(0, 400)}`, res.status, code, detail);
    }
    if (res.status === 204) return undefined as T;
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

  /**
   * App'in store versiyonlari, en yeni once. `sort` bu uc icin GECERSIZ
   * (eskiden gonderiliyordu → her sync 400 aliyordu); istemcide siralanir.
   */
  async listAppStoreVersions(appleAppId: string, limit = 50, platform?: 'IOS' | 'MAC_OS' | 'TV_OS' | 'VISION_OS') {
    const qs = new URLSearchParams({ limit: String(Math.min(200, Math.max(1, limit))) });
    if (platform) qs.set('filter[platform]', platform);
    const res = await this.request<{ data: any[] }>('GET', `/v1/apps/${appleAppId}/appStoreVersions?${qs}`);
    const t = (v: any) => Date.parse(v?.attributes?.createdDate ?? '') || 0;
    return { ...res, data: [...(res.data ?? [])].sort((a, b) => t(b) - t(a)) };
  }

  /** App bilgisi kayitlari (ad/alt baslik bunlarin yerellestirmelerinde) */
  async listAppInfos(appleAppId: string) {
    return this.request<{ data: any[] }>('GET', `/v1/apps/${appleAppId}/appInfos?limit=10`);
  }

  async listAppInfoLocalizations(appInfoId: string) {
    return this.request<{ data: any[] }>('GET', `/v1/appInfos/${appInfoId}/appInfoLocalizations?limit=50`);
  }

  async listVersionLocalizations(versionId: string) {
    return this.request<{ data: any[] }>('GET', `/v1/appStoreVersions/${versionId}/appStoreVersionLocalizations?limit=50`);
  }

  /** PATCH — attributes: name | subtitle (AppInfoLocalizationUpdateRequest) */
  async updateAppInfoLocalization(id: string, attributes: Record<string, string>) {
    return this.request<{ data: any }>('PATCH', `/v1/appInfoLocalizations/${id}`, {
      data: { type: 'appInfoLocalizations', id, attributes },
    });
  }

  // ─── Ekran goruntuleri (Apple semasi + asc CLI ile dogrulandi) ───
  // Akis: set bul/olustur → POST appScreenshots {fileName,fileSize} → donen
  // uploadOperations parcalarini PUT → PATCH {uploaded:true, sourceFileChecksum: md5}
  // → assetDeliveryState: AWAITING_UPLOAD → UPLOAD_COMPLETE → COMPLETE | FAILED.

  async listScreenshotSets(versionLocId: string) {
    return this.request<{ data: any[] }>('GET', `/v1/appStoreVersionLocalizations/${versionLocId}/appScreenshotSets?limit=50`);
  }

  async listScreenshots(setId: string) {
    return this.request<{ data: any[] }>('GET', `/v1/appScreenshotSets/${setId}/appScreenshots?limit=50`);
  }

  async createScreenshotSet(versionLocId: string, screenshotDisplayType: string) {
    return this.request<{ data: any }>('POST', '/v1/appScreenshotSets', {
      data: {
        type: 'appScreenshotSets',
        attributes: { screenshotDisplayType },
        relationships: { appStoreVersionLocalization: { data: { type: 'appStoreVersionLocalizations', id: versionLocId } } },
      },
    });
  }

  async createScreenshot(setId: string, fileName: string, fileSize: number) {
    return this.request<{ data: any }>('POST', '/v1/appScreenshots', {
      data: {
        type: 'appScreenshots',
        attributes: { fileName, fileSize },
        relationships: { appScreenshotSet: { data: { type: 'appScreenshotSets', id: setId } } },
      },
    });
  }

  async commitScreenshot(id: string, md5Hex: string) {
    return this.request<{ data: any }>('PATCH', `/v1/appScreenshots/${id}`, {
      data: { type: 'appScreenshots', id, attributes: { uploaded: true, sourceFileChecksum: md5Hex } },
    });
  }

  async getScreenshot(id: string) {
    return this.request<{ data: any }>('GET', `/v1/appScreenshots/${id}`);
  }

  async deleteScreenshot(id: string) {
    return this.request<void>('DELETE', `/v1/appScreenshots/${id}`);
  }

  /**
   * Apple'in verdigi on-imzali parca adreslerine baytlari yukler (Authorization
   * YOK; basliklar operasyondan gelir). Yonlendirme izlenmez; 5xx/ag hatasinda
   * PUT bir kez yeniden denenir (asc CLI: PUT tekrar-guvenli).
   */
  async uploadParts(operations: Array<{ method?: string; url: string; length: number; offset: number; requestHeaders?: Array<{ name: string; value: string }> }>, bytes: Buffer) {
    for (const op of operations) {
      if (!op?.url || op.offset < 0 || op.length <= 0 || op.offset + op.length > bytes.length) {
        throw new Error('Apple geçersiz yükleme parçası döndürdü');
      }
      const method = (op.method ?? 'PUT').toUpperCase();
      const headers = Object.fromEntries((op.requestHeaders ?? []).map((h) => [h.name, h.value]));
      const body = Uint8Array.from(bytes.subarray(op.offset, op.offset + op.length));
      let lastErr: unknown;
      for (let attempt = 0; attempt < (method === 'PUT' ? 2 : 1); attempt++) {
        try {
          const res = await fetch(op.url, { method, headers, body, redirect: 'error', signal: AbortSignal.timeout(120_000) });
          if (res.ok) { lastErr = null; break; }
          lastErr = new Error(`Parça yüklemesi ${res.status}`);
          if (res.status < 500) break;
        } catch (err) {
          lastErr = err;
        }
      }
      if (lastErr) throw lastErr;
    }
  }

  /** PATCH — attributes: description | keywords | promotionalText | whatsNew (AppStoreVersionLocalizationUpdateRequest) */
  async updateVersionLocalization(id: string, attributes: Record<string, string>) {
    return this.request<{ data: any }>('PATCH', `/v1/appStoreVersionLocalizations/${id}`, {
      data: { type: 'appStoreVersionLocalizations', id, attributes },
    });
  }

  /** App'in müşteri yorumları (+ varsa yanıtımız: include=response, Apple şeması) */
  async listCustomerReviews(appleAppId: string, opts: { limit?: number; sort?: 'createdDate' | '-createdDate' } = {}) {
    const qs = new URLSearchParams();
    if (opts.limit) qs.set('limit', String(opts.limit));
    qs.set('sort', opts.sort ?? '-createdDate');
    qs.set('include', 'response');
    return this.request<{ data: any[]; included?: any[]; meta?: any }>(
      'GET',
      `/v1/apps/${appleAppId}/customerReviews?${qs.toString()}`,
    );
  }

  /** Tek yorum (+ yanıtı) */
  async getCustomerReview(reviewId: string) {
    return this.request<{ data: any; included?: any[] }>('GET', `/v1/customerReviews/${encodeURIComponent(reviewId)}?include=response`);
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
