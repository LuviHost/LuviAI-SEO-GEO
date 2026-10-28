import { describe, it, expect, vi, beforeEach, afterAll, beforeAll } from 'vitest';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import type { SafeTextResult } from '../common/safe-fetch.js';

const fetchMock = vi.fn();
vi.mock('../common/safe-fetch.js', async (orig) => {
  const real: any = await orig();
  return { ...real, safeFetchText: (...a: any[]) => fetchMock(...a) };
});

const { GeoRunnerService, GEO_METHOD_VERSION } = await import('./geo-runner.service.js');
const { SafeFetchError } = await import('../common/safe-fetch.js');

type Reply = { status: number; text?: string; headers?: Record<string, string>; url?: string; contentType?: string };

function reply(url: string, r: Reply): SafeTextResult {
  return {
    status: r.status,
    ok: r.status >= 200 && r.status < 300,
    url: r.url ?? url,
    redirected: !!r.url && r.url !== url,
    contentType: r.contentType ?? 'text/html',
    headers: r.headers ?? {},
    text: r.text ?? '',
    truncated: false,
    binary: false,
  };
}

/** URL → yanit; tanimsiz adres 404 */
function serve(map: Record<string, Reply | Error>) {
  fetchMock.mockImplementation(async (url: string) => {
    const r = map[url];
    if (r instanceof Error) throw r;
    return reply(url, r ?? { status: 404, text: 'yok' });
  });
}

const RICH = `<html><head>
<link rel="canonical" href="https://site.com/a">
<meta property="og:title" content="A"><meta property="og:type" content="article"><meta property="og:url" content="https://site.com/a">
<meta name="twitter:card" content="summary"><meta name="twitter:title" content="A">
<script type="application/ld+json">{"@type":"Article"}</script>
<script type="application/ld+json">{"@type":"FAQPage"}</script>
<script type="application/ld+json">{"@type":"BreadcrumbList"}</script>
</head><body><h1>Baslik</h1><h2>a</h2><h2>b</h2><h3>c</h3>
<time datetime="${new Date().toISOString()}"></time>
<ul><li>x</li></ul><ol><li>y</li></ol><table><tr><td>z</td></tr></table><blockquote>q</blockquote>
<p>SEO nedir? Tanim burada.</p></body></html>`;

const home = (links: string[]) => `${RICH.replace('</body>', links.map((l) => `<a href="${l}">l</a>`).join('') + '</body>')}`;

const LLMS = '# Site\n\n> Kisa ozet\n\n- [A](https://site.com/a)\n- [B](https://site.com/b)\n- [C](https://site.com/c)\n';

const CF_WAF: Reply = {
  status: 403,
  headers: { server: 'cloudflare', 'cf-ray': 'a4c218f8d9c3b647-IST' },
  text: '<title>Attention Required! | Cloudflare</title><h1>Sorry, you have been blocked</h1>',
};
const CF_CHALLENGE_200: Reply = { status: 200, text: '<html><head><title>Just a moment...</title></head><body>Checking your browser</body></html>' };

beforeEach(() => { fetchMock.mockReset(); });

