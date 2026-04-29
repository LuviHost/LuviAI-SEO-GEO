import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { createHmac, randomBytes, createHash } from 'crypto';

/**
 * OAuth helper — Google Ads + Meta Marketing API icin popup-based connect akisi.
 *
 * State imzalama: HMAC-SHA256 (NEXTAUTH_SECRET ile), 15 dk gecerli.
 * CSRF korumasi + tampering koruma.
 */
@Injectable()
export class OAuthService {
  private readonly log = new Logger(OAuthService.name);
  private readonly stateSecret = process.env.NEXTAUTH_SECRET ?? 'dev-secret-change-me';

  // ─────────────────────────────────────────────────────────────
  //  State signing (CSRF protect)
  // ─────────────────────────────────────────────────────────────
  signState(payload: { siteId: string; userId: string; provider: string }): string {
    const obj = { ...payload, ts: Date.now(), nonce: randomBytes(8).toString('hex') };
    const data = Buffer.from(JSON.stringify(obj)).toString('base64url');
    const sig = createHmac('sha256', this.stateSecret).update(data).digest('base64url');
    return `${data}.${sig}`;
  }

  verifyState(state: string): { siteId: string; userId: string; provider: string } {
    const [data, sig] = (state ?? '').split('.');
    if (!data || !sig) throw new BadRequestException('State eksik');
    const expected = createHmac('sha256', this.stateSecret).update(data).digest('base64url');
    if (sig !== expected) throw new BadRequestException('State imza gecersiz');
    const payload = JSON.parse(Buffer.from(data, 'base64url').toString());
    if (Date.now() - payload.ts > 15 * 60 * 1000) throw new BadRequestException('State suresi doldu');
    return payload;
  }

