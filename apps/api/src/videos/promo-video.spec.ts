import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { BadRequestException, ConflictException, ForbiddenException, ValidationPipe } from '@nestjs/common';
import { QuotaService } from '../billing/quota.service.js';
import { makeSafeTextFetch, SafeFetchError } from '../common/safe-fetch.js';
import { VideosService } from './videos.service.js';
import { RequestVideoDto } from './videos.dto.js';
import { ARTICLE_SHORT_ENGINE, PRODUCT_IMAGE_MAX_BYTES, PRODUCT_IMAGE_MAX_PX } from './article-video.config.js';
import { buildPromoCopy, VideoCopyError } from './article-video-copy.js';
import {
  assertOwnSitePageUrl, buildPromoSource, fetchOwnPage, fetchProductImage, OTHER_HOST_MESSAGE, prepareProductImage, profileFromBrain,
  PromoSourceError, sameSiteHost,
} from './promo-video-source.js';
import { loadPageKit, loadPromoCopyKit, type PromoSource, type RenderKit } from './article-short-kit.js';
import { VideoRenderService } from './video-render.service.js';
import { canTransition, toVideoView } from './article-video-view.js';
import { runInWorker } from './brand-sandbox.js';

/**
 * RanksUp Video — site ve urun tanitim videolari.
 *  - urun sayfasi YALNIZ sitenin alan adinda (baska alan adi, IP, yonlendirme ile kacis yok)
 *  - urun gorseli tavanlari (bayt, piksel, SVG yok, cikti boyutu)
 *  - fiyat YALNIZ iki kaynakla dogrulanmissa (yapisal + gorunur metin) ve sayi korumasindan gecerse
 *  - sayi korumasi yeni turlerde de: her sayi sitenin kendi metninde; profil sayi kaynagi degil
 *  - LLM yoksa / reddedilirse cikarimsal metin
 *  - aylik hak uc turde ORTAK; govde geriye uyumlu (type yoksa makale)
 *  - dusmanca girdide ayristirma hizli (dogrusal)
 */

const SITE_URL = 'https://www.ornekdukkan.com.tr';

/* ───────────── ornek sayfalar ───────────── */

const HOME_HTML = `<!doctype html><html lang="tr"><head><title>Örnek Dükkan | El yapımı seramik</title>
<meta name="description" content="Örnek Dükkan, el yapımı seramik kupa ve tabakları 2012'den beri İzmir atölyesinde üretir. Siparişleri 3 iş gününde kargolar.">
<script type="application/ld+json">{"@context":"https://schema.org","@type":"Organization","name":"Örnek Dükkan","description":"El yapımı seramik kupa, tabak ve vazo üreten aile atölyesi."}</script>
</head><body><header><nav><ul><li>Ana sayfa</li><li>Mağaza</li></ul></nav></header>
<main><h1>El yapımı seramikler, atölyeden kapınıza</h1>
<section><h2>Neler yapıyoruz?</h2>
<div class="card"><h3>Kupalar</h3><p>Her kupa elde şekillendirilir ve sırlanır.</p></div>
<div class="card"><h3>Tabaklar</h3><p>Günlük kullanıma uygun dayanıklı tabaklar.</p></div>
<div class="card"><h3>Vazolar</h3><p>Tek parça, numaralı vazolar.</p></div>
</section>
<section><h2>Sıkça Sorulan Sorular</h2><h3>Kargo ne kadar sürer?</h3><p>3 iş günü.</p></section>
</main><footer><h3>İletişim</h3><p>© 2026 Örnek Dükkan</p></footer></body></html>`;

function productHtml(opts: { ldPrice?: string | number | null; visible?: string | null; currency?: string; image?: string; extraOffers?: Array<number> } = {}) {
  const offers: unknown[] = [];
  if (opts.ldPrice !== null && opts.ldPrice !== undefined) offers.push({ '@type': 'Offer', price: opts.ldPrice, priceCurrency: opts.currency ?? 'TRY' });
  for (const p of opts.extraOffers ?? []) offers.push({ '@type': 'Offer', price: p, priceCurrency: 'TRY' });
  const ld = {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: 'Mavi Sırlı Kupa',
    description: 'Elde şekillendirilmiş mavi sırlı seramik kupa. Bulaşık makinesinde yıkanabilir. Her kupa tek ve benzersizdir.',
    image: opts.image ?? 'https://cdn.ornekdukkan.com.tr/img/kupa.jpg',
    brand: { '@type': 'Brand', name: 'Örnek Dükkan' },
    ...(offers.length ? { offers } : {}),
  };
  return `<!doctype html><html lang="tr"><head><title>Mavi Sırlı Kupa | Örnek Dükkan</title>
<meta property="og:image" content="https://cdn.ornekdukkan.com.tr/img/kupa-og.jpg">
<meta name="description" content="Mavi sırlı kupa, 350 ml hacimli el yapımı seramik kupa.">
<script type="application/ld+json">${JSON.stringify(ld)}</script></head>
<body><main><h1>Mavi Sırlı Kupa</h1>
${opts.visible ? `<div class="price"><span>Fiyat:</span> <span class="amount">${opts.visible}</span></div>` : ''}
<div class="eski">Eski fiyat: <s>899,00 TL</s></div>
<ul><li>350 ml hacim</li><li>Bulaşık makinesinde yıkanabilir</li></ul>
<div class="attr"><span>Malzeme:</span> <span>Taş seramik</span></div>
<div class="attr"><span>Renk:</span> <span>Mavi</span></div>
</main></body></html>`;
}

/* ───────────── 1) alan adi kurali ───────────── */

