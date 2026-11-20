import { load, type CheerioAPI } from 'cheerio';
import type { RawItem } from './collector.service.js';
import { isSearchCentralUpdatesFeed, parseSearchCentralUpdates } from './search-central-updates.js';

/**
 * PLATFORM DEGISIKLIK GUNLUKLERI — platform sahibinin kendi kaydi.
 *
 * Blog duyurulari buyuk lansmanlari verir; tarayici, arama araci ve model
 * degisiklikleri cogu zaman YALNIZ degisiklik gunlugune yazilir (20.11.2026:
 * Google'in FAQ zengin sonucunu kaldirmasi blogda hic gecmedi).
 *
 * Ortak iki tuzak (bkz. search-central-updates.ts):
 * 1. Kayit adresi buyuk bir sayfanin capasi; analist adresi acarsa sayfanin
 *    basini okur, bu kaydi degil → metin toplama aninda fullText olarak saklanir.
 * 2. Parmak izi (adres capasiz + baslik) ayni basligin baska tarihte tekrar
 *    gelmesinde cakisir → adrese kaydin tarihi eklenir (?tarih=YYYY-MM-DD).
 *
 * Kaynak ekleme kurali: RSS varsa RSS (kind 'rss'), yoksa sunucuda islenmis
 * HTML (kind 'changelog'). Kapali sayfalar (ChatGPT surum notlari, 403)
 * kimlik degistirilerek ACILMAZ.
 */

export const ANTHROPIC_PLATFORM_FEED = 'https://platform.claude.com/docs/en/release-notes/feed.xml';
export const OPENAI_CRAWLER_FEED = 'https://developers.openai.com/api/docs/bots/rss.xml';
export const OPENAI_API_CHANGELOG = 'https://developers.openai.com/changelog';
export const CLAUDE_APPS_RELEASE_NOTES = 'https://support.claude.com/en/articles/12138966-release-notes';

const MAX_ENTRIES = 60;

// ── ortak yardimcilar ─────────────────────────────────────────

