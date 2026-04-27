import * as contentfulManagement from 'contentful-management';
import { PublishAdapter } from './base.js';
import type { PublishPayload, PublishResult } from './base.js';

/**
 * Contentful Management API adapter.
 * credentials: { spaceId, environmentId?, managementToken }
 * config: { contentTypeId, locale? }
 *
 * Contentful'da entry yaratır + publish eder.
 */
export class ContentfulAdapter extends PublishAdapter {
  async publish(payload: PublishPayload): Promise<PublishResult> {
    const { spaceId, environmentId = 'master', managementToken } = this.credentials;
    const { contentTypeId = 'blogPost', locale = 'en-US' } = this.config;

    try {
      const client = (contentfulManagement as any).createClient({ accessToken: managementToken });
      const space = await client.getSpace(spaceId);
      const env = await space.getEnvironment(environmentId);

      const entry = await env.createEntry(contentTypeId, {
        fields: {
          title: { [locale]: payload.title },
          slug: { [locale]: payload.slug },
          body: { [locale]: payload.bodyHtml },
          excerpt: { [locale]: payload.metaDescription ?? '' },
          publishedAt: { [locale]: new Date().toISOString() },
        },
      });

      const published = await entry.publish();

      return {
        ok: true,
        externalUrl: `https://app.contentful.com/spaces/${spaceId}/entries/${published.sys.id}`,
        externalId: published.sys.id,
      };
    } catch (err: any) {
      return { ok: false, error: err.message };
    }
  }

  async test(): Promise<boolean> {
    const { spaceId, managementToken } = this.credentials;
    try {
      const client = (contentfulManagement as any).createClient({ accessToken: managementToken });
      await client.getSpace(spaceId);
      return true;
    } catch {
      return false;
    }
  }
}
