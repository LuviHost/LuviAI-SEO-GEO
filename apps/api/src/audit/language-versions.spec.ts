import { describe, it, expect } from 'vitest';
import { detectLanguageVersions, pathLanguage, primaryLanguage } from './language-versions.js';
import { AuditChecksService, HREFLANG_METHOD_VERSION, HTTPS_CHAIN_INCOMPLETE_SCORE } from './audit-checks.service.js';
import { computeRobotsCheck } from './robots-check.js';
import { checkMethodVersion, olcumYontemiDegisti } from './audit.service.js';

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

  it('kodlu ve kodsuz sayfalar ayni <html lang> bildiriyorsa yol parcasi dil degildir', () => {
    const v = detectLanguageVersions([{ url: 'https://s.com', lang: 'tr' }, { url: 'https://s.com/en', lang: 'tr' }]);
    expect(v.multilingual).toBe(false);
  });

  it('baska anlama gelen iki harfli yol parcalari dil sayilmaz ("/it", "/hr", "/no")', () => {
    for (const yol of ['/it', '/hr/ilanlar', '/no', '/is', '/id/123', '/my']) {
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

  it('tek dilli site: eski hukumle AYNI (100) ve surum damgasi YOK — karsilastirma etkilenmez', async () => {
    const yeni = await kontrol(tarama([sayfa('https://site.com'), sayfa('https://site.com/hakkimizda')]), 'hreflang');
    expect(yeni).toMatchObject({ found: true, valid: true, score: 100, issues: [] });
    expect(yeni.details).toMatchObject({ applicable: false, pagesWithHreflang: 0 });
    expect(yeni.details).not.toHaveProperty('methodVersion');
    // v1 kaydi (alan yok) ile ayni yontem sayilir: "yontem degisti" denmez
    const eski = { id: 'hreflang', found: true, valid: true, score: 100, issues: [], details: { pagesWithHreflang: 0 } };
    expect(checkMethodVersion(yeni)).toBe(checkMethodVersion(eski));
    expect(olcumYontemiDegisti('hreflang', eski, yeni)).toBe(false);
  });

  it('iki dilli sitede ilk yeni tarama eski "100" ile kiyaslanmaz (yontem degisti, "kotulesti" degil)', async () => {
    const yeni = await kontrol(tarama([sayfa('https://site.com'), sayfa('https://site.com/EN')]), 'hreflang');
    const eski = { id: 'hreflang', found: true, valid: true, score: 100, issues: [], details: { pagesWithHreflang: 0 } };
    expect(olcumYontemiDegisti('hreflang', eski, yeni)).toBe(true);
  });
});

describe('HTTPS kontrolu — eksik sertifika zinciri', () => {
  it('zincir eksikse "gecti" degil: uyari, 70 puan, kesin konusmayan metin', async () => {
    const r = await kontrol(tarama([sayfa('https://site.com')], { tlsChainIncomplete: true }), 'https');
    expect(r).toMatchObject({ found: true, valid: false, score: HTTPS_CHAIN_INCOMPLETE_SCORE, details: { chainIncomplete: true } });
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
