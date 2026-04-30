import type {
  SocialAdapter,
  SocialAdapterContext,
  SocialPublishInput,
  SocialPublishResult,
} from './types.js';

/**
 * YouTube adapter — OAuth 2.0 (Google) + YouTube Data API v3.
 *
 * Auth:
 *   - Authorize: https://accounts.google.com/o/oauth2/v2/auth
 *   - Token:     https://oauth2.googleapis.com/token
 *   - Scopes:    youtube.upload, youtube.readonly, youtube (channel ops)
 *   - access_type=offline + prompt=consent => refresh_token alirsin
 *
 * Profil:
 *   GET https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true
 *
 * "Yayinla":
 *   YouTube'da SocialPublishInput.text "post" olarak yayinlanmaz —
 *   Community Posts API public degil. Bunun yerine:
 *   - mediaUrls'da bir video varsa: videos.insert (resumable upload)
 *   - aksi halde: SocialPublishInput.text + thumbnail ile bir "Short" yapilamaz.
 *   Su an MVP: video URL gelirse upload, gelmezse anlamli hata.
 *
 * Env:
 *   YOUTUBE_CLIENT_ID
 *   YOUTUBE_CLIENT_SECRET
 */

const GOOGLE_AUTH = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN = 'https://oauth2.googleapis.com/token';
const YT_API = 'https://www.googleapis.com/youtube/v3';
const YT_UPLOAD = 'https://www.googleapis.com/upload/youtube/v3';

export class YouTubeAdapter implements SocialAdapter {
  type = 'youtube';

  oauth = {
    scopes: [
      'openid',
      'email',
      'profile',
      'https://www.googleapis.com/auth/youtube.upload',
      'https://www.googleapis.com/auth/youtube.readonly',
      'https://www.googleapis.com/auth/youtube',
    ],

    buildAuthUrl(state: string, redirectUri: string): string {
      const params = new URLSearchParams({
        response_type: 'code',
        client_id: process.env.YOUTUBE_CLIENT_ID ?? '',
        redirect_uri: redirectUri,
        scope: this.scopes.join(' '),
        state,
        access_type: 'offline',
        prompt: 'consent',
        include_granted_scopes: 'true',
      });
      return `${GOOGLE_AUTH}?${params.toString()}`;
    },

    async exchange(code: string, redirectUri: string) {
      const res = await fetch(GOOGLE_TOKEN, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          code,
          redirect_uri: redirectUri,
          client_id: process.env.YOUTUBE_CLIENT_ID ?? '',
          client_secret: process.env.YOUTUBE_CLIENT_SECRET ?? '',
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
        token_type: string;
        id_token?: string;
      };
      return {
        accessToken: data.access_token,
        refreshToken: data.refresh_token,
        expiresAt: new Date(Date.now() + data.expires_in * 1000),
        extra: { scope: data.scope },
      };
    },

    async fetchProfile(accessToken: string) {
      const res = await fetch(
        `${YT_API}/channels?part=snippet,contentDetails&mine=true`,
        { headers: { Authorization: `Bearer ${accessToken}` } },
      );
      if (!res.ok) {
        const body = await res.text();
        throw new Error(`YouTube channels.mine failed: ${res.status} ${body}`);
      }
      const data = (await res.json()) as {
        items?: Array<{
          id: string;
          snippet: {
            title: string;
            description?: string;
            customUrl?: string;
            thumbnails?: { default?: { url?: string }; medium?: { url?: string }; high?: { url?: string } };
          };
        }>;
      };
      const channel = data.items?.[0];
      if (!channel) {
        throw new Error(
          'YouTube hesabinda kanal bulunamadi. Bu Google hesabiyla bir YouTube kanali olusturmus olmaniz gerekir.',
        );
      }
      const thumb =
        channel.snippet.thumbnails?.high?.url ??
        channel.snippet.thumbnails?.medium?.url ??
        channel.snippet.thumbnails?.default?.url;
      return {
        externalId: channel.id,
        externalName: channel.snippet.title,
        externalAvatar: thumb,
        extra: {
          customUrl: channel.snippet.customUrl,
          description: channel.snippet.description,
        },
      };
    },
  };

