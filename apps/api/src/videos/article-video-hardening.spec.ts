import { afterAll, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadBrandKit, loadExtractKit, VIDEO_APP_DIR } from './article-short-kit.js';
import { extractSiteBrand } from './article-video-brand.js';
import { BrandSandboxError, runInWorker, sandboxedBrandCompute } from './brand-sandbox.js';
import { articleHtmlDocument, removeH1 } from './article-video-source.js';
import type { SafeTextResult } from '../common/safe-fetch.js';

/**
 * Inceleme bulgularinin regresyon testleri (marka / makale ayristirma sertlestirmesi).
 *
 *  - ReDoS: guvenilmeyen HTML/CSS'te karesel / ustel desenler. Onceki olcumler (ayni girdi):
 *    2 MB '-----' satir ici CSS ~ 85 dk, kapanmayan <title><style> 2 MB ~ 85 sn, 28 kalin
 *    etiket + kuyruk ~ 12 sn — hepsi API ya da worker'in olay dongusunu kilitliyordu.
 *    Simdi her biri < 200 ms (girdi kirpilir, desenler dogrusal).
 *  - API olay dongusu: saf ayristirma worker_thread'de, sert sure siniriyla (brand-sandbox.ts).
 *  - Logo adayi tavani + toplam son tarih: 41 bin <link rel=icon> x 8 sn = 91 saatlik tek is olculdu.
 *  - Gecersiz HTML varligi (&#x110000;) ayristirmayi RangeError ile dusurmez.
 *  - Zaman asimindaki render'in ffmpeg'i oldurulur.
 */

const A = path.join(VIDEO_APP_DIR, 'scripts/article-short');
const mod = <T>(f: string): Promise<T> => import(pathToFileURL(path.join(A, f)).href) as Promise<T>;
const htmlKit = () => mod<any>('html.mjs');
const brandKit = () => mod<any>('brand.mjs');

const MB2 = 2 * 1024 * 1024;
const rep = (unit: string, size = MB2) => unit.repeat(Math.floor(size / unit.length));
const failingFetcher = async () => {
  throw new Error('ag yok');
};

/** fn'in suresi (ms) — es zamanli ayristirma burada olay dongusunu kilitlerse sure uzar */
async function timed(fn: () => unknown): Promise<number> {
  const t = performance.now();
  await fn();
  return performance.now() - t;
}

