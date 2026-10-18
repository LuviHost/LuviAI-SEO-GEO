import 'reflect-metadata';
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import http from 'node:http';
import zlib from 'node:zlib';
import type { AddressInfo } from 'node:net';
import { makeSafeTextFetch } from '../common/safe-fetch.js';
import { SiteCrawlerService } from './site-crawler.service.js';

/**
 * Tarayici + Content-Encoding (uctan uca, gercek safe-fetch ile).
 *
 * NEDEN VAR: undici.request govdeyi acmaz. Her zaman sikistiran bir sunucuda
 * (on-sikistirilmis S3 / CloudFront nesnesi, nginx gzip_static always) gzip
 * baytlari metin diye ok=true donuyor; tarayici baslik / meta / H1 bulamayip
 * sitede olmayan "eksik baslik" sorunlarini puana yaziyordu. Artik govde
 * acilir; acilamayan govdeden SEO verisi URETILMEZ.
 */

const PAGE = '<html><head><title>Merhaba Dünya</title><meta name="description" content="Açıklama metni"></head><body><h1>Başlık</h1></body></html>';
type Handler = (req: http.IncomingMessage, res: http.ServerResponse) => void;
let server: http.Server;
let base = '';
let handler: Handler;
const yok: Handler = (_req, res) => { res.writeHead(404, { 'content-type': 'text/plain' }); res.end('yok'); };
const yol = (req: http.IncomingMessage) => (req.url ?? '').split('?')[0];

beforeAll(async () => {
  server = http.createServer((req, res) => handler(req, res));
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));
afterEach(() => { handler = yok; });

/** Yalnizca test: yerel sunucu 127.0.0.1'de ve rastgele portta */
const crawler = () => new SiteCrawlerService(makeSafeTextFetch({ isBlocked: () => false, allowAnyPort: true }));

describe('SiteCrawlerService — her zaman sikistiran sunucu', () => {
  it('gzip ve br anasayfa acilir: baslik / H1 dogru okunur', async () => {
    for (const enc of ['gzip', 'br'] as const) {
      handler = (req, res) => {
        if (yol(req) !== '/') return yok(req, res);
        const body = enc === 'gzip' ? zlib.gzipSync(PAGE) : zlib.brotliCompressSync(Buffer.from(PAGE));
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'content-encoding': enc });
        res.end(body);
      };
      const r = await crawler().crawl(base, 1);
      expect(r.homeAccess ?? null, enc).toBeNull();
      expect(r.pages, enc).toHaveLength(1);
      expect(r.pages[0], enc).toMatchObject({ title: 'Merhaba Dünya', h1: 'Başlık' });
    }
  });

  it('acilamayan govde (ilan edilmemis zstd) SEO verisi uretmez: anasayfa okunamadi, sayfa yok', async () => {
    handler = (req, res) => {
      if (yol(req) !== '/') return yok(req, res);
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'content-encoding': 'zstd' });
      res.end(Buffer.from([0x28, 0xb5, 0x2f, 0xfd, 0x24, 0x58, 0x00, 0x00, 0x10, 0x02, 0x3c, 0x68, 0x00, 0x91, 0x07]));
    };
    const r = await crawler().crawl(base, 5);
    expect(r.pages).toHaveLength(0);
    expect(r.homeAccess).toMatchObject({ state: 'unreachable' });
  });
});