  async refreshTokens(ctx: SocialAdapterContext): Promise<Record<string, any> | null> {
    const refreshToken = ctx.credentials?.refreshToken;
    if (!refreshToken) return null;
    const res = await fetch(GOOGLE_TOKEN, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
        client_id: process.env.YOUTUBE_CLIENT_ID ?? '',
        client_secret: process.env.YOUTUBE_CLIENT_SECRET ?? '',
      }),
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`YouTube token refresh failed: ${res.status} ${body}`);
    }
    const data = (await res.json()) as {
      access_token: string;
      expires_in: number;
      scope?: string;
      token_type: string;
    };
    return {
      accessToken: data.access_token,
      refreshToken,
      expiresAt: new Date(Date.now() + data.expires_in * 1000).toISOString(),
      scope: data.scope,
    };
  }

  /**
   * YouTube'a video yukler (resumable upload, snippet + status meta ile).
   * Community Post / metin-only yayin Data API'da public degil — video gerek.
   *
   * SocialPublishInput.text -> video.title (60 char) + description (5000 char).
   * SocialPublishInput.mediaUrls[0].url -> video URL'i (mp4/mov/webm). Adapter
   * bu URL'i fetch eder, byte stream'i Google'a yollar.
   */
  async publish(input: SocialPublishInput, ctx: SocialAdapterContext): Promise<SocialPublishResult> {
    const accessToken = ctx.credentials?.accessToken;
    if (!accessToken) throw new Error('YouTube accessToken yok');

    const video = input.mediaUrls?.find((m) => m.type === 'video');
    if (!video?.url) {
      throw new Error(
        'YouTube yayini icin video URL gerekli. mediaUrls icinde { type: "video", url: "..." } bulunmali.',
      );
    }

    const title = this.toTitle(input.text);
    const description = this.toDescription(input);

    // 1) Resumable upload session ac
    const initRes = await fetch(
      `${YT_UPLOAD}/videos?uploadType=resumable&part=snippet,status`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json; charset=UTF-8',
          'X-Upload-Content-Type': 'video/*',
        },
        body: JSON.stringify({
          snippet: {
            title,
            description,
            tags: input.metadata?.hashtags ?? [],
            categoryId: '22', // People & Blogs (default — kullanici sonra degistirir)
          },
          status: {
            privacyStatus: 'public',
            selfDeclaredMadeForKids: false,
          },
        }),
      },
    );

    if (!initRes.ok) {
      const body = await initRes.text();
      throw new Error(`YouTube upload init failed: ${initRes.status} ${body}`);
    }
    const uploadUrl = initRes.headers.get('location');
    if (!uploadUrl) throw new Error('YouTube upload URL alinamadi (Location header yok)');

    // 2) Video binary'sini cek + Google'a yolla
    const videoRes = await fetch(video.url);
    if (!videoRes.ok || !videoRes.body) {
      throw new Error(`Video kaynaktan cekilemedi: ${video.url} (${videoRes.status})`);
    }
    const videoBuffer = Buffer.from(await videoRes.arrayBuffer());

    const uploadRes = await fetch(uploadUrl, {
      method: 'PUT',
      headers: {
        'Content-Type': videoRes.headers.get('content-type') ?? 'video/mp4',
        'Content-Length': videoBuffer.length.toString(),
      },
      body: videoBuffer,
    });

    if (!uploadRes.ok) {
      const body = await uploadRes.text();
      throw new Error(`YouTube video upload failed: ${uploadRes.status} ${body}`);
    }

    const data = (await uploadRes.json()) as {
      id: string;
      snippet?: { title: string };
      status?: { privacyStatus: string };
    };

    const videoId = data.id;
    const externalUrl = `https://www.youtube.com/watch?v=${videoId}`;
    return { externalId: videoId, externalUrl, raw: data };
  }

  /** İlk satir ya da ilk 70 karakter — title YouTube'da 100 char limit. */
  private toTitle(text: string): string {
    const firstLine = text.trim().split('\n')[0]?.trim() ?? '';
    const candidate = firstLine.length >= 10 ? firstLine : text.trim();
    if (candidate.length <= 95) return candidate;
    return candidate.slice(0, 92) + '...';
  }

  /** description: tum text + hashtag'ler. 5000 char limit. */
  private toDescription(input: SocialPublishInput): string {
    let out = input.text.trim();
    const tags = input.metadata?.hashtags ?? [];
    if (tags.length) {
      out += '\n\n' + tags.map((t) => (t.startsWith('#') ? t : `#${t}`)).join(' ');
    }
    if (input.metadata?.link) {
      out += `\n\n${input.metadata.link}`;
    }
    if (out.length > 4990) out = out.slice(0, 4987) + '...';
    return out;
  }
}
