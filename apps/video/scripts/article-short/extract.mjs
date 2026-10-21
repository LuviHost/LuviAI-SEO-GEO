/**
 * Makale HTML'i -> yapisal makale (baslik, aciklama, bolumler, maddeler).
 * Kaynak sirasi: JSON-LD (BlogPosting/Article) -> Open Graph -> <h1>/<title>.
 * Govde: bilinen icerik sinifi > <article> > <main> > <body>; icinde h2-h4 basliklari, tamami
 * kalin <p> "sahte basliklar" (birçok CMS boyle yazar), <li> ve emoji isaretli maddeler.
 */
import { attr, balancedElement, capHtml, decode, elements, firstInner, jsonLd, meta, removeElements, stripTags, typeOf } from './html.mjs';

const ARTICLE_TYPES = ['BlogPosting', 'Article', 'NewsArticle', 'TechArticle', 'Report'];
/** Makale icerigini tasiyan bilinen siniflar. Acilis etiketi dogrusal desenle bulunur, sinif attr() ile okunur:
 * eski tek desen (`[^>]*class...[^"']*(a|b)[^"']*`) kapanmayan uzun etikette karesel geri izliyordu. */
const CONTENT_TAG = /<(div|section|article)\b[^<>]{0,4096}>/gi;
const CONTENT_CLASS = /(article-text|article-body|article-content|entry-content|post-content|post-body|blog-content|blog-post-content|content-body|single-content|rich-text)/i;
/** Aday govde sayisi tavani: her aday balancedElement ile belge boyunca taranir (k aday x n = karesel) */
const MAX_BODY_CANDIDATES = 20;
/** Makale belgesi tavani: tipik yazi 20-80 KB; 600 KB'tan sonrasi videonun uc maddesine bir sey katmaz */
export const MAX_ARTICLE_HTML_CHARS = 600_000;
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
  const clean = removeElements(html, 'script|style|noscript|template|svg');
  let best = null;
  let seen = 0;
  for (const m of clean.matchAll(CONTENT_TAG)) {
    const cls = CONTENT_CLASS.exec(attr(m[0], 'class') ?? '');
    if (!cls) continue;
    if (++seen > MAX_BODY_CANDIDATES) break;
    const el = balancedElement(clean, m.index);
    const score = (el.match(/<p\b/gi) ?? []).length + (el.match(/<li\b/gi) ?? []).length;
    if (!best || score > best.score) best = { el, score, via: `class:${cls[1].toLowerCase()}` };
  }
  if (best && best.score >= 3) return best;
  for (const tag of ['article', 'main', 'body']) {
    const i = clean.search(new RegExp(`<${tag}\\b`, 'i'));
    if (i >= 0) return { el: balancedElement(clean, i), score: 0, via: tag };
  }
  return { el: clean, score: 0, via: 'document' };
}

export function blocksOf(bodyHtml) {
  const html = removeElements(bodyHtml, 'figure|nav|aside|form|table|button');
  const blocks = [];
  for (const { name: tag, inner } of elements(html, 'h[1-6]|p|li|blockquote')) {
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
    const allBold = isAllBold(core);
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

/**
 * Paragrafin tamami kalin mi (<strong>/<b> elemanlari ve aralarinda bosluk)? Eski desen
 * `^(?:<(b)>[\s\S]*?<\/\1>\s*)+$` ic ice niceleyici yuzunden ustel geri izliyordu: sonu
 * eslesmeyen 28 `<b>x</b>` ~ dakikalar. Elemanlar bir kez, soldan saga yurunur.
 */
function isAllBold(core) {
  let pos = 0;
  let any = false;
  for (const el of elements(core, 'strong|b')) {
    if (core.slice(pos, el.index).trim()) return false;
    pos = el.end;
    any = true;
  }
  return any && !core.slice(pos).trim();
}

export function sectionsOf(blocks) {
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

export function extractArticle(rawHtml, pageUrl) {
  const url = new URL(pageUrl);
  const html = capHtml(rawHtml, MAX_ARTICLE_HTML_CHARS);
  const ld = jsonLd(html);
  const art = ld.find((n) => typeOf(n).some((t) => ARTICLE_TYPES.includes(t))) ?? {};
  const crumbs = ld.find((n) => typeOf(n).includes('BreadcrumbList'));
  const h1Inner = firstInner(html, 'h1');
  const titleInner = firstInner(html, 'title');
  const title = stripTags(String(art.headline ?? '')) || meta(html, 'og:title') || (h1Inner !== null ? stripTags(h1Inner) : '') || (titleInner !== null ? stripTags(titleInner) : '');
  const items = Array.isArray(crumbs?.itemListElement) ? crumbs.itemListElement : [];
  const parentCrumb = items.length >= 3 ? stripTags(String(items[items.length - 2]?.name ?? '')) : null;
  const canonical = (/<link\b[^<>]{0,4096}?rel\s*=\s*["']canonical["'][^<>]{0,4096}>/i.exec(html) || [])[0];
  const body = findBody(html);
  const blocks = blocksOf(body.el);
  return {
    url: (canonical && attr(canonical, 'href')) || url.href,
    domain: url.hostname.replace(/^www\./, ''),
    title: decode(title).trim(),
    h1: h1Inner !== null ? stripTags(h1Inner) : null,
    description: stripTags(String(art.description ?? '')) || meta(html, 'og:description') || meta(html, 'description') || '',
    image: (typeof art.image === 'string' ? art.image : art.image?.url) || meta(html, 'og:image') || null,
    section: parentCrumb || (art.articleSection ? stripTags(String(art.articleSection)) : null),
    dateModified: art.dateModified ?? art.datePublished ?? meta(html, 'article:modified_time') ?? null,
    lang: (typeof art.inLanguage === 'string' ? art.inLanguage : null) ?? (/<html\b[^<>]{0,4096}?lang\s*=\s*["']?([a-z-]+)/i.exec(html) || [])[1] ?? null,
    bodyVia: body.via,
    blocks,
    sections: sectionsOf(blocks),
    /** sayi/olgu koruyucusu icin: YALNIZ makalenin kendi metni (baslik + aciklama + govde) */
    sourceText: [decode(title), stripTags(String(art.description ?? '')), ...blocks.map((b) => b.raw)].join('\n'),
  };
}
