import { describe, it, expect, afterEach, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { SiteCrawlerService } from './site-crawler.service.js';
import { makeSafeTextFetch } from '../common/safe-fetch.js';

/**
 * Crawler bellek tavani.
 *
 * NEDEN VAR — uretimde olculdu: ofsayt.com taramasi 100 sayfa icin 137 MB
 * indiriyordu ve iceride 14.1 MB'lik TEK bir HTML sayfasi vardi. Cheerio boyle
 * bir belgeyi ayristirirken kaynagin birkac kati DOM ayirir; 5'li batch ve
 * WORKER_CONCURRENCY=2 ile worker RSS'i 205 MB'tan 1440 MB'a cikiyordu.
 * PM2'nin 1 GB max_memory_restart siniri SIGTERM gonderiyor, tarama yarida
 * oluyor, DB'deki is PROCESSING'de asili kaliyor, BullMQ takilan isi yeniden
 * veriyor ve ayni tarama tekrar cokuyordu — ayni is uretimde 7 kez basladi.
 *
 * Onemli olan yalnizca metnin kirpilmasi degil, BAGLANTININ KESILMESI: govde
 * sonuna kadar indirilip sonra kesilirse bellek zaten harcanmis olur. Asagidaki
 * testler akisin gercekten erken birakildigini ve <head> sinyallerinin sag
 * kaldigini dogrular.
 *
 * Tarayici artik SSRF korumali safeFetchText kullaniyor (global fetch degil);
 * testler gercek bir yerel HTTP sunucusuyla ve yalnizca teste ozel, yerel
 * adrese izin veren politikayla (makeSafeTextFetch) kosar.
 */

const HTML = { 'content-type': 'text/html; charset=utf-8' };
const PARCA = 64 * 1024;

type Handler = (req: http.IncomingMessage, res: http.ServerResponse) => void;

let server: http.Server;
let base = '';
let handler: Handler = (_req, res) => { res.writeHead(404); res.end(); };

beforeAll(async () => {
  server = http.createServer((req, res) => handler(req, res));
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));

/** Yalnizca test: yerel sunucu 127.0.0.1'de ve rastgele portta */
const crawler = () => new SiteCrawlerService(makeSafeTextFetch({ isBlocked: () => false, allowAnyPort: true }));

/**
 * Istemci okudukca (geri basinc) 64 KB'lik parca yazan devasa govde. sayac,
 * sunucunun yazmaya calistigi toplam bayti tutar — istemci baglantiyi
 * birakmazsa toplamin tamamina ulasir.
 */
function devasaYanit(res: http.ServerResponse, toplam: number, bas: string, sayac: { bayt: number }, headers: http.OutgoingHttpHeaders) {
  res.writeHead(200, headers);
  let gonderilen = 0;
  const yaz = () => {
    while (gonderilen < toplam) {
      const govde = gonderilen === 0 && bas ? bas + 'x'.repeat(PARCA - bas.length) : 'x'.repeat(PARCA);
      gonderilen += PARCA;
      sayac.bayt += PARCA;
      if (!res.write(govde)) { res.once('drain', yaz); return; }
    }
    res.end();
  };
  res.on('error', () => {});
  yaz();
}

const kokDosya = (url: string | undefined) => !!url && /sitemap|robots|llms/.test(url);

describe('crawler — sayfa boyutu tavani', () => {
  afterEach(() => { handler = (_req, res) => { res.writeHead(404); res.end(); }; });

  it('20 MB\'lik sayfada baglantiyi ~2 MB\'ta birakiyor (tamamini indirmiyor)', async () => {
    const sayac = { bayt: 0 };
    let anasayfaIstegi = 0;
    handler = (req, res) => {
      if (kokDosya(req.url)) { res.writeHead(404); res.end(); return; }
      anasayfaIstegi++;
      devasaYanit(res, 20 * 1024 * 1024, '<html><head><title>Dev Sayfa</title></head><body>', sayac, HTML);
    };

    const r = await crawler().crawl(base, 1);

    // Anasayfa artik bir kez cekilir (link kesfi ve sayfa turu ayni govdeyi kullanir)
    expect(anasayfaIstegi).toBe(1);
    // 20 MB yazilmaya calisildi; istemci ~2 MB'ta birakinca sunucu duruyor
    // (kalan pay soket tamponlari).
    expect(sayac.bayt, `${(sayac.bayt / 1048576).toFixed(1)} MB yazildi — tavan uygulanmiyor`).toBeLessThan(8 * 1024 * 1024);
    expect(r.pages.length).toBe(1);
  });

  it('kirpilan sayfa yine de <head> sinyallerini veriyor — link grafiginden dusmuyor', async () => {
    const sayac = { bayt: 0 };
    const bas =
      '<html><head><title>Kirpilmis Baslik</title>' +
      '<meta name="description" content="ozet metni">' +
      '<link rel="canonical" href="https://ornek.test/x">' +
      '</head><body><h1>Bir Baslik</h1>';
    handler = (req, res) => {
      if (kokDosya(req.url)) { res.writeHead(404); res.end(); return; }
      devasaYanit(res, 20 * 1024 * 1024, bas, sayac, HTML);
    };

    const r = await crawler().crawl(base, 1);
    const p = r.pages[0];
    expect(p, 'sayfa tamamen dusmus — orphan analizi yanilir').toBeDefined();
    expect(p.title).toBe('Kirpilmis Baslik');
    expect(p.metaDescription).toBe('ozet metni');
    expect(p.canonical).toBe('https://ornek.test/x');
    expect(p.h1).toBe('Bir Baslik');
  });

  it('tavan altindaki normal sayfa hic dokunulmadan tam okunuyor', async () => {
    const govde = '<html><head><title>Kucuk</title></head><body>' + 'a'.repeat(50_000) + '</body></html>';
    handler = (req, res) => {
      if (kokDosya(req.url)) { res.writeHead(404); res.end(); return; }
      res.writeHead(200, HTML); res.end(govde);
    };
    const r = await crawler().crawl(base, 1);
    expect(r.pages[0].title).toBe('Kucuk');
  });
});

describe('crawler — icerik turu suzgeci', () => {
  afterEach(() => { handler = (_req, res) => { res.writeHead(404); res.end(); }; });

  it('PDF/binary govde hic indirilmiyor', async () => {
    const sayac = { bayt: 0 };
    handler = (req, res) => {
      if (kokDosya(req.url)) { res.writeHead(404); res.end(); return; }
      devasaYanit(res, 20 * 1024 * 1024, '', sayac, { 'content-type': 'application/pdf' });
    };

    const r = await crawler().crawl(base, 1);
    // Govde okunmadan birakiliyor; soket tamponlari kadar yazim olabilir
    expect(sayac.bayt, `${(sayac.bayt / 1048576).toFixed(1)} MB — binary govde bosaltilmis`).toBeLessThan(4 * 1024 * 1024);
    expect(r.pages.length).toBe(0);
  });

  it('content-type yoksa okumaya devam ediyor — bazi sunucular basligi hic gondermiyor', async () => {
    handler = (req, res) => {
      if (kokDosya(req.url)) { res.writeHead(404); res.end(); return; }
      res.writeHead(200); // content-type yok
      res.end('<html><head><title>Basliksiz</title></head><body></body></html>');
    };
    const r = await crawler().crawl(base, 1);
    expect(r.pages[0]?.title).toBe('Basliksiz');
  });

  it('XML sitemap suzgecten geciyor — text/xml engellenirse URL kesfi biter', async () => {
    handler = (req, res) => {
      if (req.url?.startsWith('/sitemap.xml')) {
        res.writeHead(200, { 'content-type': 'application/xml' });
        res.end(`<urlset><url><loc>${base}/a</loc></url><url><loc>${base}/b</loc></url></urlset>`);
        return;
      }
      if (kokDosya(req.url)) { res.writeHead(404); res.end(); return; }
      res.writeHead(200, HTML); res.end('<html><head><title>S</title></head><body></body></html>');
    };
    const r = await crawler().crawl(base, 5);
    expect(r.sitemapUrl).toContain('sitemap.xml');
    expect(r.pages.map((p) => p.url)).toContain(`${base}/a`);
  });
});

// GEO calistiricisinin ayni 2 MB tavani artik safeFetchText uzerinden gercek
// baglantida sinaniyor: src/audit/geo-runner.spec.ts ("2 MB tavan gercek
// baglantida"). Buradaki global fetch sahteli kopya o gecisle gecersiz kaldi.
