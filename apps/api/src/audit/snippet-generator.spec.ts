import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import type { SafeTextResult } from '../common/safe-fetch.js';

// Tarayici baska bir is akisinda degisiyor — bu spec onun koduna baglanmasin
vi.mock('../sites/site-crawler.service.js', () => ({ SiteCrawlerService: class {} }));
vi.mock('../prisma/prisma.service.js', () => ({ PrismaService: class {} }));
const fetchMock = vi.fn();
vi.mock('../common/safe-fetch.js', async (orig) => {
  const real: any = await orig();
  return { ...real, safeFetchText: (...a: any[]) => fetchMock(...a) };
});

delete process.env.ANTHROPIC_API_KEY;
const { SnippetGeneratorService, isWithinSiteHost, assertWithinSiteHost } = await import('./snippet-generator.service.js');
const { CrawlAccessError } = await import('../sites/crawl-access.js');

type Reply = { status: number; text?: string; headers?: Record<string, string> };
const res = (url: string, r: Reply): SafeTextResult => ({
  status: r.status, ok: r.status >= 200 && r.status < 300, url, redirected: false, contentType: 'text/html',
  headers: r.headers ?? {}, text: r.text ?? '', truncated: false, binary: false,
});
function serve(map: Record<string, Reply>) {
  fetchMock.mockImplementation(async (url: string) => res(url, map[url] ?? { status: 404, text: 'yok' }));
}

const GOOD = `<html><head><title>Bu baslik yirmi karakterden uzun olmali</title>
<meta name="description" content="${'a'.repeat(150)}"><link rel="canonical" href="x">
<meta property="og:a" content="1"><meta property="og:b" content="1"><meta property="og:c" content="1">
<meta name="twitter:a" content="1"><meta name="twitter:b" content="1">
<script type="application/ld+json">{"@type":"Article"}</script></head><body><h1>H</h1></body></html>`;
const CF_WAF: Reply = { status: 403, headers: { server: 'cloudflare', 'cf-ray': 'x' }, text: 'Sorry, you have been blocked' };

function build(pages: string[]) {
  const prisma = { site: { findUniqueOrThrow: vi.fn(async () => ({ id: 's1', url: 'https://site.com', name: 'Site' })) } };
  const crawler = { crawl: vi.fn(async () => ({ pages: pages.map((url) => ({ url, title: '', h1: '' })) })) };
  return new SnippetGeneratorService(prisma as any, crawler as any);
}

beforeEach(() => { fetchMock.mockReset(); });

