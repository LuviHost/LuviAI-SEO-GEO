import 'reflect-metadata';
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { Test } from '@nestjs/testing';
import { makeSafeTextFetch, safeFetchText, type SafeTextResult } from '../common/safe-fetch.js';
import { SiteCrawlerService } from './site-crawler.service.js';

/**
 * Tarayici: engel siniflandirmasi, RanksUpBot robots grubu, kibar durma.
 *
 * NEDEN VAR: ofsayt.com Cloudflare arkasinda tarayiciya 403 "Sorry, you have
 * been blocked" donuyordu; eski kod sayfayi "yok" sayiyor, engel sayfasini
 * site sanip 44 puan uretiyordu. Artik engel "blocked" olarak kayda gecer,
 * neden + izin talimatiyla birlikte; anasayfa engelliyse tarama durur.
 */

const CF_BLOCK = '<!DOCTYPE html><html><head><title>Attention Required! | Cloudflare</title></head><body><h1>Sorry, you have been blocked</h1><span>Cloudflare Ray ID: abc</span></body></html>';
const HTML = { 'content-type': 'text/html; charset=utf-8' };

type Handler = (req: http.IncomingMessage, res: http.ServerResponse) => void;
let server: http.Server;
let base = '';
let istekler: string[] = [];
let handler: Handler;
const yok: Handler = (_req, res) => { res.writeHead(404, HTML); res.end('yok'); };

