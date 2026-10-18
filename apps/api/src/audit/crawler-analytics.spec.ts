import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SafeTextResult } from '../common/safe-fetch.js';

vi.mock('../prisma/prisma.service.js', () => ({ PrismaService: class {} }));
const fetchMock = vi.fn();
vi.mock('../common/safe-fetch.js', async (orig) => {
  const real: any = await orig();
  return { ...real, safeFetchText: (...a: any[]) => fetchMock(...a) };
});

const { CrawlerAnalyticsService, readSitemapLocs, normalizeCoverageUrl, ROBOTS_ONLY_TOKENS } = await import('./crawler-analytics.service.js');

type Reply = { status: number; text?: string; truncated?: boolean; headers?: Record<string, string> };
const res = (url: string, r: Reply): SafeTextResult => ({
  status: r.status, ok: r.status >= 200 && r.status < 300, url, redirected: false, contentType: 'application/xml',
  headers: r.headers ?? {}, text: r.text ?? '', truncated: r.truncated ?? false, binary: false,
});
function serve(map: Record<string, Reply>) {
  fetchMock.mockImplementation(async (url: string) => res(url, map[url] ?? { status: 404 }));
}
const urlset = (n: number, prefix = 'p') => `<?xml version="1.0"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${Array.from({ length: n }, (_, i) => `<url><loc>https://site.com/${prefix}${i}</loc></url>`).join('')}</urlset>`;
const urlsetOf = (locs: string[]) => `<?xml version="1.0"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${locs.map((l) => `<url><loc>${l}</loc></url>`).join('')}</urlset>`;
const index = (children: string[]) => `<?xml version="1.0"?><sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${children.map((c) => `<sitemap><loc>${c}</loc></sitemap>`).join('')}</sitemapindex>`;

const svc = () => new CrawlerAnalyticsService({} as any) as any;

beforeEach(() => { fetchMock.mockReset(); });

