import { describe, it, expect } from 'vitest';
import { detectLanguageVersions, pathLanguage, primaryLanguage } from './language-versions.js';
import { AuditChecksService, HREFLANG_METHOD_VERSION, HTTPS_CHAIN_INCOMPLETE_SCORE, HTTPS_METHOD_VERSION } from './audit-checks.service.js';
import { computeRobotsCheck } from './robots-check.js';
import { compareAuditRows, olcumYontemiDegisti } from './audit.service.js';

/**
 * Dil surumu tespiti + ona dayanan hreflang kontrolu (yontem v2) + HTTPS
 * zincir bulgusu + robots.txt / site haritasi yoklugunun onemi.
 *
 * NEDEN VAR: labenko.com (12.11.2026) iki dilli ("/" Turkce, "/EN" Ingilizce),
 * hic hreflang etiketi yok, sunucu sertifika zincirini eksik gonderiyor ve
 * robots.txt / sitemap.xml yok. Musteri raporu "Hreflang: gecti", "HTTPS:
 * gecti" dedi ve iki sayfalik sitede robots.txt ile site haritasini "kritik"
 * ilk iki is olarak gosterdi.
 */

const sayfa = (url: string, over: Record<string, unknown> = {}) => ({
  url, title: 'Yeterince uzun bir sayfa basligi burada', metaDescription: 'x'.repeat(120), h1: `H1 ${url}`, h2s: [], textSample: '',
  ogTags: {}, twitterTags: {}, canonical: url, hreflangs: [], jsonLdBlocks: [], schemaTypes: [],
  lang: null, imageAltStats: { total: 0, withAlt: 0, emptyAlt: 0, absent: 0, ariaDecorative: 0, suspicious: 0, excluded: 0 },
  images: [], imagesCapped: false, outboundLinks: [], ...over,
}) as any;

const tarama = (pages: any[], over: Record<string, unknown> = {}) => ({
  baseUrl: 'https://site.com', pages, sitemapUrl: 'https://site.com/sitemap.xml', robotsTxt: 'User-agent: *\nAllow: /\nSitemap: https://site.com/sitemap.xml',
  llmsTxt: null, totalPages: pages.length, ...over,
}) as any;

const kontrol = async (c: any, id: string) => (await new AuditChecksService().runAllChecks(c)).find((x) => x.id === id)!;

