import { describe, it, expect } from 'vitest';
import {
  ANTHROPIC_PLATFORM_FEED, CLAUDE_APPS_RELEASE_NOTES, OPENAI_API_CHANGELOG, OPENAI_CRAWLER_FEED,
  changelogParserFor, htmlToText, parseClaudeAppsReleaseNotes, parseFullTextFeed, parseOpenAiApiChangelog, withEntryDate,
} from './changelogs.js';
import { SEARCH_CENTRAL_UPDATES_FEED, parseSearchCentralUpdates } from './search-central-updates.js';
import { fingerprintOf } from './collector.service.js';
import { INTEL_SOURCES } from './source-registry.js';

const fps = (items: { url: string; title: string }[]) => new Set(items.map((i) => fingerprintOf(i.url, i.title))).size;

/** platform.claude.com/docs/en/release-notes/feed.xml (20.11.2026) sadelestirilmis */
const ANT_FEED = `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel>
<title>Claude Platform release notes</title>
<item><title>Claude Platform release notes — November 17, 2026</title>
<link>https://platform.claude.com/docs/en/release-notes/overview#linked-billing</link>
<description><![CDATA[<p>We’ve launched <a href="/docs/en/manage-claude/oauth-apps/organization-billing-connections">Linked billing</a> in beta. Your customers can now pay for the Claude usage in your app through their own Claude organization.</p>]]></description>
<pubDate>Tue, 17 Nov 2026 00:00:00 GMT</pubDate></item>
<item><title>Claude Platform release notes — November 12, 2026</title>
<link>https://platform.claude.com/docs/en/release-notes/overview#self-hosted-managed-agents</link>
<description><![CDATA[<p>We’ve launched self-hosted Claude Managed Agents. You run the whole Managed Agents service on your own infrastructure.</p>]]></description>
<pubDate>Thu, 12 Nov 2026 00:00:00 GMT</pubDate></item>
</channel></rss>`;

/** developers.openai.com/changelog (Astro SSR) sadelestirilmis; sinif adlari hash'li */
const oaiEntry = (day: string, tags: string[], body: string) => `
<div class="mt-5"><div class="grid grid-cols-[3rem_1fr] items-start gap-x-4 gap-y-2">
  <div><div class="_Badge_10t5o_1" data-variant="outline">${day}</div></div>
  <div><div class="flex flex-wrap gap-2 mb-2">${tags.map((t) => `<div class="_Badge_10t5o_1" data-variant="soft"><span>${t}</span></div>`).join('')}</div>
  <div class="_MarkdownContent_13d6z_1 _ChangelogMarkdown_pvkq8_19">${body}</div></div>
</div></div>`;
const OAI_HTML = `<html><body><div class="_ChangelogPage_pvkq8_1"><h1>Changelog</h1>
<div class="mb-12"><h3 class="mt-0 mb-4 _ChangelogSectionTitle_pvkq8_43">November, 2026</h3>
${oaiEntry('Nov 19', ['Feature', 'gpt-live-1.1'], '<p><a href="/api/docs/models/gpt-live-1.1">GPT-Live-1.1</a> improves pronunciation in multilingual voice conversations.</p>')}
${oaiEntry('Nov 17', ['Update', 'web_search'], '<p>The web search tool now returns source URLs for every citation.</p>')}
${oaiEntry('Nov 17', ['Update', 'web_search'], '<p>Web search results now honor the user location parameter.</p>')}
</div>
<div class="mb-12"><h3 class="_ChangelogSectionTitle_pvkq8_43">October, 2026</h3>
${oaiEntry('Oct 2', ['Deprecation'], '<p>Older search preview models are deprecated.</p>')}
</div></div></body></html>`;

/** support.claude.com surum notlari (Intercom) sadelestirilmis */
const p = (html: string) => `<div class="intercom-interblocks-paragraph"><p>${html}</p></div>`;
const APPS_HTML = `<html><body><article>
<div><h2 id="h_m">November 2026</h2></div>
<div><h3 id="h_e2e22537c4">November 17, 2026</h3></div>
${p('<b>Choose a release channel in Claude Desktop</b>')}
${p('You can now use a release channel. <b>Stable</b> stays the default. See <a href="https://support.claude.com/en/articles/1-install">Choose a release channel</a>.')}
${p(' ')}
${p('<b>Web search in more regions</b>')}
${p('Web search is now available to all users in Turkey.')}
<div><h3 id="h_2d03630102">November 12, 2026</h3></div>
${p('<b>Web search in more regions</b>')}
${p('Web search is now available to all users in Brazil.')}
</article></body></html>`;

