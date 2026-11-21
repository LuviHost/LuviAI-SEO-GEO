import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { googleDirectives, excludedFromGoogleAi } from './google-ai-eligibility.js';
import { AuditChecksService, OVERALL_SCORE_WEIGHTS, GOOGLE_AI_PAGE_BLOCK_FLOOR } from './audit-checks.service.js';
import { SiteCrawlerService } from '../sites/site-crawler.service.js';
import { makeSafeTextFetch } from '../common/safe-fetch.js';
import { bulguMetni, kontrolMetni, aksiyonMetni } from '../client-report/client-report-texts.js';

/**
 * Google AI cevaplarina uygunluk (21.11.2026).
 *
 * NEDEN VAR: AI Bakisi ve AI Modu'nu olcuyoruz ama sayfanin kendini bu iki
 * yuzeye kapatip kapatmadigina bakmiyorduk. Google'in iki belgesi:
 *  - "AI features and your website": kaynak olmanin tek teknik sarti dizinde
 *    ve snippet ile gosterilebilir olmak.
 *  - "Robots meta tag": nosnippet (ve max-snippet:0) icerigi AI Bakisi /
 *    AI Modu'na dogrudan girdi olmaktan da cikarir; max-snippet:N girdiyi
 *    sinirlar; meta adlari robots + googlebot; X-Robots-Tag oneksiz ya da
 *    "googlebot:" onekli.
 * Bing etiketleri (NoArchive / NoCache / ai-grounding) bu kontrolde YOK.
 */

const sig = (metas: Array<[string, string]>, header: string | null = null) => ({
  metas: metas.map(([name, content]) => ({ name, content })),
  header,
});

describe('googleDirectives — Google icin gecerli yonergeler', () => {
  it('meta robots ve googlebot okunur; bingbot ve diger adlar yok sayilir', () => {
    expect(googleDirectives(sig([['robots', 'noindex, follow']])).noindex).toBe(true);
    expect(googleDirectives(sig([['googlebot', 'nosnippet']])).nosnippet).toBe(true);
    const bing = googleDirectives(sig([['bingbot', 'noindex, nosnippet'], ['robots', 'noarchive, nocache']]));
    expect(excludedFromGoogleAi(bing)).toBe(false);
    expect(bing.sources).toEqual([]);
  });

  it('none = noindex; max-snippet:0 = nosnippet; -1 sinir degil', () => {
    expect(googleDirectives(sig([['robots', 'NONE']])).noindex).toBe(true);
    const zero = googleDirectives(sig([['robots', 'max-snippet:0']]));
    expect(zero.nosnippet).toBe(true);
    expect(zero.maxSnippet).toBeNull();
    const open = googleDirectives(sig([['robots', 'max-snippet:-1, max-image-preview:large']]));
    expect(excludedFromGoogleAi(open)).toBe(false);
    expect(open.maxSnippet).toBeNull();
  });

  it('pozitif max-snippet sinir olarak tasinir; celisende kucuk olan gecerli', () => {
    const d = googleDirectives(sig([['robots', 'max-snippet:160'], ['googlebot', 'max-snippet:50']]));
    expect(d.maxSnippet).toBe(50);
    expect(excludedFromGoogleAi(d)).toBe(false);
  });

  it('X-Robots-Tag: oneksiz ve googlebot onekli uygulanir, baska bot oneki uygulanmaz', () => {
    expect(googleDirectives(sig([], 'noindex')).noindex).toBe(true);
    expect(googleDirectives(sig([], 'googlebot: nosnippet')).nosnippet).toBe(true);
    const other = googleDirectives(sig([], 'bingbot: noindex, nosnippet'));
    expect(excludedFromGoogleAi(other)).toBe(false);
    // Onek bir sonraki onege kadar gecerli
    const mixed = googleDirectives(sig([], 'otherbot: noindex, googlebot: nosnippet'));
    expect(mixed.noindex).toBe(false);
    expect(mixed.nosnippet).toBe(true);
    expect(mixed.sources).toEqual(['X-Robots-Tag (googlebot): nosnippet']);
    // max-snippet:N bot oneki sanilmaz
    expect(googleDirectives(sig([], 'max-snippet:0')).nosnippet).toBe(true);
  });
});