describe('urun sayfasi yalniz sitenin kendi alan adinda', () => {
  it('ayni kayitli alan adi (www, alt alan, .com.tr) kabul; normallestirilir', () => {
    expect(assertOwnSitePageUrl('https://www.ornekdukkan.com.tr/urun/kupa#yorumlar', SITE_URL)).toBe('https://www.ornekdukkan.com.tr/urun/kupa');
    expect(assertOwnSitePageUrl('ornekdukkan.com.tr/urun/kupa', SITE_URL)).toBe('https://ornekdukkan.com.tr/urun/kupa');
    expect(assertOwnSitePageUrl('https://magaza.ornekdukkan.com.tr/p/1', SITE_URL)).toBe('https://magaza.ornekdukkan.com.tr/p/1');
  });

  it.each([
    ['baska alan adi', 'https://rakip.com/urun/kupa'],
    ['benzer ad (kotu-...)', 'https://kotu-ornekdukkan.com.tr/urun'],
    ['alan adi sonek hilesi', 'https://ornekdukkan.com.tr.evil.com/urun'],
    ['ayni kok, baska kayitli alan adi (.com)', 'https://ornekdukkan.com/urun'],
  ])('%s reddedilir (Turkce mesaj)', (_ad, url) => {
    expect(() => assertOwnSitePageUrl(url, SITE_URL)).toThrow(PromoSourceError);
    try {
      assertOwnSitePageUrl(url, SITE_URL);
    } catch (e: any) {
      expect(e.userMessage).toBe(OTHER_HOST_MESSAGE);
    }
  });

  it.each([
    ['IPv4', 'http://93.184.216.34/urun'],
    ['IPv6', 'http://[2606:2800:220:1::1]/urun'],
    ['yerel IP', 'http://127.0.0.1/urun'],
    ['kimlik bilgisi', 'https://kul:sifre@www.ornekdukkan.com.tr/urun'],
    ['standart disi port', 'https://www.ornekdukkan.com.tr:8443/urun'],
    ['http disi sema', 'ftp://www.ornekdukkan.com.tr/urun'],
    ['javascript', 'javascript:alert(1)'],
    ['bos', '   '],
  ])('%s reddedilir', (_ad, url) => {
    expect(() => assertOwnSitePageUrl(url, SITE_URL)).toThrow(PromoSourceError);
  });

  it('site adresi IP ise hicbir sey eslesmez', () => {
    expect(sameSiteHost('127.0.0.1', 'http://127.0.0.1/')).toBe(false);
  });
});

