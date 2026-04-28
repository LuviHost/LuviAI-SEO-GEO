import { PublishAdapter } from './base.js';
import type { PublishPayload, PublishResult, OnPageMetaPayload, OnPageMetaResult } from './base.js';

/**
 * Webflow adapter.
 *  - publish(): CMS Collection item'a yeni post ekler
 *  - applyOnPageMeta(): Pages API ile var olan sayfanın seo + openGraph alanlarını günceller
 *
 * credentials: { apiToken, siteId, collectionId? }
 * config: { liveAfterPublish?, fieldMap? }
 */
export class WebflowAdapter extends PublishAdapter {
  async publish(payload: PublishPayload): Promise<PublishResult> {
    const { apiToken, collectionId } = this.credentials;
    if (!collectionId) return { ok: false, error: 'Webflow collectionId yok' };
    const fieldMap = this.config.fieldMap ?? {
      title: 'name', slug: 'slug', body: 'post-body', excerpt: 'post-summary',
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
          body: JSON.stringify({ isArchived: false, isDraft: !this.config.liveAfterPublish, fieldData }),
        },
      );
      if (!res.ok) {
        const err = await res.text();
        return { ok: false, error: `Webflow ${res.status}: ${err.slice(0, 200)}` };
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
    const { apiToken, siteId, collectionId } = this.credentials;
    try {
      const url = collectionId
        ? `https://api.webflow.com/v2/collections/${collectionId}`
        : `https://api.webflow.com/v2/sites/${siteId}`;
      const res = await fetch(url, { headers: { Authorization: `Bearer ${apiToken}`, 'accept-version': '2.0.0' } });
      return res.ok;
    } catch { return false; }
  }

  async applyOnPageMeta(payload: OnPageMetaPayload): Promise<OnPageMetaResult> {
    const { apiToken, siteId } = this.credentials;
    if (!apiToken || !siteId) {
      return { ok: false, applied: [], skipped: [{ field: 'all', reason: 'Webflow apiToken veya siteId eksik' }] };
    }

    const page = await this.findPage(apiToken, siteId, payload.pageUrl);
    if (!page) {
      return {
        ok: false,
        applied: [],
        skipped: [{ field: 'all', reason: `Webflow Pages API içinde URL bulunamadı: ${payload.pageUrl}` }],
      };
    }

    const seo: Record<string, any> = {};
    const openGraph: Record<string, any> = {};
    const applied: string[] = [];
    const skipped: { field: string; reason: string }[] = [];

    if (payload.metaTitle) { seo.title = payload.metaTitle; applied.push('metaTitle'); }
    if (payload.metaDescription) { seo.description = payload.metaDescription; applied.push('metaDescription'); }
    if (payload.ogTitle) { openGraph.title = payload.ogTitle; applied.push('ogTitle'); }
    if (payload.ogDescription) { openGraph.description = payload.ogDescription; applied.push('ogDescription'); }
    if (payload.ogImage) { openGraph.image = payload.ogImage; applied.push('ogImage'); }
    if (payload.canonical) skipped.push({ field: 'canonical', reason: 'Webflow Pages API canonical override desteklemiyor — Page Settings > SEO Settings içinden manuel set edilmeli' });
    if (payload.jsonLd) skipped.push({ field: 'jsonLd', reason: 'Webflow custom code — Project Settings > Custom Code içine ekle' });
    if (payload.twitterCard) skipped.push({ field: 'twitterCard', reason: 'Webflow OG image otomatik Twitter card için kullanılır' });

    const body: Record<string, any> = {};
    if (Object.keys(seo).length) body.seo = seo;
    if (Object.keys(openGraph).length) body.openGraph = openGraph;

    if (Object.keys(body).length === 0) {
      return { ok: false, applied, skipped: [{ field: 'all', reason: 'Uygulanacak alan yok' }] };
    }

    const res = await fetch(`https://api.webflow.com/v2/pages/${page.id}`, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${apiToken}`,
        'Content-Type': 'application/json',
        'accept-version': '2.0.0',
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      return {
        ok: false,
        applied: [],
        skipped: [{ field: 'all', reason: `Webflow Pages PUT ${res.status}: ${(await res.text()).slice(0, 180)}` }],
      };
    }
    return { ok: true, applied, skipped, externalUrl: payload.pageUrl };
  }

  private async findPage(apiToken: string, siteId: string, pageUrl: string): Promise<{ id: string; slug: string } | null> {
    let pathname = '/';
    try { pathname = new URL(pageUrl).pathname.replace(/\/$/, '') || '/'; } catch {}
    const slug = pathname === '/' ? '' : pathname.split('/').filter(Boolean).pop() ?? '';

    const res = await fetch(`https://api.webflow.com/v2/sites/${siteId}/pages?limit=100`, {
      headers: { Authorization: `Bearer ${apiToken}`, 'accept-version': '2.0.0' },
    });
    if (!res.ok) return null;
    const data: any = await res.json();
    const pages: any[] = data.pages ?? [];
    if (slug === '') {
      return pages.find(p => p.slug === '' || p.slug === '/' || p.title?.toLowerCase() === 'home') ?? null;
    }
    return pages.find(p => p.slug === slug) ?? null;
  }
}