const sayfa = (url: string, robotsSignals?: unknown) => ({
  url, title: 'Yeterince uzun bir sayfa basligi burada', metaDescription: 'x'.repeat(120), h1: 'H', h2s: [], textSample: '',
  ogTags: {}, twitterTags: {}, canonical: url, hreflangs: [], jsonLdBlocks: [], schemaTypes: [], lang: 'tr',
  imageAltStats: { total: 0, withAlt: 0, emptyAlt: 0, absent: 0, ariaDecorative: 0, suspicious: 0, excluded: 0 },
  images: [], imagesCapped: false, outboundLinks: [],
  ...(robotsSignals ? { robotsSignals } : {}),
}) as any;

const tarama = (pages: any[]) => ({ baseUrl: 'https://site.com', pages, sitemapUrl: null, robotsTxt: null, llmsTxt: null, totalPages: pages.length }) as any;
const kontrol = async (pages: any[]) =>
  (await new AuditChecksService().runAllChecks(tarama(pages))).find((c) => c.id === 'google_ai_eligibility')!;

describe('google_ai_eligibility — denetim kontrolu', () => {
  it('genel skora girer', () => {
    expect(OVERALL_SCORE_WEIGHTS.google_ai_eligibility).toBeGreaterThan(0);
  });

  it('yonerge yoksa 100, sorun yok', async () => {
    const c = await kontrol([sayfa('https://site.com/', sig([['robots', 'index, follow']])), sayfa('https://site.com/a', sig([]))]);
    expect(c.score).toBe(100);
    expect(c.valid).toBe(true);
    expect(c.issues).toEqual([]);
    expect(c.details?.checkedPages).toBe(2);
  });

  it('anasayfa noindex: kritik, 0 puan, sayfa adresi sorunda', async () => {
    const c = await kontrol([sayfa('https://site.com/', sig([['robots', 'noindex']])), sayfa('https://site.com/a', sig([]))]);
    expect(c.score).toBe(0);
    expect(c.issues).toHaveLength(1);
    expect(c.issues[0]).toMatchObject({ severity: 'critical', type: 'google_home_noindex', page: 'https://site.com/' });
  });

  it('anasayfa X-Robots-Tag nosnippet: kritik, 0 puan', async () => {
    const c = await kontrol([sayfa('https://site.com/', sig([], 'nosnippet'))]);
    expect(c.score).toBe(0);
    expect(c.issues[0]).toMatchObject({ severity: 'critical', type: 'google_home_nosnippet' });
    expect(c.issues[0].description).toContain('X-Robots-Tag: nosnippet');
  });

  it('anasayfa max-snippet:N yalniz bilgi, puan dusmez', async () => {
    const c = await kontrol([sayfa('https://site.com/', sig([['robots', 'max-snippet:50']]))]);
    expect(c.score).toBe(100);
    expect(c.issues[0]).toMatchObject({ severity: 'info', type: 'google_home_max_snippet' });
    expect(c.details?.homeMaxSnippet).toBe(50);
  });

  it('diger sayfalarda nosnippet uyari ve puan payla duser (taban); noindex yalniz bilgi', async () => {
    const pages = [
      sayfa('https://site.com/', sig([])),
      sayfa('https://site.com/a', sig([['robots', 'nosnippet']])),
      sayfa('https://site.com/b', sig([])),
      sayfa('https://site.com/giris', sig([['robots', 'noindex']])),
      sayfa('https://site.com/c', sig([])),
    ];
    const c = await kontrol(pages);
    expect(c.score).toBe(Math.round(100 - 60 * (1 / 4)));
    expect(c.issues.map((i) => [i.type, i.severity])).toEqual([['google_pages_nosnippet', 'warning'], ['google_pages_noindex', 'info']]);
    expect(c.details?.nosnippetPages).toEqual(['https://site.com/a']);
    expect(c.details?.noindexPages).toEqual(['https://site.com/giris']);

    const hepsi = await kontrol([sayfa('https://site.com/', sig([])), sayfa('https://site.com/a', sig([['robots', 'nosnippet']]))]);
    expect(hepsi.score).toBe(GOOGLE_AI_PAGE_BLOCK_FLOOR);
  });

  it('yonergesi okunmamis tarama (eski tarayici) hukum vermez: dogrulanamadi, sorun yok', async () => {
    const c = await kontrol([sayfa('https://site.com/'), sayfa('https://site.com/a')]);
    expect(c.details?.unverified).toBe(true);
    expect(c.issues).toEqual([]);
  });

  it('musteri raporunda her sorun tipinin cumlesi ve aksiyonu var', () => {
    for (const tip of ['google_home_noindex', 'google_home_nosnippet', 'google_home_max_snippet', 'google_pages_nosnippet', 'google_pages_noindex']) {
      expect(bulguMetni(tip, { details: { homeMaxSnippet: 50, nosnippetCount: 3, noindexCount: 2 }, description: '' }), tip).toBeTruthy();
      expect(aksiyonMetni('google_ai_eligibility', tip)?.baslik, tip).toBeTruthy();
    }
    expect(bulguMetni('google_pages_nosnippet', { details: { nosnippetCount: 3 }, description: '' })).toContain('3 sayfa');
    expect(kontrolMetni('google_ai_eligibility').ad).toBe('Google AI cevaplarına uygunluk');
  });

  it('rapor metninde "snippet" yalniz yonerge adi olarak gecer (client-report-dil YASAK kurali)', () => {
    const b = { details: { homeMaxSnippet: 50, nosnippetCount: 3, noindexCount: 2 }, description: '' };
    const k = kontrolMetni('google_ai_eligibility');
    const metinler = [k.neden, k.oneri];
    for (const tip of ['google_home_noindex', 'google_home_nosnippet', 'google_home_max_snippet', 'google_pages_nosnippet', 'google_pages_noindex']) {
      metinler.push(bulguMetni(tip, b)!, aksiyonMetni('google_ai_eligibility', tip)!.baslik);
    }
    for (const m of metinler) expect(m.replace(/(data-no|no|max-)snippet/g, ''), m).not.toMatch(/snippet/i);
    // Her raporda gorunen genel metin yonerge adi da tasimaz
    expect(`${k.neden} ${k.oneri}`).not.toMatch(/snippet/i);
  });
});

