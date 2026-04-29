import { Injectable, Logger } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';

export type SchemaType =
  | 'Article'
  | 'BlogPosting'
  | 'NewsArticle'
  | 'HowTo'
  | 'FAQPage'
  | 'QAPage'
  | 'Product'
  | 'Service'
  | 'Review'
  | 'AggregateRating'
  | 'LocalBusiness'
  | 'Organization'
  | 'Person'
  | 'Course'
  | 'Event'
  | 'VideoObject'
  | 'BreadcrumbList'
  | 'WebSite'
  | 'DefinedTerm'
  | 'ClaimReview'
  | 'Speakable';

export interface SchemaJsonLd {
  '@context': 'https://schema.org';
  '@type': string;
  [key: string]: any;
}

export interface ClassificationResult {
  primary: SchemaType[];
  reasoning: string;
}

/**
 * Schema Classifier — yazilan makalenin icerigine bakip hangi schema.org
 * tiplerinin uygulanmasi gerektigini AI ile karara baglar.
 *
 * Always-on: BreadcrumbList + Article (or BlogPosting)
 * Conditional:
 *  - HowTo (adim-adim rehber tespit edilirse)
 *  - FAQPage (3+ Q&A varsa — zaten frontmatter'da faqs var)
 *  - Product/Service/Review (e-ticaret/hizmet sayfalari)
 *  - LocalBusiness (adres + saat varsa)
 *  - Course (egitim icerikleri)
 *  - VideoObject (embed video varsa)
 *  - DefinedTerm (sektor terim sozlugu)
 *  - Speakable (sesli optimizasyon — her makaleye)
 */
@Injectable()
export class SchemaClassifierService {
  private readonly log = new Logger(SchemaClassifierService.name);
  private readonly anthropic = process.env.ANTHROPIC_API_KEY
    ? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
    : null;

  /**
   * Makale markdown'ini analiz et, hangi schema'lari uygulamak gerektigine karar ver.
   */
  async classify(markdown: string, hints: { hasFaqs?: boolean; persona?: string; pillar?: string } = {}): Promise<ClassificationResult> {
    // Heuristic: AI cagrilmadan bazi tipleri kesin koy
    const primary = new Set<SchemaType>(['Article', 'BlogPosting', 'BreadcrumbList', 'Speakable']);

    const md = (markdown ?? '').slice(0, 6000);
    const lower = md.toLowerCase();

    // FAQ
    if (hints.hasFaqs || /sıkça\s*sorulan\s*soru|sss/i.test(md)) primary.add('FAQPage');

    // HowTo — "adım", "adım adım", "1.", "2.", "kurulum"
    if (/(adım\s*adım|step[- ]by[- ]step|nasıl\s*kurulur|nasıl\s*yapılır|kurulum\s*rehberi)/i.test(md)) {
      primary.add('HowTo');
    }

    // Definition / Term
    if (/(\?|nedir|ne\s*demek|ne\s*ise\s*yarar)/i.test(md.split('\n')[0] ?? '')) {
      primary.add('DefinedTerm');
    }

    // Video embed
    if (/youtube\.com\/embed|<video|youtu\.be\//i.test(md)) primary.add('VideoObject');

    // Course / education
    if (/(eğitim|kurs|sertifika|öğren|öğrenmek)/i.test(lower) && /(modül|ders|saat|gün)/i.test(lower)) {
      primary.add('Course');
    }

    // Product / Service heuristic
    if (/(ürün|fiyat|paket|abonelik|aylık|yıllık)/i.test(lower) && /(satın\s*al|sipariş|cart|checkout)/i.test(lower)) {
      primary.add('Product');
    }
    if (/(hizmet|servis|destek\s*paketi|teklif)/i.test(lower) && !primary.has('Product')) {
      primary.add('Service');
    }

    // AI'ya inceltme yaptir (env'de Anthropic key varsa)
    let reasoning = 'heuristic-only';
    if (this.anthropic && md.length > 800) {
      try {
        const resp = await this.anthropic.messages.create({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 300,
          system: 'Sen bir schema.org uzmanisin. Verilen Turkce makaleyi inceleyip hangi schema.org tiplerinin uygulanmasi gerektigini karara baglarsin. Sadece JSON dondur, baska aciklama yapma.',
          messages: [
            {
              role: 'user',
              content: `Markdown makale:\n\n${md.slice(0, 4000)}\n\nMevcut tahminler: ${[...primary].join(', ')}\n\nJSON dondur, format:\n{\n  "add": ["schema1", "schema2"],\n  "remove": ["schema1"],\n  "reason": "kisa aciklama"\n}\n\nKabul edilen tipler: Article, BlogPosting, NewsArticle, HowTo, FAQPage, QAPage, Product, Service, Review, AggregateRating, LocalBusiness, Organization, Person, Course, Event, VideoObject, BreadcrumbList, WebSite, DefinedTerm, ClaimReview, Speakable.`,
            },
          ],
        });
        const text = resp.content
          .filter((b: any) => b.type === 'text')
          .map((b: any) => b.text)
          .join('');
        const match = text.match(/\{[\s\S]*\}/);
        if (match) {
          const parsed = JSON.parse(match[0]);
          for (const t of (parsed.add ?? []) as string[]) primary.add(t as SchemaType);
          for (const t of (parsed.remove ?? []) as string[]) primary.delete(t as SchemaType);
          reasoning = parsed.reason ?? 'ai-refined';
        }
      } catch (err: any) {
        this.log.warn(`Schema classifier AI fail: ${err.message}`);
      }
    }

    return {
      primary: [...primary],
      reasoning,
    };
  }

  /**
   * Belirlenen tipler icin gercek JSON-LD schema'larini uret.
   * Article + BreadcrumbList + FAQPage + (varsa diger tipler).
   */
  buildJsonLd(args: {
    types: SchemaType[];
    article: {
      title: string;
      url: string;
      slug: string;
      metaDescription?: string | null;
      datePublished?: string | null;
      dateModified?: string | null;
      heroImage?: string | null;
      faqs?: Array<{ q: string; a: string }>;
      author?: { name: string; url?: string } | null;
    };
    site: {
      name: string;
      url: string;
      logo?: string | null;
      sameAs?: string[];
    };
  }): SchemaJsonLd[] {
    const schemas: SchemaJsonLd[] = [];
    const a = args.article;
    const s = args.site;
    const baseUrl = s.url.replace(/\/+$/, '');

    // Always: Article (BlogPosting)
    if (args.types.includes('Article') || args.types.includes('BlogPosting')) {
      const isBlog = args.types.includes('BlogPosting');
      schemas.push({
        '@context': 'https://schema.org',
        '@type': isBlog ? 'BlogPosting' : 'Article',
        headline: a.title,
        description: a.metaDescription ?? '',
        datePublished: a.datePublished ?? new Date().toISOString(),
        dateModified: a.dateModified ?? new Date().toISOString(),
        url: a.url,
        mainEntityOfPage: { '@type': 'WebPage', '@id': a.url },
        author: a.author
          ? { '@type': 'Person', name: a.author.name, ...(a.author.url ? { url: a.author.url } : {}) }
          : { '@type': 'Organization', name: s.name, url: baseUrl },
        publisher: {
          '@type': 'Organization',
          name: s.name,
          url: baseUrl,
          ...(s.logo ? { logo: { '@type': 'ImageObject', url: s.logo } } : {}),
        },
        ...(a.heroImage ? { image: a.heroImage } : {}),
      });
    }

    // BreadcrumbList — always
    if (args.types.includes('BreadcrumbList')) {
      schemas.push({
        '@context': 'https://schema.org',
        '@type': 'BreadcrumbList',
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: 'Anasayfa', item: baseUrl },
          { '@type': 'ListItem', position: 2, name: 'Blog', item: `${baseUrl}/blog` },
          { '@type': 'ListItem', position: 3, name: a.title, item: a.url },
        ],
      });
    }

