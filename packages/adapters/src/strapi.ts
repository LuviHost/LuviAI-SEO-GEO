import { PublishAdapter } from './base.js';
import type { PublishPayload, PublishResult } from './base.js';
import { adapterFetch, httpErrorText } from './transport.js';
import { pickString, trimTrailingSlash } from './credential-keys.js';

/**
 * Strapi REST API adapter (v4+).
 * credentials: { baseUrl | strapiUrl, token | apiToken } — once panel katalogu
 *   adlari, sonra eski adlar (bkz. credential-keys.ts)
 * config: { collection | contentType: 'articles', publish?: boolean }
 *
 * Strapi 4+ REST: POST /api/{plural-content-type}
 * Docs: https://docs.strapi.io/cms/api/rest
 */
export class StrapiAdapter extends PublishAdapter {
  async publish(payload: PublishPayload): Promise<PublishResult> {
    const { publish = true } = this.config;

    try {
      const { base, token, collection } = this.target();
      const res = await adapterFetch(`${base}/api/${collection}`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
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
        return { ok: false, error: await httpErrorText('Strapi', res) };
      }

      const data: any = await res.json();
      const id = data.data?.id;
      return {
        ok: true,
        externalUrl: `${base}/admin/content-manager/collection-types/api::${collection}.${collection}/${id}`,
        externalId: String(id),
      };
    } catch (err: any) {
      return { ok: false, error: err.message };
    }
  }

  /**
   * Token'i ve koleksiyonu birlikte dogrular: GET /api/{koleksiyon}, tek kayit.
   * Eskiden GET /api cagriliyordu — Strapi'de oyle bir uc yok (REST yalniz
   * /api/:pluralApiId altinda; https://docs.strapi.io/cms/api/rest), test her
   * zaman basarisiz donuyordu. Sayfa boyutu: pagination[pageSize]
   * (https://docs.strapi.io/cms/api/rest/sort-pagination).
   */
  async test(): Promise<boolean> {
    try {
      const { base, token, collection } = this.target();
      const res = await adapterFetch(`${base}/api/${collection}?pagination[pageSize]=1`, {
        headers: { 'Authorization': `Bearer ${token}` },
      });
      // Govde okunmaz; baglanti havuzda asili kalmasin
      await res.body?.cancel().catch(() => {});
      return res.ok;
    } catch {
      return false;
    }
  }

  private target(): { base: string; token: string; collection: string } {
    const url = pickString(this.credentials, 'baseUrl', 'strapiUrl');
    if (!url) throw new Error('Strapi URL eksik — yayın hedefini düzenleyip adresi girin.');
    const token = pickString(this.credentials, 'token', 'apiToken');
    if (!token) throw new Error('Strapi API token eksik — yayın hedefini düzenleyip token girin.');
    const collection = pickString(this.config, 'collection', 'contentType') ?? 'articles';
    // Ad yola girer: "../admin" gibi bir deger istegi baska bir uca tasimasin.
    // Strapi API kimlikleri kebab-case (ornek: blog-posts).
    if (!/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(collection)) {
      throw new Error('Strapi koleksiyon adı geçersiz: yalnız harf, rakam, "-" ve "_" kullanın (ör. articles).');
    }
    return { base: trimTrailingSlash(url), token, collection };
  }
}
