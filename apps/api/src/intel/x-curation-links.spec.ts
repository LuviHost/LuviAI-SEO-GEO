import { describe, it, expect } from 'vitest';
import { classifyHref, urlsInText, canonicalizeUrl, sourceKeyForUrl, baseDomain, parseCurationTarget, splitThread, renderThread, authorFromStatusUrl } from './x-curation-links.js';

describe('classifyHref', () => {
  it('t.co → tco, tweet permalink → tweet (normalize), x.com ici → ignore, dis → external', () => {
    expect(classifyHref('https://t.co/YC1lV9WimO').kind).toBe('tco');
    const t = classifyHref('https://twitter.com/seo_wins/status/2092640469868294287?s=20');
    expect(t).toEqual({ href: 'https://x.com/seo_wins/status/2092640469868294287', kind: 'tweet', statusId: '2092640469868294287' });
    expect(classifyHref('https://x.com/i/chat/123').kind).toBe('ignore');
    expect(classifyHref('https://pbs.twimg.com/media/abc.jpg').kind).toBe('ignore');
    expect(classifyHref('https://www.searchenginejournal.com/foo/').kind).toBe('external');
    expect(classifyHref('javascript:void(0)').kind).toBe('ignore');
  });
});

describe('urlsInText / canonicalizeUrl', () => {
  it('metindeki URL\'leri toplar, sondaki noktalama atilir', () => {
    expect(urlsInText('bak: https://ahrefs.com/blog/x-y/. ve https://t.co/abc!')).toEqual(['https://ahrefs.com/blog/x-y/', 'https://t.co/abc']);
  });
  it('izleme parametreleri ve hash atilir, sondaki slash sadelesir', () => {
    expect(canonicalizeUrl('https://Example.com/a/?utm_source=x&id=5#top')).toBe('https://example.com/a?id=5');
    expect(canonicalizeUrl('https://example.com/')).toBe('https://example.com/');
  });
});

describe('sourceKeyForUrl — yayinciya atif', () => {
  it('katalogdaki yayincinin makalesi kendi kaynagina eslenir', () => {
    // SEJ ve Google Search Central katalogda RSS olarak var
    const sej = sourceKeyForUrl('https://www.searchenginejournal.com/some-article/123/');
    expect(sej).toBeTruthy();
    expect(sej).toBe('search-engine-journal');
  });
  it('katalogda olmayan host null (cagiran x-curated kullanir)', () => {
    expect(sourceKeyForUrl('https://example-unknown-blog.io/post')).toBeNull();
  });
  it('jenerik feed hostlari (medium/github) yayinci sayilmaz', () => {
    expect(sourceKeyForUrl('https://medium.com/@someone/post')).toBeNull();
    expect(sourceKeyForUrl('https://github.com/x/y')).toBeNull();
  });
  it('baseDomain', () => {
    expect(baseDomain('developers.google.com')).toBe('google.com');
    expect(baseDomain('blog.example.com.tr')).toBe('example.com.tr');
    expect(baseDomain('localhost')).toBeNull();
  });
});

describe('parseCurationTarget', () => {
  it('hash icindeki klasor adi ayrilir, URL temiz kalir', () => {
    expect(parseCurationTarget('https://x.com/i/bookmarks#folder=ranksup.ai')).toEqual({ url: 'https://x.com/i/bookmarks', folder: 'ranksup.ai' });
    expect(parseCurationTarget('https://x.com/i/bookmarks')).toEqual({ url: 'https://x.com/i/bookmarks', folder: null });
    expect(parseCurationTarget('https://x.com/i/bookmarks#folder=SEO%20kutusu')).toEqual({ url: 'https://x.com/i/bookmarks', folder: 'SEO kutusu' });
  });
});

describe('splitThread / renderThread — devam gonderileri ve yanitlar', () => {
  const MAIN = 'https://x.com/illyism/status/100';
  const row = (user: string | null, st: string | null, text: string, links: string[] = []) => ({ user, st, text, links });

  it('yazarin devam gonderileri kronolojik thread, digerleri yanit; tekrarlar birlesir', () => {
    const rows = [
      row('/illyism', '/illyism/status/100', 'Ana gonderi 1/'),
      row('/jonathan_wilke', '/jonathan_wilke/status/300', 'katilmiyorum, bende calismadi'),
      row('/illyism', '/illyism/status/102', 'Devam 2/', ['https://t.co/abc']),
      row('/illyism', '/illyism/status/100', 'Ana gonderi 1/'), // ikinci kaydirma adiminda tekrar
      row('/Buildingitmyway', '/Buildingitmyway/status/400', 'wtf is going on'),
    ];
    const s = splitThread(rows, MAIN);
    expect(s.author).toBe('illyism');
    expect(s.thread.map((t) => t.url)).toEqual(['https://x.com/illyism/status/100', 'https://x.com/illyism/status/102']);
    expect(s.thread[1].links).toEqual(['https://t.co/abc']);
    expect(s.replies.map((r) => r.user)).toEqual(['jonathan_wilke', 'buildingitmyway']);
    expect(renderThread(s)).toContain('1/ Ana gonderi 1/');
    expect(renderThread(s)).toContain('2/ Devam 2/');
    expect(renderThread(s)).toContain('- @jonathan_wilke: katilmiyorum');
  });

  it('status URL\'si olmayan satirlar atlanir; yanitlar 8 ile sinirli', () => {
    const rows = [row('/x', null, 'yok'), ...Array.from({ length: 12 }, (_, i) => row(`/u${i}`, `/u${i}/status/${200 + i}`, `yanit ${i}`))];
    const s = splitThread(rows, MAIN);
    expect(s.thread).toEqual([]);
    expect(s.replies.length).toBe(8);
  });

  it('authorFromStatusUrl', () => {
    expect(authorFromStatusUrl('https://twitter.com/seo_wins/status/1?s=20')).toBe('seo_wins');
    expect(authorFromStatusUrl('https://x.com/i/status/1')).toBe('i');
    expect(authorFromStatusUrl('https://example.com/a')).toBeNull();
  });
});
