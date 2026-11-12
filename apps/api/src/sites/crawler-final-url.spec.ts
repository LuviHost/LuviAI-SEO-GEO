import 'reflect-metadata';
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import http from 'node:http';
import type { AddressInfo } from 'node:net';

/**
 * Tarayici: yonlendirme sonrasi adres (finalUrl) ve eksik sertifika zinciri bayragi.
 *
 * NEDEN VAR: denetimin iki kontrolu bu iki alana dayanir —
 *  - hreflang (audit/language-versions.ts): anasayfasi "/" → "/tr/" yonlendiren
 *    tek dilli site "kodsuz + kodlu sayfa" gibi gorunup iki dilli sayilmasin;
 *  - HTTPS (audit-checks.service checkHttps): zincirini bizim tamamladigimiz
 *    site "HTTPS: gecti" almasin (labenko.com, 12.11.2026).
 * Alanlar tarayicida doldurulmazsa iki kontrol de sessizce eski davranisa doner.
 */

const zincirTamamlanan = new Set<string>();
vi.mock('../common/tls-chain.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../common/tls-chain.js')>()),
  tlsChainCompletedFor: (host: string) => zincirTamamlanan.has(host),
}));

const { makeSafeTextFetch } = await import('../common/safe-fetch.js');
const { SiteCrawlerService } = await import('./site-crawler.service.js');
const { detectLanguageVersions } = await import('../audit/language-versions.js');

const HTML = { 'content-type': 'text/html; charset=utf-8' };
type Handler = (req: http.IncomingMessage, res: http.ServerResponse) => void;
let server: http.Server;
let base = '';
let handler: Handler;
const yok: Handler = (_req, res) => { res.writeHead(404, HTML); res.end('yok'); };

beforeAll(async () => {
  server = http.createServer((req, res) => handler(req, res));
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));
afterEach(() => { handler = yok; zincirTamamlanan.clear(); });

const crawler = () => new SiteCrawlerService(makeSafeTextFetch({ isBlocked: () => false, allowAnyPort: true }));
const yol = (req: http.IncomingMessage) => (req.url ?? '').split('?')[0];
const sayfa = (title: string, body = '') => `<html><head><title>${title}</title></head><body>${body}</body></html>`;

describe('finalUrl — yalniz baska bir yola yonlendiyse', () => {
  it('"/" → "/tr/" yonlendiren tek dilli site: anasayfanin finalUrl\'i dolu, dil surumu SAYILMAZ', async () => {
    handler = (req, res) => {
      const p = yol(req);
      if (p === '/') { res.writeHead(302, { location: '/tr/' }); res.end(); return; }
      if (p === '/tr/' || p === '/tr') { res.writeHead(200, HTML); res.end(sayfa('Anasayfa', '<a href="/tr/hakkimizda">Hakkımızda</a>')); return; }
      if (p === '/tr/hakkimizda') { res.writeHead(200, HTML); res.end(sayfa('Hakkımızda')); return; }
      yok(req, res);
    };
    const r = await crawler().crawl(base, 10);
    const ana = r.pages.find((x) => new URL(x.url).pathname === '/')!;
    expect(ana).toBeDefined();
    expect(new URL(ana.finalUrl!).pathname).toBe('/tr/');
    const alt = r.pages.find((x) => x.url.endsWith('/tr/hakkimizda'))!;
    expect(alt.finalUrl).toBeUndefined();
    expect(detectLanguageVersions(r.pages).multilingual).toBe(false);
    // finalUrl olmasaydi "/" kodsuz sayfa sayilir, site iki dilli gorunurdu
    expect(detectLanguageVersions(r.pages.map(({ finalUrl: _f, ...p }) => p)).multilingual).toBe(true);
  });

  it('labenko bicimi ("/" Turkce, "/EN" Ingilizce, yonlendirme yok): finalUrl yok, site iki dilli', async () => {
    handler = (req, res) => {
      const p = yol(req);
      if (p === '/') { res.writeHead(200, HTML); res.end(sayfa('Labenko', '<a href="/EN">EN</a>')); return; }
      if (p === '/EN') { res.writeHead(200, HTML); res.end(sayfa('Labenko EN', '<a href="/">TR</a>')); return; }
      yok(req, res);
    };
    const r = await crawler().crawl(base, 10);
    expect(r.pages.map((x) => new URL(x.url).pathname).sort()).toEqual(['/', '/EN']);
    expect(r.pages.every((x) => x.finalUrl === undefined)).toBe(true);
    expect(detectLanguageVersions(r.pages)).toMatchObject({ multilingual: true, languages: ['en'], evidence: 'url-path' });
  });
});

describe('tlsChainIncomplete — zinciri biz tamamladiysak', () => {
  const tekSayfa: Handler = (req, res) => {
    if (yol(req) === '/') { res.writeHead(200, HTML); res.end(sayfa('Site')); return; }
    yok(req, res);
  };

  it('zincir tamamlanarak baglanilan alan adi: bayrak dolu', async () => {
    handler = tekSayfa;
    zincirTamamlanan.add('127.0.0.1');
    expect((await crawler().crawl(base, 5)).tlsChainIncomplete).toBe(true);
  });

  it('normal baglanti: bayrak false', async () => {
    handler = tekSayfa;
    expect((await crawler().crawl(base, 5)).tlsChainIncomplete).toBe(false);
  });
});