beforeAll(async () => {
  server = http.createServer((req, res) => {
    istekler.push((req.url ?? '').replace(/[?&]_rc=\d+/, ''));
    handler(req, res);
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));
afterEach(() => { istekler = []; handler = yok; });

/** Yalnizca test: yerel sunucu 127.0.0.1'de ve rastgele portta */
const crawler = () => new SiteCrawlerService(makeSafeTextFetch({ isBlocked: () => false, allowAnyPort: true }));
const yol = (req: http.IncomingMessage) => (req.url ?? '').split('?')[0];
const sayfa = (title: string, body = '') => `<html><head><title>${title}</title></head><body>${body}</body></html>`;

describe('anasayfa engelliyse tarama durur, puan icin veri uretilmez', () => {
  it('Cloudflare 403: "blocked/waf", neden + RanksUpBot izin talimati; baska istek atilmaz', async () => {
    handler = (_req, res) => { res.writeHead(403, { ...HTML, server: 'cloudflare', 'cf-ray': '1' }); res.end(CF_BLOCK); };
    const r = await crawler().crawl(base, 30);

    expect(r.homeAccess).toMatchObject({ state: 'blocked', kind: 'waf', vendor: 'cloudflare', status: 403 });
    expect(r.homeAccess!.reason).toContain('Cloudflare');
    expect(r.homeAccess!.hint).toContain('RanksUpBot');
    expect(r.pages).toHaveLength(0);
    expect(r.blockedPages).toHaveLength(1);
    // robots.txt + anasayfa — arkasinda 30 sayfa denenmez
    expect(istekler).toEqual(['/robots.txt', '/']);
  });

  it('200 donen bot dogrulama ekrani da engeldir (icerik sanilmaz)', async () => {
    handler = (req, res) => {
      if (yol(req) === '/robots.txt') return yok(req, res);
      res.writeHead(200, { ...HTML, server: 'cloudflare', 'cf-mitigated': 'challenge' });
      res.end('<html><head><title>Just a moment...</title></head><body></body></html>');
    };
    const r = await crawler().crawl(base, 30);
    expect(r.homeAccess).toMatchObject({ state: 'blocked', kind: 'challenge' });
    expect(r.pages).toHaveLength(0);
  });

  it('anasayfa 500: "unreachable/http_error"; denetim modunda (stopIfHomeUnreadable) durur', async () => {
    handler = (req, res) => {
      if (yol(req) === '/') { res.writeHead(500, HTML); res.end('hata'); return; }
      if (yol(req) === '/sitemap.xml') { res.writeHead(200, { 'content-type': 'application/xml' }); res.end(`<urlset><url><loc>${base}/a</loc></url></urlset>`); return; }
      if (yol(req) === '/a') { res.writeHead(200, HTML); res.end(sayfa('A')); return; }
      yok(req, res);
    };
    const denetim = await crawler().crawl(base, 30, { stopIfHomeUnreadable: true });
    expect(denetim.homeAccess).toMatchObject({ state: 'unreachable', kind: 'http_error', status: 500 });
    expect(denetim.pages).toHaveLength(0);
    expect(istekler).not.toContain('/sitemap.xml');

    istekler = [];
    // Marka beyni gibi cagiranlar sitemap'teki sayfalarla devam edebilir
    const beyin = await crawler().crawl(base, 30);
    expect(beyin.homeAccess?.status).toBe(500);
    expect(beyin.pages.map((p) => p.url)).toEqual([`${base}/a`]);
  });
});

describe('RanksUpBot robots.txt grubu', () => {
  it('"User-agent: RanksUpBot / Disallow: /" → anasayfa hic istenmez, neden robots', async () => {
    handler = (req, res) => {
      if (yol(req) === '/robots.txt') { res.writeHead(200, { 'content-type': 'text/plain' }); res.end('User-agent: RanksUpBot\nDisallow: /\n'); return; }
      res.writeHead(200, HTML); res.end(sayfa('Gizli'));
    };
    const r = await crawler().crawl(base, 30);
    expect(r.homeAccess).toMatchObject({ state: 'blocked', kind: 'robots' });
    expect(r.homeAccess!.hint).toContain('User-agent: RanksUpBot');
    expect(istekler).toEqual(['/robots.txt']);
  });

  it('"*" grubu uygulanmaz — tarama surer', async () => {
    handler = (req, res) => {
      if (yol(req) === '/robots.txt') { res.writeHead(200, { 'content-type': 'text/plain' }); res.end('User-agent: *\nDisallow: /\n'); return; }
      if (yol(req) === '/') { res.writeHead(200, HTML); res.end(sayfa('Ana')); return; }
      yok(req, res);
    };
    const r = await crawler().crawl(base, 30);
    expect(r.homeAccess).toBeNull();
    expect(r.ranksUpBotGroup).toBe(false);
    expect(r.pages.map((p) => p.title)).toEqual(['Ana']);
  });

  it('yasakli yol istenmez; engelli sayfa "blocked" olarak kaydedilir, eksik sayilmaz', async () => {
    handler = (req, res) => {
      const p = yol(req);
      if (p === '/robots.txt') { res.writeHead(200, { 'content-type': 'text/plain' }); res.end('User-agent: RanksUpBot\nDisallow: /gizli\n'); return; }
      if (p === '/') { res.writeHead(200, HTML); res.end(sayfa('Ana', '<a href="/a">a</a><a href="/gizli">g</a><a href="/korumali">k</a>')); return; }
      if (p === '/a') { res.writeHead(200, HTML); res.end(sayfa('A')); return; }
      if (p === '/korumali') { res.writeHead(403, { ...HTML, server: 'cloudflare', 'cf-ray': '1' }); res.end(CF_BLOCK); return; }
      if (p === '/gizli') { res.writeHead(200, HTML); res.end(sayfa('Gizli')); return; }
      yok(req, res);
    };
    const r = await crawler().crawl(base, 30);

    expect(r.homeAccess).toBeNull();
    expect(r.ranksUpBotGroup).toBe(true);
    expect(istekler, 'robots.txt RanksUpBot\'a yasakladigi yol istenmis').not.toContain('/gizli');
    expect(r.robotsDisallowed).toEqual([`${base}/gizli`]);
    expect(r.pages.map((p) => p.title).sort()).toEqual(['A', 'Ana']);
    expect(r.blockedPages).toHaveLength(1);
    expect(r.blockedPages![0]).toMatchObject({ kind: 'waf', url: `${base}/korumali` });
  });
});

describe('kok dosyalar: engelli olan "yok" degildir', () => {
  it('robots.txt WAF ile engelli → robots "blocked", llms 404 → "missing"', async () => {
    handler = (req, res) => {
      const p = yol(req);
      if (p === '/robots.txt') { res.writeHead(403, { ...HTML, server: 'cloudflare', 'cf-ray': '1' }); res.end(CF_BLOCK); return; }
      if (p === '/') { res.writeHead(200, HTML); res.end(sayfa('Ana')); return; }
      yok(req, res);
    };
    const r = await crawler().crawl(base, 5);
    expect(r.robotsTxt).toBeNull();
    expect(r.resources?.robots.state).toBe('blocked');
    expect(r.resources?.robots.access?.hint).toContain('RanksUpBot');
    expect(r.resources?.llms.state).toBe('missing');
    expect(r.resources?.sitemap.state).toBe('missing');
  });

  it('SPA\'nin her yola dondugu HTML robots.txt / llms.txt sayilmaz', async () => {
    handler = (_req, res) => { res.writeHead(200, HTML); res.end('<!doctype html><html><head><title>SPA</title></head><body><div id="root"></div></body></html>'); };
    const r = await crawler().crawl(base, 1);
    expect(r.robotsTxt).toBeNull();
    expect(r.llmsTxt).toBeNull();
    expect(r.resources?.robots.state).toBe('missing');
  });
});

describe('bot korumasi devreye girince tarama kibarca durur', () => {
  it('429 alinan partiden sonra yeni sayfa istenmez', async () => {
    const yollar = Array.from({ length: 12 }, (_, i) => `/p${i}`);
    handler = (req, res) => {
      const p = yol(req);
      if (p === '/sitemap.xml') {
        res.writeHead(200, { 'content-type': 'application/xml' });
        res.end(`<urlset>${yollar.map((y) => `<url><loc>${base}${y}</loc></url>`).join('')}</urlset>`);
        return;
      }
      if (p === '/p2') { res.writeHead(429, HTML); res.end('yavas'); return; }
      if (p === '/' || /^\/p\d+$/.test(p)) { res.writeHead(200, HTML); res.end(sayfa(p)); return; }
      yok(req, res);
    };
    const r = await crawler().crawl(base, 30);
    expect(r.stoppedEarly).toContain('429');
    // Ilk parti: anasayfa + p0..p3; p4 ve sonrasi istenmemeli
    expect(istekler).not.toContain('/p4');
    expect(istekler).not.toContain('/p11');
    expect(r.blockedPages!.map((b) => b.kind)).toEqual(['rate_limited']);
    // Durduktan sonra llms.txt icin de istek atilmaz; "yok" degil "kontrol edilmedi"
    expect(istekler).not.toContain('/llms.txt');
    expect(r.resources?.llms.state).toBe('error');
  });
});

/**
 * Sahte getirici — yonlendirme sonucu (res.url) taklit edilir. Yerel sunucuyla
 * www'li ad uretilemedigi icin bu senaryo boyle sinanir.
 */
function sahteGetirici(sayfalar: Record<string, { status?: number; url?: string; text: string; type?: string }>) {
  const istenen: string[] = [];
  const fetcher = async (raw: string): Promise<SafeTextResult> => {
    istenen.push(raw);
    const key = raw.replace(/[?&]_rc=\d+$/, '');
    const s = sayfalar[key];
    const status = s?.status ?? (s ? 200 : 404);
    return {
      status,
      ok: status >= 200 && status < 300,
      url: s?.url ?? raw,
      redirected: !!s?.url,
      contentType: s?.type ?? 'text/html',
      headers: { 'content-type': s?.type ?? 'text/html' },
      text: s?.text ?? 'yok',
      truncated: false,
      binary: false,
    };
  };
  return { fetcher, istenen };
}

describe('ornek.com → www.ornek.com yonlendirmesi', () => {
  it('sayfa adresleri ve ic linkler tek kokte birlesir (orphan analizi dogru eslesir)', async () => {
    const { fetcher } = sahteGetirici({
      'https://ornek.com/': {
        url: 'https://www.ornek.com/',
        text: sayfa('Ana', '<a href="https://www.ornek.com/a">a</a><a href="/b">b</a><a href="https://baska.com/x">dis</a>'),
      },
      'https://www.ornek.com/a': { text: sayfa('A', '<a href="https://ornek.com/b">b</a>') },
      'https://www.ornek.com/b': { text: sayfa('B', '<a href="/">ana</a>') },
    });
    const r = await new SiteCrawlerService(fetcher).crawl('https://ornek.com', 10);

    expect(r.baseUrl).toBe('https://www.ornek.com');
    expect(r.pages.map((p) => p.url).sort()).toEqual(['https://www.ornek.com/', 'https://www.ornek.com/a', 'https://www.ornek.com/b']);
    const ana = r.pages.find((p) => p.title === 'Ana')!;
    expect(ana.outboundLinks).toContain('https://www.ornek.com/a');
    expect(ana.outboundLinks).toContain('https://www.ornek.com/b');
    expect(ana.outboundLinks.some((l) => l.includes('baska.com'))).toBe(false);
    // www'suz yazilmis ic link de ayni koke cekildi
    expect(r.pages.find((p) => p.title === 'A')!.outboundLinks).toEqual(['https://www.ornek.com/b']);
  });

  it('sitemap\'teki baska alan adina ait adresler bu sitenin sayfasi sayilmaz', async () => {
    const { fetcher, istenen } = sahteGetirici({
      'https://ornek.com/': { text: sayfa('Ana') },
      'https://ornek.com/sitemap.xml': {
        type: 'application/xml',
        text: '<urlset><url><loc>https://ornek.com/a</loc></url><url><loc>https://rakip.com/x</loc></url></urlset>',
      },
      'https://ornek.com/a': { text: sayfa('A') },
    });
    const r = await new SiteCrawlerService(fetcher).crawl('https://ornek.com', 10);
    expect(r.pages.map((p) => p.url).sort()).toEqual(['https://ornek.com/', 'https://ornek.com/a']);
    expect(istenen.some((u) => u.includes('rakip.com'))).toBe(false);
  });

  it('RanksUpBot sorgulu adresleri yasakliyorsa onbellek kirma parametresi eklenmez', async () => {
    const { fetcher, istenen } = sahteGetirici({
      'https://ornek.com/robots.txt': { type: 'text/plain', text: 'User-agent: RanksUpBot\nDisallow: /*?\n' },
      'https://ornek.com/': { text: sayfa('Ana') },
    });
    await new SiteCrawlerService(fetcher).crawl('https://ornek.com', 1);
    const sonrakiler = istenen.filter((u) => !u.includes('/robots.txt'));
    expect(sonrakiler.length).toBeGreaterThan(0);
    expect(sonrakiler.some((u) => u.includes('_rc=')), sonrakiler.join(', ')).toBe(false);
  });
});

describe('buyuk sitemap', () => {
  it('50.000 URL\'lik sitemap hizla islenir (tekillestirme dogrusal)', async () => {
    const locs = Array.from({ length: 50_000 }, (_, i) => `<url><loc>https://ornek.com/s/${i}</loc></url>`).join('');
    const { fetcher } = sahteGetirici({
      'https://ornek.com/': { text: sayfa('Ana') },
      'https://ornek.com/sitemap.xml': { type: 'application/xml', text: `<urlset>${locs}</urlset>` },
    });
    const t0 = Date.now();
    const r = await new SiteCrawlerService(fetcher).crawl('https://ornek.com', 1);
    expect(r.totalPages).toBe(50_000);
    expect(Date.now() - t0, 'sitemap isleme cok yavas').toBeLessThan(5000);
  });
});

describe('Nest DI', () => {
  it('istege bagli getirici kayitli degilse uretimdeki SSRF korumali safeFetchText kullanilir', async () => {
    const mod = await Test.createTestingModule({ providers: [SiteCrawlerService] }).compile();
    expect((mod.get(SiteCrawlerService) as any).fetchText).toBe(safeFetchText);
  });
});
