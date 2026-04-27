import * as crypto from 'node:crypto';
import { PublishAdapter } from './base.js';
import type { PublishPayload, PublishResult } from './base.js';

/**
 * Ghost Admin API adapter.
 * credentials: { siteUrl, adminApiKey }
 * config: { status: 'published' | 'draft', tags?: string[] }
 *
 * adminApiKey format: "id:secret" (Ghost Admin → Integrations → New)
 * JWT auth ile self-signed token.
 */
export class GhostAdapter extends PublishAdapter {
  async publish(payload: PublishPayload): Promise<PublishResult> {
    const { siteUrl, adminApiKey } = this.credentials;
    const { status = 'published', tags = [] } = this.config;

    try {
      const token = this.makeJWT(adminApiKey);
      const apiUrl = `${siteUrl.replace(/\/$/, '')}/ghost/api/admin/posts/?source=html`;

      const res = await fetch(apiUrl, {
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
        const error = await res.text();
        return { ok: false, error: `Ghost ${res.status}: ${error.slice(0, 200)}` };
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

  async test(): Promise<boolean> {
    const { siteUrl, adminApiKey } = this.credentials;
    try {
      const token = this.makeJWT(adminApiKey);
      const res = await fetch(`${siteUrl}/ghost/api/admin/site/`, {
        headers: { 'Authorization': `Ghost ${token}`, 'Accept-Version': 'v5.0' },
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  private makeJWT(adminApiKey: string): string {
    const [id, secret] = adminApiKey.split(':');
    if (!id || !secret) throw new Error('Ghost adminApiKey format: id:secret');

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
