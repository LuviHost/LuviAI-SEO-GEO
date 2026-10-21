/**
 * Makale HTML'i -> yapisal makale (baslik, aciklama, bolumler, maddeler).
 * Kaynak sirasi: JSON-LD (BlogPosting/Article) -> Open Graph -> <h1>/<title>.
 * Govde: bilinen icerik sinifi > <article> > <main> > <body>; icinde h2-h4 basliklari, tamami
 * kalin <p> "sahte basliklar" (birçok CMS boyle yazar), <li> ve emoji isaretli maddeler.
 */
import { attr, balancedElement, decode, jsonLd, meta, stripTags, typeOf } from './html.mjs';

const ARTICLE_TYPES = ['BlogPosting', 'Article', 'NewsArticle', 'TechArticle', 'Report'];
const CONTENT_CLASS = /<(div|section|article)\b[^>]*class\s*=\s*["'][^"']*(article-text|article-body|article-content|entry-content|post-content|post-body|blog-content|blog-post-content|content-body|single-content|rich-text)[^"']*["'][^>]*>/gi;
const BULLET_MARK = /^(?:[•▪▸►➤✓✔✅☑⚠❗❌✗\u{1F449}\u{1F539}\u{1F538}\u{1F4CC}]️?|[-–]\s)\s*/u;
const KEYCAP = /^\s*(?:\d️?⃣|\d{1,2}[.)])\s*/u;

/** Gorsel suslemeyi at (emoji, numara rozeti, sondaki parantez etiketi) — kelime degistirmez */
export function stripDecor(s, { paren = true } = {}) {
  let t = s.replace(KEYCAP, '').replace(BULLET_MARK, '');
  t = t.replace(/[\p{Extended_Pictographic}️⃣]/gu, '').replace(/\s+/g, ' ').trim();
  const tail = paren ? /\s*\([^()]{2,40}\)\s*$/.exec(t) : null;
  if (tail && t.length - tail[0].length >= 12) t = t.slice(0, tail.index).trim();
  return t;
}

function findBody(html) {
  const clean = html.replace(/<(script|style|noscript|template|svg)\b[\s\S]*?<\/\1>/gi, '');
  let best = null;
  for (const m of clean.matchAll(CONTENT_CLASS)) {
    const el = balancedElement(clean, m.index);
    const score = (el.match(/<p\b/gi) ?? []).length + (el.match(/<li\b/gi) ?? []).length;
    if (!best || score > best.score) best = { el, score, via: `class:${m[2]}` };
  }
  if (best && best.score >= 3) return best;
  for (const tag of ['article', 'main', 'body']) {
    const i = clean.search(new RegExp(`<${tag}\\b`, 'i'));
    if (i >= 0) return { el: balancedElement(clean, i), score: 0, via: tag };
  }
  return { el: clean, score: 0, via: 'document' };
}