describe('SnippetGeneratorService.bulkScan — okunamayan sayfa ortalamaya girmez', () => {
  it('engelli ve okunamayan sayfa ayri isaretlenir, nedeni yazilir, ortalama yalniz okunan sayfalardan', async () => {
    serve({ 'https://site.com/a': { status: 200, text: GOOD }, 'https://site.com/b': CF_WAF });
    const r = await build(['https://site.com/a', 'https://site.com/b', 'https://site.com/c']).bulkScan('s1');
    const byUrl = Object.fromEntries(r.pages.map((p) => [p.url, p]));
    expect(byUrl['https://site.com/a']).toMatchObject({ blocked: false, failed: false, score: 95 });
    expect(byUrl['https://site.com/a'].failReason).toBeUndefined();
    expect(byUrl['https://site.com/b']).toMatchObject({ blocked: true, failed: false });
    expect(byUrl['https://site.com/b'].issues[0]).toContain('Cloudflare');
    // 404 engel degil ama OLCUM de degil: failed + kisa Turkce neden; skor 0 ortalamaya GIRMEZ
    expect(byUrl['https://site.com/c']).toMatchObject({
      blocked: false, failed: true, failReason: 'Sayfa HTTP 404 döndü.', issues: ['Sayfa HTTP 404 döndü.'],
    });
    expect(r.blockedPages).toBe(1);
    expect(r.failedPages).toBe(1);
    expect(r.totalScanned).toBe(3);
    expect(r.averageScore).toBe(95);
  });

  it('zaman asimi, DNS ve HTML olmayan icerik de failed; nedenleri ayrisir', async () => {
    const { SafeFetchError } = await import('../common/safe-fetch.js');
    fetchMock.mockImplementation(async (url: string) => {
      if (url === 'https://site.com/a') return res(url, { status: 200, text: GOOD });
      if (url === 'https://site.com/t') throw new SafeFetchError('timeout', 'zaman asimi');
      if (url === 'https://site.com/d') throw new SafeFetchError('dns', 'cozulemedi');
      return { ...res(url, { status: 200 }), binary: true, contentType: 'application/pdf' };
    });
    const r = await build(['https://site.com/a', 'https://site.com/t', 'https://site.com/d', 'https://site.com/x.pdf']).bulkScan('s1');
    const reasons = Object.fromEntries(r.pages.filter((p) => p.failed).map((p) => [p.url, p.failReason]));
    expect(reasons).toEqual({
      'https://site.com/t': 'Sayfa zamanında yanıt vermedi.',
      'https://site.com/d': 'Alan adı çözülemedi.',
      'https://site.com/x.pdf': 'Adres bir HTML sayfası değil (application/pdf).',
    });
    expect(r).toMatchObject({ totalScanned: 4, failedPages: 3, blockedPages: 0, averageScore: 95 });
  });

  it('sayfalarin hepsi engelliyse "ortalama 0" yerine neden + izin talimati (400)', async () => {
    serve({ 'https://site.com/a': CF_WAF, 'https://site.com/b': CF_WAF });
    const p = build(['https://site.com/a', 'https://site.com/b']).bulkScan('s1');
    await expect(p).rejects.toBeInstanceOf(BadRequestException);
    await expect(p).rejects.toThrow(/RanksUpBot/);
  });

  it('hicbir sayfa okunamadiysa (engel + okuma hatasi) once engelin nedeni; yalniz okuma hatasinda o neden', async () => {
    serve({ 'https://site.com/a': { status: 404 }, 'https://site.com/b': CF_WAF });
    await expect(build(['https://site.com/a', 'https://site.com/b']).bulkScan('s1')).rejects.toThrow(/RanksUpBot/);
    serve({ 'https://site.com/a': { status: 500 }, 'https://site.com/b': { status: 404 } });
    const p = build(['https://site.com/a', 'https://site.com/b']).bulkScan('s1');
    await expect(p).rejects.toBeInstanceOf(BadRequestException);
    await expect(p).rejects.toThrow('Sayfalar okunamadı: Sayfa HTTP 500 döndü.');
  });
});

describe('SnippetGeneratorService.bulkScan — ayni anda en fazla 4 sayfa istegi', () => {
  // NEDEN: 30-50 sayfa ayni anda isteniyordu; WAF/429 bu patlamaya takilinca
  // sayfalar "engellendi" isaretleniyordu — engeli kendi istek yagmurumuz uretiyordu.
  it('istekler sinirli eszamanlilikla gider, sonuc sirasi tarama sirasidir', async () => {
    let inFlight = 0;
    let peak = 0;
    const pages = Array.from({ length: 12 }, (_, i) => `https://site.com/p${i}`);
    fetchMock.mockImplementation(async (url: string) => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      // Sondaki sayfalar once bitsin: sira yine de korunmali
      await new Promise((r) => setTimeout(r, 20 - Number(url.slice(url.lastIndexOf('p') + 1))));
      inFlight--;
      return res(url, { status: 200, text: GOOD });
    });
    const r = await build(pages).bulkScan('s1');
    expect(peak).toBeLessThanOrEqual(4);
    expect(peak).toBeGreaterThan(1);
    expect(fetchMock).toHaveBeenCalledTimes(12);
    expect(r.pages.map((p) => p.url)).toEqual(pages);
    expect(r).toMatchObject({ totalScanned: 12, averageScore: 95, blockedPages: 0, failedPages: 0 });
  });
});

