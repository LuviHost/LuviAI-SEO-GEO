import { PublishAdapter } from './base.js';
import type { PublishPayload, PublishResult, OnPageMetaPayload, OnPageMetaResult } from './base.js';

/**
 * kobipratik özel adapter — luvihost grubu içi kullanım için admin-only.
 *
 * Hedef: kobipratik.com (.NET ASP.NET Core backend + Vue 3 + ViteSSG frontend).
 * Auth: Bearer LUVIAI_API_KEY (M2M).
 *
 * credentials:
 *   - baseUrl: "https://www.kobipratik.com" (veya dev: "https://dev.kobipratik.com")
 *   - apiKey:  kobipratik appsettings -> LuviAI:ApiKey değeri
 *
 * config:
 *   - defaultPathPrefix?: "/pratik-kobi-rehberi"  // payload.slug'in önüne eklenir; yoksa root'tan başlar
 *
 * Yetenekler:
 *   - publish: PageMeta upsert (full SEO + GEO + body override)
 *   - applyOnPageMeta: Mevcut sayfaya sadece meta yazma (body'ye dokunmaz)
 *   - test: ping endpoint
 */
export class KobipratikAdapter extends PublishAdapter {
  async publish(payload: PublishPayload): Promise<PublishResult> {
    const { baseUrl, apiKey } = this.credentials;
    if (!baseUrl || !apiKey) {
      return { ok: false, error: 'kobipratik credentials eksik (baseUrl + apiKey gerekli)' };
    }

    const path = this.buildPath(payload.slug, payload.metaTitle || payload.title);
    const url = `${this.normalizeBase(baseUrl)}/api/v1/luviai/page-meta/upsert`;

    const body: Record<string, any> = {
      path,
      entityType: 'Blog',
      metaTitle: payload.metaTitle || payload.title,
      metaDescription: payload.metaDescription || '',
      ogTitle: payload.metaTitle || payload.title,
      ogDescription: payload.metaDescription || '',
      ogImage: payload.heroImageUrl || '',
      ogType: 'article',
      twitterCard: 'summary_large_image',
      twitterTitle: payload.metaTitle || payload.title,
      twitterDescription: payload.metaDescription || '',
      twitterImage: payload.heroImageUrl || '',
      canonicalUrl: this.absoluteUrl(baseUrl, path),
      bodyHtmlOverride: payload.bodyHtml,
      bodyMdOverride: payload.bodyMd,
      publishedAt: new Date().toISOString(),
      modifiedAt: new Date().toISOString(),
      updateSource: 'luviai',
      updatedByLabel: 'luviai-bot',
    };

    if (Array.isArray(payload.schemaMarkup) && payload.schemaMarkup.length > 0) {
      const article = payload.schemaMarkup.find((s) => s?.['@type'] === 'Article' || s?.['@type'] === 'BlogPosting');
      const faq = payload.schemaMarkup.find((s) => s?.['@type'] === 'FAQPage');
      const breadcrumb = payload.schemaMarkup.find((s) => s?.['@type'] === 'BreadcrumbList');
      const howTo = payload.schemaMarkup.find((s) => s?.['@type'] === 'HowTo');
      if (article) body.jsonLd = JSON.stringify(article);
      if (faq) body.faqJsonLd = JSON.stringify(faq);
      if (breadcrumb) body.breadcrumbJsonLd = JSON.stringify(breadcrumb);
      if (howTo) body.howToJsonLd = JSON.stringify(howTo);
    }

    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const errorText = await res.text();
        return { ok: false, error: `kobipratik ${res.status}: ${errorText.slice(0, 300)}` };
      }