function blocksOf(bodyHtml) {
  const html = bodyHtml.replace(/<(figure|nav|aside|form|table|button)\b[\s\S]*?<\/\1>/gi, '');
  const blocks = [];
  for (const m of html.matchAll(/<(h[1-6]|p|li|blockquote)\b[^>]*>([\s\S]*?)<\/\1>/gi)) {
    const tag = m[1].toLowerCase();
    const inner = m[2];
    const text = stripTags(inner);
    if (!text || !/[\p{L}\p{N}]/u.test(text)) continue;
    if (tag[0] === 'h') {
      blocks.push({ type: 'heading', level: Number(tag[1]), text, raw: text });
      continue;
    }
    if (tag === 'li') {
      blocks.push({ type: 'li', text: stripDecor(text, { paren: false }), raw: text });
      continue;
    }
    // tamami kalin, kisa, cumle gibi bitmeyen paragraf -> baslik
    // numara rozeti / emoji kalin etiketin DISINDA olabilir: <p>3️⃣<strong> Baslik</strong></p>
    const core = inner.replace(/<br\s*\/?>/gi, '').replace(/^\s*(?:\d\uFE0F?\u20E3|\d{1,2}[.)]|[\p{Extended_Pictographic}\uFE0F])+\s*/u, '');
    const allBold = /^\s*(?:<(strong|b)\b[^>]*>[\s\S]*?<\/\1>\s*)+$/i.test(core);
    const badge = KEYCAP.test(text) && text.length <= 80 && !/[.:]$/.test(text);
    if ((allBold && text.length <= 90 && !/[:.]$/.test(text)) || badge) {
      blocks.push({ type: 'heading', level: KEYCAP.test(text) ? 3 : 2, text: stripDecor(text), raw: text, pseudo: true });
      continue;
    }
    if (BULLET_MARK.test(text) || /^\p{Extended_Pictographic}/u.test(text)) {
      blocks.push({ type: 'li', text: stripDecor(text, { paren: false }), raw: text, mark: true });
      continue;
    }
    blocks.push({ type: 'p', text, raw: text, label: /^<(strong|b)\b[^>]*>[^<]{2,24}:\s*<\/\1>/i.test(inner.trim()) || /^[\p{L} ]{2,20}:\s/u.test(text) });
  }
  // h1 ve h2'leri ayni seviyeye cek: govdedeki en ust baslik seviyesi = 2
  const levels = blocks.filter((b) => b.type === 'heading').map((b) => b.level);
  const top = levels.length ? Math.min(...levels) : 2;
  for (const b of blocks) if (b.type === 'heading') b.level = Math.max(2, b.level - top + 2);
  return blocks;
}

function sectionsOf(blocks) {
  const sections = [];
  let cur = { heading: null, items: [] };
  for (const b of blocks) {
    if (b.type === 'heading' && b.level === 2) {
      if (cur.heading || cur.items.length) sections.push(cur);
      cur = { heading: b.text, items: [] };
    } else cur.items.push(b);
  }
  if (cur.heading || cur.items.length) sections.push(cur);
  return sections;
}

export function extractArticle(html, pageUrl) {
  const url = new URL(pageUrl);
  const ld = jsonLd(html);
  const art = ld.find((n) => typeOf(n).some((t) => ARTICLE_TYPES.includes(t))) ?? {};
  const crumbs = ld.find((n) => typeOf(n).includes('BreadcrumbList'));
  const h1m = /<h1\b[^>]*>([\s\S]*?)<\/h1>/i.exec(html);
  const titleTag = /<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  const title = stripTags(String(art.headline ?? '')) || meta(html, 'og:title') || (h1m ? stripTags(h1m[1]) : '') || (titleTag ? stripTags(titleTag[1]) : '');
  const items = Array.isArray(crumbs?.itemListElement) ? crumbs.itemListElement : [];
  const parentCrumb = items.length >= 3 ? stripTags(String(items[items.length - 2]?.name ?? '')) : null;
  const canonical = (/<link\b[^>]*rel\s*=\s*["']canonical["'][^>]*>/i.exec(html) || [])[0];
  const body = findBody(html);
  const blocks = blocksOf(body.el);
  return {
    url: (canonical && attr(canonical, 'href')) || url.href,
    domain: url.hostname.replace(/^www\./, ''),
    title: decode(title).trim(),
    h1: h1m ? stripTags(h1m[1]) : null,
    description: stripTags(String(art.description ?? '')) || meta(html, 'og:description') || meta(html, 'description') || '',
    image: (typeof art.image === 'string' ? art.image : art.image?.url) || meta(html, 'og:image') || null,
    section: parentCrumb || (art.articleSection ? stripTags(String(art.articleSection)) : null),
    dateModified: art.dateModified ?? art.datePublished ?? meta(html, 'article:modified_time') ?? null,
    lang: (typeof art.inLanguage === 'string' ? art.inLanguage : null) ?? (/<html\b[^>]*lang\s*=\s*["']?([a-z-]+)/i.exec(html) || [])[1] ?? null,
    bodyVia: body.via,
    blocks,
    sections: sectionsOf(blocks),
    /** sayi/olgu koruyucusu icin: YALNIZ makalenin kendi metni (baslik + aciklama + govde) */
    sourceText: [decode(title), stripTags(String(art.description ?? '')), ...blocks.map((b) => b.raw)].join('\n'),
  };
}
