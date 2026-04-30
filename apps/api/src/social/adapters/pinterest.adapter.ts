import type {
  SocialAdapter,
  SocialAdapterContext,
  SocialPublishInput,
  SocialPublishResult,
} from './types.js';

/**
 * Pinterest adapter — Pinterest API v5.
 *
 * Auth: OAuth 2.0
 * Scopes: pins:read,pins:write,boards:read,boards:write,user_accounts:read
 *
 * Token: POST https://api.pinterest.com/v5/oauth/token
 * Authorize: https://www.pinterest.com/oauth/
 *
 * Image pin: POST https://api.pinterest.com/v5/pins
 *   body: { board_id, title, description, link, alt_text, media_source: {source_type:'image_url', url} }
 *
 * Video pin: source_type='video_id', önce upload registration sonra video upload.
 */

const PIN_API = 'https://api.pinterest.com/v5';

export class PinterestAdapter implements SocialAdapter {
  type = 'pinterest';

  oauth = {
    scopes: ['pins:read', 'pins:write', 'boards:read', 'boards:write', 'user_accounts:read'],

    buildAuthUrl(state: string, redirectUri: string): string {
      const params = new URLSearchParams({
        client_id: process.env.PINTEREST_CLIENT_ID ?? '',
        redirect_uri: redirectUri,
        response_type: 'code',
        scope: this.scopes.join(','),
        state,
      });
      return `https://www.pinterest.com/oauth/?${params.toString()}`;
    },

    async exchange(code: string, redirectUri: string) {
      const basic = Buffer.from(
        `${process.env.PINTEREST_CLIENT_ID ?? ''}:${process.env.PINTEREST_CLIENT_SECRET ?? ''}`,
      ).toString('base64');
      const res = await fetch(`${PIN_API}/oauth/token`, {
        method: 'POST',
        headers: {
          Authorization: `Basic ${basic}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          code,
          redirect_uri: redirectUri,
        }),
      });
      if (!res.ok) {
        const body = await res.text();
        throw new Error(`Pinterest token exchange failed: ${res.status} ${body}`);
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
      const res = await fetch(`${PIN_API}/user_account`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (!res.ok) {
        const body = await res.text();
        throw new Error(`Pinterest user_account failed: ${res.status} ${body}`);
      }
      const data = (await res.json()) as {
        username: string;
        account_type?: string;
        profile_image?: string;
      };
      return {
        externalId: data.username,
        externalName: data.username,
        externalAvatar: data.profile_image,
        extra: { accountType: data.account_type },
      };
    },
  };

  async refreshTokens(ctx: SocialAdapterContext): Promise<Record<string, any> | null> {
    const refreshToken = ctx.credentials?.refreshToken;
    if (!refreshToken) return null;
    const basic = Buffer.from(
      `${process.env.PINTEREST_CLIENT_ID ?? ''}:${process.env.PINTEREST_CLIENT_SECRET ?? ''}`,
    ).toString('base64');
    const res = await fetch(`${PIN_API}/oauth/token`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${basic}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
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
    if (!accessToken) throw new Error('Pinterest accessToken yok');

    const boardId = (ctx.config as any)?.boardId;
    if (!boardId) throw new Error('Pinterest board_id yok — kanal config\'inde tanımla');

    const image = (input.mediaUrls ?? []).find((m) => m.type === 'image');
    const video = (input.mediaUrls ?? []).find((m) => m.type === 'video');
    if (!image && !video) {
      throw new Error('Pinterest pin medya gerek (image veya video)');
    }

    const body: any = {
      board_id: boardId,
      title: this.shortTitle(input),
      description: this.formatText(input),
      link: input.metadata?.link,
      alt_text: image?.altText ?? '',
    };

    if (image) {
      body.media_source = { source_type: 'image_url', url: image.url };
    } else if (video) {
      // Video upload Pinterest'te iki adımlı: register + upload + register pin.
      // Şimdilik basit destek; gelişmiş video için ayrı method.
      throw new Error('Pinterest video pin: register/upload akışı henüz uygulanmadı');
    }

    const res = await fetch(`${PIN_API}/pins`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const errBody = await res.text();
      throw new Error(`Pinterest publish failed: ${res.status} ${errBody}`);
    }
    const data = (await res.json()) as { id: string };
    return {
      externalId: data.id,
      externalUrl: `https://www.pinterest.com/pin/${data.id}/`,
      raw: data,
    };
  }

  private shortTitle(input: SocialPublishInput): string {
    const t = input.text.trim().split('\n')[0] ?? input.text.trim();
    return t.length > 100 ? t.slice(0, 97) + '...' : t;
  }

  private formatText(input: SocialPublishInput): string {
    let out = input.text.trim();
    const tags = input.metadata?.hashtags ?? [];
    if (tags.length) {
      out += '\n\n' + tags.map((t) => (t.startsWith('#') ? t : `#${t}`)).join(' ');
    }
    return out.length > 800 ? out.slice(0, 797) + '...' : out;
  }
}