  // ─────────────────────────────────────────────────────────────
  //  GOOGLE ADS OAuth
  // ─────────────────────────────────────────────────────────────
  buildGoogleAdsAuthUrl(state: string): string {
    const clientId = process.env.GOOGLE_CLIENT_ID ?? process.env.GOOGLE_OAUTH_CLIENT_ID;
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

  async exchangeGoogleCode(code: string): Promise<{ access_token: string; refresh_token: string }> {
    const clientId = process.env.GOOGLE_CLIENT_ID ?? process.env.GOOGLE_OAUTH_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET ?? process.env.GOOGLE_OAUTH_CLIENT_SECRET;
    if (!clientId || !clientSecret) throw new BadRequestException('Google OAuth env eksik');

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
    });
    if (!res.ok) throw new BadRequestException(`Google token exchange ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const data = await res.json() as any;
    if (!data.refresh_token) throw new BadRequestException('Refresh token gelmedi — Google hesabini once revoke et, sonra tekrar bagla');
    return { access_token: data.access_token, refresh_token: data.refresh_token };
  }

  /**
   * Bu access token ile hangi Google Ads hesaplarina erisilebiliyor — listeyi getir.
   */
  async listGoogleAdsCustomers(accessToken: string): Promise<{ id: string; resourceName: string; descriptiveName?: string; currencyCode?: string; isManager?: boolean }[]> {
    const devToken = process.env.GOOGLE_ADS_DEV_TOKEN;
    if (!devToken) {
      this.log.warn('GOOGLE_ADS_DEV_TOKEN env yok — customer listesi alinamiyor');
      return [];
    }
    try {
      const res = await fetch('https://googleads.googleapis.com/v21/customers:listAccessibleCustomers', {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'developer-token': devToken,
        },
      });
      if (!res.ok) throw new Error(`${res.status}: ${(await res.text()).slice(0, 200)}`);
      const data = await res.json() as any;
      const resourceNames: string[] = data.resourceNames ?? [];
      const ids = resourceNames.map((rn) => ({ id: rn.split('/').pop() ?? '', resourceName: rn })).filter(c => c.id);

      // Her customer için descriptive_name + currency_code çek (Manager Account ise ayrıca işaretle)
      const enriched = await Promise.all(ids.map(async (c) => {
        try {
          const sr = await fetch(`https://googleads.googleapis.com/v21/customers/${c.id}/googleAds:search`, {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${accessToken}`,
              'developer-token': devToken,
              'login-customer-id': c.id,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ query: 'SELECT customer.id, customer.descriptive_name, customer.currency_code, customer.manager FROM customer LIMIT 1' }),
          });
          if (!sr.ok) {
            this.log.warn(`google-ads search ${c.id} HTTP ${sr.status}: ${(await sr.text()).slice(0, 250)}`);
            return c;
          }
          const sd = await sr.json() as any;
          const row = sd.results?.[0]?.customer;
          if (!row) return c;
          return {
            ...c,
            descriptiveName: row.descriptiveName ?? row.descriptive_name ?? undefined,
            currencyCode: row.currencyCode ?? row.currency_code ?? undefined,
            isManager: row.manager === true,
          };
        } catch {
          return c;
        }
      }));
      return enriched;
    } catch (err: any) {
      this.log.warn(`listGoogleAdsCustomers fail: ${err.message}`);
      return [];
    }
  }

  // ─────────────────────────────────────────────────────────────
  //  META OAuth (Facebook + Instagram)
  // ─────────────────────────────────────────────────────────────
  buildMetaAuthUrl(state: string): string {
    const appId = process.env.META_APP_ID;
    if (!appId) throw new BadRequestException('META_APP_ID env yok');

    // Dev mode: Admin/Developer/Tester rolündeki kullanıcılar için tüm ads scope'ları aktif.
    // Production (Live mode) için bunlar App Review'dan geçmeli.
    const scope = [
      'public_profile',
      'email',
      'ads_read',
      'ads_management',
      'business_management',
      'pages_show_list',
      'pages_read_engagement',
      'instagram_basic',
    ].join(',');

    const params = new URLSearchParams({
      client_id: appId,
      redirect_uri: this.metaRedirectUri(),
      scope,
      state,
      response_type: 'code',
    });
    return `https://www.facebook.com/v21.0/dialog/oauth?${params}`;
  }

  async exchangeMetaCode(code: string): Promise<{ access_token: string }> {
    const appId = process.env.META_APP_ID;
    const appSecret = process.env.META_APP_SECRET;
    if (!appId || !appSecret) throw new BadRequestException('META_APP_ID / META_APP_SECRET env eksik');

    // 1) short-lived
    const shortRes = await fetch(
      `https://graph.facebook.com/v21.0/oauth/access_token?client_id=${appId}&redirect_uri=${encodeURIComponent(this.metaRedirectUri())}&client_secret=${appSecret}&code=${code}`
    );
    if (!shortRes.ok) throw new BadRequestException(`Meta token exchange ${shortRes.status}: ${(await shortRes.text()).slice(0, 200)}`);
    const shortData = await shortRes.json() as any;
    const shortToken = shortData.access_token;

    // 2) long-lived (60 gun)
    const longRes = await fetch(
      `https://graph.facebook.com/v21.0/oauth/access_token?grant_type=fb_exchange_token&client_id=${appId}&client_secret=${appSecret}&fb_exchange_token=${shortToken}`
    );
    if (!longRes.ok) throw new BadRequestException(`Meta long-lived ${longRes.status}: ${(await longRes.text()).slice(0, 200)}`);
    const longData = await longRes.json() as any;
    return { access_token: longData.access_token };
  }

  async listMetaAdAccounts(accessToken: string): Promise<{ id: string; name: string; currency: string }[]> {
    try {
      const res = await fetch(`https://graph.facebook.com/v21.0/me/adaccounts?fields=id,name,currency,account_status&access_token=${accessToken}`);
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
      const res = await fetch(`https://graph.facebook.com/v21.0/me/accounts?fields=id,name,instagram_business_account&access_token=${accessToken}`);
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
    const webBase = process.env.WEB_BASE_URL ?? 'https://ai.luvihost.com';
    return {
      url: `${webBase}/legal/data-deletion?code=${code}`,
      confirmation_code: code,
    };
  }

  // ─────────────────────────────────────────────────────────────
  //  Helpers
  // ─────────────────────────────────────────────────────────────
  private googleRedirectUri(): string {
    return `${process.env.API_BASE_URL ?? 'https://ai.luvihost.com'}/api/oauth/google-ads/callback`;
  }

  private metaRedirectUri(): string {
    return `${process.env.API_BASE_URL ?? 'https://ai.luvihost.com'}/api/oauth/meta-ads/callback`;
  }

  /**
   * Popup'tan parent window'a postMessage gondermek icin HTML response.
   */
  buildCallbackHtml(provider: 'google-ads' | 'meta-ads', payload: any, error?: string): string {
    const origin = process.env.WEB_BASE_URL ?? 'https://ai.luvihost.com';
    const success = !error;
    const message = success
      ? { type: 'oauth-success', provider, data: payload }
      : { type: 'oauth-error', provider, message: error };

    return `<!DOCTYPE html>
<html lang="tr"><head><meta charset="utf-8"><title>${success ? 'Bağlandı' : 'Hata'}</title>
<style>body{font-family:system-ui,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;background:#0f172a;color:#fff}
.box{text-align:center;padding:40px;max-width:400px}
h1{font-size:20px;margin:0 0 12px}
p{color:#94a3b8;margin:0;font-size:14px}
.icon{font-size:48px;margin-bottom:16px}</style></head>
<body><div class="box">
<div class="icon">${success ? '✅' : '❌'}</div>
<h1>${success ? 'Bağlantı başarılı' : 'Bağlantı hatası'}</h1>
<p>${success ? 'Pencere otomatik kapanacak…' : (error ?? 'Bilinmeyen hata').slice(0, 200)}</p>
</div>
<script>
(function(){
  try {
    if (window.opener) {
      window.opener.postMessage(${JSON.stringify(message)}, ${JSON.stringify(origin)});
    }
  } catch (e) {}
  setTimeout(function(){ try { window.close(); } catch(e){} }, 800);
})();
</script></body></html>`;
  }
}