describe('detectLanguageVersions', () => {
  it('labenko bicimi: "/" + "/EN", <html lang> yok → iki dilli (adres yolu)', () => {
    const v = detectLanguageVersions([{ url: 'https://labenko.com', lang: null }, { url: 'https://labenko.com/EN', lang: null }]);
    expect(v).toEqual({ multilingual: true, languages: ['en'], evidence: 'url-path', samples: ['https://labenko.com/EN'] });
  });

  it('<html lang> iki farkli dil → iki dilli; "en-US" ile "en-GB" ayni dil', () => {
    expect(detectLanguageVersions([{ url: 'https://s.com/a', lang: 'tr' }, { url: 'https://s.com/b', lang: 'en-US' }]))
      .toMatchObject({ multilingual: true, languages: ['en', 'tr'], evidence: 'html-lang' });
    expect(detectLanguageVersions([{ url: 'https://s.com/a', lang: 'en-US' }, { url: 'https://s.com/b', lang: 'en-GB' }]).multilingual).toBe(false);
  });

  it('iki farkli dil kodu ("/tr/…", "/en/…") → iki dilli, kodsuz sayfa gerekmez', () => {
    const v = detectLanguageVersions([{ url: 'https://s.com/tr/hakkimizda' }, { url: 'https://s.com/en/about' }]);
    expect(v).toMatchObject({ multilingual: true, languages: ['en', 'tr'], evidence: 'url-path' });
  });

  it('tek dilli site: dil kodu yok → dil surumu yok', () => {
    expect(detectLanguageVersions([{ url: 'https://s.com', lang: 'tr' }, { url: 'https://s.com/hakkimizda', lang: 'tr' }]))
      .toEqual({ multilingual: false, languages: [], evidence: null, samples: [] });
  });

  it('anasayfasi "/" → "/tr/" yonlendiren tek dilli site iki dilli SAYILMAZ (yonlendirme sonrasi adres)', () => {
    const v = detectLanguageVersions([
      { url: 'https://s.com', finalUrl: 'https://s.com/tr/' },
      { url: 'https://s.com/tr/hakkimizda' },
      { url: 'https://s.com/tr/iletisim' },
    ]);
    expect(v.multilingual).toBe(false);
  });

  it('tek tuk kodsuz sayfa ikinci dil sayilmaz: anasayfa "/tr/"ye yonleniyorsa varsayilan dil kodludur', () => {
    const v = detectLanguageVersions([
      { url: 'https://s.com', finalUrl: 'https://s.com/tr/' },
      { url: 'https://s.com/tr/hakkimizda' },
      { url: 'https://s.com/kvkk' },
    ]);
    expect(v.multilingual).toBe(false);
  });

  it('kodsuz sayfalar yoldaki kodun dilini bildiriyorsa kodlu bolum ayni dildir ("/tr/…" + "tr" sayfalar)', () => {
    const v = detectLanguageVersions([
      { url: 'https://s.com', lang: 'tr' }, { url: 'https://s.com/iletisim', lang: 'tr' },
      { url: 'https://s.com/tr/urunler', lang: 'tr' }, { url: 'https://s.com/tr/blog', lang: 'tr' },
    ]);
    expect(v.multilingual).toBe(false);
  });

  it('sablonu her sayfaya ayni <html lang> yazan iki dilli site yine iki dillidir (yaygin sablon hatasi)', () => {
    expect(detectLanguageVersions([{ url: 'https://s.com', lang: 'tr' }, { url: 'https://s.com/EN', lang: 'tr' }]))
      .toMatchObject({ multilingual: true, languages: ['en'], evidence: 'url-path' });
    const cok = [{ url: 'https://s.com', lang: 'tr' }, { url: 'https://s.com/urunler', lang: 'tr' },
      ...Array.from({ length: 10 }, (_, i) => ({ url: `https://s.com/en/page-${i}`, lang: 'tr' }))];
    expect(detectLanguageVersions(cok)).toMatchObject({ multilingual: true, languages: ['en'] });
  });

  it('"/ar-ge" (arastirma-gelistirme) Arapca degildir; rastgele "xx-yy" dil-bolge sayilmaz', () => {
    expect(pathLanguage('https://s.com/ar-ge')).toBeNull();
    expect(pathLanguage('https://s.com/ar-ge/projeler')).toBeNull();
    expect(pathLanguage('https://s.com/de-ar')).toBeNull();
    expect(pathLanguage('https://s.com/ar-sa/')).toBe('ar');
    expect(pathLanguage('https://s.com/EN_US/home')).toBe('en');
    const v = detectLanguageVersions([{ url: 'https://s.com' }, { url: 'https://s.com/hakkimizda' }, { url: 'https://s.com/ar-ge' }, { url: 'https://s.com/iletisim' }]);
    expect(v.multilingual).toBe(false);
  });

  it('tek sayfadaki farkli <html lang> (ör. varsayilan dili degismemis blog eklentisi) siteyi iki dilli yapmaz', () => {
    const sayfalar = [
      ...Array.from({ length: 28 }, (_, i) => ({ url: `https://s.com/sayfa-${i}`, lang: 'tr' })),
      { url: 'https://s.com/blog/', lang: 'en-US' },
    ];
    expect(detectLanguageVersions(sayfalar).multilingual).toBe(false);
    // Anlamli bir pay (>= %15) ise dil surumudur
    const yarisi = [
      ...Array.from({ length: 6 }, (_, i) => ({ url: `https://s.com/a-${i}`, lang: 'tr' })),
      ...Array.from({ length: 4 }, (_, i) => ({ url: `https://s.com/b-${i}`, lang: 'en' })),
    ];
    expect(detectLanguageVersions(yarisi)).toMatchObject({ multilingual: true, languages: ['en', 'tr'], evidence: 'html-lang' });
  });

  it('uc harfli dil kodu ikinci dil sayilmaz ("tr" ile "tur" ayni dil); dil olmayan deger yok sayilir', () => {
    expect(detectLanguageVersions([{ url: 'https://s.com/a', lang: 'tr' }, { url: 'https://s.com/b', lang: 'tur' }]).multilingual).toBe(false);
    expect(detectLanguageVersions([{ url: 'https://s.com/a', lang: 'tr' }, { url: 'https://s.com/b', lang: 'utf-8' }]).multilingual).toBe(false);
  });

  it('baska anlama gelen iki harfli yol parcalari dil sayilmaz ("/it", "/hr", "/no")', () => {
    for (const yol of ['/it', '/hr/ilanlar', '/no', '/is', '/id/123', '/my', '/uk/', '/az', '/da']) {
      expect(pathLanguage(`https://s.com${yol}`)).toBeNull();
      expect(detectLanguageVersions([{ url: 'https://s.com' }, { url: `https://s.com${yol}` }]).multilingual).toBe(false);
    }
    expect(pathLanguage('https://s.com/de-DE/produkte')).toBe('de');
    expect(pathLanguage('https://s.com/english')).toBeNull();
    expect(pathLanguage('gecersiz adres')).toBeNull();
  });

  it('primaryLanguage: gecersiz / bos deger null', () => {
    expect(primaryLanguage('TR')).toBe('tr');
    expect(primaryLanguage('zh-Hant-TW')).toBe('zh');
    expect(primaryLanguage('eng')).toBe('en');
    expect(primaryLanguage('utf-8')).toBeNull();
    expect(primaryLanguage('')).toBeNull();
    expect(primaryLanguage('{{ lang }}')).toBeNull();
    expect(primaryLanguage(null)).toBeNull();
  });
});

