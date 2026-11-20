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
 * HTML (kind 'changelog'). Kapali sayfalar kimlik degistirilerek ACILMAZ
 * (ChatGPT surum notlari 20.11.2026'da 403 dondu, 21.11.2026'da bot
 * kimligimizle 200; yeniden kapanirsa failCount kaynagi kendisi durdurur).
 */

export const ANTHROPIC_PLATFORM_FEED = 'https://platform.claude.com/docs/en/release-notes/feed.xml';
export const OPENAI_CRAWLER_FEED = 'https://developers.openai.com/api/docs/bots/rss.xml';
export const OPENAI_API_CHANGELOG = 'https://developers.openai.com/changelog';
export const CLAUDE_APPS_RELEASE_NOTES = 'https://support.claude.com/en/articles/12138966-release-notes';
export const CHATGPT_RELEASE_NOTES = 'https://help.openai.com/en/articles/6825453-chatgpt-release-notes';
export const OPENAI_MODEL_RELEASE_NOTES = 'https://help.openai.com/en/articles/9624314-model-release-notes';
export const GOOGLE_SEARCH_STATUS_INCIDENTS = 'https://status.search.google.com/incidents.json';
export const GEMINI_APPS_RELEASE_NOTES = 'https://gemini.google/us/release-notes/?hl=en';
export const PERPLEXITY_CHANGELOG = 'https://www.perplexity.ai/changelog';
export const YAHOO_PRESS_FEED = 'https://www.yahooinc.com/press/rss.xml';

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

// ── HTML: OpenAI Help Center (ChatGPT + model surum notlari) ──

/**
 * help.openai.com (Intercom): her tarih bir callout kutusu; icinde h1 tarih
 * ("November 20, 2026"), her h2 bir kayit basligi, aradaki p/ul govde. Ayni
 * gunde birden fazla h2 olabilir (canli sayfada 240 kutunun 58'inde).
 * Capa yok → adrese kaydin tarihi eklenir, baslik parmak izini ayirir.
 */
export function parseOpenAiHelpReleaseNotes(html: string, pageUrl: string, label: string, prefix: string): RawItem[] {
  const $ = load(html);
  const out: RawItem[] = [];
  $('article .intercom-interblocks-callout').each((_, box) => {
    let date: Date | null = null;
    let cur: { title: string; parts: string[] } | null = null;
    const flush = () => {
      if (cur && date && cur.parts.length && out.length < MAX_ENTRIES) {
        out.push(entry(label, `${prefix} — ${cur.title}`, date, cur.parts.join('\n'), pageUrl, 'OpenAI'));
      }
      cur = null;
    };
    $(box).children().each((__, el) => {
      const $el = $(el);
      if (el.tagName === 'h1') { flush(); date = utcDate($el.text().trim()); return; }
      if (el.tagName === 'h2') { flush(); cur = { title: $el.text().replace(/\s+/g, ' ').trim(), parts: [] }; return; }
      if (!date) return;
      const text = htmlToText($.html($el) ?? '', pageUrl);
      if (!text) return;
      if (!cur) cur = { title: firstSentence(text, 100), parts: [] };
      cur.parts.push(text);
    });
    flush();
  });
  return out;
}

// ── JSON: Google Search Status Dashboard ──────────────────────

/**
 * status.search.google.com/incidents.json — cekirdek / spam guncellemeleri
 * ve sunum sorunlari. Atom feed'i yalniz son kaydi tutar; JSON tum gecmisi
 * ve her olayin guncellemelerini ("Released ...", "The rollout was complete
 * ...") verir. Her guncelleme ayri kayit: yayilimin bitisi de bir olgu.
 */
export function parseGoogleSearchStatus(json: string): RawItem[] {
  let incidents: any[];
  try { incidents = JSON.parse(json); } catch { return []; }
  if (!Array.isArray(incidents)) return [];
  const out: RawItem[] = [];
  for (const inc of incidents) {
    const name = String(inc?.external_desc ?? '').trim();
    const uri = String(inc?.uri ?? '').trim();
    if (!name || !uri) continue;
    for (const u of Array.isArray(inc.updates) ? inc.updates : []) {
      if (out.length >= MAX_ENTRIES) return out;
      const date = new Date(u?.when ?? u?.created ?? '');
      // "<https://...>" bicimindeki baglantilar → "(https://...)"
      const body = String(u?.text ?? '').replace(/\s*<(https?:\/\/[^>\s]+)>/g, ' ($1)').replace(/\s+/g, ' ').trim();
      if (!body || Number.isNaN(date.getTime())) continue;
      const service = inc.service_name ? ` (${inc.service_name})` : '';
      out.push(entry('Google Search Status Dashboard', `Google Search${service} — ${name}: ${firstSentence(body.replace(/\s*\(https?:[^)]*\)/g, ''), 120)}`,
        date, body, `https://status.search.google.com/${uri}`, 'Google'));
    }
  }
  return out;
}

// ── HTML: Gemini uygulama surum notlari ───────────────────────

/**
 * gemini.google/us/release-notes/?hl=en — sunucuda islenmis; her kart bir
 * tarih (h2 "2026.11.17"), altinda h3 basliklı ozellikler ve What / Why
 * maddeleri. Turkiye IP'sinden yerel sayfa karisik dilde gelir → /us/ + hl=en.
 * Sinif adlari hash'li (_releaseNoteCard_1le3z_90) → kismi eslesme;
 * "releaseNoteCard_" Title/Body siniflarini disarida birakir.
 */
