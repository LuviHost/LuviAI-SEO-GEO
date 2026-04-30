import type {
  SocialAdapter,
  SocialAdapterContext,
  SocialPublishInput,
  SocialPublishResult,
} from './types.js';

/**
 * YouTube adapter — Data API v3 (videos.insert + resumable upload).
 *
 * Auth: Google OAuth 2.0
 * Scopes: https://www.googleapis.com/auth/youtube.upload
 *         https://www.googleapis.com/auth/youtube.readonly (kanal info için)
 *
 * Quota: 10,000 unit/gün (default). videos.insert = 1600 unit → ~6 yükleme/gün.
 *
 * Resumable upload akışı:
 *   1) POST https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status
 *      → response.headers.location = upload session URL
 *   2) PUT upload session URL ile video binary
 *   3) response = video resource
 *
 * Shorts: video <60s + 9:16 aspect → otomatik Shorts olarak işaretlenir.
 */

const YT_API = 'https://www.googleapis.com/youtube/v3';
const YT_UPLOAD = 'https://www.googleapis.com/upload/youtube/v3';

export class YouTubeAdapter implements SocialAdapter {
  type = 'youtube';

  oauth = {
    scopes: [
      'https://www.googleapis.com/auth/youtube.upload',
      'https://www.googleapis.com/auth/youtube.readonly',
    ],

    buildAuthUrl(state: string, redirectUri: string): string {
      const params = new URLSearchParams({
        client_id: process.env.GOOGLE_OAUTH_CLIENT_ID ?? process.env.YOUTUBE_CLIENT_ID ?? '',
        redirect_uri: redirectUri,
        response_type: 'code',
        scope: this.scopes.join(' '),
        access_type: 'offline',
        prompt: 'consent',
        state,
      });
      return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
    },

    async exchange(code: string, redirectUri: string) {
      const res = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          code,
          client_id: process.env.GOOGLE_OAUTH_CLIENT_ID ?? process.env.YOUTUBE_CLIENT_ID ?? '',
          client_secret: process.env.GOOGLE_OAUTH_CLIENT_SECRET ?? process.env.YOUTUBE_CLIENT_SECRET ?? '',
          redirect_uri: redirectUri,
          grant_type: 'authorization_code',
        }),
      });
      if (!res.ok) {
        const body = await res.text();
        throw new Error(`YouTube token exchange failed: ${res.status} ${body}`);
      }
      const data = (await res.json()) as {
        access_token: string;
        refresh_token?: string;
        expires_in: number;
        scope: string;
      };
      return {
        accessToken: data.access_token,
        refreshToken: data.refresh_token,
        expiresAt: new Date(Date.now() + data.expires_in * 1000),
        extra: { scope: data.scope },
      };
    },

    async fetchProfile(accessToken: string) {
      const res = await fetch(`${YT_API}/channels?part=snippet&mine=true`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (!res.ok) {
        const body = await res.text();
        throw new Error(`YouTube channels failed: ${res.status} ${body}`);
      }
      const data = (await res.json()) as { items?: Array<any> };
      const ch = data.items?.[0];
      if (!ch) throw new Error('YouTube: bağlı kanal bulunamadı');
      return {
        externalId: ch.id,
        externalName: ch.snippet?.title ?? 'YouTube channel',
        externalAvatar: ch.snippet?.thumbnails?.default?.url,
        extra: { customUrl: ch.snippet?.customUrl },
      };
    },
  };

  async refreshTokens(ctx: SocialAdapterContext): Promise<Record<string, any> | null> {
    const refreshToken = ctx.credentials?.refreshToken;
    if (!refreshToken) return null;
    const res = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: process.env.GOOGLE_OAUTH_CLIENT_ID ?? process.env.YOUTUBE_CLIENT_ID ?? '',
        client_secret: process.env.GOOGLE_OAUTH_CLIENT_SECRET ?? process.env.YOUTUBE_CLIENT_SECRET ?? '',
        refresh_token: refreshToken,
        grant_type: 'refresh_token',
      }),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { access_token: string; expires_in: number };
    return {
      ...ctx.credentials,
      accessToken: data.access_token,
      expiresAt: new Date(Date.now() + data.expires_in * 1000),
    };
  }

  async publish(input: SocialPublishInput, ctx: SocialAdapterContext): Promise<SocialPublishResult> {
    const accessToken = ctx.credentials?.accessToken;
    if (!accessToken) throw new Error('YouTube accessToken yok');

    const video = (input.mediaUrls ?? []).find((m) => m.type === 'video');
    if (!video) throw new Error('YouTube publish için video URL gerek');

    // 1) Resumable upload session başlat
    const meta = {
      snippet: {
        title: this.formatTitle(input),
        description: this.formatDescription(input),
        tags: input.metadata?.hashtags ?? [],
        categoryId: '22', // People & Blogs (default)
      },
      status: { privacyStatus: (ctx.config as any)?.privacyStatus ?? 'public' },
    };

    const initRes = await fetch(`${YT_UPLOAD}/videos?uploadType=resumable&part=snippet,status`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        'X-Upload-Content-Type': 'video/*',
      },
      body: JSON.stringify(meta),
    });
    if (!initRes.ok) {
      const body = await initRes.text();
      throw new Error(`YouTube upload init failed: ${initRes.status} ${body}`);
    }
    const sessionUrl = initRes.headers.get('Location');
    if (!sessionUrl) throw new Error('YouTube upload init: Location header yok');

    // 2) Video binary'yi indir → upload session'a PUT et
    const videoRes = await fetch(video.url);
    if (!videoRes.ok) throw new Error(`YouTube video fetch failed: ${videoRes.status}`);
    const buf = Buffer.from(await videoRes.arrayBuffer());

    const upload = await fetch(sessionUrl, {
      method: 'PUT',
      headers: {
        'Content-Type': videoRes.headers.get('content-type') ?? 'video/mp4',
        'Content-Length': String(buf.byteLength),
      },
      body: buf,
    });
    if (!upload.ok) {
      const body = await upload.text();
      throw new Error(`YouTube upload PUT failed: ${upload.status} ${body}`);
    }
    const data = (await upload.json()) as { id: string };

    return {
      externalId: data.id,
      externalUrl: `https://www.youtube.com/watch?v=${data.id}`,
      raw: data,
    };
  }

  private formatTitle(input: SocialPublishInput): string {
    let out = input.text.trim().split('\n')[0] ?? input.text.trim();
    return out.length > 100 ? out.slice(0, 97) + '...' : out;
  }

  private formatDescription(input: SocialPublishInput): string {
    let out = input.text.trim();
    if (input.metadata?.link) out += `\n\n${input.metadata.link}`;
    const tags = input.metadata?.hashtags ?? [];
    if (tags.length) out += '\n\n' + tags.map((t) => (t.startsWith('#') ? t : `#${t}`)).join(' ');
    return out.length > 5000 ? out.slice(0, 4997) + '...' : out;
  }
}