/** HTML parcasi → duz metin; dis baglantilarin adresi korunur (hangi belge/ozellik) */
export function htmlToText(html: string, base?: string): string {
  const $ = load(`<div id="k">${html}</div>`);
  $('#k script, #k style').remove();
  $('#k a[href]').each((_, a) => {
    const $a = $(a);
    const label = $a.text().replace(/\s+/g, ' ').trim();
    let href = $a.attr('href') ?? '';
    if (base && href.startsWith('/')) href = new URL(href, base).toString();
    $a.replaceWith(/^https?:\/\//.test(href) && label ? `${label} (${href})` : label);
  });
  $('#k p, #k li, #k h1, #k h2, #k h3, #k h4, #k pre').each((_, el) => {
    $(el).append('\n');
  });
  return $('#k')
    .text()
    .split('\n')
    .map((l) => l.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join('\n');
}

/** Adrese kayit tarihini ekler; capa korunur */
export function withEntryDate(url: string, ymd: string): string {
  const [base, hash] = url.split('#');
  const sep = base.includes('?') ? '&' : '?';
  return `${base}${sep}tarih=${ymd}${hash ? `#${hash}` : ''}`;
}

/** Basliklar icin: baglanti adresi olmadan duz metin */
function plainText(html: string): string {
  return load(`<div id="k">${html}</div>`)('#k').text().replace(/\s+/g, ' ').trim();
}

function firstSentence(text: string, max = 140): string {
  const line = text.split('\n')[0] ?? '';
  const s = line.split(/(?<=[.!?])\s/)[0] ?? line;
  return s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s;
}

function entry(label: string, title: string, date: Date, body: string, url: string, author: string): RawItem {
  const ymd = date.toISOString().slice(0, 10);
  return {
    url: withEntryDate(url, ymd),
    title: title.slice(0, 300),
    author,
    publishedAt: date,
    summary: body,
    fullText: [`${label} (resmi kaynak) — ${ymd}`, title, body].join('\n'),
  };
}

function utcDate(input: string): Date | null {
  const d = new Date(`${input} 00:00:00 UTC`);
  return Number.isNaN(d.getTime()) ? null : d;
}

// ── RSS: aciklamasi kaydin tam metni olan feed'ler ────────────

/**
 * Claude Platform surum notlari ve OpenAI tarayici guncellemeleri. Kayit
 * basliklari jenerik ("Claude Platform release notes — November 17, 2026"),
 * panelde ayiklanabilsin diye ilk cumle basliga eklenir.
 */
export function parseFullTextFeed(xml: string, label: string, author: string): RawItem[] {
  const $ = load(xml, { xml: true });
  const out: RawItem[] = [];
  $('item').slice(0, MAX_ENTRIES).each((_, el) => {
    const $el = $(el);
    const title = $el.find('title').first().text().replace(/\s+/g, ' ').trim();
    const link = $el.find('link').first().text().trim();
    const date = new Date($el.find('pubDate').first().text().trim());
    const desc = $el.find('description').first().text();
    const body = htmlToText(desc, link || undefined);
    if (!title || !link || !body || Number.isNaN(date.getTime())) return;
    out.push(entry(label, `${title}: ${firstSentence(plainText(desc))}`, date, body, link, author));
  });
  return out;
}

// ── HTML: OpenAI API degisiklik gunlugu ───────────────────────

/**
 * developers.openai.com/changelog — sunucuda islenmis (Astro SSR). Ay
 * basligi "November, 2026"; her kayitta tarih rozeti ("Nov 19", outline),
 * tur ve etiket rozetleri (soft) ve markdown govdesi. Sinif adlari hash
 * tasir (_ChangelogMarkdown_pvkq8_19) → kismi eslesme.
 */
export function parseOpenAiApiChangelog(html: string, pageUrl = OPENAI_API_CHANGELOG): RawItem[] {
  const $ = load(html);
  const out: RawItem[] = [];
  $('[class*="ChangelogSectionTitle"]').each((_, h) => {
    const year = ($(h).text().match(/(\d{4})/) ?? [])[1];
    if (!year) return;
    $(h).parent().find('div.grid').each((_, g) => {
      if (out.length >= MAX_ENTRIES) return;
      const $g = $(g);
      const day = $g.find('[data-variant="outline"]').first().text().trim();
      const date = utcDate(`${day}, ${year}`);
      const tags = $g.find('[data-variant="soft"]').map((__, b) => $(b).text().trim()).get().filter(Boolean);
      const md = $g.find('[class*="ChangelogMarkdown"]').first();
      const mdHtml = $.html(md.contents()) ?? '';
      const body = htmlToText(mdHtml, pageUrl);
      if (!date || !body) return;
      // Ayni gun ayni etiketli iki kayit var (canli sayfada olculdu) → ilk
      // cumle basliga girer; hem ayirt eder hem panelde okunur
      const title = `OpenAI API — ${tags.length ? `${tags.join(', ')}: ` : ''}${firstSentence(plainText(mdHtml), 110)}`;
      out.push(entry('OpenAI API degisiklik gunlugu', title, date, body, pageUrl, 'OpenAI'));
    });
  });
  return out;
}

// ── HTML: Claude uygulama surum notlari (Help Center) ─────────

/**
 * support.claude.com surum notlari: h3 tarih ("November 17, 2026", kendi
 * capasiyla), ardindan yalniz kalin metinli paragraf = kayit basligi, sonraki
 * paragraflar govde. Ayni tarihte birden fazla kayit olabilir.
 */
export function parseClaudeAppsReleaseNotes(html: string, pageUrl = CLAUDE_APPS_RELEASE_NOTES): RawItem[] {
  const $: CheerioAPI = load(html);
  const out: RawItem[] = [];
  let date: Date | null = null;
  let anchor = '';
  let cur: { title: string; parts: string[] } | null = null;

  const flush = () => {
    if (cur && date && cur.parts.length && out.length < MAX_ENTRIES) {
      const url = anchor ? `${pageUrl}#${anchor}` : pageUrl;
      out.push(entry('Claude uygulama surum notlari', `Claude — ${cur.title}`, date, cur.parts.join('\n'), url, 'Anthropic'));
    }
    cur = null;
  };

  $('article').first().find('h3, p, li').each((_, el) => {
    const $el = $(el);
    if (el.tagName === 'h3') {
      flush();
      date = utcDate($el.text().trim());
      anchor = $el.attr('id') ?? '';
      return;
    }
    if (!date) return;
    if (el.tagName === 'li' && $el.parents('li').length) return; // ic ice liste bir kez
    if (el.tagName === 'p' && $el.parents('li').length) return;
    const text = htmlToText($.html($el) ?? '', pageUrl);
    if (!text) return;
    const bold = $el.children('b, strong').first().text().replace(/\s+/g, ' ').trim();
    if (el.tagName === 'p' && bold && bold === $el.text().replace(/\s+/g, ' ').trim()) {
      flush();
      cur = { title: bold, parts: [] };
      return;
    }
    if (!cur) cur = { title: firstSentence(text, 100), parts: [] };
    cur.parts.push(text);
  });
  flush();
  return out;
}

// ── yonlendirici ──────────────────────────────────────────────

type Parser = (body: string) => RawItem[];

/** Bu adres ozel ayristirici gerektiriyor mu? Gerekmiyorsa null (genel feed yolu) */
export function changelogParserFor(url: string): Parser | null {
  if (isSearchCentralUpdatesFeed(url)) return parseSearchCentralUpdates;
  if (url === ANTHROPIC_PLATFORM_FEED) return (x) => parseFullTextFeed(x, 'Claude Platform surum notlari', 'Anthropic');
  if (url === OPENAI_CRAWLER_FEED) return (x) => parseFullTextFeed(x, 'OpenAI tarayici guncellemeleri', 'OpenAI');
  if (url === OPENAI_API_CHANGELOG) return (h) => parseOpenAiApiChangelog(h);
  if (url === CLAUDE_APPS_RELEASE_NOTES) return (h) => parseClaudeAppsReleaseNotes(h);
  return null;
}
