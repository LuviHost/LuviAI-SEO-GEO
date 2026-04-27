import * as crypto from 'node:crypto';
import { PublishAdapter } from './base.js';
import type { PublishPayload, PublishResult } from './base.js';

/**
 * Custom PHP endpoint adapter — kullanıcı kendi PHP API'ını yazar, biz POST atarız.
 *
 * credentials: { endpointUrl, apiKey?, hmacSecret? }
 * config: { method?: 'POST' | 'PUT', expectedField?: 'url' | 'id' }
 *
 * Body JSON:
 * {
 *   slug, title, body_html, body_md, meta_title, meta_description,
 *   category, hero_image_url
 * }
 *
 * Auth seçenekleri:
 *  - apiKey → "Authorization: Bearer {apiKey}" header
 *  - hmacSecret → "X-LuviAI-Signature: sha256={hmac}" header (body üzerine)
 *
 * Beklenen response:
 *   { ok: true, url?: '...', id?: '...' }
 *   veya { ok: false, error: '...' }
 */
export class CustomPhpAdapter extends PublishAdapter {
  async publish(payload: PublishPayload): Promise<PublishResult> {
    const { endpointUrl, apiKey, hmacSecret } = this.credentials;
    const { method = 'POST' } = this.config;

    const body = JSON.stringify({
      slug: payload.slug,
      title: payload.title,
      body_html: payload.bodyHtml,
      body_md: payload.bodyMd,
      meta_title: payload.metaTitle,
      meta_description: payload.metaDescription,
      category: payload.category,
      hero_image_url: payload.heroImageUrl,
      schema_markup: payload.schemaMarkup,
      published_at: new Date().toISOString(),
    });

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'User-Agent': 'LuviAI-Publisher/1.0',
    };

    if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;
    if (hmacSecret) {
      const signature = crypto.createHmac('sha256', hmacSecret).update(body).digest('hex');
      headers['X-LuviAI-Signature'] = `sha256=${signature}`;
    }

    try {
      const res = await fetch(endpointUrl, { method, headers, body });

      if (!res.ok) {
        return { ok: false, error: `HTTP ${res.status}: ${(await res.text()).slice(0, 200)}` };
      }

      const data: any = await res.json().catch(() => ({}));

      if (data.ok === false) {
        return { ok: false, error: data.error ?? 'Unknown error' };
      }

      return {
        ok: true,
        externalUrl: data.url ?? data.permalink,
        externalId: data.id ?? data.post_id ?? data.slug ?? payload.slug,
      };
    } catch (err: any) {
      return { ok: false, error: err.message };
    }
  }

  async test(): Promise<boolean> {
    const { endpointUrl, apiKey } = this.credentials;
    try {
      // OPTIONS veya GET ile bağlantı testi
      const res = await fetch(endpointUrl, {
        method: 'OPTIONS',
        headers: apiKey ? { 'Authorization': `Bearer ${apiKey}` } : {},
      });
      return res.status < 500; // 4xx sayılır (auth eksik vs.)
    } catch {
      return false;
    }
  }
}
