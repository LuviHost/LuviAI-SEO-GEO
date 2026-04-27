import { PublishAdapter } from './base.js';
import type { PublishPayload, PublishResult } from './base.js';

/**
 * WordPress REST API adapter
 *  - Auth: App Password (kullanıcı /wp-admin/profile.php'den oluşturur)
 *  - Endpoint: POST /wp-json/wp/v2/posts
 *  - Body: { title, content, status: 'publish'|'draft', categories, meta }
 */
export class WordPressRestAdapter extends PublishAdapter {
  async publish(payload: PublishPayload): Promise<PublishResult> {
    const { siteUrl, username, appPassword } = this.credentials;
    const auth = Buffer.from(`${username}:${appPassword}`).toString('base64');

    const res = await fetch(`${siteUrl}/wp-json/wp/v2/posts`, {
      method: 'POST',
      headers: { 'Authorization': `Basic ${auth}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: payload.title,
        slug: payload.slug,
        content: payload.bodyHtml,
        status: this.config.postStatus ?? 'publish',
        excerpt: payload.metaDescription,
      }),
    });
    if (!res.ok) {
      return { ok: false, error: `WP REST ${res.status}: ${await res.text()}` };
    }
    const data: any = await res.json();
    return { ok: true, externalUrl: data.link, externalId: String(data.id) };
  }

  async test(): Promise<boolean> {
    const { siteUrl } = this.credentials;
    const res = await fetch(`${siteUrl}/wp-json/wp/v2`);
    return res.ok;
  }
}