describe('hreflang kontrolu — yontem v2', () => {
  it('iki dilli site, hic hreflang yok → BASARISIZ (0, uyari), "gecti" degil', async () => {
    const r = await kontrol(tarama([sayfa('https://site.com'), sayfa('https://site.com/EN')]), 'hreflang');
    expect(HREFLANG_METHOD_VERSION).toBe(2);
    expect(r).toMatchObject({ found: false, valid: false, score: 0 });
    expect(r.issues).toHaveLength(1);
    expect(r.issues[0]).toMatchObject({ type: 'hreflang_missing', severity: 'warning', fixable: false });
    expect(r.issues[0].description).toContain('(EN)');
    expect(r.details).toMatchObject({ methodVersion: 2, applicable: true, pagesWithHreflang: 0, languages: ['en'], evidence: 'url-path' });
  });

  it('iki dilli site, hreflang var → gecer (100)', async () => {
    const hreflangs = [{ lang: 'tr', href: 'https://site.com/' }, { lang: 'en', href: 'https://site.com/EN' }];
    const r = await kontrol(tarama([sayfa('https://site.com', { hreflangs }), sayfa('https://site.com/EN', { hreflangs })]), 'hreflang');
    expect(r).toMatchObject({ found: true, valid: true, score: 100, issues: [] });
    expect(r.details).toMatchObject({ methodVersion: 2, applicable: true, pagesWithHreflang: 2 });
  });

  it('tek dilli site: eski hukumle AYNI (100) — karsilastirma "yontem degisti" demez', async () => {
    const yeni = await kontrol(tarama([sayfa('https://site.com'), sayfa('https://site.com/hakkimizda')]), 'hreflang');
    expect(yeni).toMatchObject({ found: true, valid: true, score: 100, issues: [] });
    expect(yeni.details).toMatchObject({ methodVersion: 2, applicable: false, pagesWithHreflang: 0 });
    // v1 kaydi (surum alani yok): yeni yontem ayni hukmu verdi, fark yontemden degil
    const eski = { id: 'hreflang', found: true, valid: true, score: 100, issues: [], details: { pagesWithHreflang: 0 } };
    expect(olcumYontemiDegisti('hreflang', eski, yeni)).toBe(false);
    expect(olcumYontemiDegisti('hreflang', yeni, eski)).toBe(false);
  });

  it('hreflang etiketi olan site: eski "100" ile yeni "100" ayni hukum — "yontem degisti" denmez', async () => {
    const hreflangs = [{ lang: 'tr', href: 'https://site.com/' }, { lang: 'en', href: 'https://site.com/EN' }];
    const yeni = await kontrol(tarama([sayfa('https://site.com', { hreflangs }), sayfa('https://site.com/EN', { hreflangs })]), 'hreflang');
    const eski = { id: 'hreflang', found: true, valid: true, score: 100, issues: [], details: { pagesWithHreflang: 2 } };
    expect(olcumYontemiDegisti('hreflang', eski, yeni)).toBe(false);
  });

  it('iki dilli sitede ilk yeni tarama eski "100" ile kiyaslanmaz (yontem degisti, "kotulesti" degil)', async () => {
    const yeni = await kontrol(tarama([sayfa('https://site.com'), sayfa('https://site.com/EN')]), 'hreflang');
    const eski = { id: 'hreflang', found: true, valid: true, score: 100, issues: [], details: { pagesWithHreflang: 0 } };
    expect(olcumYontemiDegisti('hreflang', eski, yeni)).toBe(true);
  });

  it('iki YENI tarama arasindaki fark sitenindir: dil surumu eklendi → kotulesti; etiket eklendi → iyilesti', async () => {
    const tekDil = await kontrol(tarama([sayfa('https://site.com'), sayfa('https://site.com/hakkimizda')]), 'hreflang');
    const etiketsiz = await kontrol(tarama([sayfa('https://site.com'), sayfa('https://site.com/EN')]), 'hreflang');
    const hreflangs = [{ lang: 'tr', href: 'https://site.com/' }, { lang: 'en', href: 'https://site.com/EN' }];
    const etiketli = await kontrol(tarama([sayfa('https://site.com', { hreflangs }), sayfa('https://site.com/EN', { hreflangs })]), 'hreflang');
    for (const [a, b] of [[tekDil, etiketsiz], [etiketsiz, tekDil], [etiketsiz, etiketli], [etiketli, etiketsiz]]) {
      expect(olcumYontemiDegisti('hreflang', a, b)).toBe(false);
    }
    const satir = (from: unknown, to: unknown) => compareAuditRows(
      { id: 'a', ranAt: new Date('2026-11-13'), overallScore: 80, geoScore: null, checks: { hreflang: from }, issues: [] } as any,
      { id: 'b', ranAt: new Date('2026-11-20'), overallScore: 80, geoScore: null, checks: { hreflang: to }, issues: [] } as any,
    ).checks.find((c) => c.id === 'hreflang')!;
    expect(satir(tekDil, etiketsiz)).toMatchObject({ durum: 'kotulesti', delta: -100 });
    expect(satir(etiketsiz, etiketli)).toMatchObject({ durum: 'iyilesti', delta: 100 });
  });
});

