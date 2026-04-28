import { createHash, randomBytes } from 'node:crypto';
import type {
  SocialAdapter,
  SocialAdapterContext,
  SocialPublishInput,
  SocialPublishResult,
} from './types.js';

/**
 * X (Twitter) adapter — OAuth 2.0 with PKCE + /2/tweets API.
 *
 * X gerektiriyor:
 *   - Confidential client (Client Secret + Basic Auth)
 *   - PKCE (code_verifier + code_challenge S256)
 *   - Scopes: tweet.read tweet.write users.read offline.access
 *
 * Token icin:
 *   POST https://api.x.com/2/oauth2/token
 *   Auth: Basic base64(client_id:client_secret)
 *   Body: grant_type=authorization_code&code=...&redirect_uri=...&code_verifier=...
 *
 * Tweet:
 *   POST https://api.x.com/2/tweets
 *   Header: Authorization: Bearer <access_token>
 *   Body: { text: "..." }
 *
 * Free tier: 500 post/ay (yazma), 100 read/ay. Yeterli.
 */

const X_API = 'https://api.x.com/2';
const X_OAUTH_AUTHORIZE = 'https://x.com/i/oauth2/authorize';
const X_OAUTH_TOKEN = 'https://api.x.com/2/oauth2/token';

function pkce() {
  const verifier = randomBytes(48).toString('base64url').slice(0, 64);
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge };
}

export class TwitterAdapter implements SocialAdapter {
  type = 'twitter';

  oauth = {
    scopes: ['tweet.read', 'tweet.write', 'users.read', 'offline.access'],

    /**
     * X PKCE icin verifier ve challenge uretip,
     * verifier'i state'in icine gomuyoruz (base64 + JSON).
     * Callback'te ayni state geri geldiginde verifier'i cikartip token swap'a veriyoruz.
     */
    buildAuthUrl(state: string, redirectUri: string): string {
      // state ZATEN base64'lenmis JSON ({siteId, type, n}) — icine code_verifier ekle
      // social-channels.service.ts buildAuthUrl'i dogrudan bu method'u cagiriyor;
      // o yuzden state'i tekrar parse + verifier ekle + base64'le.
      let stateObj: any = {};
      try {
        stateObj = JSON.parse(Buffer.from(state, 'base64url').toString('utf-8'));
      } catch {
        stateObj = { state };
      }
      const { verifier, challenge } = pkce();
      stateObj.cv = verifier;
      const newState = Buffer.from(JSON.stringify(stateObj)).toString('base64url');

      const params = new URLSearchParams({
        response_type: 'code',
        client_id: process.env.TWITTER_CLIENT_ID ?? '',
        redirect_uri: redirectUri,
        scope: this.scopes.join(' '),
        state: newState,
        code_challenge: challenge,
        code_challenge_method: 'S256',
      });
      return `${X_OAUTH_AUTHORIZE}?${params.toString()}`;
    },

    async exchange(code: string, redirectUri: string, state?: string) {
      // state'ten code_verifier cikar
      let cv = '';
      if (state) {
        try {
          const stateObj = JSON.parse(Buffer.from(state, 'base64url').toString('utf-8'));
          cv = stateObj.cv ?? '';
        } catch {}
      }
      if (!cv) {
        throw new Error('X OAuth: code_verifier yok (state bozuk)');
      }

      const basic = Buffer.from(
        `${process.env.TWITTER_CLIENT_ID}:${process.env.TWITTER_CLIENT_SECRET}`,
      ).toString('base64');

      const res = await fetch(X_OAUTH_TOKEN, {
        method: 'POST',
        headers: {
          Authorization: `Basic ${basic}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          code,
          redirect_uri: redirectUri,
          code_verifier: cv,
        }),
      });
      if (!res.ok) {
        const body = await res.text();
        throw new Error(`X token exchange failed: ${res.status} ${body}`);
      }
      const data = (await res.json()) as {
        access_token: string;
        refresh_token?: string;
        expires_in: number;
        scope: string;
        token_type: string;
      };
      return {
        accessToken: data.access_token,
        refreshToken: data.refresh_token,
        expiresAt: new Date(Date.now() + data.expires_in * 1000),
        extra: { scope: data.scope, tokenType: data.token_type },
      };
    },

    async fetchProfile(accessToken: string) {
      const res = await fetch(`${X_API}/users/me?user.fields=profile_image_url,username,name`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (!res.ok) {
        const body = await res.text();
        throw new Error(`X /users/me failed: ${res.status} ${body}`);
      }
      const data = (await res.json()) as {
        data: { id: string; username: string; name: string; profile_image_url?: string };
      };
      return {
        externalId: data.data.id,
        externalName: `@${data.data.username}`,
        externalAvatar: data.data.profile_image_url,
        extra: { username: data.data.username, displayName: data.data.name },
      };
    },
  };

  async publish(input: SocialPublishInput, ctx: SocialAdapterContext): Promise<SocialPublishResult> {
    const accessToken = ctx.credentials?.accessToken;
    if (!accessToken) throw new Error('X accessToken yok');

    // Thread destegi: metadata.threadParts varsa zincir at
    const parts = input.metadata?.threadParts?.length
      ? input.metadata.threadParts
      : [this.formatText(input)];

    let firstId: string | null = null;
    let lastId: string | null = null;

    for (let i = 0; i < parts.length; i++) {
      const text = parts[i].slice(0, 280);
      const body: any = { text };
      if (lastId) {
        body.reply = { in_reply_to_tweet_id: lastId };
      }
      const res = await fetch(`${X_API}/tweets`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const errBody = await res.text();
        throw new Error(`X publish failed (part ${i + 1}/${parts.length}): ${res.status} ${errBody}`);
      }
      const data = (await res.json()) as { data: { id: string; text: string } };
      lastId = data.data.id;
      if (!firstId) firstId = lastId;
    }

    if (!firstId) throw new Error('X publish: no tweet ID');

    const username = (ctx.config?.username as string) ?? 'i';
    const externalUrl = `https://x.com/${username}/status/${firstId}`;

    return { externalId: firstId, externalUrl };
  }

  private formatText(input: SocialPublishInput): string {
    let text = input.text.trim();
    const tags = input.metadata?.hashtags ?? [];
    if (tags.length) {
      const hashStr = ' ' + tags.map((t) => (t.startsWith('#') ? t : `#${t}`)).join(' ');
      // 280 char sinirina sigarsa ekle
      if (text.length + hashStr.length <= 280) text += hashStr;
    }
    if (input.metadata?.link && text.length + input.metadata.link.length + 1 <= 280) {
      text += ` ${input.metadata.link}`;
    }
    if (text.length > 280) text = text.slice(0, 277) + '...';
    return text;
  }
}