describe('crawler — robots meta ve X-Robots-Tag', () => {
  let server: http.Server;
  let base = '';
  beforeAll(async () => {
    server = http.createServer((req, res) => {
      const path = (req.url ?? '/').split('?')[0];
      if (path === '/') {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'x-robots-tag': 'googlebot: nosnippet' });
        res.end('<html><head><title>Ana</title><meta name="robots" content="max-snippet:-1"><meta name="bingbot" content="noarchive"><meta name="description" content="d"></head><body><a href="/a">a</a></body></html>');
        return;
      }
      if (path === '/a') {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        res.end('<html><head><title>A</title><meta name="GoogleBot" content="noindex"></head><body>a</body></html>');
        return;
      }
      res.writeHead(404); res.end();
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(() => new Promise<void>((r) => server.close(() => r())));

  it('her sayfada Google meta adlari ve baslik saklanir; denetim anasayfa yasagini bulur', async () => {
    const crawl = await new SiteCrawlerService(makeSafeTextFetch({ isBlocked: () => false, allowAnyPort: true })).crawl(base, 5);
    const home = crawl.pages.find((p) => p.url === `${base}/`)!;
    expect(home.robotsSignals).toEqual({ metas: [{ name: 'robots', content: 'max-snippet:-1' }], header: 'googlebot: nosnippet' });
    const a = crawl.pages.find((p) => p.url === `${base}/a`)!;
    expect(a.robotsSignals).toEqual({ metas: [{ name: 'googlebot', content: 'noindex' }], header: null });

    const c = (await new AuditChecksService().runAllChecks(crawl)).find((x) => x.id === 'google_ai_eligibility')!;
    expect(c.issues.map((i) => i.type)).toEqual(['google_home_nosnippet', 'google_pages_noindex']);
    expect(c.score).toBe(0);
  });
});
