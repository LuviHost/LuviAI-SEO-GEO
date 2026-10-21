import { mdToHtml, parseFrontmatter } from '@luviai/shared';
import { liveEntries, liveEntryRef } from '../articles/republish-policy.js';
import { stripHeroPlaceholder } from '../articles/hero-placeholder.js';
import type { ExtractKit, ShortArticle } from './article-short-kit.js';

/**
 * RanksUp Video — makale metni VERITABANINDAN (yeniden indirmeden).
 *
 * NEDEN: yayindaki sayfayi yeniden cekmek robots/WAF/sure riskini, sayfanin tema metinlerini
 * (menu, yan bant) ve cerez bantlarini getirir. Makalenin govdesi zaten bizde: bodyMd
 * (pipeline yazar; publisher ayni markdown'i mdToHtml ile HTML'e cevirip yayinlar), bodyHtml
 * yalniz bazi eski kayitlarda dolu. Sayi koruyucusu (validateScript) bu metne bakar: videodaki
 * her sayi yayinlanan metinde birebir gecmek zorunda.
 */

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export interface ArticleSourceRow {
  title: string;
  metaDescription?: string | null;
  language?: string | null;
  category?: string | null;
  bodyMd?: string | null;
  bodyHtml?: string | null;
  publishedTo?: unknown;
}

/** Makalenin govde HTML'i: bodyHtml varsa o, yoksa bodyMd (on bilgi atilir, yayinciyla ayni cevirici) */
export function articleBodyHtml(a: Pick<ArticleSourceRow, 'bodyMd' | 'bodyHtml'>): string | null {
  if (typeof a.bodyHtml === 'string' && a.bodyHtml.trim()) return a.bodyHtml;
  if (typeof a.bodyMd === 'string' && a.bodyMd.trim()) {
    const parsed = parseFrontmatter(a.bodyMd);
    const md = stripHeroPlaceholder(String(parsed.content ?? a.bodyMd));
    return mdToHtml(md);
  }
  return null;
}

/**
 * Ust etiket (kicker) icin kategori: yalniz okunur bir ad ise ("Pratik KOBİ Rehberi").
 * Kucuk harf-tire slug ("pratik-kobi-rehberi") videoda kotu gorunur, hic konmaz.
 */
export function kickerFromCategory(category: string | null | undefined): string | null {
  const c = String(category ?? '').trim();
  if (!c || c.length > 40 || /^[a-z0-9-]+$/.test(c) || /[/<>]/.test(c)) return null;
  return c;
}

/**
 * Yazinin herkese acik adresi: canli yayin kayitlarindan (cop kutusu / silinmis haric) http(s)
 * olan, once sitenin kendi alan adindaki. FTP/SFTP/GitHub kayit adresleri sayfa degildir.
 */
export function publishedArticleUrl(publishedTo: unknown, siteUrl: string): string | null {
  let siteHost = '';
  try {
    siteHost = new URL(siteUrl).hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    /* site adresi bozuksa yalniz http(s) suzgeci uygulanir */
  }
  const urls = liveEntries(publishedTo)
    .map((e) => liveEntryRef(e).externalUrl)
    .filter((u): u is string => typeof u === 'string' && /^https?:\/\//i.test(u))
    .filter((u) => {
      try {
        const h = new URL(u).hostname.toLowerCase();
        return h !== 'github.com' && h !== 'raw.githubusercontent.com';
      } catch {
        return false;
      }
    });
  const own = urls.find((u) => {
    try {
      return new URL(u).hostname.replace(/^www\./, '').toLowerCase() === siteHost;
    } catch {
      return false;
    }
  });
  return own ?? urls[0] ?? null;
}

/**
 * <h1>...</h1> elemanlarini at — dogrusal. Eski `/<h1\b[^>]*>[\s\S]*?<\/h1>/gi` kapanmayan
 * her <h1>'de govdenin sonuna kadar tarardi (binlerce kapanmayan <h1> = karesel; worker'in olay
 * dongusu ve BullMQ kilit yenilemesi durur). Kapanis bir kez aranir; yoksa kalan H1'ler kalir.
 */
export function removeH1(html: string): string {
  const open = /<h1\b[^<>]{0,4096}>/gi;
  const close = /<\/h1\s*>/gi;
  let out = '';
  let last = 0;
  for (let m; (m = open.exec(html)); ) {
    close.lastIndex = open.lastIndex;
    const c = close.exec(html);
    if (!c) break;
    out += html.slice(last, m.index);
    last = c.index + c[0].length;
    open.lastIndex = last;
  }
  return out + html.slice(last);
}

/** Govde tavani (extract.mjs MAX_ARTICLE_HTML_CHARS ile ayni): tipik yazi 20-80 KB */
const MAX_BODY_CHARS = 600_000;

/** extract.mjs'in bekledigi tam belge: baslik + meta aciklama + <article> icinde govde */
export function articleHtmlDocument(a: ArticleSourceRow, body: string): string {
  const lang = esc(String(a.language ?? 'tr').slice(0, 5));
  const desc = a.metaDescription ? `<meta name="description" content="${esc(a.metaDescription)}">` : '';
  // Govdedeki H1 atilir (baslik <title>'dan okunur): extract.mjs en ust baslik seviyesini
  // bolum seviyesi sayar; H1 kalirsa H2 bolumleri bir alt seviyeye kayar ve madde bulunamaz.
  // Yayinci da govdedeki H1'i atar (publisher.service withoutH1).
  const withoutH1 = removeH1(body.length > MAX_BODY_CHARS ? body.slice(0, MAX_BODY_CHARS) : body);
  return `<!doctype html><html lang="${lang}"><head><title>${esc(a.title)}</title>${desc}</head><body><article class="article-body">${withoutH1}</article></body></html>`;
}

/**
 * DB satirindan yapisal makale. pageUrl: yazinin canli adresi (yoksa sitenin adresi — CTA o
 * zaman yalniz alan adini gosterir). Govde yoksa null (cagiran acik hata verir).
 */
export function shortArticleFromRow(kit: ExtractKit, a: ArticleSourceRow, pageUrl: string): ShortArticle | null {
  const body = articleBodyHtml(a);
  if (!body) return null;
  const article = kit.extractArticle(articleHtmlDocument(a, body), pageUrl);
  return { ...article, section: kickerFromCategory(a.category), lang: article.lang ?? a.language ?? 'tr' };
}

/** Ekranda kaynak olarak gosterilen yol: alan adi + yazinin bulundugu bolum (or. kobipratik.com/pratik-kobi-rehberi) */
export function sourcePathOf(pageUrl: string, domain: string): string {
  try {
    const parts = new URL(pageUrl).pathname.split('/').filter(Boolean);
    return [domain, ...parts.slice(0, -1)].join('/');
  } catch {
    return domain;
  }
}
