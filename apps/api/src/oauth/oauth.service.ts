import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { createHmac, createHash } from 'crypto';
import { OAuthFlowError } from '../auth/oauth-state.js';
import { GOOGLE_ADS_SCOPES, hasGrantedScope } from '../auth/oauth-scopes.js';
import { META_GRAPH_VERSION, META_REQUESTED_PERMISSIONS, fetchMissingMetaPermissions } from './meta-permissions.js';
import {
  describeGoogleAdsError, googleAdsHeaders, googleAdsOAuthClient, googleAdsRequest, googleAdsUserReason, normalizeCustomerId,
} from '../ads/google-ads-api.js';

/** Panelin hesap secicisinin okudugu sekil (yanit sozlesmesi degismedi) */
export type GoogleAdsCustomerOption = {
  id: string;
  resourceName: string;
  descriptiveName?: string;
  currencyCode?: string;
  isManager?: boolean;
};

/**
 * OAuth helper — Google Ads + Meta Marketing API icin popup-based connect akisi.
 *
 * State: auth/oauth-state.ts — sunucuda saklanan, tek kullanimlik, 10 dk'lik
 * nonce (GSC/GA ile ortak). Eskiden HMAC imzali, 15 dk boyunca TEKRAR
 * kullanilabilen bir state vardi ve NEXTAUTH_SECRET yoksa herkesin bildigi
 * 'dev-secret-change-me' ile imzalaniyordu: sir eksik bir uretim sunucusunda
 * herkes gecerli state uretebilirdi. Sunucu kaydinda imza sirri gerekmez.
 */
@Injectable()
export class OAuthService {
  private readonly log = new Logger(OAuthService.name);

