import type {
  SocialAdapter,
  SocialAdapterContext,
  SocialPublishInput,
  SocialPublishResult,
} from './types.js';

/**
 * Bluesky adapter — AT Protocol (atproto.com).
 *
 * App review YOK. Kullanıcı app password üretir (https://bsky.app/settings/app-passwords)
 * ve handle (@xyz.bsky.social) ile birlikte yapıştırır → çalışır.
 *
 * createSession: POST https://bsky.social/xrpc/com.atproto.server.createSession
 *   body: { identifier: '<handle veya email>', password: '<app-password>' }
 *   resp: { accessJwt, refreshJwt, did, handle }
 *
 * createRecord: POST https://bsky.social/xrpc/com.atproto.repo.createRecord
 *   header: Authorization: Bearer <accessJwt>
 *   body: { repo: did, collection: 'app.bsky.feed.post', record: { text, createdAt, ... } }
 */

const BSKY_PDS = 'https://bsky.social';

export class BlueskyAdapter implements SocialAdapter {
  type = 'bluesky';

  /**
   * Bluesky'da OAuth web-flow yok (AT Proto OAuth henüz yaygınlaşmadı).
   * App password ile oturum açıyoruz — UI form gönderir, biz session yaratırız.
   * (oauth opsiyonel olduğundan tanımlamıyoruz; SocialChannelsService özel bir
   * `connectWithCredentials` akışı kullanır — aşağıdaki static helper'ı çağırır.)
   */

  static async signIn(handle: string, appPassword: string): Promise<{
    did: string;
    handle: string;
    accessJwt: string;
    refreshJwt: string;
  }> {
    const res = await fetch(`${BSKY_PDS}/xrpc/com.atproto.server.createSession`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier: handle, password: appPassword }),
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Bluesky signIn failed: ${res.status} ${body}`);
    }
    const data = (await res.json()) as {
      did: string;
      handle: string;
      accessJwt: string;
      refreshJwt: string;
    };
    return data;
  }

  static async refreshSession(refreshJwt: string): Promise<{
    accessJwt: string;
    refreshJwt: string;
  }> {
    const res = await fetch(`${BSKY_PDS}/xrpc/com.atproto.server.refreshSession`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${refreshJwt}` },
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Bluesky refreshSession failed: ${res.status} ${body}`);
    }
    return (await res.json()) as { accessJwt: string; refreshJwt: string };
  }

  async refreshTokens(ctx: SocialAdapterContext): Promise<Record<string, any> | null> {
    const refreshJwt = ctx.credentials?.refreshJwt;
    if (!refreshJwt) return null;
    try {
      const fresh = await BlueskyAdapter.refreshSession(refreshJwt);
      return {
        ...ctx.credentials,
        accessJwt: fresh.accessJwt,
        refreshJwt: fresh.refreshJwt,
      };
    } catch {
      return null;
    }
  }

  /**
   * Bluesky URL kart embed'ı için open graph fetch lazım — sadelik için
   * şimdilik external link'i text'e ekliyoruz, embed yok.
   * Image upload: blob upload + embed.images.
   */
  async publish(input: SocialPublishInput, ctx: SocialAdapterContext): Promise<SocialPublishResult> {
    const accessJwt = ctx.credentials?.accessJwt;
    const did = ctx.externalId;
    if (!accessJwt || !did) throw new Error('Bluesky session yok (accessJwt/did)');

    const text = this.formatText(input);
    const record: any = {
      $type: 'app.bsky.feed.post',
      text,
      createdAt: new Date().toISOString(),
      langs: ['tr'],
    };

    // Image embed
    const images = (input.mediaUrls ?? []).filter((m) => m.type === 'image').slice(0, 4);
    if (images.length) {
      const blobs = await Promise.all(images.map(async (img) => {
        const blobRes = await this.uploadBlob(accessJwt, img.url);
        return { alt: img.altText ?? '', image: blobRes };
      }));
      record.embed = { $type: 'app.bsky.embed.images', images: blobs };
    }

    const res = await fetch(`${BSKY_PDS}/xrpc/com.atproto.repo.createRecord`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessJwt}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        repo: did,
        collection: 'app.bsky.feed.post',
        record,
      }),
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Bluesky publish failed: ${res.status} ${body}`);
    }

    const data = (await res.json()) as { uri: string; cid: string };
    // at://did:plc:xxx/app.bsky.feed.post/3kabc → https://bsky.app/profile/<handle>/post/<rkey>
    const rkey = data.uri.split('/').pop() ?? '';
    const handle = (ctx.config as any)?.handle ?? did;
    const externalUrl = `https://bsky.app/profile/${handle}/post/${rkey}`;
    return { externalId: data.uri, externalUrl, raw: data };
  }

  private async uploadBlob(accessJwt: string, imageUrl: string): Promise<any> {
    const imgRes = await fetch(imageUrl);
    if (!imgRes.ok) throw new Error(`Bluesky image fetch failed: ${imgRes.status}`);
    const buf = Buffer.from(await imgRes.arrayBuffer());
    const mime = imgRes.headers.get('content-type') ?? 'image/jpeg';
    if (buf.byteLength > 1_000_000) {
      throw new Error('Bluesky image > 1MB — sıkıştırma gerek');
    }
    const upload = await fetch(`${BSKY_PDS}/xrpc/com.atproto.repo.uploadBlob`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessJwt}`,
        'Content-Type': mime,
      },
      body: buf,
    });
    if (!upload.ok) {
      const body = await upload.text();
      throw new Error(`Bluesky uploadBlob failed: ${upload.status} ${body}`);
    }
    const data = (await upload.json()) as { blob: any };
    return data.blob;
  }

  private formatText(input: SocialPublishInput): string {
    let out = input.text.trim();
    const tags = input.metadata?.hashtags ?? [];
    if (tags.length) {
      out += '\n\n' + tags.map((t) => (t.startsWith('#') ? t : `#${t}`)).join(' ');
    }
    if (input.metadata?.link) {
      const link = input.metadata.link;
      if (out.length + link.length + 2 <= 300) {
        out += `\n\n${link}`;
      }
    }
    if (out.length > 300) out = out.slice(0, 297) + '...';
    return out;
  }
}
