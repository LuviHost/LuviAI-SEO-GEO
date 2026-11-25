import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { SiteCrawlerService } from './site-crawler.service.js';
import { makeSafeTextFetch } from '../common/safe-fetch.js';

/**
 * Tarama: acilmayan sayfalar (brokenPages), canonical hedefi (canonicalProblems)
 * ve aciklayici olmayan baglanti metni (genericLinks). Eskiden 404 donen sayfa
 * hicbir yere yazilmadan atlaniyordu.
 *
 * Gercek yerel HTTP sunucusu + yalniz teste ozel, yerel adrese izin veren
 * politika (crawl-tel-links.spec.ts ile ayni kurulum).
 */

const HTML = { 'content-type': 'text/html; charset=utf-8' };
let server: http.Server;
let base = '';
let routes: Record<string, { status: number; body?: string; type?: string }> = {};
const istenen: string[] = [];

beforeAll(async () => {
  server = http.createServer((req, res) => {
    const path = (req.url ?? '/').split('?')[0];
    istenen.push(path);
    const r = routes[path];
    if (!r) { res.writeHead(404, HTML); res.end('<html><body>yok</body></html>'); return; }
    res.writeHead(r.status, { 'content-type': r.type ?? HTML['content-type'] });
    res.end(r.body ?? '');
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));

const crawler = () => new SiteCrawlerService(makeSafeTextFetch({ isBlocked: () => false, allowAnyPort: true }));
const sayfa = (title: string, head = '', body = '') =>
  ({ status: 200, body: `<html><head><title>${title}</title>${head}</head><body>${body}</body></html>` });

describe('tarama — acilmayan sayfalar', () => {
  it('ana sayfa baglantisinda 404 / 5xx kaydedilir; 403 ve normalizasyon farki bozuk sayilmaz', async () => {
    routes = {
      '/': sayfa('Ana', '', `
        <a href="/var">Var</a><a href="/yok">Yok</a><a href="/cokme">Çökme</a>
        <a href="/yasak">Yasak</a><a href="/bolu/">Bölü</a>`),
      '/var': sayfa('Var'),
      '/cokme': { status: 500, body: 'hata' },
      '/yasak': { status: 403, body: 'yasak' },
      // Yalniz sondaki "/" ile acilan sayfa: normalize "/bolu" 404 doner, yazildigi hal acilir
      '/bolu/': sayfa('Bölü'),
    };
    const r = await crawler().crawl(base, 20);
    const yol = (u: string) => new URL(u).pathname;
    expect(r.brokenPages!.map((b) => [yol(b.url), b.status, b.kind, b.source]).sort()).toEqual([
      ['/cokme', 500, 'server_error', 'home-link'],
      ['/yok', 404, 'not_found', 'home-link'],
    ]);
  });

  it('site haritasindaki 404 adres yazildigi haliyle ve kaynagi "sitemap" ile', async () => {
    routes = {
      '/robots.txt': { status: 200, type: 'text/plain', body: `User-agent: *\nAllow: /\nSitemap: ${base}/sitemap.xml\n` },
      '/sitemap.xml': {
        status: 200, type: 'application/xml',
        body: `<?xml version="1.0"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
          <url><loc>${base}/</loc></url><url><loc>${base}/harita-var</loc></url><url><loc>${base}/harita-yok/</loc></url></urlset>`,
      },
      '/': sayfa('Ana'),
      '/harita-var': sayfa('Var'),
    };
    const r = await crawler().crawl(base, 20);
    expect(r.brokenPages).toEqual([{ url: `${base}/harita-yok/`, status: 404, kind: 'not_found', source: 'sitemap' }]);
  });

  it('hepsi acildiysa alan bos dizi (olculdu, sorun yok)', async () => {
    routes = { '/': sayfa('Ana', '', '<a href="/a">A</a>'), '/a': sayfa('A') };
    const r = await crawler().crawl(base, 5);
    expect(r.brokenPages).toEqual([]);
  });
});

describe('tarama — canonical hedefi', () => {
  it('acilmayan hedef yoklanir; taramada 404 gorulen hedefe istek atilmaz; kendi adresi ve baska site atlanir', async () => {
    routes = {
      '/': sayfa('Ana', `<link rel="canonical" href="${base}/">`, '<a href="/a">A</a><a href="/b">B</a><a href="/c">C</a><a href="/yok">Yok</a><a href="/d">D</a>'),
      '/a': sayfa('A', '<link rel="canonical" href="/eski-a">'),
      '/b': sayfa('B', '<link rel="canonical" href="/yok">'),
      '/c': sayfa('C', '<link rel="canonical" href="https://baska-site.example/c">'),
      '/d': sayfa('D', '<link rel="canonical" href="/a">'),
    };
    istenen.length = 0;
    const r = await crawler().crawl(base, 20);
    const yol = (u: string) => new URL(u).pathname;
    expect(r.canonicalProblems!.map((p) => [yol(p.page), yol(p.target), p.status, p.kind]).sort()).toEqual([
      ['/a', '/eski-a', 404, 'not_found'],
      ['/b', '/yok', 404, 'not_found'],
    ]);
    // /eski-a yoklandi, /yok tarama sirasinda bir kez istendi (canonical icin tekrar istenmedi)
    expect(istenen.filter((p) => p === '/eski-a')).toHaveLength(1);
    expect(istenen.filter((p) => p === '/yok')).toHaveLength(1);
    // Hukum verilen hedefler: /eski-a, /yok, /a (taramada acildi) — kendi adresi ve baska site sayilmaz
    expect(r.canonicalTargetsChecked).toBe(3);
  });
});

describe('tarama — ucretsiz analiz siniri', () => {
  it('canonicalProbeMax 0: ek sayfa istenmez; taramada 404 gorulen hedef yine raporlanir', async () => {
    routes = {
      '/': sayfa('Ana', '', '<a href="/a">A</a><a href="/b">B</a><a href="/yok">Yok</a>'),
      '/a': sayfa('A', '<link rel="canonical" href="/eski-a">'),
      '/b': sayfa('B', '<link rel="canonical" href="/yok">'),
    };
    istenen.length = 0;
    const r = await crawler().crawl(base, 10, { canonicalProbeMax: 0 });
    expect(istenen).not.toContain('/eski-a');
    expect(r.canonicalProblems!.map((p) => new URL(p.target).pathname)).toEqual(['/yok']);
    expect(r.canonicalTargetsChecked).toBe(1);
  });
});

describe('tarama — baglanti metni', () => {
  it('aciklayici olmayan metinler sayilir; nofollow, ayni sayfa ve aciklayici metin atlanir', async () => {
    routes = {
      '/': sayfa('Ana', '', `
        <a href="/a">Devamı »</a>
        <a href="/a">CLICK HERE</a>
        <a href="/a">Kredi notu nedir?</a>
        <a href="/a" rel="nofollow">buraya tıklayın</a>
        <a href="#yorumlar">burada</a>
        <a href="/"> Daha fazla </a>
        <a href="/a"><img src="/x.png" alt=""></a>`),
      '/a': sayfa('A'),
    };
    const r = await crawler().crawl(base, 5);
    const home = r.pages.find((p) => p.url === `${base}/`)!;
    expect(home.genericLinkCount).toBe(2);
    expect(home.genericLinks).toEqual([
      { text: 'Devamı »', href: '/a' },
      { text: 'CLICK HERE', href: '/a' },
    ]);
    expect(r.pages.find((p) => p.url === `${base}/a`)!.genericLinkCount).toBe(0);
  });
});
