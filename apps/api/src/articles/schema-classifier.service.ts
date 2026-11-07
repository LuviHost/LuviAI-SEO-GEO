import { Injectable, Logger } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';
import { safeParseJson } from '../common/safe-json.js';

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
/**
 * Otomatik uretilebilecek tipler (08.11.2026 kanit denetimi).
 *
 * NEDEN beyaz liste: Google'in yapisal veri politikasi "Don't mark up content that is not visible to readers
 * of the page" der ve isaretlemenin sayfanin asil icerigini temsil etmesini ister. Eskiden bir makaleye
 * anahtar kelimeyle HowTo (tek adimi sabit "Adimlar makalede detayli aciklanmaktadir" metni), sayfa adresini
 * video sayan VideoObject, makale basligiyla Product / Service / Course ekleniyordu: hepsi sayfada olmayan ya
 * da sayfayi yanlis tanimlayan isaretleme. HowTo zengin sonucu 2023'te, FAQ zengin sonucu 7 Mayis 2026'da
 * kaldirildi; Ahrefs'in kontrollu testinde (2026) sema eklemenin AI alintisina etkisi cikmadi. Makaleye
 * yalniz makaleyi dogru tanimlayan tipler girer; FAQPage yalniz sayfada gorunen SSS varsa (bkz. visibleFaqs).
 */
export const OTOMATIK_SEMA_TIPLERI: ReadonlySet<SchemaType> = new Set<SchemaType>([
  'Article', 'BlogPosting', 'BreadcrumbList', 'Speakable', 'WebSite', 'Organization', 'FAQPage', 'DefinedTerm',
]);

/**
 * SSS'den yalniz sayfada GORUNEN sorular sema'ya girer: soru metni (bosluk/buyuk-kucuk harf farki gozetmeden)
 * makale govdesinde gecmeli. Frontmatter'daki ama metinde olmayan soru isaretlenmez (Google: gorunmeyen icerik
 * isaretlenmez).
 */