    // FAQPage
    if (args.types.includes('FAQPage') && a.faqs && a.faqs.length > 0) {
      schemas.push({
        '@context': 'https://schema.org',
        '@type': 'FAQPage',
        mainEntity: a.faqs.map((f) => ({
          '@type': 'Question',
          name: f.q,
          acceptedAnswer: { '@type': 'Answer', text: f.a },
        })),
      });
    }

    // HowTo (heuristic — frontmatter'da steps yoksa basit format)
    if (args.types.includes('HowTo')) {
      schemas.push({
        '@context': 'https://schema.org',
        '@type': 'HowTo',
        name: a.title,
        description: a.metaDescription ?? '',
        // Step listesi makale icindeki numarali liste'den extract edilebilir; simdilik placeholder
        step: [
          { '@type': 'HowToStep', name: 'Adimlar makalede detayli aciklanmaktadir', url: a.url },
        ],
      });
    }

    // Speakable — her zaman, AI sesli asistanlar icin
    if (args.types.includes('Speakable')) {
      schemas.push({
        '@context': 'https://schema.org',
        '@type': 'WebPage',
        url: a.url,
        speakable: {
          '@type': 'SpeakableSpecification',
          cssSelector: ['h1', 'blockquote', '.summary', '[itemprop="description"]'],
        },
      });
    }

    // DefinedTerm
    if (args.types.includes('DefinedTerm')) {
      schemas.push({
        '@context': 'https://schema.org',
        '@type': 'DefinedTerm',
        name: a.title,
        description: a.metaDescription ?? '',
        url: a.url,
        inDefinedTermSet: `${baseUrl}/sozluk`,
      });
    }

    // VideoObject (placeholder — gercek video varsa pipeline doldurmali)
    if (args.types.includes('VideoObject')) {
      schemas.push({
        '@context': 'https://schema.org',
        '@type': 'VideoObject',
        name: a.title,
        description: a.metaDescription ?? '',
        uploadDate: a.datePublished ?? new Date().toISOString(),
        thumbnailUrl: a.heroImage ?? `${baseUrl}/default-video-thumb.png`,
        contentUrl: a.url,
      });
    }

    // Course
    if (args.types.includes('Course')) {
      schemas.push({
        '@context': 'https://schema.org',
        '@type': 'Course',
        name: a.title,
        description: a.metaDescription ?? '',
        provider: { '@type': 'Organization', name: s.name, url: baseUrl },
        url: a.url,
      });
    }

    // Product / Service
    if (args.types.includes('Product')) {
      schemas.push({
        '@context': 'https://schema.org',
        '@type': 'Product',
        name: a.title,
        description: a.metaDescription ?? '',
        url: a.url,
        brand: { '@type': 'Brand', name: s.name },
      });
    }
    if (args.types.includes('Service')) {
      schemas.push({
        '@context': 'https://schema.org',
        '@type': 'Service',
        name: a.title,
        description: a.metaDescription ?? '',
        provider: { '@type': 'Organization', name: s.name, url: baseUrl },
        url: a.url,
      });
    }

    // Organization (Knowledge Graph) — sameAs ile
    if (args.types.includes('Organization') || (s.sameAs && s.sameAs.length > 0)) {
      schemas.push({
        '@context': 'https://schema.org',
        '@type': 'Organization',
        name: s.name,
        url: baseUrl,
        ...(s.logo ? { logo: s.logo } : {}),
        ...(s.sameAs && s.sameAs.length > 0 ? { sameAs: s.sameAs } : {}),
      });
    }

    return schemas;
  }
}