describe('yonlendirme alan adinin disina cikamaz (gercek safe-fetch, yerel sunucu)', () => {
  let server: http.Server;
  let port = 0;
  const hits: string[] = [];
  beforeAll(async () => {
    server = http.createServer((req, res) => {
      hits.push(`${req.headers.host}${req.url}`);
      if (req.url === '/kendi') return void res.writeHead(302, { location: `http://localhost:${port}/hedef` }).end();
      if (req.url === '/disari') return void res.writeHead(302, { location: `http://127.0.0.1:${port}/gizli` }).end();
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end('<html><title>Sayfa</title><body><h1>Merhaba</h1></body></html>');
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
    port = (server.address() as AddressInfo).port;
  });
  afterAll(() => server.close());
  // Test icin yerel adrese baglanmaya izin veren safe-fetch (uretimde ozel IP'ler engelli)
  const fetchText = makeSafeTextFetch({ isBlocked: () => false, allowAnyPort: true });

  it('ayni ana bilgisayara yonlendirme izlenir', async () => {
    const site = `http://localhost:${port}/`;
    const page = await fetchOwnPage(`http://localhost:${port}/kendi`, site, { fetchText });
    expect(page.url).toBe(`http://localhost:${port}/hedef`);
    expect(page.text).toContain('Merhaba');
  });

  it('baska ana bilgisayara (IP) yonlendirme: hedefe ISTEK ATILMADAN reddedilir', async () => {
    const site = `http://localhost:${port}/`;
    hits.length = 0;
    const err = await fetchOwnPage(`http://localhost:${port}/disari`, site, { fetchText }).catch((e) => e);
    expect(err).toBeInstanceOf(PromoSourceError);
    expect(err.userMessage).toMatch(/başka bir alan adına yönlendiriyor/);
    expect(hits).toEqual([`localhost:${port}/disari`]); // /gizli hic istenmedi
  });

  it('safe-fetch allowRedirect kancasi: false -> redirect hatasi', async () => {
    const err = await fetchText(`http://localhost:${port}/disari`, { allowRedirect: () => false }).catch((e) => e);
    expect(err).toBeInstanceOf(SafeFetchError);
    expect(err.code).toBe('redirect');
  });

  it('ikinci savunma: son adres alan adi disindaysa (kanca atlatilsa bile) reddedilir', async () => {
    const lying = async () => ({ status: 200, ok: true, url: 'https://rakip.com/x', redirected: true, contentType: 'text/html', headers: {}, text: '<html></html>', truncated: false, binary: false });
    await expect(fetchOwnPage(`${SITE_URL}/urun`, SITE_URL, { fetchText: lying })).rejects.toThrow(/alan adi disi/);
  });

  it('HTML olmayan icerik ve HTTP hatasi Turkce mesajla reddedilir', async () => {
    const pdf = async (url: string) => ({ status: 200, ok: true, url, redirected: false, contentType: 'application/pdf', headers: {}, text: '', truncated: false, binary: true });
    await expect(fetchOwnPage(`${SITE_URL}/k.pdf`, SITE_URL, { fetchText: pdf })).rejects.toMatchObject({ userMessage: expect.stringMatching(/web sayfası değil/) });
    const notFound = async (url: string) => ({ status: 404, ok: false, url, redirected: false, contentType: 'text/html', headers: {}, text: '', truncated: false, binary: false });
    await expect(fetchOwnPage(`${SITE_URL}/yok`, SITE_URL, { fetchText: notFound })).rejects.toMatchObject({ userMessage: expect.stringMatching(/HTTP 404/) });
  });
});

/* ───────────── 2) urun gorseli ───────────── */

describe('urun gorseli tavanlari', () => {
  const png = (w: number, h: number, alpha = false) => sharp({ create: { width: w, height: h, channels: alpha ? 4 : 3, background: alpha ? { r: 10, g: 80, b: 200, alpha: 0.5 } : { r: 10, g: 80, b: 200 } } }).png().toBuffer();

  it('buyuk gorsel en fazla 1280 px JPEG; saydam gorsel PNG', async () => {
    const big = await prepareProductImage(await png(3000, 2000), 'image/png');
    expect(big).toMatchObject({ type: 'image/jpeg', width: PRODUCT_IMAGE_MAX_PX });
    expect(big!.height).toBeLessThanOrEqual(PRODUCT_IMAGE_MAX_PX);
    const alpha = await prepareProductImage(await png(600, 600, true), 'image/png');
    expect(alpha?.type).toBe('image/png');
  });

  it('SVG (tur ya da icerik koklamasi), cok kucuk, bozuk ve piksel bombasi reddedilir', async () => {
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="800" height="800"><script>alert(1)</script><rect width="800" height="800"/></svg>');
    expect(await prepareProductImage(svg, 'image/svg+xml')).toBeNull();
    expect(await prepareProductImage(svg, 'image/png')).toBeNull(); // yanlis tur bildirse de
    expect(await prepareProductImage(await png(120, 120), 'image/png')).toBeNull();
    expect(await prepareProductImage(Buffer.from('bozuk-veri'.repeat(50)), 'image/jpeg')).toBeNull();
    // 8000x8000 = 64 M piksel > 40 M tavan (decompression bomb): sharp cozmeden reddeder
    const bomb = await sharp({ create: { width: 8000, height: 8000, channels: 3, background: '#000' } }).png({ compressionLevel: 9 }).toBuffer();
    expect(await prepareProductImage(bomb, 'image/png')).toBeNull();
  });

  it('indirme: bayt tavani + yalniz image/*; kullanilamayan aday atlanir, siradaki denenir', async () => {
    const good = await png(800, 800);
    const calls: any[] = [];
    const fetchBinary = vi.fn(async (url: string, opts: any) => {
      calls.push({ url, opts });
      if (url.endsWith('svg')) return { url, contentType: 'image/svg+xml', body: Buffer.from('<svg/>') };
      if (url.endsWith('buyuk')) throw new SafeFetchError('too_large', 'sinir');
      return { url, contentType: 'image/png', body: good };
    });
    const notes: string[] = [];
    const img = await fetchProductImage(['https://cdn.x.com/a.svg', 'https://cdn.x.com/buyuk', 'https://cdn.x.com/ok.png', 'https://cdn.x.com/dorduncu.png'], { fetchBinary }, notes);
    expect(img?.dataUri).toMatch(/^data:image\/jpeg;base64,/);
    expect(img?.source).toBe('https://cdn.x.com/ok.png');
    expect(calls).toHaveLength(3);
    for (const c of calls) {
      expect(c.opts.maxBytes).toBe(PRODUCT_IMAGE_MAX_BYTES);
      expect(c.opts.accept.test('image/png')).toBe(true);
      expect(c.opts.accept.test('text/html')).toBe(false);
    }
    expect(notes.join(' ')).toMatch(/svg/);
    expect(notes.join(' ')).toMatch(/too_large/);
  });
});

/* ───────────── 3) sayfa ayristirma + fiyat (iki kaynak) ───────────── */

describe('fiyat yalniz dogrulanmissa', () => {
  const url = `${SITE_URL}/urun/mavi-kupa`;
  it('JSON-LD + gorunur metin ayni tutar -> dogrulanmis; gosterilen yazim sayfadaki gibi', async () => {
    const { extractPage } = await loadPageKit();
    const p = extractPage(productHtml({ ldPrice: '749.90', visible: '749,90 TL' }), url, { kind: 'product' });
    expect(p.price).toMatchObject({ verified: true, display: '749,90 TL', value: 749.9, currency: 'TRY', sources: ['json-ld', 'gorunur-metin'] });
    expect(p.product?.name).toBe('Mavi Sırlı Kupa');
    expect(p.images[0]).toBe('https://cdn.ornekdukkan.com.tr/img/kupa.jpg');
  });

  it.each([
    ['yalniz JSON-LD (gorunur metinde yok)', { ldPrice: '749.90', visible: null }, /gorunur metninde yok/],
    ['yalniz gorunur metin (yapisal yok)', { ldPrice: null, visible: '749,90 TL' }, /yapisal fiyat yok/],
    ['tutarlar farkli', { ldPrice: '749.90', visible: '699,90 TL' }, /gorunur metninde yok/],
    ['para birimi farkli', { ldPrice: '749.90', visible: '749,90 TL', currency: 'USD' }, /gorunur metninde yok/],
    ['birden fazla yapisal fiyat (varyant)', { ldPrice: '749.90', visible: '749,90 TL', extraOffers: [799.9] }, /birden fazla/],
  ])('%s -> fiyat gosterilmez', async (_ad, opts, reason) => {
    const { extractPage } = await loadPageKit();
    const p = extractPage(productHtml(opts as any), url, { kind: 'product' });
    expect(p.price.verified).toBe(false);
    expect(p.price.reason).toMatch(reason);
    expect(p.price.display).toBeUndefined();
  });

  it('eski fiyat / ozellik satirindaki tutar madde olarak videoya girmez', async () => {
    const { extractPage } = await loadPageKit();
    const p = extractPage(productHtml({ ldPrice: '749.90', visible: '749,90 TL' }), url, { kind: 'product' });
    const pairs = p.pairs.filter((x: any) => !x.boring).map((x: any) => x.raw);
    expect(pairs).toEqual(['Malzeme: Taş seramik', 'Renk: Mavi']);
    expect(p.pairs.find((x: any) => /Eski fiyat/.test(x.raw))?.boring).toBe(true);
  });

  it('fiyat yazimi da sayi korumasindan gecer (verifyPriceText)', async () => {
    const { extractPage } = await loadPageKit();
    const kit = await loadPromoCopyKit();
    const p = extractPage(productHtml({ ldPrice: '749.90', visible: '749,90 TL' }), url, { kind: 'product' });
    const src = buildPromoSource(p, { type: 'product', siteUrl: SITE_URL, profile: null });
    expect(kit.verifyPriceText('749,90 TL', src)).toBe(true);
    expect(kit.verifyPriceText('649,90 TL', src)).toBe(false);
    expect(kit.verifyPriceText('Ucuz', src)).toBe(false);
  });
});

/* ───────────── 4) metin: sayi korumasi + cikarimsal yedek ───────────── */

async function siteSource(profile: PromoSource['profile'] = null): Promise<PromoSource> {
  const { extractPage } = await loadPageKit();
  return buildPromoSource(extractPage(HOME_HTML, `${SITE_URL}/`, { kind: 'site' }), { type: 'site', siteUrl: SITE_URL, siteLanguage: 'tr', profile });
}

describe('tanitim metni — cikarimsal ve koruyucu', () => {
  it('site: kanca H1, alt satir kurum aciklamasi, uc hizmet karti; SSS/iletisim/menu secilmez', async () => {
    const kit = await loadPromoCopyKit();
    const src = await siteSource();
    const s = kit.extractivePromoScript(src, 'site');
    expect(s.hook).toBe('El yapımı seramikler, atölyeden kapınıza');
    expect(s.hookSub).toBe('El yapımı seramik kupa, tabak ve vazo üreten aile atölyesi.');
    expect(s.points.map((p) => p.title)).toEqual(['Kupalar', 'Tabaklar', 'Vazolar']);
    expect(s.points[0].detail).toBe('Her kupa elde şekillendirilir ve sırlanır.');
    expect(s.cta).toEqual({ label: 'Sitemizi ziyaret edin', domain: 'ornekdukkan.com.tr', url: `${SITE_URL}/` });
    // her alanin kaynak satiri var
    expect(s.evidence.map((e) => e.field)).toEqual(expect.arrayContaining(['hook', 'hookSub', 'points[0].title', 'points[0].detail']));
    expect(kit.validatePromoScript(s, src)).toMatchObject({ ok: true, errors: [] });
  });

  it('urun: ad + fayda + aciklama cumleleri; CTA sayfanin kisa adresi', async () => {
    const { extractPage } = await loadPageKit();
    const kit = await loadPromoCopyKit();
    const src = buildPromoSource(extractPage(productHtml({ ldPrice: '749.90', visible: '749,90 TL' }), `${SITE_URL}/urun/mavi-kupa`, { kind: 'product' }), { type: 'product', siteUrl: SITE_URL, profile: null });
    const s = kit.extractivePromoScript(src, 'product');
    expect(s.hook).toBe('Mavi Sırlı Kupa');
    expect(s.hookSub).toBe('Mavi sırlı kupa, 350 ml hacimli el yapımı seramik kupa.');
    expect(s.kicker).toBe('Örnek Dükkan');
    expect(s.points.map((p) => p.title)).toEqual(['Elde şekillendirilmiş mavi sırlı seramik kupa', 'Bulaşık makinesinde yıkanabilir', 'Her kupa tek ve benzersizdir']);
    expect(s.cta).toMatchObject({ label: 'Hemen inceleyin', domain: 'ornekdukkan.com.tr/urun/mavi-kupa' });
    expect(kit.validatePromoScript(s, src).ok).toBe(true);
  });

  it('SAYI KORUMASI: sayfada olmayan sayi reddedilir (alt-dize degil: "2012" iceren sayfa "20"yi hakli cikarmaz)', async () => {
    const kit = await loadPromoCopyKit();
    const src = await siteSource();
    const base = kit.extractivePromoScript(src, 'site');
    expect(kit.validatePromoScript({ ...base, hookSub: '2012\'den beri üretim' }, src).ok).toBe(true);
    for (const bad of ['20 yıllık atölye', '%50 indirim', '3 günde kargo, 1000 müşteri', '12 çeşit kupa']) {
      const r = kit.validatePromoScript({ ...base, hookSub: bad }, src);
      expect(r.ok, bad).toBe(false);
      expect(r.errors.join(' '), bad).toMatch(/sayfada yok/);
    }
  });

  it('profil (Brain) kelime baglamidir ama SAYI KAYNAGI DEGIL; taranmis sayfa basliklari sitenin metnidir', async () => {
    const kit = await loadPromoCopyKit();
    const profile = profileFromBrain(
      { url: SITE_URL, customNiche: 'el yapımı seramik atölyesi' },
      { brandVoice: { brandPromise: '500 mutlu müşteriye ulaşan butik atölye' }, sitePages: [{ url: `${SITE_URL}/koleksiyon-2025`, title: 'Koleksiyon 2025' }, { url: 'https://rakip.com/x', title: 'Rakip 999' }] },
    );
    expect(profile?.pages).toEqual([{ title: 'Koleksiyon 2025', url: `${SITE_URL}/koleksiyon-2025` }]);
    const src = await siteSource(profile);
    const base = kit.extractivePromoScript(src, 'site');
    expect(kit.validatePromoScript({ ...base, hookSub: '500 mutlu müşteri' }, src).ok).toBe(false);
    expect(kit.validatePromoScript({ ...base, hookSub: 'Koleksiyon 2025 yayında' }, src).ok).toBe(true);
    expect(kit.validatePromoScript({ ...base, hookSub: 'Rakip 999' }, src).ok).toBe(false);
  });

  it('LLM yok / hata -> cikarimsal; uydurma sayili LLM ciktisi reddedilip cikarimsal kullanilir; butce doluysa model cagrilmaz', async () => {
    const kit = await loadPromoCopyKit();
    const src = await siteSource();
    const ctx = { userId: 'u1', siteId: 's1', videoId: 'v1' };
    const down = await buildPromoCopy(src, ctx, { kit, chat: async () => { throw new Error('AI kapali'); } });
    expect(down).toMatchObject({ strategy: 'extractive', llmRejected: 'AI kapali', costUsd: 0 });

    const lying = vi.fn(async () => ({
      output: JSON.stringify({ hook: 'Türkiye\'nin 1 numaralı atölyesi', points: [{ title: 'Kupalar' }, { title: 'Tabaklar' }, { title: 'Vazolar' }], evidence: [] }),
      stopReason: 'end_turn', costUsd: 0.0012, usage: { inputTokens: 1, outputTokens: 1 },
    }) as any);
    const r = await buildPromoCopy(src, ctx, { kit, chat: lying });
    expect(r.strategy).toBe('extractive');
    expect(r.llmRejected).toMatch(/koruyucu reddetti.*sayfada yok/);
    expect(r.costUsd).toBe(0.0012); // reddedilen cagri da kayda gecer
    expect(r.script.hook).toBe('El yapımı seramikler, atölyeden kapınıza');
    const req = (lying.mock.calls as any[])[0][0];
    expect(req.model).toBe('claude-haiku-5-5');
    expect(JSON.stringify(req)).not.toMatch(/data:image|logoDataUri/); // modele gorsel / logo gitmez

    const honest = vi.fn(async () => ({
      output: JSON.stringify({ hook: 'El yapımı seramik atölyesi', hookSub: 'Kupa, tabak ve vazo', points: [{ title: 'Kupalar' }, { title: 'Tabaklar' }, { title: 'Vazolar' }], evidence: [{ field: 'hook', source: 'El yapımı seramikler' }] }),
      stopReason: 'end_turn', costUsd: 0.001,
    }) as any);
    const ok = await buildPromoCopy(src, ctx, { kit, chat: honest });
    expect(ok.strategy).toBe('llm');
    expect(ok.script.cta.url).toBe(`${SITE_URL}/`); // adres modelden alinmaz

    const chat = vi.fn();
    const blocked = await buildPromoCopy(src, ctx, { kit, chat, budgetBlocked: async () => true });
    expect(chat).not.toHaveBeenCalled();
    expect(blocked.strategy).toBe('extractive');
  });

  it('kaynakta uc nokta yoksa video uretilmez: Turkce hata', async () => {
    const { extractPage } = await loadPageKit();
    const kit = await loadPromoCopyKit();
    const thin = buildPromoSource(extractPage('<html><head><title>X</title></head><body><h1>Merhaba dünya sitesi</h1></body></html>', `${SITE_URL}/`, { kind: 'site' }), { type: 'site', siteUrl: SITE_URL, profile: null });
    await expect(buildPromoCopy(thin, { userId: 'u', siteId: 's', videoId: 'v' }, { kit, chat: async () => { throw new Error('x'); } })).rejects.toBeInstanceOf(VideoCopyError);
  });
});

/* ───────────── 5) dusmanca girdi: dogrusal ayristirma ───────────── */

describe('dusmanca sayfa: ayristirma hizli kalir (< 200 ms)', () => {
  const N = 590_000;
  const cases: Array<[string, string]> = [
    ['kapanmayan etiketler', '<div class="a"'.repeat(N / 14)],
    ['yalniz "<"', '<'.repeat(N)],
    ['fiyat benzeri rakam dizisi', '1,000'.repeat(N / 5)],
    ['TL ile rakam dizisi', '<p>' + '9.999,99 TL '.repeat(N / 12) + '</p>'],
    ['iki nokta satirlari', '<div>Etiket: deger</div>'.repeat(N / 24)],
    ['ic ice basliklar', '<h2>a</h2><h3>b</h3><h4>c</h4>'.repeat(N / 30)],
    ['kapanmayan JSON-LD', '<script type="application/ld+json">{"@type":"Product","name":"' + 'a'.repeat(N - 80)],
    ['itemprop yigini', '<span itemprop="price" content="1">'.repeat(N / 36)],
    ['uzun tek satir', 'a'.repeat(N)],
  ];
  it.each(cases)('%s', async (_ad, html) => {
    const { extractPage } = await loadPageKit();
    const kit = await loadPromoCopyKit();
    const doc = `<html><head><title>t</title></head><body><main>${html}</main></body></html>`;
    const t0 = performance.now();
    const p = extractPage(doc, `${SITE_URL}/urun`, { kind: 'product' });
    const src = buildPromoSource(p, { type: 'product', siteUrl: SITE_URL, profile: null });
    const s = kit.extractivePromoScript(src, 'product');
    kit.validatePromoScript(s, src);
    const ms = performance.now() - t0;
    expect(ms).toBeLessThan(200);
  });

  it('sunucuda ayristirma is parcaciginda: page islemi worker_thread uzerinden calisir', async () => {
    const r = await runInWorker<any>('page', [productHtml({ ldPrice: '749.90', visible: '749,90 TL' }), `${SITE_URL}/urun/k`, { kind: 'product' }]);
    expect(r.price.verified).toBe(true);
  });
});

/* ───────────── 6) istek: govde, alan adi, ortak hak, kilit ───────────── */

const SITE = 'cmsite000000000000000001';
const ART = 'cmart0000000000000000001';

function world(opts: { plan?: string; used?: number } = {}) {
  const user: any = { id: 'u1', plan: opts.plan ?? 'PRO', role: 'USER', videosUsedThisMonth: opts.used ?? 0, articlesUsedThisMonth: 0, articlesQuotaResetAt: new Date(), aiCostThisMonthUsd: 0 };
  const videos: any[] = [];
  const kv = new Map<string, { expiresAt: Date | null }>();
  let n = 0;
  const prisma: any = {
    user: {
      findUniqueOrThrow: vi.fn(async () => ({ ...user })),
      update: vi.fn(async ({ data }: any) => Object.assign(user, data)),
      updateMany: vi.fn(async ({ where, data }: any) => {
        const c = where.videosUsedThisMonth ?? {};
        if (c.lt !== undefined && !(user.videosUsedThisMonth < c.lt)) return { count: 0 };
        if (c.gt !== undefined && !(user.videosUsedThisMonth > c.gt)) return { count: 0 };
        const d = data.videosUsedThisMonth;
        user.videosUsedThisMonth += typeof d?.increment === 'number' ? d.increment : -(d?.decrement ?? 0);
        return { count: 1 };
      }),
    },
    site: { findUnique: vi.fn(async () => ({ id: SITE, url: SITE_URL, name: 'Örnek Dükkan', language: 'tr', userId: 'u1', user: { id: 'u1', plan: user.plan, role: 'USER' } })) },
    article: { findFirst: vi.fn(async ({ where }: any) => (where.id === ART ? { id: ART, title: 'Makale', status: 'PUBLISHED', language: 'tr' } : null)) },
    kvStore: {
      create: vi.fn(async ({ data }: any) => {
        if (kv.has(data.key)) throw new Error('Unique constraint failed');
        kv.set(data.key, { expiresAt: data.expiresAt });
        return data;
      }),
      deleteMany: vi.fn(async ({ where }: any) => {
        const e = kv.get(where.key);
        if (!e) return { count: 0 };
        // Suresi gecmemis kilit silinmez (yalniz "eski kilit" temizligi kosullu)
        if (where.expiresAt?.lt && !(e.expiresAt && e.expiresAt < where.expiresAt.lt)) return { count: 0 };
        kv.delete(where.key);
        return { count: 1 };
      }),
    },
    video: {
      findFirst: vi.fn(async ({ where }: any) => videos.find((v) => (!where.articleId || v.articleId === where.articleId) && where.status.in.includes(v.status)) ?? null),
      findMany: vi.fn(async ({ where }: any) => videos.filter((v) => v.siteId === where.siteId && where.status.in.includes(v.status) && v.providerRaw?.engine === where.providerRaw?.equals)),
      create: vi.fn(async ({ data }: any) => {
        const v = { id: `cmvideo00000000000000000${++n}`, createdAt: new Date(), updatedAt: new Date(), durationSec: null, videoUrl: null, thumbnailUrl: null, fileSize: null, errorMsg: null, completedAt: null, ...data };
        videos.push(v);
        return { ...v };
      }),
      update: vi.fn(async ({ where, data }: any) => Object.assign(videos.find((v) => v.id === where.id), data)),
      updateMany: vi.fn(async ({ where, data }: any) => {
        const v = videos.find((x) => x.id === where.id && (!where.status || x.status === where.status));
        if (!v) return { count: 0 };
        Object.assign(v, data);
        return { count: 1 };
      }),
    },
  };
  const quota = new QuotaService(prisma);
  const queue = { add: vi.fn(async (id: string) => id), remove: vi.fn(async () => true), state: vi.fn(async () => 'waiting') };
  return { svc: new VideosService(prisma, quota, queue as any), prisma, user, videos, queue, kv };
}
const me = { id: 'u1', role: 'USER' };

describe('istek govdesi (DTO) — geriye uyumlu', () => {
  const pipe = new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true });
  const body = (v: unknown) => pipe.transform(v, { type: 'body', metatype: RequestVideoDto, data: '' });

  it('eski istemci: yalniz articleId (type yok) gecer', async () => {
    await expect(body({ articleId: ART, primaryColor: '#1d4ed8', useLogo: false, brandName: 'X' })).resolves.toMatchObject({ articleId: ART });
  });
  it('site: makale gerekmez; urun: pageUrl zorunlu; bicim yalniz vertical|horizontal', async () => {
    await expect(body({ type: 'site', format: 'horizontal' })).resolves.toMatchObject({ type: 'site', format: 'horizontal' });
    await expect(body({ type: 'product', pageUrl: `${SITE_URL}/urun/k` })).resolves.toMatchObject({ type: 'product' });
    await expect(body({ type: 'product' })).rejects.toBeTruthy();
    await expect(body({ type: 'article' })).rejects.toBeTruthy(); // makale kimligi yok
    await expect(body({})).rejects.toBeTruthy();
    await expect(body({ type: 'video' })).rejects.toBeTruthy();
    await expect(body({ type: 'site', format: 'square' })).rejects.toBeTruthy();
    await expect(body({ type: 'product', pageUrl: 'x'.repeat(2001) })).rejects.toBeTruthy();
    await expect(body({ type: 'site', bilinmeyen: 1 })).rejects.toBeTruthy();
  });
});