describe('HTTPS kontrolu — eksik sertifika zinciri', () => {
  it('zincir eksikse "gecti" degil: uyari, 70 puan, kesin konusmayan metin', async () => {
    const r = await kontrol(tarama([sayfa('https://site.com')], { tlsChainIncomplete: true }), 'https');
    expect(r).toMatchObject({ found: true, valid: false, score: HTTPS_CHAIN_INCOMPLETE_SCORE, details: { methodVersion: HTTPS_METHOD_VERSION, chainIncomplete: true } });
    expect(HTTPS_CHAIN_INCOMPLETE_SCORE).toBe(70);
    expect(r.issues).toHaveLength(1);
    expect(r.issues[0]).toMatchObject({ type: 'tls_chain_incomplete', severity: 'warning', fixable: false });
    // Hangi botlarin baglanamadigi olculmedi
    expect(r.issues[0].description).toContain('bağlanamayabilir');
    expect(r.issues[0].description).toContain('fullchain.pem');
  });

  it('zincir tamsa ve HTTP sitede davranis degismedi', async () => {
    expect(await kontrol(tarama([sayfa('https://site.com')]), 'https')).toMatchObject({ found: true, valid: true, score: 100, issues: [] });
    expect(await kontrol(tarama([sayfa('https://site.com')], { tlsChainIncomplete: false }), 'https')).toMatchObject({ valid: true, score: 100 });
    const http = await kontrol(tarama([sayfa('http://site.com')], { baseUrl: 'http://site.com', tlsChainIncomplete: true }), 'https');
    expect(http).toMatchObject({ found: false, valid: false, score: 0 });
    expect(http.issues.map((i) => i.type)).toEqual(['no_https']);
  });
});

