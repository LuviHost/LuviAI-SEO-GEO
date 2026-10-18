import * as crypto from 'node:crypto';
import { PublishAdapter } from './base.js';
import type { PublishPayload, PublishResult } from './base.js';
import { adapterFetch, httpErrorText } from './transport.js';
import { pickString, trimTrailingSlash } from './credential-keys.js';

/**
 * Ghost Admin API adapter.
 * credentials: { apiUrl (panel katalogu) | siteUrl (eski kayitlar), adminApiKey }
 * config: { status: 'published' | 'draft', tags?: string[] }
 *
 * adminApiKey format: "id:secret" — Ghost Admin → Integrations ekraninda
 * yeni bir Custom Integration ile uretilir; secret hex kodludur ve imzadan
 * once ham bayta cevrilir (https://docs.ghost.org/admin-api, Token
 * Authentication). JWT auth ile self-signed token.
 */
export class GhostAdapter extends PublishAdapter {
  async publish(payload: PublishPayload): Promise<PublishResult> {
    const { status = 'published', tags = [] } = this.config;

    try {
      const token = this.makeJWT(this.adminApiKey());
      const apiUrl = `${this.adminBase()}/ghost/api/admin/posts/?source=html`;

      const res = await adapterFetch(apiUrl, {
        method: 'POST',
        headers: {
          'Authorization': `Ghost ${token}`,
          'Content-Type': 'application/json',
          'Accept-Version': 'v5.0',
        },
        body: JSON.stringify({
          posts: [
            {
              title: payload.title,
              slug: payload.slug,
              html: payload.bodyHtml,
              excerpt: payload.metaDescription,
              status,
              tags: tags.map((name: string) => ({ name })),
              meta_title: payload.metaTitle,
              meta_description: payload.metaDescription,
            },
          ],
        }),
      });

      if (!res.ok) {
        return { ok: false, error: await httpErrorText('Ghost', res) };
      }

      const data: any = await res.json();
      const post = data.posts?.[0];
      return {
        ok: true,
        externalUrl: post?.url,
        externalId: post?.id,
      };
    } catch (err: any) {
      return { ok: false, error: err.message };
    }
  }

  /**
   * Anahtari GERCEKTEN dogrular. Eskiden /ghost/api/admin/site/ okunuyordu;
   * o uc herkese acik (Ghost core routes.js: router.get('/site',
   * mw.publicAdminApi, ...)) — yanlis anahtarla da 200 donup "baglanti
   * basarili" dedirtirdi. /posts/ kimlik ister (mw.authAdminApi); limit=1 ile
   * yanit kucuk kalir. Kaynak (18.10.2026):
   * https://github.com/TryGhost/Ghost/blob/main/ghost/core/server/web/api/endpoints/admin/routes.js
   */
  async test(): Promise<boolean> {
    try {
      const token = this.makeJWT(this.adminApiKey());
      const res = await adapterFetch(`${this.adminBase()}/ghost/api/admin/posts/?limit=1`, {
        headers: { 'Authorization': `Ghost ${token}`, 'Accept-Version': 'v5.0' },
      });
      // Govde okunmaz; baglanti havuzda asili kalmasin
      await res.body?.cancel().catch(() => {});
      return res.ok;
    } catch {
      return false;
    }
  }

  /** Panel katalogu 'apiUrl' yazar; eski kayitlar 'siteUrl' (bkz. credential-keys.ts) */
  private adminBase(): string {
    const url = pickString(this.credentials, 'apiUrl', 'siteUrl');
    if (!url) throw new Error('Ghost API URL eksik — yayın hedefini düzenleyip adresi girin.');
    return trimTrailingSlash(url);
  }

  private adminApiKey(): string {
    const key = pickString(this.credentials, 'adminApiKey');
    if (!key) throw new Error('Ghost Admin API Key eksik — yayın hedefini düzenleyip anahtarı girin.');
    return key;
  }

  private makeJWT(adminApiKey: string): string {
    const [id, secret] = adminApiKey.split(':');
    // Buffer.from(_, 'hex') gecersiz karakterde sessizce kisaltir: yanlis imza
    // "401" diye donerdi, asil neden (bicim) gorunmezdi
    if (!id || !secret || !/^[0-9a-f]+$/i.test(secret) || secret.length % 2 !== 0) {
      throw new Error("Ghost Admin API Key 'id:secret' biçiminde olmalı (secret onaltılık).");
    }

    const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT', kid: id })).toString('base64url');
    const now = Math.floor(Date.now() / 1000);
    const payload = Buffer.from(JSON.stringify({ iat: now, exp: now + 5 * 60, aud: '/admin/' })).toString('base64url');

    const signature = crypto
      .createHmac('sha256', Buffer.from(secret, 'hex'))
      .update(`${header}.${payload}`)
      .digest('base64url');

    return `${header}.${payload}.${signature}`;
  }
}
