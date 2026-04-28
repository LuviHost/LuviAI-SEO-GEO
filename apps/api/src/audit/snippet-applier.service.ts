import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { decrypt } from '@luviai/shared';
import { getAdapter } from '@luviai/adapters';
// OnPageMeta tipleri base.ts içinde tanımlı; package exports root index'ten gelen tip
// imzasını kullanmak yerine local tip kopyası — adapters package "."" path'inde
// base'i re-export etmiyor.
interface OnPageMetaPayload {
  pageUrl: string;
  metaTitle?: string;
  metaDescription?: string;
  canonical?: string;
  ogTitle?: string;
  ogDescription?: string;
  ogImage?: string;
  twitterCard?: 'summary' | 'summary_large_image';
  jsonLd?: Record<string, any>[];
}
interface OnPageMetaResult {
  ok: boolean;
  applied: string[];
  skipped: { field: string; reason: string }[];
  externalUrl?: string;
  error?: string;
}
import type { PageSnippet } from './snippet-generator.service.js';

/**
 * D2 — snippet'leri uygun adapter üzerinden hedef CMS'e yazar.
 * Şu an WordPress REST (Yoast/RankMath) destekli.
 * Webflow / Wix / statik HTML için "snippet copy-paste" fallback'ı kalır.
 */
@Injectable()
export class SnippetApplierService {
  private readonly log = new Logger(SnippetApplierService.name);

  constructor(private readonly prisma: PrismaService) {}

  async applyToTarget(siteId: string, snippets: PageSnippet[]): Promise<OnPageMetaResult & { adapter: string }> {
    if (snippets.length === 0) {
      return { ok: false, applied: [], skipped: [{ field: 'all', reason: 'Snippet listesi boş' }], adapter: 'none' };
    }

    const site = await this.prisma.site.findUniqueOrThrow({
      where: { id: siteId },
      include: {
        publishTargets: { where: { isDefault: true, isActive: true }, take: 1 },
      },
    });

    const target = site.publishTargets[0];
    if (!target) {
      return {
        ok: false,
        applied: [],
        skipped: [{ field: 'all', reason: 'Default publish target yok — Settings → Publish Targets üzerinden ekle' }],
        adapter: 'none',
      };
    }

    const Adapter = getAdapter(target.type) as any;
    if (!Adapter) {
      return { ok: false, applied: [], skipped: [{ field: 'all', reason: `Adapter yok: ${target.type}` }], adapter: target.type };
    }

    const credentials: Record<string, any> = {};
    for (const [k, v] of Object.entries(target.credentials as Record<string, any>)) {
      credentials[k] = typeof v === 'string' && v.includes(':') ? this.tryDecrypt(v) : v;
    }
    const adapter = new Adapter(credentials, target.config ?? {}) as { applyOnPageMeta: (p: OnPageMetaPayload) => Promise<OnPageMetaResult> };

    // Snippet array → OnPageMetaPayload transform
    const pageUrl = snippets[0].pageUrl;
    const payload: OnPageMetaPayload = { pageUrl };
    const jsonLd: Record<string, any>[] = [];

    for (const s of snippets) {
      switch (s.type) {
        case 'meta_title':
          payload.metaTitle = this.stripTag(s.generatedSnippet, 'title');
          break;
        case 'meta_description':
          payload.metaDescription = this.attrFromMeta(s.generatedSnippet, 'content');
          break;
        case 'canonical':
          payload.canonical = this.attrFromLink(s.generatedSnippet, 'href');
          break;
        case 'open_graph': {
          payload.ogTitle = this.metaProperty(s.generatedSnippet, 'og:title');
          payload.ogDescription = this.metaProperty(s.generatedSnippet, 'og:description');
          payload.ogImage = this.metaProperty(s.generatedSnippet, 'og:image');
          break;
        }
        case 'twitter_card':
          payload.twitterCard = (this.metaName(s.generatedSnippet, 'twitter:card') as any) ?? 'summary_large_image';
          break;
        case 'jsonld_article':
        case 'jsonld_organization':
        case 'jsonld_breadcrumb': {
          const obj = this.parseJsonLd(s.generatedSnippet);
          if (obj) jsonLd.push(obj);
          break;
        }
        default:
          break;
      }
    }
    if (jsonLd.length) payload.jsonLd = jsonLd;

    const result = await adapter.applyOnPageMeta(payload);
    this.log.log(`[${siteId}] applyOnPageMeta(${target.type}): applied=${result.applied.length} skipped=${result.skipped.length}`);
    return { ...result, adapter: target.type };
  }

  // ──────────────────────────────────────────────
  private stripTag(html: string, tag: string): string {
    const m = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'i').exec(html);
    return m ? this.decode(m[1].trim()) : '';
  }
  private attrFromMeta(html: string, attr: string): string {
    const m = new RegExp(`<meta[^>]*${attr}=["']([^"']+)["']`, 'i').exec(html);
    return m ? this.decode(m[1]) : '';
  }
  private attrFromLink(html: string, attr: string): string {
    const m = new RegExp(`<link[^>]*${attr}=["']([^"']+)["']`, 'i').exec(html);
    return m ? this.decode(m[1]) : '';
  }
  private metaProperty(html: string, prop: string): string {
    const m = new RegExp(`<meta[^>]*property=["']${prop}["'][^>]*content=["']([^"']+)["']`, 'i').exec(html);
    return m ? this.decode(m[1]) : '';
  }
  private metaName(html: string, name: string): string {
    const m = new RegExp(`<meta[^>]*name=["']${name}["'][^>]*content=["']([^"']+)["']`, 'i').exec(html);
    return m ? this.decode(m[1]) : '';
  }
  private parseJsonLd(html: string): Record<string, any> | null {
    const m = /<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/i.exec(html);
    if (!m) return null;
    try { return JSON.parse(m[1].trim()); } catch { return null; }
  }
  private decode(s: string): string {
    return s.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
  }
  private tryDecrypt(v: string): string {
    try { return decrypt(v); } catch { return v; }
  }
}
