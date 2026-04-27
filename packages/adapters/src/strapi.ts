import { PublishAdapter } from './base.js';
import type { PublishPayload, PublishResult } from './base.js';

/**
 * Strapi REST API adapter (v4+).
 * credentials: { strapiUrl, apiToken }
 * config: { contentType: 'articles', publish?: boolean }
 *
 * Strapi 4+ REST: POST /api/{plural-content-type}
 * Docs: https://docs.strapi.io/dev-docs/api/rest
 */
export class StrapiAdapter extends PublishAdapter {
  async publish(payload: PublishPayload): Promise<PublishResult> {
    const { strapiUrl, apiToken } = this.credentials;
    const { contentType = 'articles', publish = true } = this.config;

    const url = `${strapiUrl.replace(/\/$/, '')}/api/${contentType}`;

    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          data: {
            title: payload.title,
            slug: payload.slug,
            content: payload.bodyHtml,
            excerpt: payload.metaDescription,
            publishedAt: publish ? new Date().toISOString() : null,
          },
        }),
      });

      if (!res.ok) {
        const error = await res.text();
        return { ok: false, error: `Strapi ${res.status}: ${error.slice(0, 200)}` };
      }

      const data: any = await res.json();
      const id = data.data?.id;
      return {
        ok: true,
        externalUrl: `${strapiUrl}/admin/content-manager/collection-types/api::${contentType}.${contentType}/${id}`,
        externalId: String(id),
      };
    } catch (err: any) {
      return { ok: false, error: err.message };
    }
  }

  async test(): Promise<boolean> {
    const { strapiUrl, apiToken } = this.credentials;
    try {
      const res = await fetch(`${strapiUrl}/api`, {
        headers: { 'Authorization': `Bearer ${apiToken}` },
      });
      return res.ok;
    } catch {
      return false;
    }
  }
}
