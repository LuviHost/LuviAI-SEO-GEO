import type {
  SocialAdapter,
  SocialAdapterContext,
  SocialPublishInput,
  SocialPublishResult,
} from './types.js';

/**
 * TikTok adapter — Content Posting API (v2).
 *
 * NOT: TikTok Content Posting API'i kullanmak için TikTok for Developers'da
 * app review tamamlanmalı. App review sürecinde sandbox-only çalışır.
 *
 * OAuth: https://www.tiktok.com/v2/auth/authorize/
 * Token: POST https://open.tiktokapis.com/v2/oauth/token/
 * Scopes: user.info.basic, video.publish, video.upload
 *
 * Video upload akışı:
 *   1) POST /v2/post/publish/video/init/  → upload_url + publish_id
 *   2) PUT/POST upload_url ile video binary
 *   3) POST /v2/post/publish/status/fetch/ ile durum sorgula
 *
 * Maks: 4GB / 60dk · MP4/MOV/MPEG · 9:16 önerilir (Reels-style)
 */

const TIKTOK_API = 'https://open.tiktokapis.com/v2';

export class TikTokAdapter implements SocialAdapter {
  type = 'tiktok';

  oauth = {
    scopes: ['user.info.basic', 'video.publish', 'video.upload'],

    buildAuthUrl(state: string, redirectUri: string): string {
      const params = new URLSearchParams({
        client_key: process.env.TIKTOK_CLIENT_KEY ?? '',
        scope: this.scopes.join(','),
        response_type: 'code',
        redirect_uri: redirectUri,
        state,
      });
      return `https://www.tiktok.com/v2/auth/authorize/?${params.toString()}`;
    },

    async exchange(code: string, redirectUri: string) {
      const res = await fetch(`${TIKTOK_API}/oauth/token/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_key: process.env.TIKTOK_CLIENT_KEY ?? '',
          client_secret: process.env.TIKTOK_CLIENT_SECRET ?? '',
          code,
          grant_type: 'authorization_code',
          redirect_uri: redirectUri,
        }),
      });
      if (!res.ok) {
        const body = await res.text();
        throw new Error(`TikTok token exchange failed: ${res.status} ${body}`);
      }
      const data = (await res.json()) as {
        access_token: string;
        refresh_token: string;
        expires_in: number;
        open_id: string;
        scope: string;
      };
      return {
        accessToken: data.access_token,
        refreshToken: data.refresh_token,
        expiresAt: new Date(Date.now() + data.expires_in * 1000),
        extra: { openId: data.open_id, scope: data.scope },
      };
    },

    async fetchProfile(accessToken: string) {
      const res = await fetch(`${TIKTOK_API}/user/info/?fields=open_id,union_id,avatar_url,display_name,username`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (!res.ok) {
        const body = await res.text();
        throw new Error(`TikTok user/info failed: ${res.status} ${body}`);
      }
      const data = (await res.json()) as { data: { user: any } };
      const u = data.data.user;
      return {
        externalId: u.open_id,
        externalName: u.display_name ?? u.username ?? 'TikTok user',
        externalAvatar: u.avatar_url,
        extra: { unionId: u.union_id, username: u.username },
      };
    },
  };

  async refreshTokens(ctx: SocialAdapterContext): Promise<Record<string, any> | null> {
    const refreshToken = ctx.credentials?.refreshToken;
    if (!refreshToken) return null;
    const res = await fetch(`${TIKTOK_API}/oauth/token/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_key: process.env.TIKTOK_CLIENT_KEY ?? '',
        client_secret: process.env.TIKTOK_CLIENT_SECRET ?? '',
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
      }),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      access_token: string;
      refresh_token: string;
      expires_in: number;
    };
    return {
      ...ctx.credentials,
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresAt: new Date(Date.now() + data.expires_in * 1000),
    };
  }

  async publish(input: SocialPublishInput, ctx: SocialAdapterContext): Promise<SocialPublishResult> {
    const accessToken = ctx.credentials?.accessToken;
    if (!accessToken) throw new Error('TikTok accessToken yok');

    const video = (input.mediaUrls ?? []).find((m) => m.type === 'video');
    if (!video) throw new Error('TikTok publish için video URL gerek');

    // 1) init upload — videoyu URL'den çekme modunda
    const initBody = {
      post_info: {
        title: this.formatTitle(input),
        privacy_level: (ctx.config as any)?.privacyLevel ?? 'PUBLIC_TO_EVERYONE',
        disable_duet: false,
        disable_comment: false,
        disable_stitch: false,
        video_cover_timestamp_ms: 1000,
      },
      source_info: {
        source: 'PULL_FROM_URL',
        video_url: video.url,
      },
    };

    const initRes = await fetch(`${TIKTOK_API}/post/publish/video/init/`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(initBody),
    });
    if (!initRes.ok) {
      const body = await initRes.text();
      throw new Error(`TikTok init failed: ${initRes.status} ${body}`);
    }
    const initData = (await initRes.json()) as { data: { publish_id: string } };
    const publishId = initData.data.publish_id;

    // PULL_FROM_URL modunda TikTok video'yu fetch eder; biz sadece publish_id döndürürüz.
    // Status fetch arka plan worker'da poll edilecek (şimdilik publish_id'yi externalId yap).
    return {
      externalId: publishId,
      externalUrl: `https://www.tiktok.com/${(ctx.config as any)?.username ? '@' + (ctx.config as any).username : ''}`,
      raw: initData,
    };
  }

  private formatTitle(input: SocialPublishInput): string {
    let out = input.text.trim().split('\n')[0] ?? input.text.trim();
    const tags = input.metadata?.hashtags ?? [];
    if (tags.length) {
      out += ' ' + tags.map((t) => (t.startsWith('#') ? t : `#${t}`)).join(' ');
    }
    return out.length > 2200 ? out.slice(0, 2197) + '...' : out;
  }
}