describe('readSitemapLocs', () => {
  it('urlset / sitemapindex / tanimsiz belge', () => {
    expect(readSitemapLocs(urlset(2))).toEqual({ kind: 'urlset', locs: ['https://site.com/p0', 'https://site.com/p1'] });
    expect(readSitemapLocs(index(['https://site.com/post-sitemap.xml']))).toEqual({ kind: 'index', locs: ['https://site.com/post-sitemap.xml'] });
    expect(readSitemapLocs('<html><body>404</body></html>')).toEqual({ kind: 'none', locs: [] });
  });
  it('kapanmayan <loc> / CDATA yigini sureci kilitlemez (ReDoS)', () => {
    const t = Date.now();
    readSitemapLocs(`<urlset><loc>${' '.repeat(2_000_000)}x`);
    readSitemapLocs(`<urlset>${'<loc><![CDATA['.repeat(150_000)}`);
    readSitemapLocs(`<urlset>${`<loc>${' '.repeat(3000)}<![CDATA[`.repeat(600)}`);
    expect(Date.now() - t).toBeLessThan(2000);
  });
  it('XML kacislari cozulur, CDATA okunur; image:loc sayfa sayilmaz', () => {
    const xml = `<urlset><url><loc>https://site.com/?p=1&amp;lang=tr</loc><image:image><image:loc>https://site.com/a.jpg</image:loc></image:image></url>`
      + `<url><loc><![CDATA[https://site.com/b?x=1&y=2]]></loc></url><url><loc> https://site.com/c </loc></url></urlset>`;
    expect(readSitemapLocs(xml).locs).toEqual(['https://site.com/?p=1&lang=tr', 'https://site.com/b?x=1&y=2', 'https://site.com/c']);
  });
});

describe('normalizeCoverageUrl', () => {
  const site = new URL('https://www.site.com/');
  it('goreli yol site alan adinda; www / http farki ve sondaki / onemsiz; %-kacis cozulur', () => {
    expect(normalizeCoverageUrl('/blog/a/', site)).toEqual({ path: '/blog/a', query: '' });
    expect(normalizeCoverageUrl('http://site.com/blog/a', site)).toEqual({ path: '/blog/a', query: '' });
    expect(normalizeCoverageUrl('https://WWW.SITE.COM/urun/%c3%a7ay#x', site)).toEqual({ path: '/urun/çay', query: '' });
    expect(normalizeCoverageUrl('https://site.com/urun/çay', site)).toEqual({ path: '/urun/çay', query: '' });
    expect(normalizeCoverageUrl('/', site)).toEqual({ path: '/', query: '' });
    expect(normalizeCoverageUrl('/?p=12', site)).toEqual({ path: '/', query: '?p=12' });
  });
  it('izleme parametreleri atilir, kalan sorgu siralanir', () => {
    expect(normalizeCoverageUrl('/blog/a/?utm_source=x&gclid=1&srsltid=abc', site)).toEqual({ path: '/blog/a', query: '' });
    expect(normalizeCoverageUrl('/urun?b=2&utm_medium=m&a=1', site)).toEqual({ path: '/urun', query: '?a=1&b=2' });
    expect(normalizeCoverageUrl('/?', site)).toEqual({ path: '/', query: '' });
  });
  it('baska alan adi ve gecersiz adres: null', () => {
    expect(normalizeCoverageUrl('https://other.com/blog/a', site)).toBeNull();
    expect(normalizeCoverageUrl('https://blog.site.com/a', site)).toBeNull();
    expect(normalizeCoverageUrl('//evil.com/x', site)).toBeNull();
    expect(normalizeCoverageUrl('javascript:alert(1)', site)).toBeNull();
  });
});

describe('CrawlerAnalyticsService.sitemapPages — sayfa adresleri, alt sitemap adresleri DEGIL', () => {
  const origin = new URL('https://site.com/');
  const pages = async (s: any, url = 'https://site.com/') => s.sitemapPages(url, origin);

  it('duz urlset: <loc> adresleri (ayni adres bir kez, baska alan adi sayilmaz)', async () => {
    serve({ 'https://site.com/sitemap.xml': { status: 200, text: urlsetOf(['https://site.com/a', 'https://site.com/a/', 'https://www.site.com/b', 'https://cdn.other.com/c']) } });
    const r = await pages(svc());
    expect(r.ok).toBe(true);
    expect([...r.keys].sort()).toEqual(['/a', '/b']);
  });

  it('sitemapindex: alt sitemap\'lerdeki sayfalar toplanir (eskiden 2 "sayfa" sayiliyordu)', async () => {
    serve({
      'https://site.com/sitemap.xml': { status: 200, text: index(['https://site.com/post-sitemap.xml', 'https://site.com/page-sitemap.xml']) },
      'https://site.com/post-sitemap.xml': { status: 200, text: urlset(40, 'post') },
      'https://site.com/page-sitemap.xml': { status: 200, text: urlset(7, 'page') },
    });
    const r = await pages(svc(), 'https://site.com');
    expect(r.ok && r.keys.size).toBe(47);
  });

  it('bir alt sitemap okunamazsa liste eksik: oran hesaplanmaz (kismi liste orani sisirirdi)', async () => {
    serve({
      'https://site.com/sitemap.xml': { status: 200, text: index(['https://site.com/a.xml', 'https://site.com/b.xml']) },
      'https://site.com/a.xml': { status: 200, text: urlset(10) },
    });
    expect(await pages(svc(), 'https://site.com')).toMatchObject({ ok: false, reason: 'sitemap_incomplete' });
  });

  it('kesik belge → eksik; cok fazla alt sitemap → cok buyuk (alt belgelere gidilmez); okunamayan kok → yok', async () => {
    serve({ 'https://site.com/sitemap.xml': { status: 200, text: urlset(5), truncated: true } });
    expect(await pages(svc(), 'https://site.com')).toMatchObject({ ok: false, reason: 'sitemap_incomplete' });

    const many = Array.from({ length: 26 }, (_, i) => `https://site.com/s${i}.xml`);
    serve({ 'https://site.com/sitemap.xml': { status: 200, text: index(many) } });
    expect(await pages(svc(), 'https://site.com')).toMatchObject({ ok: false, reason: 'sitemap_too_large' });
    expect(fetchMock).toHaveBeenCalledTimes(2); // alt sitemap'lere gidilmedi

    serve({ 'https://site.com/sitemap.xml': { status: 404, text: 'yok' } });
    expect(await pages(svc(), 'https://site.com')).toMatchObject({ ok: false, reason: 'sitemap_unavailable' });
    serve({ 'https://site.com/sitemap.xml': { status: 200, text: '<html>ana sayfa</html>' } });
    expect(await pages(svc(), 'https://site.com')).toMatchObject({ ok: false, reason: 'sitemap_unavailable' });
  });

  it('engel sayfasi "sitemap yok" sayilmaz: erisim engellendi olarak nedeniyle doner', async () => {
    serve({ 'https://site.com/sitemap.xml': { status: 403, headers: { server: 'cloudflare', 'cf-ray': 'x' }, text: 'Sorry, you have been blocked' } });
    const r = await pages(svc(), 'https://site.com');
    expect(r).toMatchObject({ ok: false, reason: 'sitemap_blocked' });
    expect(r.text).toContain('Cloudflare');
  });

  it('sonuc onbellekte: panel her acildiginda site yeniden taranmaz', async () => {
    serve({ 'https://site.com/sitemap.xml': { status: 200, text: urlset(3) } });
    const s = svc();
    await pages(s, 'https://site.com');
    await pages(s, 'https://site.com');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('CrawlerAnalyticsService.getHistory — kapsam = |ziyaret ∩ sitemap| / |sitemap|', () => {
  type Hit = { bot: string; date: Date; hits: number; uniqueUrls: number; topUrls: Array<{ url: string; count: number }> };
  function history(hitsRows: Hit[], eventPaths: string[], siteUrl: string | null = 'https://www.site.com', days = 30) {
    const groupByEvents = vi.fn(async () => eventPaths.map((path) => ({ path })));
    const prisma = {
      aiCrawlerHit: {
        findMany: vi.fn(async () => hitsRows),
        groupBy: vi.fn(async () => hitsRows.map((h) => ({ bot: h.bot, _min: { date: h.date } }))),
      },
      crawlerHitEvent: { groupBy: groupByEvents },
      site: { findUnique: vi.fn(async () => (siteUrl ? { url: siteUrl } : null)) },
    };
    const run = new CrawlerAnalyticsService(prisma as any).getHistory('s1', days) as Promise<any>;
    return { run, groupByEvents };
  }
  const day = new Date('2026-10-15');
  const SITEMAP = urlsetOf(['https://site.com/blog/a', 'https://site.com/blog/b/', 'https://site.com/blog/c', 'https://site.com/urun/çay', 'https://site.com/hakkimizda']);

  it('robots.txt / feed / wp-json / baska alan adi paya girmez; sondaki / ve sorgu farki eslesir; edge yollari sayilir', async () => {
    serve({ 'https://www.site.com/sitemap.xml': { status: 200, text: SITEMAP } });
    const { run, groupByEvents } = history([
      { bot: 'GPTBot', date: day, hits: 9, uniqueUrls: 6, topUrls: [
        { url: '/robots.txt', count: 3 }, { url: '/feed/', count: 2 }, { url: '/wp-json/wp/v2/posts', count: 1 },
        { url: '/blog/a/', count: 1 }, { url: 'https://www.site.com/blog/b?utm_source=x', count: 1 }, { url: 'https://other.com/blog/c', count: 1 },
      ] },
    ], ['/blog/c', '/urun/%C3%A7ay', '/robots.txt']);
    const r = await run;
    expect(r.coverage).toEqual({
      uniquePathsVisited: 7, // /robots.txt /feed /wp-json/... /blog/a /blog/b /blog/c /urun/çay
      sitePagesTotal: 5,
      sitemapPagesVisited: 4, // a, b, c, çay — /hakkimizda ziyaret edilmedi
      pagesCrawledPct: 80,
      partial: false,
      unavailableReason: null,
      unavailableText: null,
    });
    // Ham yollar pencere icinden ve robots-only belirtecler haric okunur
    const where = (groupByEvents.mock.calls[0] as any[])[0].where;
    expect(where.siteId).toBe('s1');
    expect(where.bot).toEqual({ notIn: ['Google-Extended'] });
    expect(where.ts.gte).toBeInstanceOf(Date);
  });

  it('eski formulun "%100"u: tum ziyaretler sitemap disindaysa kapsam %0 ("/?s=ara" ana sayfa sayilmaz)', async () => {
    serve({ 'https://www.site.com/sitemap.xml': { status: 200, text: urlsetOf(['https://site.com/', 'https://site.com/blog/a', 'https://site.com/hakkimizda']) } });
    const { run } = history([
      { bot: 'GPTBot', date: day, hits: 8, uniqueUrls: 5, topUrls: ['/robots.txt', '/feed', '/wp-json', '/sitemap.xml', '/?s=ara'].map((url) => ({ url, count: 1 })) },
    ], []);
    const r = await run;
    // Eski formul: 5 tekil yol / 3 sayfa → %100'e kirpiliyordu
    expect(r.coverage).toMatchObject({ uniquePathsVisited: 5, sitePagesTotal: 3, sitemapPagesVisited: 0, pagesCrawledPct: 0 });
  });

  it('topUrls gunluk ilk 10 ile sinirliysa oran "en az" (partial)', async () => {
    serve({ 'https://www.site.com/sitemap.xml': { status: 200, text: SITEMAP } });
    const { run } = history([
      { bot: 'ClaudeBot', date: day, hits: 40, uniqueUrls: 25, topUrls: [{ url: '/blog/a', count: 10 }] },
    ], []);
    expect((await run).coverage).toMatchObject({ sitemapPagesVisited: 1, pagesCrawledPct: 20, partial: true });
  });

  it('saklama suresinden uzun pencerede edge yollari eksik: partial', async () => {
    serve({ 'https://www.site.com/sitemap.xml': { status: 200, text: SITEMAP } });
    const { run } = history([], ['/blog/a'], 'https://www.site.com', 90);
    expect((await run).coverage).toMatchObject({ sitemapPagesVisited: 1, partial: true });
  });

  it('sitemap okunamazsa oran null + neden; ziyaret yoksa sitemap hic indirilmez', async () => {
    serve({ 'https://www.site.com/sitemap.xml': { status: 404 } });
    const a = await history([{ bot: 'GPTBot', date: day, hits: 1, uniqueUrls: 1, topUrls: [{ url: '/blog/a', count: 1 }] }], []).run;
    expect(a.coverage).toMatchObject({ uniquePathsVisited: 1, sitePagesTotal: null, sitemapPagesVisited: null, pagesCrawledPct: null, unavailableReason: 'sitemap_unavailable' });
    expect(a.coverage.unavailableText).toContain('/sitemap.xml');

    fetchMock.mockClear();
    const b = await history([], []).run;
    expect(b.coverage).toMatchObject({ uniquePathsVisited: 0, pagesCrawledPct: null, unavailableReason: 'no_visits' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('sitemap\'te bu alan adina ait sayfa yoksa: toplam 0, oran null, neden sitemap_empty', async () => {
    serve({ 'https://www.site.com/sitemap.xml': { status: 200, text: urlsetOf(['https://staging.example.com/a']) } });
    const r = await history([{ bot: 'GPTBot', date: day, hits: 1, uniqueUrls: 1, topUrls: [{ url: '/a', count: 1 }] }], []).run;
    expect(r.coverage).toMatchObject({ sitePagesTotal: 0, pagesCrawledPct: null, unavailableReason: 'sitemap_empty' });
  });

  it('gecersiz days (NaN) varsayilan 30 gune duser', async () => {
    const r = await history([], [], 'https://www.site.com', Number.NaN).run;
    expect(r.days).toBe(30);
  });
});

describe('Google-Extended — yalniz robots.txt belirteci, ziyaret takibine girmez', () => {
  // Google: "Google-Extended doesn't have a separate HTTP request user agent string."
  // https://developers.google.com/search/docs/crawling-indexing/google-common-crawlers
  const line = (ua: string) => `66.249.66.1 - - [15/Oct/2026:10:00:00 +0000] "GET /blog/a HTTP/1.1" 200 512 "-" "${ua}"`;

  it('gercek Google taramasi Googlebot sayilir; "Google-Extended" iceren (taklit) ajan bot listesine girmez', () => {
    const s = svc();
    const entries = s.parseApacheLog([
      line('Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)'),
      line('Mozilla/5.0 (compatible; Google-Extended/1.0)'),
    ].join('\n'));
    expect(entries).toHaveLength(2);
    const summary = s.summarize(entries);
    expect([...summary.keys()]).toEqual(['Googlebot']);
    expect(summary.get('Googlebot').hits).toBe(1);
    expect(ROBOTS_ONLY_TOKENS.has('Google-Extended')).toBe(true);
  });

  it('gecmis: robots-only satirlar sorguda elenir; registry\'de Google-Extended yok', async () => {
    const findMany = vi.fn(async () => [
      { bot: 'GPTBot', date: new Date('2026-10-15'), hits: 3, topUrls: [{ url: '/a', count: 3 }] },
    ]);
    const groupBy = vi.fn(async () => [{ bot: 'GPTBot', _min: { date: new Date('2026-10-01') } }]);
    const prisma = { aiCrawlerHit: { findMany, groupBy }, crawlerHitEvent: { groupBy: vi.fn(async () => []) }, site: { findUnique: vi.fn(async () => null) } };
    const r: any = await new CrawlerAnalyticsService(prisma as any).getHistory('s1', 30);
    expect((findMany.mock.calls[0] as any[])[0].where.bot).toEqual({ notIn: ['Google-Extended'] });
    expect((groupBy.mock.calls[0] as any[])[0].where.bot).toEqual({ notIn: ['Google-Extended'] });
    expect(r.registry['Google-Extended']).toBeUndefined();
    expect(r.registry.Googlebot).toMatchObject({ category: 'classic-search' });
    expect(r.totalHits).toBe(3);
    expect(r.byCategory.training).toBe(3);
  });
});