describe('degisiklik gunlukleri — ortak', () => {
  it('htmlToText: goreli baglanti mutlak adrese, paragraflar satira', () => {
    expect(htmlToText('<p>A <a href="/x">b</a>.</p><p>C</p>', 'https://ex.com/y')).toBe('A b (https://ex.com/x).\nC');
  });
  it('withEntryDate: capa korunur, mevcut sorgu bozulmaz', () => {
    expect(withEntryDate('https://a.com/p#h', '2026-11-17')).toBe('https://a.com/p?tarih=2026-11-17#h');
    expect(withEntryDate('https://a.com/p?q=1', '2026-11-17')).toBe('https://a.com/p?q=1&tarih=2026-11-17');
  });
  it('yonlendirici: yalniz bilinen gunlukler ozel ayristiriciya gider', () => {
    for (const u of [SEARCH_CENTRAL_UPDATES_FEED, ANTHROPIC_PLATFORM_FEED, OPENAI_CRAWLER_FEED, OPENAI_API_CHANGELOG, CLAUDE_APPS_RELEASE_NOTES]) {
      expect(changelogParserFor(u)).toBeTypeOf('function');
    }
    expect(changelogParserFor('https://openai.com/news/rss.xml')).toBeNull();
    expect(changelogParserFor(SEARCH_CENTRAL_UPDATES_FEED)).toBe(parseSearchCentralUpdates);
  });
});

describe('Claude Platform surum notlari (RSS)', () => {
  const items = parseFullTextFeed(ANT_FEED, 'Claude Platform surum notlari', 'Anthropic');
  it('kayit metni toplama aninda saklanir; jenerik basliga ilk cumle eklenir', () => {
    expect(items).toHaveLength(2);
    expect(items[0].title).toBe('Claude Platform release notes — November 17, 2026: We’ve launched Linked billing in beta.');
    expect(items[0].fullText).toMatch(/^Claude Platform surum notlari \(resmi kaynak\) — 2026-11-17\n/);
    expect(items[0].url).toBe('https://platform.claude.com/docs/en/release-notes/overview?tarih=2026-11-17#linked-billing');
    expect(fps(items)).toBe(2);
  });
  it('bos feed bos dizi (OpenAI tarayici feed i 20.11.2026 itibariyla bos)', () => {
    expect(parseFullTextFeed('<rss><channel><title>OpenAI crawler updates</title></channel></rss>', 'x', 'OpenAI')).toEqual([]);
  });
});

describe('OpenAI API degisiklik gunlugu (HTML)', () => {
  const items = parseOpenAiApiChangelog(OAI_HTML);
  it('ay basligi + gun rozeti → tarih; etiketler ve ilk cumle basliga', () => {
    expect(items.map((i) => i.publishedAt?.toISOString().slice(0, 10))).toEqual(['2026-11-19', '2026-11-17', '2026-11-17', '2026-10-02']);
    expect(items[0].title).toBe('OpenAI API — Feature, gpt-live-1.1: GPT-Live-1.1 improves pronunciation in multilingual voice conversations.');
    expect(items[1].fullText).toContain('The web search tool now returns source URLs for every citation.');
    // govdede adres kalir
    expect(items[0].fullText).toContain('GPT-Live-1.1 (https://developers.openai.com/api/docs/models/gpt-live-1.1)');
  });
  it('ayni gun ayni etiketli iki kayit ayri parmak izi alir', () => {
    expect(fps(items)).toBe(items.length);
  });
  it('sayfa yapisi degisirse bos dizi (feed bos uyarisi tetiklenir)', () => {
    expect(parseOpenAiApiChangelog('<html><body>Changelog</body></html>')).toEqual([]);
  });
});

describe('Claude uygulama surum notlari (Help Center HTML)', () => {
  const items = parseClaudeAppsReleaseNotes(APPS_HTML);
  it('kalin paragraf = kayit basligi; ayni tarihte birden fazla kayit; bos paragraf atlanir', () => {
    expect(items.map((i) => i.title)).toEqual([
      'Claude — Choose a release channel in Claude Desktop',
      'Claude — Web search in more regions',
      'Claude — Web search in more regions',
    ]);
    expect(items[0].fullText).toContain('Choose a release channel (https://support.claude.com/en/articles/1-install)');
    expect(items[1].summary).toBe('Web search is now available to all users in Turkey.');
    expect(items[0].url).toBe('https://support.claude.com/en/articles/12138966-release-notes?tarih=2026-11-17#h_e2e22537c4');
  });
  it('ayni baslik farkli tarihte ayri kayit kalir', () => {
    expect(fps(items)).toBe(3);
  });
});

describe('katalog — platform gunlukleri', () => {
  it.each([
    ['anthropic-platform-release-notes', 'rss', ANTHROPIC_PLATFORM_FEED],
    ['claude-apps-release-notes', 'changelog', CLAUDE_APPS_RELEASE_NOTES],
    ['openai-api-changelog', 'changelog', OPENAI_API_CHANGELOG],
    ['openai-crawler-updates', 'rss', OPENAI_CRAWLER_FEED],
  ])('%s resmi, agirlik 100, gunde bir', (key, kind, target) => {
    expect(INTEL_SOURCES.find((s) => s.key === key)).toMatchObject({ kind, target, tier: 'official', weight: 100, intervalHours: 24 });
  });
  it('changelog tipindeki her kaynagin ayristiricisi var', () => {
    for (const s of INTEL_SOURCES.filter((x) => x.kind === 'changelog')) expect(changelogParserFor(s.target)).not.toBeNull();
  });
});