  // ─────────────────────────────────────────────────────────────
  //  GOOGLE ADS OAuth
  // ─────────────────────────────────────────────────────────────
  // Istemci secimi ads/google-ads-api.ts googleAdsOAuthClient(): site
  // istekleri yenileme belirtecini AYNI istemciyle yeniler ve Ads API erisim
  // seviyesi (developer token 9 Eylul 2026'da kalkti) bu istemcinin Google
  // Cloud projesinden gelir.
  buildGoogleAdsAuthUrl(state: string): string {
    const { clientId } = googleAdsOAuthClient();
    if (!clientId) throw new BadRequestException('GOOGLE_CLIENT_ID env yok');
    const redirectUri = this.googleRedirectUri();

    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: 'https://www.googleapis.com/auth/adwords',
      access_type: 'offline',
      prompt: 'consent',
      state,
    });
    return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
  }

  /**
   * Hatalar OAuthFlowError kodudur — Google'in ham cevabi yalnizca loga gider
   * (eskiden popup sayfasina 200 karakterlik govde basiliyordu).
   */
  async exchangeGoogleCode(code: string): Promise<{ access_token: string; refresh_token: string }> {
    const { clientId, clientSecret } = googleAdsOAuthClient();
    if (!clientId || !clientSecret) {
      this.log.error('Google OAuth env eksik (GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET)');
      throw new OAuthFlowError('token_exchange_failed');
    }

    let data: any;
    try {
      const res = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: clientId,
          client_secret: clientSecret,
          code,
          grant_type: 'authorization_code',
          redirect_uri: this.googleRedirectUri(),
        }),
        signal: AbortSignal.timeout(15_000),
      });
      data = await res.json().catch(() => ({}));
      if (!res.ok) {
        this.log.warn(`Google Ads token exchange HTTP ${res.status}: ${String(data?.error ?? '')} ${String(data?.error_description ?? '').slice(0, 160)}`);
        throw new OAuthFlowError('token_exchange_failed');
      }
    } catch (err) {
      if (err instanceof OAuthFlowError) throw err;
      this.log.warn(`Google Ads token exchange istegi basarisiz: ${String((err as any)?.message ?? err).slice(0, 160)}`);
      throw new OAuthFlowError('token_exchange_failed');
    }
    // adwords kapsami verilmediyse token "bagli" gorunur ama Ads API reddeder (auth/oauth-scopes.ts)
    if (!hasGrantedScope(data.scope, GOOGLE_ADS_SCOPES, GOOGLE_ADS_SCOPES)) throw new OAuthFlowError('scope_not_granted');
    if (!data.refresh_token) throw new OAuthFlowError('no_refresh_token');
    return { access_token: data.access_token, refresh_token: data.refresh_token };
  }

  /**
   * Bu access token ile hangi Google Ads hesaplarina erisilebiliyor — listeyi getir.
   * Liste alinamazsa bos dizi (eski sozlesme); nedeni ayirt etmek icin
   * listGoogleAdsCustomersDetailed.
   */
  async listGoogleAdsCustomers(accessToken: string): Promise<GoogleAdsCustomerOption[]> {
    return (await this.listGoogleAdsCustomersDetailed(accessToken)).customers;
  }

  /**
   * Hesap listesi + liste ALINAMADIYSA musteriye gosterilebilir neden.
   * Bos liste ile hata ayri: eskiden her hata (v21 kapanisi, eksik developer
   * token) bos liste donuyordu ve panel "bu Google hesabinda reklam hesabi yok
   * mu?" diyordu.
   *
   * Uclar (surum: ads/google-ads-api.ts): GET customers:listAccessibleCustomers
   * kullanicinin DOGRUDAN eristigi hesaplari doner, login-customer-id gerekmez;
   * her hesabin adi/para birimi o hesabin kendisi login-customer-id yapilarak
   * okunur (https://developers.google.com/google-ads/api/docs/concepts/call-structure).
   */
  async listGoogleAdsCustomersDetailed(accessToken: string): Promise<{ customers: GoogleAdsCustomerOption[]; error?: string }> {
    const list = await googleAdsRequest('customers:listAccessibleCustomers', {
      method: 'GET',
      headers: googleAdsHeaders(accessToken, { json: false }),
      timeoutMs: 15_000,
    });
    if (!list.ok) {
      this.log.warn(`listGoogleAdsCustomers fail: ${describeGoogleAdsError(list.error)}`);
      return {
        customers: [],
        error: googleAdsUserReason(list.error) ?? 'Google Ads hesap listesi Google\'dan alınamadı; biraz sonra tekrar dene.',
      };
    }
    const resourceNames: unknown[] = Array.isArray(list.data?.resourceNames) ? list.data.resourceNames : [];
    const ids = resourceNames
      .map((rn) => (typeof rn === 'string' ? { id: normalizeCustomerId(rn.split('/').pop()), resourceName: rn } : null))
      .filter((c): c is { id: string; resourceName: string } => !!c?.id);

    // Her customer için descriptive_name + currency_code çek (Manager Account ise ayrıca işaretle)
    const customers = await Promise.all(ids.map(async (c): Promise<GoogleAdsCustomerOption> => {
      const sr = await googleAdsRequest(`customers/${c.id}/googleAds:search`, {
        headers: googleAdsHeaders(accessToken, { loginCustomerId: c.id }),
        body: { query: 'SELECT customer.id, customer.descriptive_name, customer.currency_code, customer.manager FROM customer LIMIT 1' },
        timeoutMs: 15_000,
      });
      if (!sr.ok) {
        this.log.warn(`google-ads search ${c.id}: ${describeGoogleAdsError(sr.error)}`);
        return c;
      }
      const row = sr.data?.results?.[0]?.customer;
      if (!row) return c;
      return {
        ...c,
        descriptiveName: row.descriptiveName ?? row.descriptive_name ?? undefined,
        currencyCode: row.currencyCode ?? row.currency_code ?? undefined,
        isManager: row.manager === true,
      };
    }));
    return { customers };
  }

  // ─────────────────────────────────────────────────────────────
  //  META OAuth (Facebook + Instagram)
  // ─────────────────────────────────────────────────────────────
  buildMetaAuthUrl(state: string): string {
    const appId = process.env.META_APP_ID;
    if (!appId) throw new BadRequestException('META_APP_ID env yok');

    // Dev mode: Admin/Developer/Tester rolündeki kullanıcılar için tüm ads scope'ları aktif.
    // Production (Live mode) için bunlar App Review'dan geçmeli.
    const scope = META_REQUESTED_PERMISSIONS.join(',');

    const params = new URLSearchParams({
      client_id: appId,
      redirect_uri: this.metaRedirectUri(),
      scope,
      state,
      response_type: 'code',
      // Daha once reddedilen izni dialog bu olmadan bir daha SORMAZ; izin
      // eksik diye reddedilen kullanici yeniden baslattiginda ayni ekrana
      // takilip kalirdi (meta-permissions.ts, manual-flow belgesi).
      auth_type: 'rerequest',
    });
    return `https://www.facebook.com/${META_GRAPH_VERSION}/dialog/oauth?${params}`;
  }

  async exchangeMetaCode(code: string): Promise<{ access_token: string }> {
    const appId = process.env.META_APP_ID;
    const appSecret = process.env.META_APP_SECRET;
    if (!appId || !appSecret) {
      this.log.error('META_APP_ID / META_APP_SECRET env eksik');
      throw new OAuthFlowError('token_exchange_failed');
    }

    // Parametreler URLSearchParams ile: `code` tarayicidan gelir, ham eklenince
    // Graph istegine ek parametre sokulabiliyordu.
    const graphToken = async (params: Record<string, string>, step: string): Promise<string> => {
      try {
        const res = await fetch(`https://graph.facebook.com/${META_GRAPH_VERSION}/oauth/access_token?${new URLSearchParams(params)}`, {
          signal: AbortSignal.timeout(15_000),
        });
        const data = await res.json().catch(() => ({})) as any;
        if (!res.ok || typeof data?.access_token !== 'string') {
          this.log.warn(`Meta ${step} HTTP ${res.status}: ${String(data?.error?.type ?? '')} ${String(data?.error?.code ?? '')}`);
          throw new OAuthFlowError('token_exchange_failed');
        }
        return data.access_token;
      } catch (err) {
        if (err instanceof OAuthFlowError) throw err;
        this.log.warn(`Meta ${step} istegi basarisiz: ${String((err as any)?.message ?? err).slice(0, 160)}`);
        throw new OAuthFlowError('token_exchange_failed');
      }
    };

    // 1) short-lived
    const shortToken = await graphToken({
      client_id: appId,
      redirect_uri: this.metaRedirectUri(),
      client_secret: appSecret,
      code,
    }, 'token exchange');

    // 2) Izinler: reklam izinleri reddedilmis token "bagli" yazilmaz. Ilk
    // token ile sorulur; eksikse uzun omurlu token hic istenmez.
    await this.assertMetaPermissions(shortToken);

    // 3) long-lived (60 gun)
    const longToken = await graphToken({
      grant_type: 'fb_exchange_token',
      client_id: appId,
      client_secret: appSecret,
      fb_exchange_token: shortToken,
    }, 'long-lived');
    return { access_token: longToken };
  }

  /**
   * Token'in zorunlu Meta izinlerinden eksik olanlar (GET /me/permissions,
   * meta-permissions.ts). null = liste okunamadi (HTTP/ag hatasi ya da bicim
   * disi govde) — "eksik yok" ile karistirilmaz. Saglayici govdesi loga
   * yalniz hata tipi/kodu olarak gider.
   */
  missingMetaPermissionsFor(accessToken: string): Promise<string[] | null> {
    return fetchMissingMetaPermissions(accessToken, this.log);
  }

  /**
   * Baglanti aninda zorunlu izinler SART. Eksikse 'scope_not_granted' — eksik
   * izin adlari yalniz loga gider. Liste okunamazsa 'provider_error':
   * dogrulanamayan baglanti da "bagli" yazilmaz.
   */
  private async assertMetaPermissions(accessToken: string): Promise<void> {
    const missing = await this.missingMetaPermissionsFor(accessToken);
    if (missing === null) throw new OAuthFlowError('provider_error');
    if (missing.length > 0) {
      this.log.warn(`Meta zorunlu izinler verilmedi: ${missing.join(', ')}`);
      throw new OAuthFlowError('scope_not_granted', undefined, missing.join(','));
    }
  }

  async listMetaAdAccounts(accessToken: string): Promise<{ id: string; name: string; currency: string }[]> {
    try {
      const params = new URLSearchParams({ fields: 'id,name,currency,account_status', access_token: accessToken });
      const res = await fetch(`https://graph.facebook.com/${META_GRAPH_VERSION}/me/adaccounts?${params}`);
      if (!res.ok) return [];
      const data = await res.json() as any;
      return (data.data ?? []).filter((a: any) => a.account_status === 1).map((a: any) => ({
        id: a.id, name: a.name, currency: a.currency,
      }));
    } catch (err: any) {
      this.log.warn(`listMetaAdAccounts fail: ${err.message}`);
      return [];
    }
  }

  async listMetaPages(accessToken: string): Promise<{ id: string; name: string; instagramId?: string }[]> {
    try {
      const params = new URLSearchParams({ fields: 'id,name,instagram_business_account', access_token: accessToken });
      const res = await fetch(`https://graph.facebook.com/${META_GRAPH_VERSION}/me/accounts?${params}`);
      if (!res.ok) return [];
      const data = await res.json() as any;
      return (data.data ?? []).map((p: any) => ({
        id: p.id,
        name: p.name,
        instagramId: p.instagram_business_account?.id,
      }));
    } catch (err: any) {
      this.log.warn(`listMetaPages fail: ${err.message}`);
      return [];
    }
  }

  // ─────────────────────────────────────────────────────────────
  //  Meta signed_request parser (Deauthorize + Data Deletion webhook)
  // ─────────────────────────────────────────────────────────────
  /**
   * Meta deauthorize/data-deletion webhook'lari `signed_request` POST eder.
   * Format: base64url(sig) + "." + base64url(payload), HMAC-SHA256(payload, app_secret).
   * https://developers.facebook.com/docs/facebook-login/guides/advanced/existing-system
   */
  parseMetaSignedRequest(signedRequest: string): { user_id: string; algorithm: string; issued_at: number } {
    const appSecret = process.env.META_APP_SECRET;
    if (!appSecret) throw new BadRequestException('META_APP_SECRET env yok');
    const [encodedSig, payload] = (signedRequest ?? '').split('.');
    if (!encodedSig || !payload) throw new BadRequestException('signed_request format hatali');

    const sig = Buffer.from(encodedSig, 'base64url');
    const expected = createHmac('sha256', appSecret).update(payload).digest();
    if (sig.length !== expected.length || !sig.equals(expected)) {
      throw new BadRequestException('signed_request imza gecersiz');
    }
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (data.algorithm !== 'HMAC-SHA256') throw new BadRequestException('Algoritma desteklenmiyor');
    return data;
  }

  /**
   * Data Deletion Request URL response — Meta dokumantasyonuna gore JSON bekleniyor:
   *   { url: "<status sayfasi>", confirmation_code: "<takip kodu>" }
   * confirmation_code: Meta user_id'nin SHA-256 hash'i (deterministik, idempotent).
   */
  buildMetaDataDeletionResponse(userId: string): { url: string; confirmation_code: string } {
    const code = createHash('sha256').update(`${userId}:${process.env.META_APP_SECRET ?? ''}`).digest('hex').slice(0, 32);
    const webBase = process.env.WEB_BASE_URL ?? 'https://ranksup.ai';
    return {
      url: `${webBase}/legal/data-deletion?code=${code}`,
      confirmation_code: code,
    };
  }

  // ─────────────────────────────────────────────────────────────
  //  Helpers
  // ─────────────────────────────────────────────────────────────
  private googleRedirectUri(): string {
    return `${process.env.API_BASE_URL ?? 'https://ranksup.ai'}/api/oauth/google-ads/callback`;
  }

  private metaRedirectUri(): string {
    return `${process.env.API_BASE_URL ?? 'https://ranksup.ai'}/api/oauth/meta-ads/callback`;
  }

  /**
   * Popup'tan parent window'a postMessage gondermek icin HTML response.
   *
   * `pendingKey`: tarayici oturumu callback'te okunamadi; kod park edildi.
   * Anahtar YALNIZCA WEB_BASE_URL kokenindeki acan pencereye gider (postMessage
   * hedef kokeni) ve tek basina ise yaramaz — panel onu oturumlu /finish ile
   * kullanir; sunucu oturum kullanicisi akisi baslatanla eslesmezse reddeder.
   *
   * GUVENLIK: metin HTML-kacisli, script icindeki JSON '<' kacisli. Eskiden
   * `?error=` parametresi ham olarak <p> icine ve script'e basiliyordu
   * (yansitilan XSS: `?error=</script><script>...`).
   */
  buildCallbackHtml(
    provider: 'google-ads' | 'meta-ads',
    payload: any,
    error?: string,
    opts: { pendingKey?: string } = {},
  ): string {
    const origin = process.env.WEB_BASE_URL ?? 'https://ranksup.ai';
    const pending = !error && !!opts.pendingKey;
    const success = !error;
    const message = error
      ? { type: 'oauth-error', provider, message: error }
      : pending
        ? { type: 'oauth-pending', provider, key: opts.pendingKey }
        : { type: 'oauth-success', provider, data: payload };
    const title = error ? 'Hata' : pending ? 'Doğrulanıyor' : 'Bağlandı';
    const heading = error ? 'Bağlantı hatası' : pending ? 'Bağlantı doğrulanıyor' : 'Bağlantı başarılı';
    const text = error
      ? error.slice(0, 200)
      : pending
        ? 'RanksUp paneli bağlantıyı tamamlıyor. Pencere kendiliğinden kapanmazsa kapatıp paneli yenileyin.'
        : 'Pencere otomatik kapanacak…';

    return `<!DOCTYPE html>
<html lang="tr"><head><meta charset="utf-8"><meta name="referrer" content="no-referrer"><title>${escapeHtml(title)}</title>
<style>body{font-family:system-ui,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;background:#0f172a;color:#fff}
.box{text-align:center;padding:40px;max-width:400px}
h1{font-size:20px;margin:0 0 12px}
p{color:#94a3b8;margin:0;font-size:14px}
.icon{font-size:48px;margin-bottom:16px}</style></head>
<body><div class="box">
<div class="icon">${success ? (pending ? '⏳' : '✅') : '❌'}</div>
<h1>${escapeHtml(heading)}</h1>
<p>${escapeHtml(text)}</p>
</div>
<script>
(function(){
  try {
    if (window.opener) {
      window.opener.postMessage(${scriptJson(message)}, ${scriptJson(origin)});
    }
  } catch (e) {}
  setTimeout(function(){ try { window.close(); } catch(e){} }, 800);
})();
</script></body></html>`;
  }
}

function escapeHtml(s: string): string {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
}

/** <script> icine guvenli JSON: '</script>' ve HTML yorumlari kirilamaz */
function scriptJson(v: unknown): string {
  return JSON.stringify(v)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}