describe('VideosService.request — site ve urun', () => {
  it('site tanitimi: Video satiri tur/bicim/sablon/kaynakla; aspectRatio 16:9; makale yok', async () => {
    const w = world();
    const r = await w.svc.request(SITE, me, { type: 'site', format: 'horizontal' });
    expect(r.video).toMatchObject({ type: 'site', format: 'horizontal', sourceUrl: SITE_URL, status: 'queued' });
    expect(w.videos[0]).toMatchObject({ articleId: null, aspectRatio: '16:9', title: 'Örnek Dükkan — site tanıtımı' });
    expect(w.videos[0].providerRaw).toMatchObject({ engine: ARTICLE_SHORT_ENGINE, videoType: 'site', format: 'horizontal', template: 'SiteIntroWide', sourceUrl: SITE_URL, charged: true });
    expect(w.kv.size).toBe(0);
  });

  it('urun: baska alan adi 400 (Turkce), hak dusmez, satir acilmaz', async () => {
    const w = world();
    const err = await w.svc.request(SITE, me, { type: 'product', pageUrl: 'https://rakip.com/urun' }).catch((e) => e);
    expect(err).toBeInstanceOf(BadRequestException);
    expect(err.message).toBe(OTHER_HOST_MESSAGE);
    expect(w.user.videosUsedThisMonth).toBe(0);
    expect(w.videos).toHaveLength(0);
  });

  it('urun: kendi sayfasi kabul; ayni sayfa + bicim icin suren video varsa 409; diger bicim serbest', async () => {
    const w = world();
    await w.svc.request(SITE, me, { type: 'product', pageUrl: `${SITE_URL}/urun/kupa` });
    expect(w.videos[0].providerRaw).toMatchObject({ videoType: 'product', template: 'ProductShort', sourceUrl: `${SITE_URL}/urun/kupa` });
    await expect(w.svc.request(SITE, me, { type: 'product', pageUrl: `${SITE_URL}/urun/kupa#x` })).rejects.toBeInstanceOf(ConflictException);
    await expect(w.svc.request(SITE, me, { type: 'product', pageUrl: `${SITE_URL}/urun/kupa`, format: 'horizontal' })).resolves.toBeTruthy();
    await expect(w.svc.request(SITE, me, { type: 'product', pageUrl: `${SITE_URL}/urun/tabak` })).resolves.toBeTruthy();
    expect(w.user.videosUsedThisMonth).toBe(3);
  });

  it('makale videosu yatay istenemez; tur ile uyusmayan alanlar 400', async () => {
    const w = world();
    await expect(w.svc.request(SITE, me, { articleId: ART, format: 'horizontal' })).rejects.toBeInstanceOf(BadRequestException);
    await expect(w.svc.request(SITE, me, { type: 'site', articleId: ART })).rejects.toBeInstanceOf(BadRequestException);
    await expect(w.svc.request(SITE, me, { type: 'site', pageUrl: `${SITE_URL}/x` })).rejects.toBeInstanceOf(BadRequestException);
    expect(w.user.videosUsedThisMonth).toBe(0);
  });

  it('AYLIK HAK UC TURDE ORTAK: makale + site + urun ayni sayactan duser; dolunca hangi tur olursa olsun 403', async () => {
    const w = world({ used: 17 }); // Profesyonel: 20
    await w.svc.request(SITE, me, { articleId: ART });
    await w.svc.request(SITE, me, { type: 'site' });
    const r = await w.svc.request(SITE, me, { type: 'product', pageUrl: `${SITE_URL}/urun/kupa` });
    expect(r.remaining).toBe(0);
    expect(w.user.videosUsedThisMonth).toBe(20);
    await expect(w.svc.request(SITE, me, { type: 'site', format: 'horizontal' })).rejects.toBeInstanceOf(ForbiddenException);
    await expect(w.svc.request(SITE, me, { type: 'product', pageUrl: `${SITE_URL}/urun/tabak` })).rejects.toBeInstanceOf(ForbiddenException);
    expect(w.videos).toHaveLength(3);
  });

  it('Deneme / Buyume: site ve urun de kilitli (hak dusmez)', async () => {
    for (const plan of ['TRIAL', 'STARTER']) {
      const w = world({ plan });
      await expect(w.svc.request(SITE, me, { type: 'site' })).rejects.toBeInstanceOf(ForbiddenException);
      await expect(w.svc.request(SITE, me, { type: 'product', pageUrl: `${SITE_URL}/urun/k` })).rejects.toBeInstanceOf(ForbiddenException);
      expect(w.user.videosUsedThisMonth).toBe(0);
    }
  });

  it('cift tiklama: ayni kaynak icin es zamanli ikinci istek kilide takilir (409), hak bir kez duser', async () => {
    const w = world();
    const [a, b] = await Promise.allSettled([
      w.svc.request(SITE, me, { type: 'product', pageUrl: `${SITE_URL}/urun/kupa` }),
      w.svc.request(SITE, me, { type: 'product', pageUrl: `${SITE_URL}/urun/kupa` }),
    ]);
    expect([a.status, b.status].sort()).toEqual(['fulfilled', 'rejected']);
    expect(w.user.videosUsedThisMonth).toBe(1);
  });

  it('eski satirlar (videoType yok) panelde makale olarak gorunur', () => {
    const v = toVideoView({ id: 'v', siteId: 's', articleId: 'a', title: 't', status: 'READY', durationSec: 15, videoUrl: 'u', thumbnailUrl: 'p', fileSize: 1, errorMsg: null, createdAt: new Date(), completedAt: null, providerRaw: { engine: ARTICLE_SHORT_ENGINE } });
    expect(v).toMatchObject({ type: 'article', format: 'vertical', sourceUrl: null });
  });
});

