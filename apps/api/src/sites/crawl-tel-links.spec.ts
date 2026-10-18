import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { SiteCrawlerService } from './site-crawler.service.js';
import { makeSafeTextFetch } from '../common/safe-fetch.js';
import { napFromCrawledPages } from '../audit/site-nap.js';

/**
 * Denetim taramasi tel: baglantilarini da toplar (CrawledPage.telLinks).
 *
 * NEDEN: yerel olcum sitenin kendi telefonunu ister. Tarama yalniz JSON-LD
 * tasirken site-nap kaydi "tel: taranmadi" olarak kaliyor ve olcum aninda
 * anasayfa ayrica okunuyordu. Artik telefonu bulan denetim kaydi icin olcum
 * siteye ayrica gitmez (site-nap.spec.ts resolveSiteNap).
 *
 * Gercek yerel HTTP sunucusu + yalniz teste ozel, yerel adrese izin veren
 * politika (crawl-cap.spec.ts ile ayni kurulum).
 */

const HTML = { 'content-type': 'text/html; charset=utf-8' };
let server: http.Server;
let base = '';
let pages: Record<string, string> = {};

beforeAll(async () => {
  server = http.createServer((req, res) => {
    const path = (req.url ?? '/').split('?')[0];
    const body = pages[path];
    if (body === undefined) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, HTML);
    res.end(body);
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));

const crawler = () => new SiteCrawlerService(makeSafeTextFetch({ isBlocked: () => false, allowAnyPort: true }));

describe('crawler — tel: baglantilari', () => {
  it('tekrarsiz, kirpilmis, en fazla 10; ic link listesine karismaz', async () => {
    const many = Array.from({ length: 14 }, (_, i) => `<a href="tel:+90532111220${i % 10}${i}">${i}</a>`).join('');
    pages = {
      '/': `<html><head><title>Lavanta</title></head><body>
        <a href=" tel:+902165550000 ">Ara</a><a href="tel:+902165550000">Tekrar</a><a href="TEL:0532 111 22 33">Cep</a>
        <a href="/iletisim">İletişim</a><a href="mailto:a@b.com">e</a>${many}
      </body></html>`,
      '/iletisim': '<html><head><title>İletişim</title></head><body>Bize ulaşın</body></html>',
    };
    const r = await crawler().crawl(base, 5);
    const home = r.pages.find((p) => p.url === `${base}/`)!;
    expect(home.telLinks!.slice(0, 2)).toEqual(['tel:+902165550000', 'TEL:0532 111 22 33']);
    expect(home.telLinks).toHaveLength(10);
    expect(home.outboundLinks.some((l) => /^tel:/i.test(l))).toBe(false);
    expect(home.outboundLinks).toContain(`${base}/iletisim`);
    // tel: baglantisi olmayan sayfa da TARANDI: dizi var, bos
    expect(r.pages.find((p) => p.url === `${base}/iletisim`)!.telLinks).toEqual([]);
  });

  it('denetim kaydi tel: bulgusunu tasir (telScanned, kaynak tel-link)', async () => {
    pages = {
      '/': '<html><head><title>Lavanta</title></head><body><a href="tel:0216 555 00 00">Ara</a></body></html>',
    };
    const r = await crawler().crawl(base, 5);
    const nap = napFromCrawledPages(r.pages, new Date('2026-10-10T00:00:00Z'));
    expect(nap).toMatchObject({ status: 'ok', origin: 'audit', telScanned: true, phones: ['+902165550000'], sources: ['tel-link'] });
  });
});
