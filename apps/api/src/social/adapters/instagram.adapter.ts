import type {
  SocialAdapter,
  SocialAdapterContext,
  SocialPublishInput,
  SocialPublishResult,
} from './types.js';

/**
 * Instagram Business adapter — Graph API (v21.0+) Content Publishing.
 *
 * Önkoşul:
 *   - Instagram hesap "Business" veya "Creator" olmalı
 *   - Bir Facebook Page'e bağlı olmalı
 *   - Meta App Review: instagram_business_content_publish permission
 *
 * OAuth: Facebook Login flow + Instagram extension scope
 *
 * İçerik yayınlama 2 adım:
 *   1) POST /{ig-user-id}/media → media_id (resim/video upload)
 *   2) POST /{ig-user-id}/media_publish → published media id
 *
 * Reels: media_type='REELS' + video_url + caption (15-90sn, 9:16 önerilir)
 */

const FB_API = 'https://graph.facebook.com/v21.0';

export class InstagramAdapter implements SocialAdapter {
  type = 'instagram';

  oauth = {
    scopes: [
      'pages_show_list',
      'pages_read_engagement',
      'instagram_basic',
      'instagram_content_publish',
      'business_management',
    ],

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
        throw new Error(`IG token exchange failed: ${res.status} ${body}`);
      }
      const data = (await res.json()) as { access_token: string; expires_in?: number };
      // Long-lived token swap
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
        : { access_token: data.access_token, expires_in: data.expires_in ?? 5_184_000 };
      return {
        accessToken: longData.access_token,
        expiresAt: new Date(Date.now() + (longData.expires_in ?? 5_184_000) * 1000),
        extra: {},
      };
    },

    async fetchProfile(accessToken: string) {
      // FB user → managed pages → IG business account ID
      const pagesRes = await fetch(`${FB_API}/me/accounts?fields=id,name,access_token,instagram_business_account`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (!pagesRes.ok) {
        const body = await pagesRes.text();
        throw new Error(`IG: pages fetch failed: ${pagesRes.status} ${body}`);
      }
      const pagesData = (await pagesRes.json()) as {
        data: Array<{ id: string; name: string; access_token: string; instagram_business_account?: { id: string } }>;
      };
      const igPage = pagesData.data.find((p) => p.instagram_business_account?.id);
      if (!igPage || !igPage.instagram_business_account) {
        throw new Error(
          'IG Business hesap bulunamadı. Instagram\'ı bir Facebook Page\'e bağla ve Business/Creator hesaba çevir.',
        );
      }
      const igUserId = igPage.instagram_business_account.id;
      // IG profil bilgisi
      const profileRes = await fetch(
        `${FB_API}/${igUserId}?fields=id,username,name,profile_picture_url`,
        { headers: { Authorization: `Bearer ${igPage.access_token}` } },
      );
      const profile = profileRes.ok
        ? ((await profileRes.json()) as { id: string; username?: string; name?: string; profile_picture_url?: string })
        : { id: igUserId };
      return {
        externalId: igUserId,
        externalName: (profile as any).username ?? (profile as any).name ?? `IG ${igUserId}`,
        externalAvatar: (profile as any).profile_picture_url,
        extra: {
          igPageAccessToken: igPage.access_token,
          fbPageId: igPage.id,
          username: (profile as any).username,
        },
      };
    },
  };

  async publish(input: SocialPublishInput, ctx: SocialAdapterContext): Promise<SocialPublishResult> {
    // IG için access token: page-level (igPageAccessToken)
    const accessToken =
      ctx.credentials?.igPageAccessToken ??
      (ctx.credentials?.extra as any)?.igPageAccessToken ??
      ctx.credentials?.accessToken;
    const igUserId = ctx.externalId;
    if (!accessToken) throw new Error('IG igPageAccessToken yok');
    if (!igUserId) throw new Error('IG igUserId yok');

    const caption = this.formatCaption(input);
    const image = (input.mediaUrls ?? []).find((m) => m.type === 'image');
    const video = (input.mediaUrls ?? []).find((m) => m.type === 'video');
    if (!image && !video) throw new Error('IG publish için image veya video URL gerek');

    // 1) Container oluştur
    const containerBody: Record<string, string> = {
      caption,
      access_token: accessToken,
    };
    if (image) {
      containerBody.image_url = image.url;
    } else if (video) {
      containerBody.media_type = 'REELS';
      containerBody.video_url = video.url;
    }

    const cRes = await fetch(`${FB_API}/${igUserId}/media`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(containerBody),
    });
    if (!cRes.ok) {
      const body = await cRes.text();
      throw new Error(`IG media container failed: ${cRes.status} ${body}`);
    }
    const cData = (await cRes.json()) as { id: string };

    // 2) Video ise işlenmesini bekle (poll status_code → FINISHED)
    if (video) {
      await this.waitMediaReady(cData.id, accessToken);
    }

    // 3) Yayınla
    const pRes = await fetch(`${FB_API}/${igUserId}/media_publish`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        creation_id: cData.id,
        access_token: accessToken,
      }),
    });
    if (!pRes.ok) {
      const body = await pRes.text();
      throw new Error(`IG publish failed: ${pRes.status} ${body}`);
    }
    const pData = (await pRes.json()) as { id: string };

    const username = (ctx.config as any)?.username ?? (ctx.credentials?.extra as any)?.username;
    const externalUrl = username ? `https://www.instagram.com/${username}/` : `https://www.instagram.com/p/${pData.id}/`;
    return { externalId: pData.id, externalUrl, raw: pData };
  }

  private async waitMediaReady(creationId: string, token: string, maxWaitMs = 90000) {
    const start = Date.now();
    while (Date.now() - start < maxWaitMs) {
      await new Promise((r) => setTimeout(r, 5000));
      const res = await fetch(
        `${FB_API}/${creationId}?fields=status_code&access_token=${encodeURIComponent(token)}`,
      );
      if (res.ok) {
        const data = (await res.json()) as { status_code?: string };
        if (data.status_code === 'FINISHED') return;
        if (data.status_code === 'ERROR') throw new Error('IG media processing ERROR');
      }
    }
    throw new Error('IG media processing timeout');
  }

  private formatCaption(input: SocialPublishInput): string {
    let out = input.text.trim();
    const tags = input.metadata?.hashtags ?? [];
    if (tags.length) out += '\n.\n.\n' + tags.map((t) => (t.startsWith('#') ? t : `#${t}`)).join(' ');
    return out.length > 2200 ? out.slice(0, 2197) + '...' : out;
  }
}