/* ───────────── 7) worker isleyicisi (sahte DB/LLM/render, gercek ayristirma) ───────────── */

describe('VideoRenderService.process — site ve urun', () => {
  const OUT = mkdtempSync(path.join(os.tmpdir(), 'rv-promo-'));
  const prevOut = process.env.VIDEO_OUTPUT_DIR;
  beforeAll(() => {
    process.env.VIDEO_OUTPUT_DIR = OUT;
  });
  afterAll(() => {
    process.env.VIDEO_OUTPUT_DIR = prevOut;
    rmSync(OUT, { recursive: true, force: true });
  });
  const VID = 'cmvideopromo00000000001';
  const brand = { name: 'Örnek Dükkan', domain: 'ornekdukkan.com.tr', primary: '#1d4ed8', colorSource: 'meta:theme-color', logoDataUri: null, logoSource: null, notes: [] };

  function setup(raw: Record<string, any>, pages: Record<string, { html: string; url?: string; status?: number }>, image?: Buffer) {
    const video: any = { id: VID, siteId: SITE, articleId: null, title: 'Ürün tanıtımı', status: 'PENDING', createdAt: new Date(), updatedAt: new Date(), providerRaw: { engine: ARTICLE_SHORT_ENGINE, request: { useLogo: true }, charged: true, chargedUserId: 'u1', ...raw } };
    const site = { id: SITE, url: SITE_URL, name: 'Örnek Dükkan', language: 'tr', niche: null, customNiche: null, userId: 'u1', user: { id: 'u1', deletionRequestedAt: null } };
    const writes: string[] = [];
    const prisma: any = {
      video: {
        updateMany: vi.fn(async ({ where, data }: any) => {
          const allowed: string[] = where.status?.in ?? (where.status ? [where.status] : [video.status]);
          if (!allowed.includes(video.status)) return { count: 0 };
          if (data.status && !canTransition(video.status, data.status)) throw new Error('gecis');
          writes.push(`${video.status}->${data.status}`);
          Object.assign(video, data);
          return { count: 1 };
        }),
        findUnique: vi.fn(async ({ include }: any) => (include ? { ...video, article: null, site } : { ...video })),
      },
      brain: { findUnique: vi.fn(async () => ({ brandVoice: { brandPromise: 'El yapımı seramik' }, sitePages: [] })) },
    };
    const quota = { refundVideoAllowance: vi.fn(async () => true), checkAiCostBudget: vi.fn(async () => ({ hardBlock: false })) };
    const svc = new VideoRenderService(prisma, quota as any, { chat: async () => { throw new Error('AI kapali'); } } as any, { create: vi.fn(async () => ({})) } as any, { state: vi.fn() } as any);
    const calls: any[] = [];
    const render: RenderKit = {
      renderConcurrency: () => 1,
      renderArticleShort: vi.fn(async (o: any) => {
        calls.push(o);
        writeFileSync(o.outFile, Buffer.alloc(1024, 1));
        writeFileSync(o.posterFile, Buffer.alloc(64, 2));
        return { durationSec: 15, width: 1080, height: 1920, fps: 30, bytes: 1024, posterBytes: 64, concurrency: 1, bundle: 'disk', inputLufs: -20, timings: {} };
      }) as any,
    };
    const fetched: string[] = [];
    svc.deps = { renderKit: async () => render, brand: vi.fn(async () => brand) as any };
    svc.promoDeps = {
      fetchText: vi.fn(async (url: string, opts: any) => {
        fetched.push(url);
        const p = pages[url];
        if (!p) throw new SafeFetchError('dns', 'yok');
        // Yonlendirme benzetimi: gercek safe-fetch gibi kancaya sor
        if (p.url && p.url !== url && opts?.allowRedirect && !opts.allowRedirect(new URL(p.url))) throw new SafeFetchError('redirect', `Izin verilmeyen yonlendirme hedefi: ${new URL(p.url).hostname}`);
        return { status: p.status ?? 200, ok: (p.status ?? 200) < 300, url: p.url ?? url, redirected: !!p.url, contentType: 'text/html', headers: {}, text: p.html, truncated: false, binary: false };
      }),
      fetchBinary: vi.fn(async (url: string) => {
        if (!image) throw new SafeFetchError('http', 'HTTP 404');
        return { url, contentType: 'image/png', body: image };
      }),
    };
    return { svc, video, quota, calls, writes, fetched, prisma };
  }

  it('site: anasayfa bir kez indirilir (marka ayni sayfayi kullanir), SiteIntroWide render, READY', async () => {
    const t = setup({ videoType: 'site', format: 'horizontal', sourceUrl: SITE_URL }, { [`${SITE_URL}/`]: { html: HOME_HTML } });
    await expect(t.svc.process(VID)).resolves.toEqual({ status: 'ready' });
    expect(t.writes).toEqual(['PENDING->GENERATING', 'GENERATING->READY']);
    expect(t.fetched).toEqual([`${SITE_URL}/`]);
    expect((t.svc.deps.brand as any).mock.calls[0][1].page.url).toBe(`${SITE_URL}/`);
    expect(t.calls[0].compositionId).toBe('SiteIntroWide');
    expect(t.calls[0].props).toMatchObject({ hook: 'El yapımı seramikler, atölyeden kapınıza', image: '', price: '', kicker: '' });
    expect(t.video.providerRaw.copy.strategy).toBe('extractive');
    expect(t.prisma.brain.findUnique).toHaveBeenCalled();
  });

  it('urun: gorsel + DOGRULANMIS fiyat props a gider; baslik urun adi olur', async () => {
    const img = await sharp({ create: { width: 900, height: 900, channels: 3, background: '#3355aa' } }).png().toBuffer();
    const url = `${SITE_URL}/urun/mavi-kupa`;
    const t = setup({ videoType: 'product', format: 'vertical', sourceUrl: url }, { [url]: { html: productHtml({ ldPrice: '749.90', visible: '749,90 TL' }) } }, img);
    await expect(t.svc.process(VID)).resolves.toEqual({ status: 'ready' });
    expect(t.calls[0].compositionId).toBe('ProductShort');
    expect(t.calls[0].props.price).toBe('749,90 TL');
    expect(t.calls[0].props.image).toMatch(/^data:image\/jpeg;base64,/);
    expect(t.video.title).toBe('Mavi Sırlı Kupa');
    expect(t.video.providerRaw.source.price).toMatchObject({ shown: true, verified: true });
  });

  it('urun: dogrulanmamis fiyat (yalniz JSON-LD) ve gorsel yoksa: fiyat da gorsel de BOS, video yine uretilir', async () => {
    const url = `${SITE_URL}/urun/mavi-kupa`;
    const t = setup({ videoType: 'product', format: 'horizontal', sourceUrl: url }, { [url]: { html: productHtml({ ldPrice: '749.90', visible: null }) } });
    await expect(t.svc.process(VID)).resolves.toEqual({ status: 'ready' });
    expect(t.calls[0].compositionId).toBe('ProductWide');
    expect(t.calls[0].props).toMatchObject({ price: '', image: '' });
    expect(JSON.stringify(t.calls[0].props)).not.toContain('749');
    expect(t.video.providerRaw.source.price).toMatchObject({ shown: false, verified: false });
  });

  it('urun sayfasi baska alan adina yonlendirirse: FAILED + Turkce mesaj + TEK iade, render yok', async () => {
    const url = `${SITE_URL}/urun/tasindi`;
    const t = setup({ videoType: 'product', format: 'vertical', sourceUrl: url }, { [url]: { html: '', url: 'https://rakip.com/urun' } });
    const r = await t.svc.process(VID);
    expect(r.status).toBe('failed');
    expect(t.video.errorMsg).toMatch(/başka bir alan adına yönlendiriyor/);
    expect(t.quota.refundVideoAllowance).toHaveBeenCalledTimes(1);
    expect(t.calls).toHaveLength(0);
  });

  it('kayitli adres sonradan alan adi disinda kaldiysa (site adresi degisti) worker yeniden denetler', async () => {
    const t = setup({ videoType: 'product', format: 'vertical', sourceUrl: 'https://rakip.com/urun' }, {});
    const r = await t.svc.process(VID);
    expect(r.status).toBe('failed');
    expect(t.video.errorMsg).toMatch(/kendi alan adında olmalı/);
    expect(t.fetched).toEqual([]);
    expect(t.quota.refundVideoAllowance).toHaveBeenCalledTimes(1);
  });

  it('bilinmeyen tur eski davranisa duser (makale); makale yoksa Turkce hata + iade', async () => {
    const t = setup({ videoType: 'banner' }, {});
    const r = await t.svc.process(VID);
    expect(r.status).toBe('failed');
    expect(t.video.errorMsg).toMatch(/Makale silinmiş/);
  });
});