describe('ReDoS — dusmanca girdi < 200 ms (once dakikalar)', () => {
  it('marka: 2 MB tire dizisi satir ici CSS (css.mjs) — CSS degiskeni deseni', async () => {
    const { extractBrand, colorFromCss } = await brandKit();
    // Dogrudan CSS ayristirici: kirpilmamis 2 MB tire, "--a" ile baslayan ve "a-" ile karisan diziler
    for (const css of ['-'.repeat(MB2), rep('--a'), rep('a-'), `--x:${'-'.repeat(MB2)}`, rep('--primary:')]) {
      expect(await timed(() => colorFromCss(css))).toBeLessThan(200);
    }
    expect(await timed(() => extractBrand(`<style>${'-'.repeat(MB2)}</style>`, 'https://example.com/', { fetcher: failingFetcher }))).toBeLessThan(200);
  });

  it('marka: kapanmayan <title><style> 2 MB (redos2.mjs), JSON-LD <script>, <meta / <link kapanmayan etiket', async () => {
    const { extractBrand, analyzeBrandPage } = await brandKit();
    for (const html of [
      rep('<title><style>'),
      rep('<script type="application/ld+json">'),
      rep('<meta '),
      rep('<link rel="icon" href="'),
      rep('<style>--a:'),
      `<title>${'<'.repeat(MB2)}`,
    ]) {
      expect(await timed(() => analyzeBrandPage(html, 'https://example.com/'))).toBeLessThan(200);
      expect(await timed(() => extractBrand(html, 'https://example.com/', { fetcher: failingFetcher }))).toBeLessThan(200);
    }
  });

  it('makale: kapanmayan <p>/<h1>/<title>, uzun sinif etiketi, kalin etiket geri izlemesi (ustel)', async () => {
    const { extractArticle } = await loadExtractKit();
    for (const html of [
      `<html><body><article>${rep('<p>')}</article></body></html>`,
      rep('<title><h1>'),
      rep('<div class="entry-content x'),
      rep('<div class="entry-content">'),
      rep('<li><blockquote>'),
      // eski allBold deseni: 28 kalin eleman + eslesmeyen kuyruk = 2^27 geri izleme (~12 sn)
      `<article><p>${'<b>x</b>'.repeat(40)}y</p></article>`,
      `<html lang="${'a'.repeat(MB2)}`,
    ]) {
      expect(await timed(() => extractArticle(html, 'https://example.com/a'))).toBeLessThan(200);
    }
  });

  it('girdi tavani: anasayfa 300 KB, satir ici CSS 300 KB, makale 600 KB sonrasi okunmaz', async () => {
    const { analyzeBrandPage, MAX_CSS_CHARS } = await brandKit();
    const { MAX_HTML_CHARS } = await htmlKit();
    expect(MAX_HTML_CHARS).toBe(300_000);
    const big = analyzeBrandPage(`<style>${'a'.repeat(MB2)}</style>${'<link rel="icon" href="/gec.png">'}`, 'https://e.com/');
    expect(big.truncated).toBe(true);
    expect(big.inlineCss.length).toBeLessThanOrEqual(MAX_CSS_CHARS);
    // Tavandan sonraki etiket hic gorulmez
    expect(big.candidates.map((c: any) => c.href)).toEqual(['/favicon.ico']);
    const { extractArticle } = await loadExtractKit();
    const a = extractArticle(`<article><p>Bas paragraf burada.</p>${' '.repeat(700_000)}<h2>Gec baslik</h2></article>`, 'https://e.com/a');
    expect(a.blocks.map((b: any) => b.text)).not.toContain('Gec baslik');
  });

  it('makale govdesi (DB): kapanmayan binlerce <h1> dogrusal atilir', () => {
    const body = rep('<h1>x');
    const t = performance.now();
    expect(removeH1(body)).toBe(body);
    expect(performance.now() - t).toBeLessThan(200);
    // Worker'in kullandigi belge kurucu da ayni yoldan gecer (DB'deki bodyHtml guvenilmeyen kiraci verisi)
    const t2 = performance.now();
    articleHtmlDocument({ title: 'Baslik' }, body);
    expect(performance.now() - t2).toBeLessThan(200);
    // Anlam ayni: kapanisli H1 atilir, digerleri kalir
    expect(removeH1('a<h1 class="x">Baslik</h1>b<H1>Iki</H1 >c')).toBe('abc');
  });

  it('anlam korunur: kalin "sahte baslik", JSON-LD, title kuyrugu ve elemanlar eskisi gibi okunur', async () => {
    const { extractArticle } = await loadExtractKit();
    const a = extractArticle(
      `<html lang="tr"><head><title>Yazi | Ornek</title><script type="application/ld+json">{"@type":"BlogPosting","headline":"Fatura finansmanı nedir?"}</script></head>
       <body><div class="post-content"><p><strong>Nasıl çalışır</strong></p><p>Birinci paragraf burada yazıyor.</p><p>İkinci paragraf.</p><ul><li>bir madde burada</li></ul><h2>Bölüm</h2><p>Metin.</p></div></body></html>`,
      'https://ornek.com/a',
    );
    expect(a.title).toBe('Fatura finansmanı nedir?');
    expect(a.bodyVia).toBe('class:post-content');
    expect(a.blocks.filter((b: any) => b.type === 'heading').map((b: any) => b.text)).toEqual(['Nasıl çalışır', 'Bölüm']);
    expect(a.lang).toBe('tr');
    const { analyzeBrandPage } = await brandKit();
    const p = analyzeBrandPage('<title>Ana Sayfa | Örnek Klinik</title><style>:root{--brand-primary:#1d4ed8}</style>', 'https://www.ornek.com/');
    expect(p.name).toBe('Örnek Klinik');
    expect(p.inlineCss).toContain('--brand-primary');
  });
});

