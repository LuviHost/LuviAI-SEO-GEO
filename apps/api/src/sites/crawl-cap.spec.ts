import { describe, it, expect, afterEach } from 'vitest';
import { SiteCrawlerService } from './site-crawler.service.js';

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
 */

const orjFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = orjFetch; });

/** Istendikce 64 KB'lik parca ureten, kac parca cekildigini sayan govde. */
function devasaGovde(toplamBayt: number, bas = '', sayac: { parca: number }) {
  const PARCA = 64 * 1024;
  let gonderilen = 0;
  const enc = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    pull(c) {
      if (gonderilen >= toplamBayt) { c.close(); return; }
      sayac.parca++;
      const govde = gonderilen === 0 && bas ? bas + 'x'.repeat(PARCA - bas.length) : 'x'.repeat(PARCA);
      gonderilen += PARCA;
      c.enqueue(enc.encode(govde));
    },
  });
}

function stubla(handler: (url: string) => Response | null) {
  const sayim = { istek: 0 };
  globalThis.fetch = (async (input: any) => {
    const url = String(input);
    const res = handler(url);
    if (res) sayim.istek++;
    return res ?? new Response(null, { status: 404 });
  }) as typeof fetch;
  return sayim;
}

const HTML = { 'content-type': 'text/html; charset=utf-8' };

describe('crawler — sayfa boyutu tavani', () => {
  it('20 MB\'lik sayfada baglantiyi ~2 MB\'ta birakiyor (tamamini indirmiyor)', async () => {
    const sayac = { parca: 0 };
    const sayim = stubla((url) => {
      if (url.includes('sitemap') || url.includes('robots') || url.includes('llms')) return null;
      return new Response(
        devasaGovde(20 * 1024 * 1024, '<html><head><title>Dev Sayfa</title></head><body>', sayac),
        { status: 200, headers: HTML },
      );
    });

    const r = await new SiteCrawlerService().crawl('https://ornek.test', 1);

    // Anasayfa iki kez cekilir: once link kesfi icin, sonra sayfa turunda.
    // Bu yuzden istek basina olcuyoruz. 20 MB = 320 parca; 2 MB tavani ~32 parca.
    const parcaBasinaIstek = sayac.parca / sayim.istek;
    expect(
      parcaBasinaIstek,
      `istek basina ${parcaBasinaIstek.toFixed(0)} parca cekildi — tavan uygulanmiyor`,
    ).toBeLessThan(40);
    expect(sayac.parca, 'govdenin tamami indirilmis').toBeLessThan(320);
    expect(r.pages.length).toBe(1);
  });

  it('kirpilan sayfa yine de <head> sinyallerini veriyor — link grafiginden dusmuyor', async () => {
    const sayac = { parca: 0 };
    const bas =
      '<html><head><title>Kirpilmis Baslik</title>' +
      '<meta name="description" content="ozet metni">' +
      '<link rel="canonical" href="https://ornek.test/x">' +
      '</head><body><h1>Bir Baslik</h1>';
    stubla((url) => {
      if (url.includes('sitemap') || url.includes('robots') || url.includes('llms')) return null;
      return new Response(devasaGovde(20 * 1024 * 1024, bas, sayac), { status: 200, headers: HTML });
    });

    const r = await new SiteCrawlerService().crawl('https://ornek.test', 1);
    const p = r.pages[0];
    expect(p, 'sayfa tamamen dusmus — orphan analizi yanilir').toBeDefined();
    expect(p.title).toBe('Kirpilmis Baslik');
    expect(p.metaDescription).toBe('ozet metni');
    expect(p.canonical).toBe('https://ornek.test/x');
    expect(p.h1).toBe('Bir Baslik');
  });

  it('tavan altindaki normal sayfa hic dokunulmadan tam okunuyor', async () => {
    const govde = '<html><head><title>Kucuk</title></head><body>' + 'a'.repeat(50_000) + '</body></html>';
    stubla((url) => {
      if (url.includes('sitemap') || url.includes('robots') || url.includes('llms')) return null;
      return new Response(govde, { status: 200, headers: HTML });
    });
    const r = await new SiteCrawlerService().crawl('https://ornek.test', 1);
    expect(r.pages[0].title).toBe('Kucuk');
  });
});