export function visibleFaqs(faqs: Array<{ q: string; a: string }> | undefined, body: string | undefined): Array<{ q: string; a: string }> {
  if (!faqs?.length || !body) return [];
  const norm = (t: string) => t.replace(/<[^>]+>/g, ' ').replace(/[*_`]/g, '').replace(/[#>]/g, ' ').replace(/\s+/g, ' ').trim().toLocaleLowerCase('tr-TR');
  const metin = norm(body);
  return faqs.filter((f) => f?.q && f?.a && metin.includes(norm(f.q)));
}

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
    const primary = new Set<SchemaType>(['Article', 'BlogPosting', 'BreadcrumbList', 'Speakable', 'WebSite', 'Organization']);

    const md = (markdown ?? '').slice(0, 6000);
    const lower = md.toLowerCase();

    // FAQ
    if (hints.hasFaqs || /sıkça\s*sorulan\s*soru|sss/i.test(md)) primary.add('FAQPage');

    // Definition / Term
    if (/(\?|nedir|ne\s*demek|ne\s*ise\s*yarar)/i.test(md.split('\n')[0] ?? '')) {
      primary.add('DefinedTerm');
    }

    // Video / Course / Product / Service / HowTo artik otomatik eklenmez (bkz. OTOMATIK_SEMA_TIPLERI)
    void lower;

    // AI'ya inceltme yaptir (env'de Anthropic key varsa)
    let reasoning = 'heuristic-only';
    if (this.anthropic && md.length > 800) {
      try {
        const resp = await this.anthropic.messages.create({
          model: 'claude-opus-5',
          max_tokens: 4000,
          system: 'Sen bir schema.org uzmanisin. Verilen Turkce makaleyi inceleyip hangi schema.org tiplerinin uygulanmasi gerektigini karara baglarsin. Sadece JSON dondur, baska aciklama yapma.',
          messages: [
            {
              role: 'user',
              content: `Markdown makale:\n\n${md.slice(0, 4000)}\n\nMevcut tahminler: ${[...primary].join(', ')}\n\nJSON dondur, format:\n{\n  "add": ["schema1", "schema2"],\n  "remove": ["schema1"],\n  "reason": "kisa aciklama"\n}\n\nKabul edilen tipler: ${[...OTOMATIK_SEMA_TIPLERI].join(', ')}. Yalniz makalede gercekten gorunen icerigi temsil eden tipi ekle.`,
            },
          ],
        });
        const text = resp.content
          .filter((b: any) => b.type === 'text')
          .map((b: any) => b.text)
          .join('');
        const match = text.match(/\{[\s\S]*\}/);
        if (match) {
          const parsed = safeParseJson(match[0]);
          for (const t of (parsed.add ?? []) as string[]) primary.add(t as SchemaType);
          for (const t of (parsed.remove ?? []) as string[]) primary.delete(t as SchemaType);
          reasoning = parsed.reason ?? 'ai-refined';
        }
      } catch (err: any) {
        this.log.warn(`Schema classifier AI fail: ${err.message}`);
      }
    }

    return {
      // Beyaz liste disi her tip (AI eklese de) cikar
      primary: [...primary].filter((t) => OTOMATIK_SEMA_TIPLERI.has(t)),
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
      /** Sitenin kayitli gercek yazari; yoksa Organization basilir (yazar uydurulmaz) */
      author?: { name: string; url?: string; sameAs?: string[]; jobTitle?: string } | null;
      /**
       * Kirinti yolu. Cagiran taraf gercek URL hiyerarsisinden uretip verir;
       * verilmezse a.url'in path segmentlerinden turetilir.
       */
      breadcrumbs?: Array<{ name: string; url: string }>;
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
          ? {
              '@type': 'Person',
              name: a.author.name,
              ...(a.author.url ? { url: a.author.url } : {}),
              ...(a.author.sameAs?.length ? { sameAs: a.author.sameAs } : {}),
              ...(a.author.jobTitle ? { jobTitle: a.author.jobTitle } : {}),
            }
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
    //
    // Sabit `${baseUrl}/blog` ara adimi yanlisti: cogu sitede /blog diye bir
    // sayfa yok (kobipratik'te rehberler /pratik-kobi-rehberi altinda). Var
    // olmayan bir kirinti 404'e baglanir. Artik cagiranin verdigi gercek yol
    // kullanilir; verilmezse makale URL'inin kendi segmentlerinden turetilir.
    if (args.types.includes('BreadcrumbList')) {
      const trail = a.breadcrumbs?.length ? a.breadcrumbs : this.deriveBreadcrumbs(baseUrl, a.url, a.title);
      schemas.push({
        '@context': 'https://schema.org',
        '@type': 'BreadcrumbList',
        itemListElement: trail.map((c, i) => ({
          '@type': 'ListItem',
          position: i + 1,
          name: c.name,
          item: c.url,
        })),
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
      });
    }

    // HowTo / VideoObject / Course / Product / Service uretilmez (bkz. OTOMATIK_SEMA_TIPLERI): sabit
    // yer tutuculu ya da makaleyi urun/kurs gibi gosteren isaretleme sayfanin icerigini temsil etmiyordu.

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

    // WebSite — SearchAction YOK: sabit `/?s=` yalniz WordPress'te calisir (diger sitelerde var olmayan arama
    // adresi isaretleniyordu) ve Google sitelinks arama kutusunu 2024'te kaldirdi.
    if (args.types.includes('WebSite')) {
      schemas.push({
        '@context': 'https://schema.org',
        '@type': 'WebSite',
        name: s.name,
        url: baseUrl,
      });
    }

    return schemas;
  }

  /**
   * Makale URL'inin path segmentlerinden kirinti yolu turetir.
   * Ara segmentin adi slug'dan insanilastirilir; uydurma bir "Blog" adimi
   * eklenmez. Segment yoksa iki adimli (Anasayfa → makale) yol doner.
   */
  private deriveBreadcrumbs(
    baseUrl: string,
    articleUrl: string,
    title: string,
  ): Array<{ name: string; url: string }> {
    const trail: Array<{ name: string; url: string }> = [{ name: 'Anasayfa', url: baseUrl }];
    let segments: string[] = [];
    try {
      segments = new URL(articleUrl).pathname.split('/').filter(Boolean);
    } catch {
      segments = String(articleUrl ?? '').split('/').filter(Boolean);
    }
    // Son segment makalenin kendisi
    const parents = segments.slice(0, -1);
    let acc = baseUrl;
    for (const seg of parents) {
      acc = `${acc}/${seg}`;
      trail.push({ name: this.humanizeSegment(seg), url: acc });
    }
    trail.push({ name: title, url: articleUrl });
    return trail;
  }

  private humanizeSegment(seg: string): string {
    return seg
      .split('-')
      .filter(Boolean)
      .map((w) => w.charAt(0).toLocaleUpperCase('tr') + w.slice(1))
      .join(' ');
  }
}