describe('gecersiz HTML varligi (html.mjs decode)', () => {
  it('&#x110000; / &#xD800; / &#99999999999; RangeError atmaz, oldugu gibi kalir; gecerli varlik cozulur', async () => {
    const { decode } = await htmlKit();
    expect(decode('a&#x110000;b')).toBe('a&#x110000;b');
    expect(decode('&#xD800;&#56320;')).toBe('&#xD800;&#56320;');
    expect(decode('&#99999999999999999999;')).toBe('&#99999999999999999999;');
    expect(decode('&#65;&#x1F600;&amp;')).toBe('A\u{1F600}&');
    // Ayristirma bu yuzden dusmez (dusmanca sayfa = marka / makale yok olurdu)
    const { extractArticle } = await loadExtractKit();
    expect(() => extractArticle('<title>X &#x110000; Y</title><article><h2>Baslik &#xDFFF;</h2><p>Metin.</p></article>', 'https://e.com/a')).not.toThrow();
    const { analyzeBrandPage } = await brandKit();
    expect(analyzeBrandPage('<meta property="og:site_name" content="Ad &#x110000;">', 'https://e.com/').name).toBe('Ad &#x110000;');
  });
});

describe('logo adayi tavani ve toplam son tarih', () => {
  it('41 bin <link rel=icon> (cands.mjs): en fazla 6 indirme denemesi, varsayilan /favicon.ico dahil', async () => {
    const { extractBrand, MAX_LOGO_CANDIDATES } = await loadBrandKit();
    let n = 0;
    const html = Array.from({ length: 41_000 }, (_, i) => `<link rel="icon" href="https://slow.example/i${i}.png">`).join('');
    const tried: string[] = [];
    const fetcher = vi.fn(async (url: string) => {
      n++;
      tried.push(url);
      throw new Error('zaman asimi');
    });
    await extractBrand(html, 'https://example.com/', { fetcher, prepareLogo: async () => null });
    expect(MAX_LOGO_CANDIDATES).toBe(6);
    expect(n).toBeLessThanOrEqual(MAX_LOGO_CANDIDATES);
    expect(tried).toContain('https://example.com/favicon.ico');
  });

  it('asili indirici: tum cikarim deadlineMs sonunda biter, bulunanla doner (sonsuz bekleme yok)', async () => {
    const { extractBrand } = await loadBrandKit();
    const html = '<meta property="og:site_name" content="Örnek"><link rel="icon" href="/a.png"><link rel="stylesheet" href="/s.css">';
    const never = vi.fn(() => new Promise<never>(() => undefined));
    const t = performance.now();
    const b = await extractBrand(html, 'https://ornek.com/', { fetcher: never as any, deadlineMs: 150 });
    expect(performance.now() - t).toBeLessThan(1000);
    expect(b.name).toBe('Örnek');
    expect(b.notes.join(' ')).toMatch(/marka suresi doldu/);
    expect(never.mock.calls.length).toBeLessThanOrEqual(2);
  });

  it('cagiranin sinyali (render isinin toplam suresi) cikarimi keser', async () => {
    const { extractBrand } = await loadBrandKit();
    const ac = new AbortController();
    setTimeout(() => ac.abort(new Error('is zaman asimi')), 50);
    const t = performance.now();
    const b = await extractBrand('<link rel="icon" href="/a.png">', 'https://ornek.com/', { fetcher: (() => new Promise(() => undefined)) as any, signal: ac.signal });
    expect(performance.now() - t).toBeLessThan(1000);
    expect(b.logoDataUri).toBeNull();
  });
});

