import type {
  SocialAdapter,
  SocialAdapterContext,
  SocialPublishInput,
  SocialPublishResult,
} from './types.js';

/**
 * Facebook Pages adapter — Graph API (v21.0+).
 *
 * NOT: pages_manage_posts izni için Meta App Review + Business Verification gerekir
 * (4-6 hafta süreç). Test modunda sadece app admin'leri kendi sayfalarına post atabilir.
 *
 * Auth: OAuth 2.0 (Facebook Login)
 * Scopes: pages_show_list, pages_read_engagement, pages_manage_posts
 *
 * Akış:
 *   - User token al (OAuth)
 *   - GET /me/accounts → user'ın yönettiği sayfalar + page access tokens
 *   - Belirli bir page'e post: POST /{page_id}/feed { message, link, access_token: PAGE_TOKEN }
 *   - Image post: POST /{page_id}/photos { url, message }
 *   - Video post: POST /{page_id}/videos { file_url, description }
 */

const FB_API = 'https://graph.facebook.com/v21.0';

export class FacebookAdapter implements SocialAdapter {
  type = 'facebook';

  oauth = {
    scopes: ['pages_show_list', 'pages_read_engagement', 'pages_manage_posts'],

    buildAuthUrl(state: string, redirectUri: string): string {
      const params = new URLSearchParams({
        client_id: process.env.FACEBOOK_APP_ID ?? '',
        redirect_uri: redirectUri,
        state,
        scope: this.scopes.join(','),
        response_type: 'code',
      });
      return `https://www.facebook.com/v21.0/dialog/oauth?${params.toString()}`;
    },

    async exchange(code: string, redirectUri: string) {
      const params = new URLSearchParams({
        client_id: process.env.FACEBOOK_APP_ID ?? '',
        client_secret: process.env.FACEBOOK_APP_SECRET ?? '',
        redirect_uri: redirectUri,
        code,
      });
      const res = await fetch(`${FB_API}/oauth/access_token?${params.toString()}`);
      if (!res.ok) {
        const body = await res.text();
        throw new Error(`Facebook token exchange failed: ${res.status} ${body}`);
      }
      const data = (await res.json()) as {
        access_token: string;
        expires_in?: number;
        token_type: string;
      };
      // Long-lived token'a swap et (60 gün)
      const longRes = await fetch(
        `${FB_API}/oauth/access_token?${new URLSearchParams({
          grant_type: 'fb_exchange_token',
          client_id: process.env.FACEBOOK_APP_ID ?? '',
          client_secret: process.env.FACEBOOK_APP_SECRET ?? '',
          fb_exchange_token: data.access_token,
        }).toString()}`,
      );
      const longData = longRes.ok
        ? ((await longRes.json()) as { access_token: string; expires_in: number })
        : { access_token: data.access_token, expires_in: data.expires_in ?? 3600 };
      return {
        accessToken: longData.access_token,
        expiresAt: new Date(Date.now() + (longData.expires_in ?? 5_184_000) * 1000),
        extra: {},
      };
    },

    async fetchProfile(accessToken: string) {
      const res = await fetch(`${FB_API}/me?fields=id,name,picture`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (!res.ok) {
        const body = await res.text();
        throw new Error(`Facebook /me failed: ${res.status} ${body}`);
      }
      const data = (await res.json()) as {
        id: string;
        name: string;
        picture?: { data: { url: string } };
      };
      return {
        externalId: data.id,
        externalName: data.name,
        externalAvatar: data.picture?.data?.url,
      };
    },
  };

  /** User token → kullanıcının yönettiği sayfaları + her sayfa için page-token döner. */
  static async listManagedPages(userAccessToken: string): Promise<Array<{
    pageId: string;
    pageName: string;
    pageAccessToken: string;
    category?: string;
  }>> {
    const res = await fetch(`${FB_API}/me/accounts?fields=id,name,access_token,category`, {
      headers: { Authorization: `Bearer ${userAccessToken}` },
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Facebook /me/accounts failed: ${res.status} ${body}`);
    }
    const data = (await res.json()) as {
      data: Array<{ id: string; name: string; access_token: string; category?: string }>;
    };
    return (data.data ?? []).map((p) => ({
      pageId: p.id,
      pageName: p.name,
      pageAccessToken: p.access_token,
      category: p.category,
    }));
  }

  async publish(input: SocialPublishInput, ctx: SocialAdapterContext): Promise<SocialPublishResult> {
    const pageToken = ctx.credentials?.pageAccessToken ?? ctx.credentials?.accessToken;
    const pageId = (ctx.config as any)?.pageId ?? ctx.externalId;
    if (!pageToken) throw new Error('Facebook pageAccessToken yok');
    if (!pageId) throw new Error('Facebook pageId yok');

    const text = this.formatText(input);
    const image = (input.mediaUrls ?? []).find((m) => m.type === 'image');
    const video = (input.mediaUrls ?? []).find((m) => m.type === 'video');

    let endpoint = `${FB_API}/${pageId}/feed`;
    let body: Record<string, any> = {
      message: text,
      access_token: pageToken,
    };
    if (input.metadata?.link) body.link = input.metadata.link;
    if (image) {
      endpoint = `${FB_API}/${pageId}/photos`;
      body = { url: image.url, message: text, access_token: pageToken };
    } else if (video) {
      endpoint = `${FB_API}/${pageId}/videos`;
      body = { file_url: video.url, description: text, access_token: pageToken };
    }

    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(body as Record<string, string>),
    });
    if (!res.ok) {
      const errBody = await res.text();
      throw new Error(`Facebook publish failed: ${res.status} ${errBody}`);
    }
    const data = (await res.json()) as { id?: string; post_id?: string };
    const externalId = data.post_id ?? data.id ?? '';
    const externalUrl = externalId ? `https://www.facebook.com/${externalId}` : `https://www.facebook.com/${pageId}`;
    return { externalId, externalUrl, raw: data };
  }

  private formatText(input: SocialPublishInput): string {
    let out = input.text.trim();
    const tags = input.metadata?.hashtags ?? [];
    if (tags.length) out += '\n\n' + tags.map((t) => (t.startsWith('#') ? t : `#${t}`)).join(' ');
    return out.length > 63206 ? out.slice(0, 63203) + '...' : out;
  }
}