describe('SnippetGeneratorService.bulkScan — kapsam: yalniz sitenin kendi alan adi', () => {
  function withCrawler(crawlResult: any = { pages: [] }, siteUrl = 'https://site.com') {
    const prisma = { site: { findUniqueOrThrow: vi.fn(async () => ({ id: 's1', url: siteUrl, name: 'Site' })) } };
    const crawler = { crawl: vi.fn(async () => crawlResult) };
    return { svc: new SnippetGeneratorService(prisma as any, crawler as any), crawler };
  }

  it('baska bir sitenin adresi reddedilir (Turkce 400) — tarama hic baslamaz', async () => {
    const { svc, crawler } = withCrawler();
    const p = svc.bulkScan('s1', 'https://rakip.com');
    await expect(p).rejects.toBeInstanceOf(BadRequestException);
    await expect(p).rejects.toThrow(/yalnızca sitenin kendi alan adında.*site\.com/);
    expect(crawler.crawl).not.toHaveBeenCalled();
  });

  it('www\'li hali, alt alan adi ve alt yol kabul edilir; tarama verilen adresten baslar', async () => {
    for (const root of ['https://www.site.com/blog', 'http://site.com', 'https://blog.site.com/']) {
      const { svc, crawler } = withCrawler();
      await svc.bulkScan('s1', root, 10);
      expect(crawler.crawl).toHaveBeenCalledWith(root, 10);
    }
  });

  it('bos rootUrl sitenin kendi adresini kullanir', async () => {
    const { svc, crawler } = withCrawler();
    await svc.bulkScan('s1', '  ');
    expect(crawler.crawl).toHaveBeenCalledWith('https://site.com', 30);
  });

  it('gecersiz ya da http(s) disi adres: anlasilir 400', async () => {
    const { svc } = withCrawler();
    await expect(svc.bulkScan('s1', 'ftp://site.com')).rejects.toThrow(/Geçerli bir adres girin/);
    await expect(svc.bulkScan('s1', 'site com')).rejects.toThrow(/Geçerli bir adres girin/);
  });

  it('anasayfa okunamadiysa "0 sayfa, ortalama 0" yerine erisim hatasi (422) + izin talimati', async () => {
    const access = {
      state: 'blocked', kind: 'waf', url: 'https://site.com/', status: 403, vendor: 'cloudflare',
      reason: 'Cloudflare güvenlik duvarı RanksUp tarayıcısını engelledi (HTTP 403).', hint: '"RanksUpBot" için izin verin.',
    };
    const { svc } = withCrawler({ pages: [], homeAccess: access });
    const p = svc.bulkScan('s1');
    await expect(p).rejects.toBeInstanceOf(CrawlAccessError);
    await expect(p).rejects.toThrow('Erişim engellendi: Cloudflare güvenlik duvarı RanksUp tarayıcısını engelledi (HTTP 403). "RanksUpBot" için izin verin.');
  });
});

describe('isWithinSiteHost', () => {
  it('ayni host, www farki ve alt alan adlari ayni site', () => {
    expect(isWithinSiteHost('https://site.com/a', 'https://www.site.com')).toBe(true);
    expect(isWithinSiteHost('https://WWW.Site.com.', 'https://site.com')).toBe(true);
    expect(isWithinSiteHost('https://shop.site.com.tr/x', 'https://site.com.tr')).toBe(true);
  });

  it('benzer gorunen baska alanlar ayni site DEGIL', () => {
    expect(isWithinSiteHost('https://site.com.evil.com', 'https://site.com')).toBe(false);
    expect(isWithinSiteHost('https://notsite.com', 'https://site.com')).toBe(false);
    expect(isWithinSiteHost('https://evil.com/?u=site.com', 'https://site.com')).toBe(false);
    expect(isWithinSiteHost('https://site.com@evil.com/', 'https://site.com')).toBe(false);
  });

  it('paylasimli platform alaninda komsu kiraci kapsam disi (kayit edilebilir alan eslemesi yok)', () => {
    expect(isWithinSiteHost('https://baska-magaza.myshopify.com', 'https://magazam.myshopify.com')).toBe(false);
    expect(isWithinSiteHost('https://myshopify.com', 'https://magazam.myshopify.com')).toBe(false);
  });

  it('gecersiz girdi patlamaz', () => {
    expect(isWithinSiteHost('javascript:alert(1)', 'https://site.com')).toBe(false);
    expect(isWithinSiteHost('https://site.com', 'gecersiz')).toBe(false);
  });
});

