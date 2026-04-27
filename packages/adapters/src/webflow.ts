import { PublishAdapter } from './base.js';
import type { PublishPayload, PublishResult } from './base.js';

/**
 * Webflow CMS API adapter.
 * credentials: { apiToken, siteId, collectionId }
 * config: { liveAfterPublish?: boolean, fieldMap?: { title, slug, body, ... } }
 *
 * Webflow CMS Collection'a yeni item olarak ekler.
 * Docs: https://developers.webflow.com/data/reference/cms/collection-items/staged-items/create-item
 */
export class WebflowAdapter extends PublishAdapter {
  async publish(payload: PublishPayload): Promise<PublishResult> {
    const { apiToken, collectionId } = this.credentials;
    const fieldMap = this.config.fieldMap ?? {
      title: 'name',
      slug: 'slug',
      body: 'post-body',
      excerpt: 'post-summary',
    };

    const fieldData: Record<string, any> = {
      [fieldMap.title]: payload.title,
      [fieldMap.slug]: payload.slug,
      [fieldMap.body]: payload.bodyHtml,
      [fieldMap.excerpt]: payload.metaDescription ?? '',
    };

    try {
      const res = await fetch(
        `https://api.webflow.com/v2/collections/${collectionId}/items${this.config.liveAfterPublish ? '/live' : ''}`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${apiToken}`,
            'Content-Type': 'application/json',
            'accept-version': '2.0.0',
          },
          body: JSON.stringify({
            isArchived: false,
            isDraft: !this.config.liveAfterPublish,
            fieldData,
          }),
        },
      );

      if (!res.ok) {
        const error = await res.text();
        return { ok: false, error: `Webflow ${res.status}: ${error.slice(0, 200)}` };
      }

      const data: any = await res.json();
      return {
        ok: true,
        externalUrl: data.lastPublished ? `https://${data.fieldData?.slug}.webflow.io` : undefined,
        externalId: data.id,
      };
    } catch (err: any) {
      return { ok: false, error: err.message };
    }
  }

  async test(): Promise<boolean> {
    const { apiToken, collectionId } = this.credentials;
    try {
      const res = await fetch(`https://api.webflow.com/v2/collections/${collectionId}`, {
        headers: { Authorization: `Bearer ${apiToken}`, 'accept-version': '2.0.0' },
      });
      return res.ok;
    } catch {
      return false;
    }
  }
}
