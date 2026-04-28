import { PublishAdapter } from './base.js';
import type { PublishPayload, PublishResult, OnPageMetaPayload, OnPageMetaResult } from './base.js';

/**
 * Shopify adapter (Admin API 2024-10).
 *  credentials: { storeDomain (xyz.myshopify.com), accessToken }
 *  config: { blogId? }
 *
 * publish(): yeni article (blog post) oluşturur — blogId verildiyse.
 * applyOnPageMeta(): URL → product/page/article tip tespit edip metafields üzerinden
 *   global SEO (title_tag/description_tag) yazar; OG/canonical için custom metafield kullanır.
 */
export class ShopifyAdapter extends PublishAdapter {
  async publish(payload: PublishPayload): Promise<PublishResult> {
    const { storeDomain, accessToken } = this.credentials;
    const { blogId } = this.config;
    if (!blogId) return { ok: false, error: 'Shopify blogId yok (config.blogId)' };

    const res = await fetch(`https://${storeDomain}/admin/api/2024-10/blogs/${blogId}/articles.json`, {
      method: 'POST',
      headers: { 'X-Shopify-Access-Token': accessToken, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        article: {
          title: payload.title,
          body_html: payload.bodyHtml,
          summary_html: payload.metaDescription ?? '',
          handle: payload.slug,
          published: this.config.published !== false,
        },
      }),
    });
    if (!res.ok) {
      return { ok: false, error: `Shopify ${res.status}: ${(await res.text()).slice(0, 180)}` };
    }
    const data: any = await res.json();
    return {
      ok: true,
      externalId: String(data.article.id),
      externalUrl: `https://${storeDomain.replace('.myshopify.com', '')}.myshopify.com/blogs/${blogId}/${data.article.handle}`,
    };
  }

  async test(): Promise<boolean> {
    const { storeDomain, accessToken } = this.credentials;
    const r = await fetch(`https://${storeDomain}/admin/api/2024-10/shop.json`, {
      headers: { 'X-Shopify-Access-Token': accessToken },
    });
    return r.ok;
  }

  async applyOnPageMeta(payload: OnPageMetaPayload): Promise<OnPageMetaResult> {
    const { storeDomain, accessToken } = this.credentials;
    if (!storeDomain || !accessToken) {
      return { ok: false, applied: [], skipped: [{ field: 'all', reason: 'Shopify storeDomain veya accessToken eksik' }] };
    }
    const target = await this.resolveResource(storeDomain, accessToken, payload.pageUrl);
    if (!target) {
      return {
        ok: false,
        applied: [],
        skipped: [{ field: 'all', reason: `Shopify\'da bu URL\'e karşılık page/product/article bulunamadı: ${payload.pageUrl}` }],
      };
    }

    const applied: string[] = [];
    const skipped: { field: string; reason: string }[] = [];

    // 1) title_tag + description_tag — Shopify\'ın yerleşik SEO alanları (resource gövdesinde)
    const updateBody: Record<string, any> = {};
    if (payload.metaTitle) { updateBody.metafields_global_title_tag = payload.metaTitle; applied.push('metaTitle'); }
    if (payload.metaDescription) { updateBody.metafields_global_description_tag = payload.metaDescription; applied.push('metaDescription'); }

    if (Object.keys(updateBody).length > 0) {
      const updateRes = await fetch(`https://${storeDomain}/admin/api/2024-10/${target.path}.json`, {
        method: 'PUT',
        headers: { 'X-Shopify-Access-Token': accessToken, 'Content-Type': 'application/json' },
        body: JSON.stringify({ [target.singular]: { id: target.id, ...updateBody } }),
      });
      if (!updateRes.ok) {
        return {
          ok: false,
          applied: [],
          skipped: [{ field: 'all', reason: `Shopify update ${updateRes.status}: ${(await updateRes.text()).slice(0, 150)}` }],
        };
      }
    }

    // 2) OG/canonical/JSON-LD → Shopify yerleşik desteklemiyor
    if (payload.canonical) skipped.push({ field: 'canonical', reason: 'Shopify canonical override için tema theme.liquid customization gerekir' });
    if (payload.ogTitle || payload.ogDescription || payload.ogImage) {
      skipped.push({ field: 'openGraph', reason: 'Shopify OG için custom metafield + theme injection gerekir (manuel)' });
    }
    if (payload.jsonLd) skipped.push({ field: 'jsonLd', reason: 'Shopify yerleşik schema kullanır — custom için theme edit' });

    return { ok: applied.length > 0, applied, skipped };
  }

  private async resolveResource(domain: string, token: string, pageUrl: string): Promise<{ id: number; singular: string; path: string } | null> {
    let path = '/';
    try { path = new URL(pageUrl).pathname; } catch {}

    // /products/<handle>
    let m = path.match(/^\/products\/([^/]+)/);
    if (m) {
      const r = await fetch(`https://${domain}/admin/api/2024-10/products.json?handle=${encodeURIComponent(m[1])}`, {
        headers: { 'X-Shopify-Access-Token': token },
      });
      if (r.ok) {
        const d: any = await r.json();
        if (d.products?.[0]) return { id: d.products[0].id, singular: 'product', path: `products/${d.products[0].id}` };
      }
    }
    // /pages/<handle>
    m = path.match(/^\/pages\/([^/]+)/);
    if (m) {
      const r = await fetch(`https://${domain}/admin/api/2024-10/pages.json?handle=${encodeURIComponent(m[1])}`, {
        headers: { 'X-Shopify-Access-Token': token },
      });
      if (r.ok) {
        const d: any = await r.json();
        if (d.pages?.[0]) return { id: d.pages[0].id, singular: 'page', path: `pages/${d.pages[0].id}` };
      }
    }
    // /blogs/<blog>/<handle>
    m = path.match(/^\/blogs\/([^/]+)\/([^/]+)/);
    if (m) {
      const blogsRes = await fetch(`https://${domain}/admin/api/2024-10/blogs.json?handle=${encodeURIComponent(m[1])}`, {
        headers: { 'X-Shopify-Access-Token': token },
      });
      if (blogsRes.ok) {
        const bd: any = await blogsRes.json();
        const blog = bd.blogs?.[0];
        if (blog) {
          const ar = await fetch(`https://${domain}/admin/api/2024-10/blogs/${blog.id}/articles.json?handle=${encodeURIComponent(m[2])}`, {
            headers: { 'X-Shopify-Access-Token': token },
          });
          if (ar.ok) {
            const ad: any = await ar.json();
            if (ad.articles?.[0]) return { id: ad.articles[0].id, singular: 'article', path: `blogs/${blog.id}/articles/${ad.articles[0].id}` };
          }
        }
      }
    }
    return null;
  }
}
