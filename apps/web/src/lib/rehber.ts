/**
 * /rehber yardimcilari — saf fonksiyonlar (Next importu yok; rehber.spec.mts dogrudan calistirir).
 *
 * Tek kaynak: sayfadaki gorunur SSS ile FAQPage JSON-LD'si, gorunur tarih ile
 * dateModified ve sitemap lastModified ayni veriden uretilir. Bilesen
 * (components/rehber/rehber-article.tsx) yalniz bu fonksiyonlari cagirir.
 */
import type { RehberArticle, RehberBlock } from '../content/rehber/types';
import { CONTENT_AUTHOR, SITE_URL, formatPageDate } from './page-updated';

export const REHBER_BASE = '/rehber';

/** Imza adresi: deneme kaydi (site-header'daki "Kayıt ol" ile ayni yol) */
export const SIGNUP_HREF = '/signin?callbackUrl=/onboarding';

export function rehberPath(slug: string): string {
  return `${REHBER_BASE}/${slug}`;
}

export type InlineToken =
  | { type: 'text'; text: string }
  | { type: 'strong'; text: string }
  | { type: 'link'; text: string; href: string };

const INLINE_RE = /\[([^\]]+)\]\(([^)\s]+)\)|\*\*([^*]+)\*\*/g;

/** `[metin](/yol)` ve `**kalin**` bicimini parcalara ayirir. Baska isaretleme yok. */
export function parseInline(text: string): InlineToken[] {
  const out: InlineToken[] = [];
  let last = 0;
  for (const m of text.matchAll(INLINE_RE)) {
    const i = m.index ?? 0;
    if (i > last) out.push({ type: 'text', text: text.slice(last, i) });
    if (m[1] !== undefined) out.push({ type: 'link', text: m[1], href: m[2] });
    else out.push({ type: 'strong', text: m[3] });
    last = i + m[0].length;
  }
  if (last < text.length) out.push({ type: 'text', text: text.slice(last) });
  return out;
}

/** Isaretlemesiz duz metin (JSON-LD ve meta icin) */
export function plainInline(text: string): string {
  return parseInline(text).map((t) => t.text).join('');
}

/** Ilk cumle: ilk `.`, `?` ya da `!` + bosluk/son. "llms.txt" gibi ic noktalar bolmez. */
export function firstSentence(text: string): string {
  const plain = plainInline(text).trim();
  const m = /^(.+?[.!?])(?:\s|$)/.exec(plain);
  return m ? m[1] : plain;
}

export function wordCount(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

/**
 * Para tutari: "$149", "€47", "149 $", "1.039 TL", "50 ₺", "₺1.499".
 * packages/shared geo-gate MONEY_RE yalniz "sayi + birim" sirasini yakalar ve disa
 * aktarilmaz; burada "$149" gibi birim-onde yazimlar da gerekli.
 */
export const MONEY_RE = /[$€₺]\s?\d|\d[\d.,]*\s?(?:\$|€|₺|TL\b|USD\b|EUR\b|dolar\b|avro\b)/i;

/** Blogun gorunur metinleri (para ve baglanti denetimi icin) */
export function blockTexts(b: RehberBlock): string[] {
  switch (b.t) {
    case 'p':
    case 'h3':
      return [b.text];
    case 'ul':
    case 'ol':
      return b.items;
    case 'table':
      return [b.caption, ...b.head, ...b.rows.flat(), ...(b.not ? [b.not] : [])];
    case 'code':
      return [b.label, b.code];
    case 'callout':
    case 'tool':
      return [b.title, b.text];
  }
}

/** Erişim tarihi gorunur bicimde: '2026-10-24' -> '24.10.2026' */
export function formatAccessDate(iso: string): string {
  const [y, m, d] = iso.split('-');
  return `${d}.${m}.${y}`;
}

const ORG = { '@type': 'Organization', name: 'RanksUp', url: SITE_URL } as const;
const PUBLISHER = {
  ...ORG,
  logo: { '@type': 'ImageObject', url: `${SITE_URL}/icon-512.png`, width: 512, height: 512 },
} as const;

/**
 * Makale sayfasinin JSON-LD'si: Article/TechArticle + BreadcrumbList + FAQPage.
 * FAQPage YALNIZ gorunur SSS'den uretilir (Google: isaretleme sayfada gorunen icerikle ayni olmali).
 */
export function rehberJsonLd(a: RehberArticle, updated: string): Record<string, unknown>[] {
  const url = `${SITE_URL}${rehberPath(a.slug)}`;
  return [
    {
      '@context': 'https://schema.org',
      '@type': a.schemaType,
      headline: a.title,
      description: a.description,
      url,
      mainEntityOfPage: { '@type': 'WebPage', '@id': url },
      inLanguage: 'tr-TR',
      datePublished: a.published,
      dateModified: updated,
      author: { '@type': 'Organization', name: CONTENT_AUTHOR.tr, url: `${SITE_URL}/about` },
      publisher: PUBLISHER,
      image: `${SITE_URL}/og-image.png?v=2`,
      isPartOf: { '@type': 'CollectionPage', name: 'RanksUp Rehber', url: `${SITE_URL}${REHBER_BASE}` },
      citation: a.sources.filter((s) => s.url).map((s) => s.url),
    },
    {
      '@context': 'https://schema.org',
      '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'RanksUp', item: SITE_URL },
        { '@type': 'ListItem', position: 2, name: 'Rehber', item: `${SITE_URL}${REHBER_BASE}` },
        { '@type': 'ListItem', position: 3, name: a.title, item: url },
      ],
    },
    rehberFaqJsonLd(a),
  ];
}

export function rehberFaqJsonLd(a: RehberArticle): Record<string, unknown> {
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: a.faq.map((f) => ({
      '@type': 'Question',
      name: f.q,
      acceptedAnswer: { '@type': 'Answer', text: f.a },
    })),
  };
}

/** /rehber dizin sayfasinin JSON-LD'si: CollectionPage (ItemList) + BreadcrumbList */
export function rehberIndexJsonLd(articles: readonly RehberArticle[], updated: string): Record<string, unknown>[] {
  const url = `${SITE_URL}${REHBER_BASE}`;
  return [
    {
      '@context': 'https://schema.org',
      '@type': 'CollectionPage',
      name: 'RanksUp Rehber',
      url,
      inLanguage: 'tr-TR',
      dateModified: updated,
      publisher: PUBLISHER,
      mainEntity: {
        '@type': 'ItemList',
        numberOfItems: articles.length,
        itemListElement: articles.map((a, i) => ({
          '@type': 'ListItem',
          position: i + 1,
          name: a.title,
          url: `${SITE_URL}${rehberPath(a.slug)}`,
        })),
      },
    },
    {
      '@context': 'https://schema.org',
      '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'RanksUp', item: SITE_URL },
        { '@type': 'ListItem', position: 2, name: 'Rehber', item: url },
      ],
    },
  ];
}

/** "Yayın: 24 Ekim 2026" gibi gorunur metin */
export function publishedText(iso: string): string {
  return `İlk yayın: ${formatPageDate(iso, 'tr')}`;
}