describe('HTTPS yontem v2 — karsilastirma', () => {
  const eski = { id: 'https', name: 'HTTPS', found: true, valid: true, score: 100, issues: [] };

  it('zincir tamamlama ile bu bulgu arasinda taranan site: eski "100" olcum degildi — "kotulesti" denmez', async () => {
    const yeni = await kontrol(tarama([sayfa('https://site.com')], { tlsChainIncomplete: true }), 'https');
    expect(olcumYontemiDegisti('https', eski, yeni)).toBe(true);
    const k = compareAuditRows(
      { id: 'a', ranAt: new Date('2026-11-12'), overallScore: 33, geoScore: null, checks: { https: eski }, issues: [] } as any,
      { id: 'b', ranAt: new Date('2026-11-13'), overallScore: 29, geoScore: null, checks: { https: yeni }, issues: yeni.issues.map((i) => ({ ...i, checkId: 'https' })) } as any,
    );
    expect(k.checks.find((c) => c.id === 'https')!.durum).toBe('metodoloji_degisti');
    // Yeni yontemin bulgusu "yeni cikan sorun" diye de sayilmaz (site degismedi): mevcut durum olarak devam edende
    expect(k.issues.yeniCikan.map((i) => i.type)).not.toContain('tls_chain_incomplete');
    expect(k.issues.devamEden.map((i) => i.type)).toContain('tls_chain_incomplete');
  });

  it('zinciri tam site: eski ve yeni "100" ayni hukum; zincir sonradan duzelirse "iyilesti"', async () => {
    const tam = await kontrol(tarama([sayfa('https://site.com')]), 'https');
    const eksik = await kontrol(tarama([sayfa('https://site.com')], { tlsChainIncomplete: true }), 'https');
    expect(tam.details).toMatchObject({ methodVersion: 2 });
    expect(olcumYontemiDegisti('https', eski, tam)).toBe(false);
    expect(olcumYontemiDegisti('https', eksik, tam)).toBe(false);
    expect(olcumYontemiDegisti('https', tam, eksik)).toBe(false);
  });
});

describe('robots.txt ve site haritasi yoklugu: uyari (kritik degil), puan ayni', () => {
  it('robots.txt yok → uyari; puan 0 (degismedi); otomatik duzeltilebilir', () => {
    const r = computeRobotsCheck(null);
    expect(r).toMatchObject({ found: false, valid: false, score: 0 });
    expect(r.issues).toEqual([expect.objectContaining({ type: 'robots_missing', severity: 'warning', fixable: true })]);
  });

  it('sitemap.xml yok → uyari; puan 0 (degismedi)', async () => {
    const r = await kontrol(tarama([sayfa('https://site.com')], { sitemapUrl: null }), 'sitemap_xml');
    expect(r).toMatchObject({ found: false, valid: false, score: 0 });
    expect(r.issues).toEqual([expect.objectContaining({ type: 'sitemap_missing', severity: 'warning', fixable: true })]);
  });

  it('gorunurlugu GERCEKTEN kesen engel kritik kalir (Googlebot tamamen engelli)', () => {
    const r = computeRobotsCheck('User-agent: Googlebot\nDisallow: /\n\nUser-agent: *\nAllow: /\nSitemap: https://site.com/sitemap.xml');
    expect(r.issues.find((i) => i.type === 'robots_search_engine_blocked')).toMatchObject({ severity: 'critical' });
  });
});
