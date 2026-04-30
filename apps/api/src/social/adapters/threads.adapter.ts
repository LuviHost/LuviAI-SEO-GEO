import type {
  SocialAdapter,
  SocialAdapterContext,
  SocialPublishInput,
  SocialPublishResult,
} from './types.js';

/**
 * Threads adapter — Threads Graph API (Meta).
 *
 * Auth: Threads OAuth (https://www.threads.net/oauth/authorize)
 * Scopes: threads_basic, threads_content_publish
 *
 * Yayınlama 2 adım (IG'ye benzer):
 *   1) POST /v1.0/{threads-user-id}/threads → media_id
 *      params: media_type=TEXT|IMAGE|VIDEO, text, image_url|video_url
 *   2) POST /v1.0/{threads-user-id}/threads_publish → published id
 */

const TH_API = 'https://graph.threads.net/v1.0';

export class ThreadsAdapter implements SocialAdapter {
  type = 'threads';

  oauth = {
    scopes: ['threads_basic', 'threads_content_publish'],

    buildAuthUrl(state: string, redirectUri: string): string {
      const params = new URLSearchParams({
        client_id: process.env.THREADS_APP_ID ?? '',
        redirect_uri: redirectUri,
        response_type: 'code',
        scope: this.scopes.join(','),
        state,
      });
      return `https://threads.net/oauth/authorize?${params.toString()}`;
    },

    async exchange(code: string, redirectUri: string) {
      const res = await fetch('https://graph.threads.net/oauth/access_token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: process.env.THREADS_APP_ID ?? '',
          client_secret: process.env.THREADS_APP_SECRET ?? '',
          grant_type: 'authorization_code',
          redirect_uri: redirectUri,
          code,
        }),
      });
      if (!res.ok) {
        const body = await res.text();
        throw new Error(`Threads token exchange failed: ${res.status} ${body}`);
      }
      const data = (await res.json()) as {
        access_token: string;
        user_id: string;
      };
      // Long-lived token (60 gün) swap
      const longRes = await fetch(
        `https://graph.threads.net/access_token?${new URLSearchParams({
          grant_type: 'th_exchange_token',
          client_secret: process.env.THREADS_APP_SECRET ?? '',
          access_token: data.access_token,
        }).toString()}`,
      );
      const longData = longRes.ok
        ? ((await longRes.json()) as { access_token: string; expires_in: number })
        : { access_token: data.access_token, expires_in: 5_184_000 };
      return {
        accessToken: longData.access_token,
        expiresAt: new Date(Date.now() + (longData.expires_in ?? 5_184_000) * 1000),
        extra: { userId: data.user_id },
      };
    },

    async fetchProfile(accessToken: string) {
      const res = await fetch(`${TH_API}/me?fields=id,username,name,threads_profile_picture_url`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (!res.ok) {
        const body = await res.text();
        throw new Error(`Threads /me failed: ${res.status} ${body}`);
      }
      const data = (await res.json()) as {
        id: string;
        username?: string;
        name?: string;
        threads_profile_picture_url?: string;
      };
      return {
        externalId: data.id,
        externalName: data.username ?? data.name ?? `Threads ${data.id}`,
        externalAvatar: data.threads_profile_picture_url,
        extra: { username: data.username },
      };
    },
  };

  async publish(input: SocialPublishInput, ctx: SocialAdapterContext): Promise<SocialPublishResult> {
    const accessToken = ctx.credentials?.accessToken;
    const userId = ctx.externalId;
    if (!accessToken) throw new Error('Threads accessToken yok');
    if (!userId) throw new Error('Threads userId yok');

    const text = this.formatText(input);
    const image = (input.mediaUrls ?? []).find((m) => m.type === 'image');
    const video = (input.mediaUrls ?? []).find((m) => m.type === 'video');

    const cBody: Record<string, string> = {
      access_token: accessToken,
      text,
    };
    if (image) {
      cBody.media_type = 'IMAGE';
      cBody.image_url = image.url;
    } else if (video) {
      cBody.media_type = 'VIDEO';
      cBody.video_url = video.url;
    } else {
      cBody.media_type = 'TEXT';
    }

    const cRes = await fetch(`${TH_API}/${userId}/threads`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(cBody),
    });
    if (!cRes.ok) {
      const body = await cRes.text();
      throw new Error(`Threads container failed: ${cRes.status} ${body}`);
    }
    const cData = (await cRes.json()) as { id: string };

    if (video) {
      // Video işlenmesini bekle
      await this.waitReady(cData.id, accessToken);
    }

    const pRes = await fetch(`${TH_API}/${userId}/threads_publish`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        creation_id: cData.id,
        access_token: accessToken,
      }),
    });
    if (!pRes.ok) {
      const body = await pRes.text();
      throw new Error(`Threads publish failed: ${pRes.status} ${body}`);
    }
    const pData = (await pRes.json()) as { id: string };

    const username = (ctx.credentials?.extra as any)?.username;
    const externalUrl = username
      ? `https://www.threads.net/@${username}/post/${pData.id}`
      : `https://www.threads.net/post/${pData.id}`;
    return { externalId: pData.id, externalUrl, raw: pData };
  }

  private async waitReady(creationId: string, token: string, maxWaitMs = 90000) {
    const start = Date.now();
    while (Date.now() - start < maxWaitMs) {
      await new Promise((r) => setTimeout(r, 4000));
      const res = await fetch(`${TH_API}/${creationId}?fields=status&access_token=${encodeURIComponent(token)}`);
      if (res.ok) {
        const data = (await res.json()) as { status?: string };
        if (data.status === 'FINISHED') return;
        if (data.status === 'ERROR') throw new Error('Threads media ERROR');
      }
    }
    throw new Error('Threads media processing timeout');
  }

  private formatText(input: SocialPublishInput): string {
    let out = input.text.trim();
    const tags = input.metadata?.hashtags ?? [];
    if (tags.length) out += ' ' + tags.map((t) => (t.startsWith('#') ? t : `#${t}`)).join(' ');
    return out.length > 500 ? out.slice(0, 497) + '...' : out;
  }
}
