import { describe, it, expect } from 'vitest';
import {
  ANTHROPIC_PLATFORM_FEED, CHATGPT_RELEASE_NOTES, CLAUDE_APPS_RELEASE_NOTES, GEMINI_APPS_RELEASE_NOTES,
  GOOGLE_SEARCH_STATUS_INCIDENTS, OPENAI_API_CHANGELOG, OPENAI_CRAWLER_FEED, OPENAI_MODEL_RELEASE_NOTES,
  PERPLEXITY_CHANGELOG, YAHOO_PRESS_FEED,
  balancedJson, changelogParserFor, htmlToText, parseClaudeAppsReleaseNotes, parseFullTextFeed, parseGeminiReleaseNotes,
  parseGoogleSearchStatus, parseOpenAiApiChangelog, parseOpenAiHelpReleaseNotes, parsePerplexityChangelog,
  parseYahooSearchPress, withEntryDate,
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
    for (const u of [SEARCH_CENTRAL_UPDATES_FEED, ANTHROPIC_PLATFORM_FEED, OPENAI_CRAWLER_FEED, OPENAI_API_CHANGELOG, CLAUDE_APPS_RELEASE_NOTES,
      CHATGPT_RELEASE_NOTES, OPENAI_MODEL_RELEASE_NOTES, GOOGLE_SEARCH_STATUS_INCIDENTS, GEMINI_APPS_RELEASE_NOTES, PERPLEXITY_CHANGELOG, YAHOO_PRESS_FEED]) {
      expect(changelogParserFor(u)).toBeTypeOf('function');
    }
    expect(changelogParserFor('https://openai.com/news/rss.xml')).toBeNull();
    expect(changelogParserFor('https://blogs.bing.com/search/feed')).toBeNull(); // duz RSS yolu
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

/** help.openai.com surum notlari (Intercom) sadelestirilmis — 21.11.2026 */
const OAI_HELP_HTML = `<html><body><article><h1>ChatGPT release notes</h1><div class="article-content">
<div class="intercom-interblocks-callout callout-transparent"><h1>November 20, 2026</h1><h2>ChatGPT Space is rolling out to Plus</h2>
<p>Starting today, ChatGPT Space is rolling out globally to Plus users.</p><p>See <a href="/en/articles/1-space">Space</a>.</p></div>
<div class="intercom-interblocks-callout callout-transparent"><h1>November 19, 2026</h1><h2>New mobile experience</h2><p>A new app layout.</p>
<h2>Health on Android</h2><ul><li>Health is now on Android.</li></ul></div>
<div class="intercom-interblocks-callout callout-transparent"><h1>November 12, 2026</h1><h2>New mobile experience</h2><p>Now on iPad.</p></div>
</div></article></body></html>`;

/** status.search.google.com/incidents.json sadelestirilmis */
const STATUS_JSON = JSON.stringify([
  { id: 'A', external_desc: 'November 2026 core update', service_name: 'Ranking', uri: 'incidents/A',
    updates: [{ when: '2026-11-10T18:07:10+00:00', text: 'Released the November 2026 core update <https://developers.google.com/search/docs/appearance/core-updates>, which applies globally. The rollout may take up to 2 weeks to complete.' }] },
  { id: 'B', external_desc: 'September 2026 spam update', service_name: 'Ranking', uri: 'incidents/B',
    updates: [
      { when: '2026-10-08T08:37:09+00:00', text: 'The rollout was complete as of October 8, 2026.' },
      { when: '2026-09-24T16:15:47+00:00', text: 'Released the September 2026 spam update.' },
    ] },
]);

/** gemini.google/us/release-notes sadelestirilmis; sinif adlari hash'li */
const GEM_HTML = `<html><body>
<div class="_releaseNoteCard_1le3z_90"><h2 class="_releaseNoteCardTitle_1le3z_104">2026.11.17</h2>
<div class="_releaseNoteCardBody_1le3z_108"></div><div class="_features_1le3z_174">
<div><h3 class="_featureTitle_1le3z_180">Tasks in Gemini, now free</h3><ul><li><div><p><b>What:</b> Tasks is rolling out free in the US.</p></div></li><li><div><p><b>Why:</b> To help more people.</p></div></li></ul></div>
<div><h3 class="_featureTitle_1le3z_180">Checkout with Google Pay in Tasks</h3><ul><li><div><p><b>What:</b> Pay with <a href="https://pay.google.com/">Google Pay</a>.</p></div></li></ul></div>
</div></div>
<div class="_releaseNoteCard_1le3z_90"><h2 class="_releaseNoteCardTitle_1le3z_104">2026.10.13</h2>
<div class="_releaseNoteCardBody_1le3z_108"><p>Gemini 4 Argon is our new frontier model.</p></div><div class="_features_1le3z_174"></div></div>
</body></html>`;

/** perplexity.ai/changelog: liste gomulu sunucu verisinde, ardindan baska atama */
const PPLX_HTML = `<html><head><script>window.__PPL_INITIAL_SERVER_ROUTE__={"route":"/changelog"};window.__PPL_INITIAL_SERVER_DATA__={"queries":[{"state":{"data":[
{"_id":"1","intro":"Hand off ongoing jobs to teammates. Uses \\"quotes\\" and {braces}.","publishedAt":"2026-11-06","slug":"teammates-and-voice","title":"Teammates and Voice mode"},
{"_id":"2","intro":"Ultrafast models.","publishedAt":"2026-10-19","slug":"ultrafast-models","title":"Ultrafast Computer models"}]}}]};window.__PPL_INITIAL_SESSION__=null;</script></head><body></body></html>`;

/** yahooinc.com/press/rss.xml sadelestirilmis */
const YAHOO_XML = `<?xml version="1.0"?><rss version="2.0"><channel><title>Yahoo Press</title>
<item><title>After Delivering More Than 3 Billion Answers, Yahoo Scout Exits Beta to Underpin All of Yahoo Search</title><link>https://www.yahooinc.com/press/scout-exits-beta</link><pubDate>Wed, 18 Nov 2026 14:00:00 GMT</pubDate><description>Yahoo launches Pivot Search.</description></item>
<item><title>Yahoo Finance Premieres New AI and Technology Show</title><link>https://www.yahooinc.com/press/finance-show</link><pubDate>Wed, 18 Nov 2026 13:00:00 GMT</pubDate><description>A new live daily show.</description></item>
<item><title>Yahoo Sports and Yahoo Finance Introduce New AI Answer Experiences</title><link>https://www.yahooinc.com/press/sports-answers</link><pubDate>Tue, 10 Nov 2026 13:00:00 GMT</pubDate><description>Powered by Yahoo Scout, the AI answer engine.</description></item>
</channel></rss>`;

describe('OpenAI Help Center surum notlari (ChatGPT + modeller)', () => {
  const items = parseOpenAiHelpReleaseNotes(OAI_HELP_HTML, CHATGPT_RELEASE_NOTES, 'ChatGPT surum notlari', 'ChatGPT');
  it('kutu = tarih; her h2 ayri kayit; govde baglanti adresiyle', () => {
    expect(items.map((i) => i.title)).toEqual([
      'ChatGPT — ChatGPT Space is rolling out to Plus', 'ChatGPT — New mobile experience', 'ChatGPT — Health on Android', 'ChatGPT — New mobile experience',
    ]);
    expect(items.map((i) => i.publishedAt?.toISOString().slice(0, 10))).toEqual(['2026-11-20', '2026-11-19', '2026-11-19', '2026-11-12']);
    expect(items[0].fullText).toContain('Space (https://help.openai.com/en/articles/1-space)');
    expect(items[2].summary).toBe('Health is now on Android.');
    expect(items[0].url).toBe(`${CHATGPT_RELEASE_NOTES}?tarih=2026-11-20`);
  });
  it('ayni baslik farkli tarihte ayri parmak izi', () => {
    expect(fps(items)).toBe(4);
  });
  it('yapi degisirse bos dizi', () => {
    expect(parseOpenAiHelpReleaseNotes('<article><p>x</p></article>', OPENAI_MODEL_RELEASE_NOTES, 'x', 'y')).toEqual([]);
  });
});

describe('Google Search Status Dashboard (incidents.json)', () => {
  const items = parseGoogleSearchStatus(STATUS_JSON);
  it('her guncelleme ayri kayit: baslangic da bitis de', () => {
    expect(items).toHaveLength(3);
    expect(items[0].title).toBe('Google Search (Ranking) — November 2026 core update: Released the November 2026 core update, which applies globally.');
    expect(items[0].fullText).toContain('core update (https://developers.google.com/search/docs/appearance/core-updates), which');
    expect(items[1].title).toContain('The rollout was complete as of October 8, 2026.');
    expect(items[1].url).toBe('https://status.search.google.com/incidents/B?tarih=2026-10-08');
    expect(fps(items)).toBe(3);
  });
  it('bozuk JSON bos dizi', () => {
    expect(parseGoogleSearchStatus('<html>')).toEqual([]);
    expect(parseGoogleSearchStatus('{"a":1}')).toEqual([]);
  });
});

describe('Gemini uygulama surum notlari', () => {
  const items = parseGeminiReleaseNotes(GEM_HTML);
  it('kart tarihi + her h3 ayri kayit; h3 yoksa kart govdesi', () => {
    expect(items.map((i) => i.title)).toEqual([
      'Gemini — Tasks in Gemini, now free', 'Gemini — Checkout with Google Pay in Tasks', 'Gemini — Gemini 4 Argon is our new frontier model.',
    ]);
    expect(items[0].publishedAt?.toISOString().slice(0, 10)).toBe('2026-11-17');
    expect(items[0].fullText).toContain('What: Tasks is rolling out free in the US.\nWhy: To help more people.');
    expect(items[1].fullText).toContain('Google Pay (https://pay.google.com/)');
    expect(items[2].publishedAt?.toISOString().slice(0, 10)).toBe('2026-10-13');
    expect(fps(items)).toBe(3);
  });
});

describe('Perplexity degisiklik gunlugu', () => {
  it('gomulu veriden kayitlar; ardindaki atama JSON u bozmaz', () => {
    const items = parsePerplexityChangelog(PPLX_HTML);
    expect(items.map((i) => [i.title, i.url, i.publishedAt?.toISOString().slice(0, 10)])).toEqual([
      ['Perplexity — Teammates and Voice mode', `${PERPLEXITY_CHANGELOG}/teammates-and-voice`, '2026-11-06'],
      ['Perplexity — Ultrafast Computer models', `${PERPLEXITY_CHANGELOG}/ultrafast-models`, '2026-10-19'],
    ]);
    expect(items[0].summary).toBe('Hand off ongoing jobs to teammates. Uses "quotes" and {braces}.');
    expect(items[0].fullText).toBeUndefined(); // analist kayit sayfasini okur
  });
  it('balancedJson dizgi icindeki parantezi saymaz', () => {
    const s = 'x={"a":"}{","b":{"c":1}};y=2';
    expect(balancedJson(s, 2)).toBe('{"a":"}{","b":{"c":1}}');
    expect(balancedJson(s, 0)).toBeNull();
  });
  it('veri yoksa bos dizi', () => {
    expect(parsePerplexityChangelog('<html></html>')).toEqual([]);
  });
});

describe('Yahoo basin bultenleri (yalniz arama)', () => {
  it('Scout / Search bultenleri gecer, Finance sovu elenir', () => {
    const items = parseYahooSearchPress(YAHOO_XML);
    expect(items.map((i) => i.url)).toEqual(['https://www.yahooinc.com/press/scout-exits-beta', 'https://www.yahooinc.com/press/sports-answers']);
    expect(items[0].author).toBe('Yahoo');
  });
});

describe('katalog — platform gunlukleri', () => {
  it.each([
    ['anthropic-platform-release-notes', 'rss', ANTHROPIC_PLATFORM_FEED],
    ['claude-apps-release-notes', 'changelog', CLAUDE_APPS_RELEASE_NOTES],
    ['openai-api-changelog', 'changelog', OPENAI_API_CHANGELOG],
    ['openai-crawler-updates', 'rss', OPENAI_CRAWLER_FEED],
    ['chatgpt-release-notes', 'changelog', CHATGPT_RELEASE_NOTES],
    ['openai-model-release-notes', 'changelog', OPENAI_MODEL_RELEASE_NOTES],
    ['google-search-status', 'changelog', GOOGLE_SEARCH_STATUS_INCIDENTS],
    ['gemini-apps-release-notes', 'changelog', GEMINI_APPS_RELEASE_NOTES],
    ['perplexity-changelog', 'changelog', PERPLEXITY_CHANGELOG],
  ])('%s resmi, agirlik 100, gunde bir', (key, kind, target) => {
    expect(INTEL_SOURCES.find((s) => s.key === key)).toMatchObject({ kind, target, tier: 'official', weight: 100, intervalHours: 24 });
  });
  it.each([
    ['bing-search-blog', 'https://blogs.bing.com/search/feed'],
    ['yahoo-search-press', YAHOO_PRESS_FEED],
  ])('%s resmi RSS, agirlik 90', (key, target) => {
    expect(INTEL_SOURCES.find((s) => s.key === key)).toMatchObject({ kind: 'rss', target, tier: 'official', weight: 90 });
  });
  it('changelog tipindeki her kaynagin ayristiricisi var', () => {
    for (const s of INTEL_SOURCES.filter((x) => x.kind === 'changelog')) expect(changelogParserFor(s.target)).not.toBeNull();
  });
});