describe('crawler — icerik turu suzgeci', () => {
  it('PDF/binary govde hic indirilmiyor', async () => {
    const sayac = { parca: 0 };
    const sayim = stubla((url) => {
      if (url.includes('sitemap') || url.includes('robots') || url.includes('llms')) return null;
      return new Response(devasaGovde(20 * 1024 * 1024, '', sayac), {
        status: 200,
        headers: { 'content-type': 'application/pdf' },
      });
    });

    const r = await new SiteCrawlerService().crawl('https://ornek.test', 1);
    // ReadableStream kendi kuyrugunu doldurmak icin istek basina 1 parca ceker;
    // bu test kosumunun artifakti. Onemli olan govdenin BOSALTILMAMASI: kod
    // content-type'i gorup okumadan iptal ediyor.
    expect(
      sayac.parca,
      `${sayac.parca} parca — binary govde bosaltilmis, ayristirilacak bir sey yokken bosa bellek`,
    ).toBeLessThanOrEqual(sayim.istek);
    expect(r.pages.length).toBe(0);
  });

  it('content-type yoksa okumaya devam ediyor — bazi sunucular basligi hic gondermiyor', async () => {
    stubla((url) => {
      if (url.includes('sitemap') || url.includes('robots') || url.includes('llms')) return null;
      // Response varsayilan olarak text/plain ekler; acikca bosaltiyoruz.
      const res = new Response('<html><head><title>Basliksiz</title></head><body></body></html>', { status: 200 });
      res.headers.delete('content-type');
      return res;
    });
    const r = await new SiteCrawlerService().crawl('https://ornek.test', 1);
    expect(r.pages[0]?.title).toBe('Basliksiz');
  });

  it('XML sitemap suzgecten geciyor — text/xml engellenirse URL kesfi biter', async () => {
    stubla((url) => {
      if (url.includes('sitemap.xml')) {
        return new Response(
          '<urlset><url><loc>https://ornek.test/a</loc></url><url><loc>https://ornek.test/b</loc></url></urlset>',
          { status: 200, headers: { 'content-type': 'application/xml' } },
        );
      }
      if (url.includes('robots') || url.includes('llms')) return null;
      return new Response('<html><head><title>S</title></head><body></body></html>', { status: 200, headers: HTML });
    });
    const r = await new SiteCrawlerService().crawl('https://ornek.test', 5);
    expect(r.sitemapUrl).toContain('sitemap.xml');
    expect(r.pages.map((p) => p.url)).toContain('https://ornek.test/a');
  });
});

/**
 * GEO calistiricisi ayni tavana tabi.
 *
 * NEDEN AYRI TEST: bu, ayni hatanin IKINCI kopyasiydi. site-crawler
 * tavanlandiktan sonra uretimde olculdu — GEO asamasi worker RSS'ini tek
 * basina 260 MB'tan 748 MB'a cikariyordu, cunku kendi tavansiz fetch'i vardi
 * ve en fazla 9 sayfanin govdesini AYNI ANDA bellekte tutuyor. Okuma mantigi
 * artik common/fetch-capped.ts'te tek yerde; bu test ikinci cagiranin
 * gercekten oraya bagli oldugunu sabitler.
 */
describe('GEO calistiricisi — ayni tavan', () => {
  it('devasa sayfada baglantiyi birakiyor', async () => {
    const { GeoRunnerService } = await import('../audit/geo-runner.service.js');
    const sayac = { parca: 0 };
    const sayim = stubla((url) => {
      if (url.includes('llms.txt') || url.includes('sitemap') || url.includes('robots')) return null;
      return new Response(
        devasaGovde(20 * 1024 * 1024, '<html><head><title>Dev</title></head><body><h1>x</h1>', sayac),
        { status: 200, headers: HTML },
      );
    });

    const r = await new GeoRunnerService().runAudit('https://ornek.test');

    const parcaBasina = sayac.parca / Math.max(1, sayim.istek);
    expect(parcaBasina, `istek basina ${parcaBasina.toFixed(0)} parca — GEO tarafi tavansiz`).toBeLessThan(40);
    // Tavan uygulanmasina ragmen skor uretilebiliyor olmali
    expect(r.score, 'GEO skoru uretilemedi — kirpma analizi bozmus').not.toBeNull();
  });
});