/* ───────────── 8) tek tablo: tur/bicim -> kompozisyon ───────────── */

describe('kompozisyon listesi API, render hatti ve Remotion kokunde ayni', () => {
  it('VIDEO_COMPOSITION degerleri render/article-short.mjs VIDEO_COMPOSITIONS ve src/Root.tsx ile birebir', async () => {
    const { VIDEO_COMPOSITION } = await import('./article-video.config.js');
    const { loadRenderKit, VIDEO_APP_DIR } = await import('./article-short-kit.js');
    const kit = (await loadRenderKit()) as unknown as { VIDEO_COMPOSITIONS: Record<string, unknown>; assertComposition(id: string): unknown };
    const api = Object.values(VIDEO_COMPOSITION).flatMap((f) => Object.values(f)).filter((x): x is string => !!x).sort();
    expect(Object.keys(kit.VIDEO_COMPOSITIONS).sort()).toEqual(api);
    const { readFileSync } = await import('node:fs');
    const root = readFileSync(path.join(VIDEO_APP_DIR, 'src/Root.tsx'), 'utf8');
    for (const id of api) expect(root, id).toMatch(new RegExp(`id="${id}"`));
    // Liste disi kimlik (pazarlama videolari) render ettirilemez
    expect(() => kit.assertComposition('SocialAd')).toThrow(/Bilinmeyen video sablonu/);
  });
});
