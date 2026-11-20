import { describe, it, expect } from 'vitest';
import {
  SEARCH_CENTRAL_UPDATES_FEED, isSearchCentralUpdatesFeed, parseSearchCentralUpdates,
} from './search-central-updates.js';
import { fingerprintOf } from './collector.service.js';
import { INTEL_SOURCES } from './source-registry.js';

/** search_docs_updates.rss (20.11.2026 canli feed) kayitlarinin kopyasi */
const item = (title: string, link: string, desc: string, date: string, guid: string) => `
    <item>
      <title>${title}</title>
      <link>${link}</link>
      <description>${desc}</description>
      <pubDate>${date}</pubDate>
      <guid isPermaLink="false">${guid}</guid>
    </item>`;

const FAQ = item(
  'Deprecating the FAQ rich result feature',
  'https://developers.google.com/search/updates#may-2026',
  `&lt;p&gt;
          &lt;b&gt;What&lt;/b&gt;: Added a deprecation notice to the
          &lt;a href=&quot;https://developers.google.com/search/docs/appearance/structured-data/faqpage&quot;&gt;FAQ rich result documentation&lt;/a&gt;.
        &lt;/p&gt;&lt;p&gt;
          &lt;b&gt;Why&lt;/b&gt;: This feature will no longer appear in Google Search starting May 7, 2026.
        &lt;/p&gt;`,
  'Fri, 08 May 2026 00:00:00 +0000',
  '2026-05-08-Deprecating-the-FAQ-rich-result-feature',
);
const SPAM = item(
  'Clarifying that spam policies apply to generative AI responses in Google Search',
  'https://developers.google.com/search/updates#may-2026',
  `&lt;p&gt;&lt;b&gt;What&lt;/b&gt;: Clarified that our spam policies also apply to generative AI responses.&lt;/p&gt;`,
  'Fri, 15 May 2026 00:00:00 +0000',
  '2026-05-15-spam',
);
const FEED = `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel>
  <title>Google Search Central Documentation Updates</title>${FAQ}${SPAM}
  <item><title>Yarim kayit</title></item>
</channel></rss>`;

describe('Search Central belge degisiklik gunlugu', () => {
  const items = parseSearchCentralUpdates(FEED);

  it('kayitlari baslik, tarih ve tam metinle cikarir; yarim kaydi atlar', () => {
    expect(items.map((i) => i.title)).toEqual([
      'Deprecating the FAQ rich result feature',
      'Clarifying that spam policies apply to generative AI responses in Google Search',
    ]);
    const faq = items[0];
    expect(faq.publishedAt?.toISOString()).toBe('2026-05-08T00:00:00.000Z');
    expect(faq.summary).toContain('This feature will no longer appear in Google Search starting May 7, 2026.');
    // degisen belgenin adresi metinde kalir
    expect(faq.summary).toContain('FAQ rich result documentation (https://developers.google.com/search/docs/appearance/structured-data/faqpage)');
  });

  it('tam metin toplama aninda saklanir; kaynak ve tarih basta, kisa kayit 200 esigini gecer', () => {
    const faq = items[0];
    expect(faq.fullText).toMatch(/^Google Search Central belge degisiklik gunlugu \(resmi kaynak\) — 2026-05-08\n/);
    expect(faq.fullText).toContain('Why: This feature will no longer appear');
    expect(faq.fullText!.length).toBeGreaterThanOrEqual(200);
  });

  it('ayni ayin kayitlari ayni capayi tasir ama birbirini ezmez (adres + tarih)', () => {
    expect(items[0].url).toBe('https://developers.google.com/search/updates?tarih=2026-05-08#may-2026');
    const fps = new Set(items.map((i) => fingerprintOf(i.url, i.title)));
    expect(fps.size).toBe(items.length);
  });

  it('ayni baslik ayni ay icinde farkli tarihte tekrar gelirse ayri kayit kalir', () => {
    const fav = (date: string) => item('Updated the favicon documentation',
      'https://developers.google.com/search/updates#june-2026', '&lt;p&gt;What: favicon.&lt;/p&gt;', date, `g-${date}`);
    const twice = parseSearchCentralUpdates(`<rss><channel>${fav('Mon, 01 Jun 2026 00:00:00 +0000')}${fav('Tue, 23 Jun 2026 00:00:00 +0000')}</channel></rss>`);
    expect(twice).toHaveLength(2);
    expect(new Set(twice.map((i) => fingerprintOf(i.url, i.title))).size).toBe(2);
  });

  it('yalniz bu feed adresi ozel ayristiriciya gider', () => {
    expect(isSearchCentralUpdatesFeed(SEARCH_CENTRAL_UPDATES_FEED)).toBe(true);
    expect(isSearchCentralUpdatesFeed('https://developers.google.com/search/blog/feed.xml')).toBe(false);
    expect(isSearchCentralUpdatesFeed('https://evil.com/search/updates/search_docs_updates.rss')).toBe(false);
  });

  it('katalogda resmi kaynak, agirlik 100, gunde bir', () => {
    const src = INTEL_SOURCES.find((s) => s.key === 'google-search-central-updates');
    expect(src).toMatchObject({ kind: 'rss', tier: 'official', weight: 100, intervalHours: 24, target: SEARCH_CENTRAL_UPDATES_FEED });
  });
});
