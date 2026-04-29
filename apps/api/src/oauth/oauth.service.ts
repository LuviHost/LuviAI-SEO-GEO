import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { createHmac, randomBytes } from 'crypto';

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
  async listGoogleAdsCustomers(accessToken: string): Promise<{ id: string; resourceName: string }[]> {
    const devToken = process.env.GOOGLE_ADS_DEV_TOKEN;
    if (!devToken) {
      this.log.warn('GOOGLE_ADS_DEV_TOKEN env yok — customer listesi alinamiyor');
      return [];
    }
    try {
      const res = await fetch('https://googleads.googleapis.com/v18/customers:listAccessibleCustomers', {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'developer-token': devToken,
        },
      });
      if (!res.ok) throw new Error(`${res.status}: ${(await res.text()).slice(0, 200)}`);
      const data = await res.json() as any;
      const resourceNames: string[] = data.resourceNames ?? [];
      return resourceNames.map((rn) => ({
        id: rn.split('/').pop() ?? '',
        resourceName: rn,
      }));
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

    const scope = [
      'ads_management',
      'ads_read',
      'business_management',
      'pages_show_list',
      'pages_read_engagement',
      'pages_manage_ads',
      'pages_manage_posts',
      'instagram_basic',
      'instagram_content_publish',
      'public_profile',
      'email',
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