describe('GeoRunnerService — engelli sayfa skora girmez', () => {
  it('anasayfa WAF 403: skor YOK, neden + izin talimati doner, ic sayfalar denenmez', async () => {
    serve({ 'https://site.com': CF_WAF });
    const r = await new GeoRunnerService().runAudit('https://site.com/bir/sayfa');
    expect(r.score).toBeNull();
    expect(r.methods).toEqual([]);
    expect(r.blocked).toMatchObject({ kind: 'waf', vendor: 'cloudflare', status: 403, url: 'https://site.com' });
    expect(r.blocked?.reason).toContain('Cloudflare');
    expect(r.blocked?.hint).toContain('RanksUpBot');
    expect(r.sample).toEqual({ measured: 0, blocked: 1 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('200 donen bot dogrulama ekrani da engeldir — eskiden icerik sanilip puanlaniyordu', async () => {
    serve({ 'https://site.com': CF_CHALLENGE_200 });
    const r = await new GeoRunnerService().runAudit('https://site.com');
    expect(r.score).toBeNull();
    expect(r.blocked).toMatchObject({ kind: 'challenge', status: 200 });
  });

  it('engelli ic sayfa (WAF ya da 200 challenge) skoru degistirmez; orneklem sayilari dogru', async () => {
    const base = { 'https://site.com': { status: 200, text: home(['/a', '/b']) }, 'https://site.com/llms.txt': { status: 200, text: LLMS, contentType: 'text/plain' }, 'https://site.com/a': { status: 200, text: RICH } };
    const svc = new GeoRunnerService();

    serve({ ...base, 'https://site.com/b': { status: 404, text: 'yok' } });
    const missing = await svc.runAudit('https://site.com');

    serve({ ...base, 'https://site.com/b': CF_WAF });
    const waf = await svc.runAudit('https://site.com');

    serve({ ...base, 'https://site.com/b': CF_CHALLENGE_200 });
    const challenge = await svc.runAudit('https://site.com');

    // Ayni ince sayfa engel isareti olmadan gelseydi skora girer ve dusururdu —
    // testin gercekten ayirt edici oldugunun kaniti.
    serve({ ...base, 'https://site.com/b': { status: 200, text: '<html><body>ince sayfa</body></html>' } });
    const thin = await svc.runAudit('https://site.com');

    expect(missing.score).not.toBeNull();
    expect(waf.score).toBe(missing.score);
    expect(challenge.score).toBe(missing.score);
    expect(thin.score!).toBeLessThan(missing.score!);
    expect(missing.sample).toEqual({ measured: 2, blocked: 0 });
    expect(waf.sample).toEqual({ measured: 2, blocked: 1 });
    expect(challenge.sample).toEqual({ measured: 2, blocked: 1 });
    expect(waf.blocked).toBeNull();
  });

  it('429 alan orneklem kesilir — siteye istek yagdirilmaz', async () => {
    serve({
      'https://site.com': { status: 200, text: home(['/a', '/b', '/c']) },
      'https://site.com/a': { status: 429, headers: { 'retry-after': '30' } },
    });
    const r = await new GeoRunnerService().runAudit('https://site.com');
    const asked = fetchMock.mock.calls.map((c) => c[0]);
    expect(asked).toContain('https://site.com/a');
    expect(asked).not.toContain('https://site.com/b');
    expect(asked).not.toContain('https://site.com/c');
    expect(r.sample).toEqual({ measured: 1, blocked: 1 });
    expect(r.score).not.toBeNull();
  });

  it('llms.txt engellendiyse "yok" sayilmaz, sinyal skordan cikar; HTML donen yol ise "yok"tur', async () => {
    const page = { 'https://site.com': { status: 200, text: RICH } };
    serve({ ...page, 'https://site.com/llms.txt': CF_WAF });
    const blocked = await new GeoRunnerService().runAudit('https://site.com');
    expect(blocked.methods.find((m) => m.id === 'llms_txt')).toBeUndefined();

    // Ozel 404: 200 + HTML. Eskiden "200 karakterden uzun" diye 30 puan aliyordu.
    serve({ ...page, 'https://site.com/llms.txt': { status: 200, text: `<!doctype html><html><body>${'x'.repeat(500)}</body></html>` } });
    const soft404 = await new GeoRunnerService().runAudit('https://site.com');
    expect(soft404.methods.find((m) => m.id === 'llms_txt')).toMatchObject({ score: 0, detail: 'Bulunamadi' });

    serve({ ...page, 'https://site.com/llms.txt': { status: 200, text: LLMS, contentType: 'text/plain' } });
    const real = await new GeoRunnerService().runAudit('https://site.com');
    expect(real.methods.find((m) => m.id === 'llms_txt')?.score).toBe(100);
  });

  it('yonlendirme sonrasi koken kullanilir (example.com → www): ic sayfalar orneklenir', async () => {
    serve({
      'https://site.com': { status: 200, url: 'https://www.site.com/', text: home(['https://www.site.com/a', 'https://www.site.com/']) },
      'https://www.site.com/a': { status: 200, text: RICH },
    });
    const r = await new GeoRunnerService().runAudit('https://site.com');
    const asked = fetchMock.mock.calls.map((c) => c[0]);
    expect(asked).toContain('https://www.site.com/llms.txt');
    expect(asked).toContain('https://www.site.com/a');
    // Anasayfa "/" ile ikinci kez orneklenmez
    expect(asked.filter((u) => u === 'https://www.site.com/')).toHaveLength(0);
    expect(r.sample).toEqual({ measured: 2, blocked: 0 });
  });

  it('ic adres / ag hatasi engel DEGIL: skor yok ama blocked da yok', async () => {
    serve({ 'https://site.com': new SafeFetchError('blocked_address', 'ozel adres') });
    const r = await new GeoRunnerService().runAudit('https://site.com');
    expect(r).toEqual({ score: null, methods: [], queries: [], details: { methodVersion: GEO_METHOD_VERSION } });
  });

  // F7: yontem degisti (HTML llms.txt 0 puan, anasayfa tek ornek, yonlendirme
  // sonrasi koken). Surum damgasi olmazsa karsilastirma farki siteye yazar.
  it('her donus yolu olcum yontemi surumunu tasir (basarili, engelli, okunamayan, hata)', async () => {
    expect(GEO_METHOD_VERSION).toBe(4);
    const svc = new GeoRunnerService();
    const surum = async (map: Record<string, Reply | Error>) => {
      serve(map);
      return (await svc.runAudit('https://site.com')).details;
    };
    expect(await surum({ 'https://site.com': { status: 200, text: RICH } })).toEqual({ methodVersion: 4 });
    expect(await surum({ 'https://site.com': CF_WAF })).toEqual({ methodVersion: 4 });
    expect(await surum({ 'https://site.com': { status: 500, text: 'hata' } })).toEqual({ methodVersion: 4 });
    expect(await surum({ 'https://site.com': new Error('ag koptu') })).toEqual({ methodVersion: 4 });
    // Gecersiz adres catch yoluna duser — o da damgali
    expect((await svc.runAudit('gecersiz adres')).details).toEqual({ methodVersion: 4 });
  });

  it('istekler durust bot kimligi ve onbellek atlatma basliklariyla gider (UA ezilmez)', async () => {
    serve({ 'https://site.com': { status: 200, text: RICH } });
    await new GeoRunnerService().runAudit('https://site.com');
    const opts = fetchMock.mock.calls[0][1];
    expect(opts.userAgent).toBeUndefined();
    expect(opts.headers).toMatchObject({ 'cache-control': 'no-cache', pragma: 'no-cache' });
    expect(opts.maxBytes).toBe(2 * 1024 * 1024);
  });
});

/**
 * Tavan GERCEK baglantida da uygulaniyor mu? (sites/crawl-cap.spec.ts'teki
 * "GEO calistiricisi — ayni tavan" testinin yerine: GEO artik global fetch
 * degil safeFetchText kullaniyor.) Yerel sunucu 20 MB'lik sayfayi akitir;
 * istemci ~2 MB'ta baglantiyi birakmali ve kirpilmis <head>'den skor uretmeli.
 */
describe('GeoRunnerService — 2 MB tavan gercek baglantida', () => {
  let server: http.Server;
  let base = '';
  const sent = { chunks: 0 };
  const CHUNK = 64 * 1024;
  beforeAll(async () => {
    server = http.createServer((req, res) => {
      if (req.url !== '/') { res.writeHead(404, { 'content-type': 'text/plain' }); res.end('yok'); return; }
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.write('<html><head><title>Dev</title><link rel="canonical" href="/"></head><body><h1>x</h1>');
      let left = Math.ceil((20 * 1024 * 1024) / CHUNK);
      const pump = () => {
        while (left > 0 && !res.destroyed) {
          left--;
          sent.chunks++;
          if (!res.write('a'.repeat(CHUNK))) { res.once('drain', pump); return; }
        }
        if (!res.destroyed) res.end('</body></html>');
      };
      res.on('close', () => { left = 0; });
      pump();
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(() => new Promise<void>((r) => server.close(() => r())));

  it('20 MB sayfada baglanti erken birakilir, kirpilmis sayfadan yine skor cikar', async () => {
    const real: any = await vi.importActual('../common/safe-fetch.js');
    // Yalnizca test politikasi: yerel sunucu 127.0.0.1'de ve rastgele portta
    fetchMock.mockImplementation(real.makeSafeTextFetch({ isBlocked: () => false, allowAnyPort: true }));
    const r = await new GeoRunnerService().runAudit(base);
    expect(r.score, 'GEO skoru uretilemedi — kirpma analizi bozmus').not.toBeNull();
    // 20 MB = 320 parca; tavanli istemci ~32 parcada keser (soket tamponu payi ile)
    expect(sent.chunks, `${sent.chunks} parca gonderildi — tavan uygulanmiyor`).toBeLessThan(160);
  });
});

/**
 * Tarih sinyali (v3). v2 `meta[article:modified_time], time[datetime]` secicisinden
 * attr("datetime") okuyordu: cheerio yalniz ilk elemana bakar (head'deki meta) ve
 * meta'nin degeri `content`'tedir — modified_time hic okunmuyordu.
 */
describe('GeoRunnerService — tarih sinyali', () => {
  const fresh = (head: string, body = '') => {
    const svc = new GeoRunnerService() as unknown as { scorePage(html: string): { freshScore: number } };
    return svc.scorePage(`<html><head>${head}</head><body><h1>x</h1>${body}</body></html>`).freshScore;
  };
  const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString();

  it('article:modified_time meta okunur (v2 bunu hic goremiyordu)', () => {
    expect(fresh(`<meta property="article:modified_time" content="${daysAgo(10)}">`)).toBe(100);
  });

  it('modified_time varken body\'deki <time datetime> de gorulur; modified once gelir', () => {
    expect(fresh('', `<time datetime="${daysAgo(30)}">gecen ay</time>`)).toBe(100);
    expect(fresh(`<meta property="article:modified_time" content="${daysAgo(900)}">`, `<time datetime="${daysAgo(5)}">x</time>`)).toBe(30);
  });

  it('meta yoksa JSON-LD dateModified, o da yoksa datePublished okunur', () => {
    const ld = (o: object) => `<script type="application/ld+json">${JSON.stringify(o)}</script>`;
    expect(fresh(ld({ '@type': 'BlogPosting', datePublished: daysAgo(800), dateModified: daysAgo(20) }))).toBe(100);
    expect(fresh(ld({ '@type': 'BlogPosting', datePublished: daysAgo(500) }))).toBe(60);
  });

  it('okunamayan tarih 50 alir (v2\'de NaN sessizce 30 oluyordu); tarih yoksa 0', () => {
    expect(fresh('<meta property="article:modified_time" content="gecen sali">')).toBe(50);
    expect(fresh('')).toBe(0);
  });
});

describe('GeoRunnerService — v4 sayfa sinyalleri', () => {
  const sayfa = (body: string, head = '') => {
    const svc = new GeoRunnerService() as unknown as { scorePage(html: string): Record<string, number> };
    return svc.scorePage(`<html><head>${head}</head><body>${body}</body></html>`);
  };

  it('tanim sinyali Turkce harfleri ve <dfn> etiketini gorur (v3 "tanım"/"açıklamak" kaciriyordu)', () => {
    expect(sayfa('<p>Bu kavramın tanımı şöyle.</p>').defScore).toBe(8);
    expect(sayfa('<p>Bunu açıklamak gerekirse</p>').defScore).toBe(8);
    expect(sayfa('<p><dfn>GEO</dfn> bir optimizasyondur.</p>').defScore).toBe(8);
    expect(sayfa('<p>Ödeme nedir?</p>').defScore).toBe(8);
  });

  it('FAQPage isareti tek basina 40 alir; gorunur soru-cevap 60\'a kadar ekler', () => {
    const faqLd = '<script type="application/ld+json">{"@type":"FAQPage"}</script>';
    expect(sayfa('<p>x</p>', faqLd).faqScore).toBe(40);
    expect(sayfa('<h3>Ne kadar sürer?\n</h3><p>a</p><h3>Ücret ne?\n</h3><p>b</p>').faqScore).toBe(20);
  });

  it('kanit ve derinlik yalniz ic sayfalardan: kisa vitrin anasayfa ortalamayi dusurmez', async () => {
    const ic = `<html><body><article><h2>a</h2><h2>b</h2><h2>c</h2><p>${'kelime '.repeat(700)}</p>
      <p>Kurulum 14 gün, ücret 3.500 TL, artış yüzde 40.</p><ol><li>a</li><li>b</li><li>c</li></ol></article></body></html>`;
    serve({
      'https://site.com': { status: 200, text: home(['/a']) },
      'https://site.com/a': { status: 200, text: ic },
    });
    const r = await new GeoRunnerService().runAudit('https://site.com');
    const m = Object.fromEntries(r.methods.map((x) => [x.id, x]));
    expect(m.evidence.score).toBe(30 + 25);
    expect(m.depth.score).toBe(Math.round(70 * 0.7 + 60 * 0.3));
    expect(m.evidence.weight).toBe(12);
    expect(m.depth.weight).toBe(8);
    expect(m.faq_qa.weight).toBe(6);
  });
});