describe('SnippetGeneratorService.generateForPage', () => {
  it('engel sayfasindan snippet uretilmez; nedeni tasiyan 400', async () => {
    serve({ 'https://site.com/a': { status: 200, text: '<title>Just a moment...</title>' } });
    const p = build([]).generateForPage('s1', 'https://site.com/a');
    await expect(p).rejects.toBeInstanceOf(BadRequestException);
    await expect(p).rejects.toThrow(/doğrulama/);
  });

  it('kapsam: baska sitenin adresi istek ATILMADAN Turkce 400 ile reddedilir', async () => {
    for (const foreign of ['https://site.com.evil.com/a', 'https://notsite.com/', 'https://site.com@evil.com/', 'http://169.254.169.254/latest/meta-data/']) {
      fetchMock.mockReset();
      const p = build([]).generateForPage('s1', foreign);
      await expect(p, foreign).rejects.toBeInstanceOf(BadRequestException);
      await expect(p, foreign).rejects.toThrow(/Snippet üretimi yalnızca sitenin kendi alan adında yapılabilir \(site\.com;/);
      expect(fetchMock, foreign).not.toHaveBeenCalled();
    }
    await expect(build([]).generateForPage('s1', 'javascript:alert(1)')).rejects.toThrow(/Geçerli bir adres girin/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('kapsam: www\'li hali ve alt alan adi kabul edilir; sayfa okunur', async () => {
    for (const own of ['https://www.site.com/a', 'https://blog.site.com/yazi']) {
      fetchMock.mockReset();
      serve({ [own]: { status: 200, text: GOOD } });
      await expect(build([]).generateForPage('s1', own), own).resolves.toEqual(expect.any(Array));
      expect(fetchMock.mock.calls[0][0], own).toBe(own);
    }
  });

  it('kapsam icindeki adres ic aga cikarsa yine okunmaz (SSRF) — gercek safeFetchText baglanmadan reddeder', async () => {
    const real: any = await vi.importActual('../common/safe-fetch.js');
    fetchMock.mockImplementation(real.safeFetchText);
    // Site kaydi ic adres olsa bile (eski kayit / DNS degisimi) okuma korumasi ayri katman
    const prisma = { site: { findUniqueOrThrow: vi.fn(async () => ({ id: 's1', url: 'http://169.254.169.254', name: 'Site' })) } };
    const svc = new SnippetGeneratorService(prisma as any, { crawl: vi.fn() } as any);
    const p = svc.generateForPage('s1', 'http://169.254.169.254/latest/meta-data/');
    await expect(p).rejects.toBeInstanceOf(BadRequestException);
    await expect(p).rejects.toThrow(/iç ağa/);
  });
});

describe('assertWithinSiteHost', () => {
  it('kapsam icindeyse kirpilmis adresi doner', () => {
    expect(assertWithinSiteHost('  https://www.site.com/a ', 'https://site.com', 'X')).toBe('https://www.site.com/a');
  });
  it('bos / gecersiz / kapsam disi adreste Turkce 400', () => {
    expect(() => assertWithinSiteHost(undefined, 'https://site.com', 'X')).toThrow(/Geçerli bir adres girin/);
    expect(() => assertWithinSiteHost('', 'https://site.com', 'X')).toThrow(BadRequestException);
    expect(() => assertWithinSiteHost('https://rakip.com', 'https://site.com', 'Statik HTML yazımı')).toThrow(
      "Statik HTML yazımı yalnızca sitenin kendi alan adında yapılabilir (site.com; www'li/www'suz hali ve alt alan adları dahil). Girilen adres bu siteye ait değil.",
    );
  });
});