      const data: any = await res.json();
      return {
        ok: true,
        externalUrl: this.absoluteUrl(baseUrl, path),
        externalId: data?.uuid ? String(data.uuid) : path,
      };
    } catch (err: any) {
      return { ok: false, error: `kobipratik request hata: ${err.message}` };
    }
  }

  async test(): Promise<boolean> {
    const { baseUrl, apiKey } = this.credentials;
    if (!baseUrl || !apiKey) return false;
    try {
      const res = await fetch(`${this.normalizeBase(baseUrl)}/api/v1/luviai/page-meta/ping`, {
        headers: { 'Authorization': `Bearer ${apiKey}` },
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  /** D2+ snippet auto-fix: sadece meta yazılır, body'ye dokunulmaz. */
  async applyOnPageMeta(payload: OnPageMetaPayload): Promise<OnPageMetaResult> {
    const { baseUrl, apiKey } = this.credentials;
    if (!baseUrl || !apiKey) {
      return {
        ok: false,
        applied: [],
        skipped: [{ field: 'all', reason: 'kobipratik credentials eksik' }],
      };
    }

    const path = this.urlToPath(payload.pageUrl, baseUrl);
    const url = `${this.normalizeBase(baseUrl)}/api/v1/luviai/page-meta/upsert`;

    const body: Record<string, any> = {
      path,
      updateSource: 'luviai',
      updatedByLabel: 'luviai-bot',
    };
    const applied: string[] = [];
    if (payload.metaTitle !== undefined) { body.metaTitle = payload.metaTitle; applied.push('metaTitle'); }
    if (payload.metaDescription !== undefined) { body.metaDescription = payload.metaDescription; applied.push('metaDescription'); }
    if (payload.canonical !== undefined) { body.canonicalUrl = payload.canonical; applied.push('canonical'); }
    if (payload.ogTitle !== undefined) { body.ogTitle = payload.ogTitle; applied.push('ogTitle'); }
    if (payload.ogDescription !== undefined) { body.ogDescription = payload.ogDescription; applied.push('ogDescription'); }
    if (payload.ogImage !== undefined) { body.ogImage = payload.ogImage; applied.push('ogImage'); }
    if (payload.twitterCard !== undefined) { body.twitterCard = payload.twitterCard; applied.push('twitterCard'); }
    if (Array.isArray(payload.jsonLd) && payload.jsonLd.length > 0) {
      const article = payload.jsonLd.find((s) => s?.['@type'] === 'Article' || s?.['@type'] === 'BlogPosting');
      const faq = payload.jsonLd.find((s) => s?.['@type'] === 'FAQPage');
      const breadcrumb = payload.jsonLd.find((s) => s?.['@type'] === 'BreadcrumbList');
      if (article) { body.jsonLd = JSON.stringify(article); applied.push('jsonLd'); }
      if (faq) { body.faqJsonLd = JSON.stringify(faq); applied.push('faqJsonLd'); }
      if (breadcrumb) { body.breadcrumbJsonLd = JSON.stringify(breadcrumb); applied.push('breadcrumbJsonLd'); }
    }

    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const errorText = await res.text();
        return {
          ok: false,
          applied: [],
          skipped: [{ field: 'all', reason: `kobipratik ${res.status}: ${errorText.slice(0, 200)}` }],
          error: errorText.slice(0, 300),
        };
      }

      return {
        ok: true,
        applied,
        skipped: [],
        externalUrl: this.absoluteUrl(baseUrl, path),
      };
    } catch (err: any) {
      return {
        ok: false,
        applied: [],
        skipped: [{ field: 'all', reason: err.message }],
        error: err.message,
      };
    }
  }

  // ─── helpers ──────────────────────────────────────────────────────────

  private normalizeBase(baseUrl: string): string {
    return baseUrl.replace(/\/+$/, '');
  }

  private buildPath(slug: string, _titleForFallback?: string): string {
    const prefix = (this.config.defaultPathPrefix as string | undefined) ?? '';
    const clean = (slug ?? '').replace(/^\/+/, '');
    const p = prefix ? `${prefix.replace(/\/+$/, '')}/${clean}` : `/${clean}`;
    return this.normalizePath(p);
  }

  private urlToPath(maybeUrl: string, baseUrl: string): string {
    if (!maybeUrl) return '/';
    try {
      // Absolute URL ise host'u sıyır
      const u = new URL(maybeUrl);
      return this.normalizePath(u.pathname || '/');
    } catch {
      // Relative path
      return this.normalizePath(maybeUrl.startsWith('/') ? maybeUrl : `/${maybeUrl}`);
    }
  }

  private normalizePath(p: string): string {
    let path = (p || '/').trim();
    if (!path.startsWith('/')) path = '/' + path;
    if (path.length > 1 && path.endsWith('/')) path = path.replace(/\/+$/, '');
    return path.toLowerCase();
  }

  private absoluteUrl(baseUrl: string, path: string): string {
    return `${this.normalizeBase(baseUrl)}${this.normalizePath(path)}`;
  }
}
