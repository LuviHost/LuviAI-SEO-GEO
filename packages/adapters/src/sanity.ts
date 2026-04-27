import { createClient } from '@sanity/client';
import { PublishAdapter } from './base.js';
import type { PublishPayload, PublishResult } from './base.js';

/**
 * Sanity adapter.
 * credentials: { projectId, dataset, token, apiVersion? }
 * config: { docType: 'post' }
 *
 * Sanity'de yeni dokuman olarak yaratır.
 * Docs: https://www.sanity.io/docs/http-mutations
 */
export class SanityAdapter extends PublishAdapter {
  async publish(payload: PublishPayload): Promise<PublishResult> {
    const { projectId, dataset, token, apiVersion = '2024-01-01' } = this.credentials;
    const { docType = 'post' } = this.config;

    try {
      const client = createClient({
        projectId,
        dataset,
        token,
        apiVersion,
        useCdn: false,
      });

      const doc = {
        _type: docType,
        title: payload.title,
        slug: { _type: 'slug', current: payload.slug },
        body: this.htmlToPortableText(payload.bodyHtml),
        excerpt: payload.metaDescription ?? '',
        publishedAt: new Date().toISOString(),
      };

      const result = await client.create(doc);

      return {
        ok: true,
        externalUrl: `https://${projectId}.sanity.studio/desk/${docType};${result._id}`,
        externalId: result._id,
      };
    } catch (err: any) {
      return { ok: false, error: err.message };
    }
  }

  async test(): Promise<boolean> {
    const { projectId, dataset, token } = this.credentials;
    try {
      const client = createClient({ projectId, dataset, token, apiVersion: '2024-01-01', useCdn: false });
      await client.fetch('*[_type=="system"][0]');
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Çok basit HTML → Portable Text dönüştürücü.
   * Sanity gerçek anlamda Portable Text bekler — paragraflar, başlıklar.
   * Tam dönüşüm Faz 3'te (sanity/block-tools).
   */
  private htmlToPortableText(html: string): any[] {
    const blocks: any[] = [];
    const paragraphs = html.split(/<\/p>|<\/h[1-6]>/);

    for (const para of paragraphs) {
      const text = para.replace(/<[^>]+>/g, '').trim();
      if (!text) continue;

      const headingMatch = para.match(/<h([1-6])/);
      const style = headingMatch ? `h${headingMatch[1]}` : 'normal';

      blocks.push({
        _type: 'block',
        _key: Math.random().toString(36).slice(2),
        style,
        markDefs: [],
        children: [{ _type: 'span', _key: Math.random().toString(36).slice(2), text, marks: [] }],
      });
    }

    return blocks;
  }
}