describe('API olay dongusu — ayristirma worker_thread\'de, sert sure siniri', () => {
  const tmp = mkdtempSync(path.join(os.tmpdir(), 'brand-sandbox-'));
  afterAll(() => rmSync(tmp, { recursive: true, force: true }));

  it('sonsuz donguye giren ayristirma API\'yi kilitlemez: is parcacigi sure sonunda durdurulur', async () => {
    // Gozden kacmis bir ReDoS'un benzeri: is parcacigi hic donmuyor
    const spin = path.join(tmp, 'spin.mjs');
    writeFileSync(spin, 'for (;;) {}\n');
    let ticks = 0;
    const iv = setInterval(() => ticks++, 10);
    const t = performance.now();
    await expect(runInWorker('analyze', [], { file: spin, timeoutMs: 300 })).rejects.toBeInstanceOf(BrandSandboxError);
    clearInterval(iv);
    expect(performance.now() - t).toBeLessThan(2000);
    // Bu surede ana surecin olay dongusu calismaya devam etti
    expect(ticks).toBeGreaterThan(5);
  });

  it('is parcacigindaki ayristirma ayni sonucu verir; dusmanca 2 MB girdi de hizli doner', async () => {
    const { analyzeBrandPage } = await brandKit();
    const html = '<meta property="og:site_name" content="Örnek"><meta name="theme-color" content="#1d4ed8"><link rel="apple-touch-icon" href="/t.png">';
    expect(await sandboxedBrandCompute('analyze', [html, 'https://ornek.com/'])).toEqual(analyzeBrandPage(html, 'https://ornek.com/'));
    expect(await sandboxedBrandCompute('cssColor', [':root{--primary:#dc2626}'])).toEqual({ hex: '#dc2626', source: 'css-degiskeni:--primary' });
    await expect(sandboxedBrandCompute('yok', [])).rejects.toThrow(/bilinmeyen islem/);
  });

  it('sunucu marka cikarimi (GET .../videos/brand) varsayilan olarak is parcacigini kullanir', async () => {
    const page = (text: string): SafeTextResult => ({ status: 200, ok: true, url: 'https://ornek.com/', redirected: false, contentType: 'text/html', headers: {}, text, truncated: false, binary: false });
    let compute: unknown;
    const kit = { extractBrand: vi.fn(async (_h: string, _u: string, opts: any) => {
      compute = opts.compute;
      return { name: 'X', domain: 'ornek.com', primary: null, colorSource: 'yok', logo: null, logoDataUri: null, notes: [] };
    }) } as any;
    await extractSiteBrand({ url: 'https://ornek.com/' }, { kit, fetchText: (async () => page('<html></html>')) as any });
    expect(compute).toBe(sandboxedBrandCompute);
    // Gercek kit + dusmanca 2 MB anasayfa: ana surecin olay dongusu kilitlenmez
    let ticks = 0;
    const iv = setInterval(() => ticks++, 5);
    const b = await extractSiteBrand({ url: 'https://ornek.com/', name: 'Örnek' }, {
      kit: await loadBrandKit(),
      fetchText: (async () => page(rep('<title><style>'))) as any,
      fetchBinary: (async () => { throw new Error('ag yok'); }) as any,
    });
    clearInterval(iv);
    expect(b.name).toBeTruthy();
    expect(ticks).toBeGreaterThan(0);
  });
});

describe('render iptali — ffmpeg oldurulur', () => {
  it('signal kesilince calisan ffmpeg SIGKILL ile kapanir (zaman asimindaki is CPU yemeye devam etmez)', async () => {
    const { runFfAsync } = await import(pathToFileURL(path.join(VIDEO_APP_DIR, 'scripts/ffmpeg.mjs')).href);
    const ac = new AbortController();
    // /dev/zero'dan gercek zamanli (-re) sonsuz ham goruntu; kodlayici gerektirmez (-c copy)
    const run = runFfAsync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-re', '-f', 'rawvideo', '-pix_fmt', 'gray', '-s', '16x16', '-i', '/dev/zero', '-c', 'copy', '-f', 'null', '-'], { timeoutMs: 60_000, signal: ac.signal });
    setTimeout(() => ac.abort(new Error('is zaman asimi')), 300);
    const t = performance.now();
    // Red yalniz surec kapandiginda ('close') gelir: red = ffmpeg artik yok
    await expect(run).rejects.toThrow(/is zaman asimi/);
    expect(performance.now() - t).toBeLessThan(5000);
    // Zaten kesilmis sinyalle hic baslatilmaz
    await expect(runFfAsync('ffmpeg', ['-version'], { signal: ac.signal })).rejects.toThrow(/is zaman asimi/);
  });
});