export function parseGeminiReleaseNotes(html: string, pageUrl = GEMINI_APPS_RELEASE_NOTES): RawItem[] {
  const $ = load(html);
  const out: RawItem[] = [];
  $('div[class*="releaseNoteCard_"]').each((_, card) => {
    const $card = $(card);
    const m = $card.find('h2').first().text().trim().match(/(\d{4})\.(\d{2})\.(\d{2})/);
    if (!m) return;
    const date = new Date(`${m[1]}-${m[2]}-${m[3]}T00:00:00Z`);
    const feats = $card.find('h3');
    if (feats.length === 0) {
      const body = htmlToText($.html($card.find('[class*="releaseNoteCardBody"]').first().contents()) ?? '', pageUrl);
      if (body && out.length < MAX_ENTRIES) out.push(entry('Gemini uygulama surum notlari', `Gemini — ${firstSentence(body, 100)}`, date, body, pageUrl, 'Google'));
      return;
    }
    feats.each((__, h3) => {
      if (out.length >= MAX_ENTRIES) return;
      const title = $(h3).text().replace(/\s+/g, ' ').trim();
      const body = htmlToText($(h3).nextAll().map((___, s) => $.html(s)).get().join(''), pageUrl);
      if (title && body) out.push(entry('Gemini uygulama surum notlari', `Gemini — ${title}`, date, body, pageUrl, 'Google'));
    });
  });
  return out;
}

// ── HTML icindeki JSON: Perplexity degisiklik gunlugu ─────────

/**
 * perplexity.ai/changelog — kayit listesi sayfaya gomulu sunucu verisinde
 * (window.__PPL_INITIAL_SERVER_DATA__): baslik, giris paragrafi, tarih, slug.
 * Her kaydin kendi sayfasi var (sunucuda islenmis) → fullText bos birakilir,
 * analist kayit sayfasini okur.
 */
/** start konumundaki { ... } nesnesini dizgi kacislarini gozeterek dondurur */
export function balancedJson(text: string, start: number): string | null {
  if (text[start] !== '{') return null;
  let depth = 0;
  let inStr = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inStr) {
      if (ch === '\\') i++;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === '{') depth++;
    else if (ch === '}' && --depth === 0) return text.slice(start, i + 1);
  }
  return null;
}

export function parsePerplexityChangelog(html: string): RawItem[] {
  const marker = html.indexOf('__PPL_INITIAL_SERVER_DATA__=');
  if (marker < 0) return [];
  // Ayni script'te ardindan baska atama gelir (";window.__PPL_INITIAL_SESSION__=null;")
  // → JSON nesnesini parantez sayarak kes
  const raw = balancedJson(html, marker + '__PPL_INITIAL_SERVER_DATA__='.length);
  let data: unknown;
  try { data = raw ? JSON.parse(raw) : null; } catch { return []; }
  const found = new Map<string, RawItem>();
  const walk = (v: unknown) => {
    if (!v || typeof v !== 'object' || found.size >= MAX_ENTRIES) return;
    if (Array.isArray(v)) { v.forEach(walk); return; }
    const o = v as Record<string, unknown>;
    if (typeof o.slug === 'string' && typeof o.title === 'string' && typeof o.publishedAt === 'string') {
      const date = new Date(`${o.publishedAt.slice(0, 10)}T00:00:00Z`);
      if (!Number.isNaN(date.getTime()) && !found.has(o.slug)) {
        found.set(o.slug, {
          url: `${PERPLEXITY_CHANGELOG}/${o.slug}`,
          title: `Perplexity — ${o.title}`.slice(0, 300),
          author: 'Perplexity',
          publishedAt: date,
          summary: typeof o.intro === 'string' ? o.intro : null,
        });
      }
      return;
    }
    Object.values(o).forEach(walk);
  };
  walk(data);
  return [...found.values()];
}

// ── RSS (suzulmus): Yahoo basin odasi ─────────────────────────

/**
 * yahooinc.com/press/rss.xml — Yahoo'nun webmaster gunlugu yok; arama
 * degisiklikleri (Yahoo Scout AI cevap motoru, Pivot Search) basin
 * bulteniyle duyuruluyor. Feed'in cogu Finance / Sports / Mail → yalniz
 * aramaya dair bultenler gecer (triage butcesi bosa gitmesin).
 */
const YAHOO_SEARCH_RE = /\b(search|scout|answer engine)\b/i;
export function parseYahooSearchPress(xml: string): RawItem[] {
  const $ = load(xml, { xml: true });
  const out: RawItem[] = [];
  $('item').each((_, el) => {
    if (out.length >= MAX_ENTRIES) return;
    const $el = $(el);
    const title = $el.find('title').first().text().replace(/\s+/g, ' ').trim();
    const link = $el.find('link').first().text().trim();
    const date = new Date($el.find('pubDate').first().text().trim());
    const summary = htmlToText($el.find('description').first().text(), link || undefined);
    if (!title || !link || Number.isNaN(date.getTime())) return;
    if (!YAHOO_SEARCH_RE.test(title) && !YAHOO_SEARCH_RE.test(summary.slice(0, 400))) return;
    out.push({ url: link, title, author: 'Yahoo', publishedAt: date, summary: summary || null });
  });
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
  if (url === CHATGPT_RELEASE_NOTES) return (h) => parseOpenAiHelpReleaseNotes(h, url, 'ChatGPT surum notlari', 'ChatGPT');
  if (url === OPENAI_MODEL_RELEASE_NOTES) return (h) => parseOpenAiHelpReleaseNotes(h, url, 'OpenAI model surum notlari', 'OpenAI modelleri');
  if (url === GOOGLE_SEARCH_STATUS_INCIDENTS) return parseGoogleSearchStatus;
  if (url === GEMINI_APPS_RELEASE_NOTES) return (h) => parseGeminiReleaseNotes(h);
  if (url === PERPLEXITY_CHANGELOG) return parsePerplexityChangelog;
  if (url === YAHOO_PRESS_FEED) return parseYahooSearchPress;
  return null;
}
