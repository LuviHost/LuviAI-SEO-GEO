import { describe, it, expect, vi } from 'vitest';
import { AuditService, compareAuditRows } from './audit.service.js';
import { AuditChecksService } from './audit-checks.service.js';
import type { CrawlResult } from '../sites/site-crawler.service.js';
import {
  CrawlAccessError, crawlAccessKey, readCrawlAccess, recordCrawlAccess, type CrawlAccessIssue,
} from '../sites/crawl-access.js';

/**
 * Erisim engellendiginde denetim PUAN VERMEZ.
 *
 * NEDEN VAR: ofsayt.com Cloudflare arkasinda tarayiciya 403 "Sorry, you have
 * been blocked" donuyordu; denetim engel sayfasini site sanip 44 puan yazdi.
 * Olculen sey site degil bizim erisimimizdi. Artik: anasayfa okunamazsa Audit
 * satiri yazilmaz (overallScore zorunlu ve 20'den fazla yer onu gercek skor
 * sayiyor), durum kv_store'a gider, panel "Erisim engellendi" gosterir.
 */

const WAF: CrawlAccessIssue = {
  state: 'blocked', kind: 'waf', url: 'https://ofsayt.com/', status: 403, vendor: 'cloudflare',
  reason: 'Cloudflare güvenlik duvarı RanksUp tarayıcısını engelledi (HTTP 403).',
  hint: 'Cloudflare panelinde Security → WAF bölümünden "RanksUpBot" kullanıcı ajanına izin veren bir kural ekleyin.',
};

function kvSahte() {
  const rows = new Map<string, { value: string; expiresAt: Date | null }>();
  return {
    rows,
    kvStore: {
      upsert: vi.fn(async ({ where, create, update }: any) => {
        rows.set(where.key, rows.has(where.key) ? { ...rows.get(where.key)!, ...update } : create);
      }),
      deleteMany: vi.fn(async ({ where }: any) => { rows.delete(where.key); }),
      findUnique: vi.fn(async ({ where }: any) => rows.get(where.key) ?? null),
    },
  };
}

function sayfa(url: string, over: Record<string, unknown> = {}) {
  return {
    url, title: 'Yeterince uzun bir sayfa basligi burada', metaDescription: 'x'.repeat(120), h1: `H1 ${url}`, h2s: [], textSample: '',
    ogTags: { 'og:title': 't' }, twitterTags: { 'twitter:card': 's' }, canonical: url, hreflangs: [], jsonLdBlocks: [], schemaTypes: ['WebPage'],
    lang: 'tr', imageAltStats: { total: 0, withAlt: 0, emptyAlt: 0, absent: 0, ariaDecorative: 0, suspicious: 0, excluded: 0 },
    images: [], imagesCapped: false, outboundLinks: [], ...over,
  } as any;
}

function servis(crawl: Partial<CrawlResult>) {
  const kv = kvSahte();
  const auditCreate = vi.fn(async ({ data }: any) => ({ id: 'a1', ...data }));
  const siteUpdate = vi.fn(async () => ({}));
  const prisma = {
    ...kv,
    site: { findUniqueOrThrow: async () => ({ id: 's1', userId: 'u1', url: 'https://ofsayt.com' }), update: siteUpdate },
    audit: { create: auditCreate },
  };
  const crawler = { crawl: vi.fn(async () => ({ baseUrl: 'https://ofsayt.com', pages: [], sitemapUrl: null, robotsTxt: null, llmsTxt: null, totalPages: 0, ...crawl })) };
  const pagespeed = { runAudit: vi.fn(async () => null) };
  const geo = { runAudit: vi.fn(async () => ({ score: 50, methods: [] })) };
  const aiCitation = { runForSite: vi.fn(async () => []) };
  const svc = new AuditService(prisma as never, crawler as never, new AuditChecksService(), pagespeed as never, geo as never, aiCitation as never, null as never);
  return { svc, kv, auditCreate, siteUpdate, crawler, pagespeed, geo, aiCitation };
}

describe('runAudit — anasayfa engelli', () => {
  it('puan hesaplanmaz, Audit satiri yazilmaz, pahali adimlar calismaz; 422 + neden + talimat', async () => {
    const t = servis({ homeAccess: WAF, blockedPages: [WAF] });
    const err = await t.svc.runAudit('s1').catch((e) => e);

    expect(err).toBeInstanceOf(CrawlAccessError);
    expect(err.getStatus()).toBe(422);
    expect(err.message).toBe(`Erişim engellendi: ${WAF.reason} ${WAF.hint}`);
    expect((err.getResponse() as any).code).toBe('CRAWL_BLOCKED');
    expect(t.auditCreate, 'engelli sitede Audit satiri (skor) yazildi').not.toHaveBeenCalled();
    expect(t.siteUpdate).not.toHaveBeenCalled();
    expect(t.pagespeed.runAudit).not.toHaveBeenCalled();
    expect(t.geo.runAudit).not.toHaveBeenCalled();
    expect(t.aiCitation.runForSite, 'engelli sitede LLM maliyeti harcandi').not.toHaveBeenCalled();
    // Denetim modunda tarama anasayfa okunamazsa durur
    expect(t.crawler.crawl).toHaveBeenCalledWith('https://ofsayt.com', 100, { stopIfHomeUnreadable: true });

    const kayit = await readCrawlAccess(t.kv, 's1');
    expect(kayit).toMatchObject({ state: 'blocked', kind: 'waf', reason: WAF.reason, hint: WAF.hint, source: 'audit' });
  });

  it('erisim duzelince kayit silinir ve normal puan yazilir', async () => {
    const t = servis({ pages: [sayfa('https://ofsayt.com/')], sitemapUrl: 'https://ofsayt.com/sitemap.xml', robotsTxt: 'User-agent: *\nAllow: /\nSitemap: https://ofsayt.com/sitemap.xml', llmsTxt: '# x' });
    await recordCrawlAccess(t.kv, 's1', WAF, 'audit');
    await t.svc.runAudit('s1');
    expect(t.kv.rows.has(crawlAccessKey('s1'))).toBe(false);
    expect(t.auditCreate).toHaveBeenCalledTimes(1);
    expect(typeof t.auditCreate.mock.calls[0][0].data.overallScore).toBe('number');
  });
});

describe('kok dosya engelli: "yok" degil "dogrulanamadi"', () => {
  const temel: CrawlResult = {
    baseUrl: 'https://ornek.com',
    pages: [sayfa('https://ornek.com/')],
    sitemapUrl: null,
    robotsTxt: null,
    llmsTxt: null,
    totalPages: 1,
  };

  it('robots/llms/sitemap engelliyse kontrol dogrulanamadi olur, sorun ve otomatik duzeltme uretmez, puana girmez', async () => {
    const checks = new AuditChecksService();
    const blocked = {
      robots: { state: 'blocked' as const, url: 'https://ornek.com/robots.txt', status: 403, reason: WAF.reason, access: WAF },
      sitemap: { state: 'blocked' as const, url: 'https://ornek.com/sitemap.xml', status: 403, reason: WAF.reason, access: WAF },
      llms: { state: 'blocked' as const, url: 'https://ornek.com/llms.txt', status: 403, reason: WAF.reason, access: WAF },
    };
    const engelli = await checks.runAllChecks({ ...temel, resources: blocked });
    const robots = engelli.find((c) => c.id === 'robots_txt')!;
    expect(robots.details?.unverified).toBe(true);
    expect(robots.details?.unverifiedReason).toBe(`robots.txt doğrulanamadı: ${WAF.reason}`);
    expect(robots.details?.unverifiedHint).toBe(WAF.hint);
    expect(robots.issues, 'auto-fix rotasina dusecek sorun uretildi').toHaveLength(0);
    for (const id of ['sitemap_xml', 'llms_txt']) {
      const c = engelli.find((x) => x.id === id)!;
      expect(c.details?.unverified, id).toBe(true);
      expect(c.issues, id).toHaveLength(0);
    }

    // Ayni sayfa verisiyle: dosyalar gercekten YOK (404) olsaydi puan daha dusuk olurdu
    const yok = await checks.runAllChecks({
      ...temel,
      resources: {
        robots: { state: 'missing', url: null, status: 404 },
        sitemap: { state: 'missing', url: null, status: 404 },
        llms: { state: 'missing', url: null, status: 404 },
      },
    });
    expect(yok.find((c) => c.id === 'robots_txt')!.issues[0].type).toBe('robots_missing');
    expect(checks.computeOverallScore(engelli)).toBeGreaterThan(checks.computeOverallScore(yok));
  });

  it('robots.txt 5xx: dogrulanamadi + arama motoru etkisi notu', async () => {
    const checks = new AuditChecksService();
    const r = await checks.runAllChecks({ ...temel, resources: {
      robots: { state: 'error', url: 'https://ornek.com/robots.txt', status: 503, reason: 'Sunucu HTTP 503 döndürdü.' },
      sitemap: { state: 'missing', url: null, status: 404 },
      llms: { state: 'missing', url: null, status: 404 },
    } });
    const robots = r.find((c) => c.id === 'robots_txt')!;
    expect(robots.details?.unverified).toBe(true);
    expect(robots.details?.unverifiedReason).toContain('Google, robots.txt sunucu hatası verdiğinde');
  });

  it('runAudit: engelli sayfa ve dogrulanamayan dosya bilgi (info) olarak gorunur, elle rotasinda', async () => {
    const pageBlock: CrawlAccessIssue = { ...WAF, kind: 'rate_limited', status: 429, url: 'https://ofsayt.com/x', reason: 'Site çok fazla istek gerekçesiyle geçici olarak reddetti (HTTP 429).', hint: 'Bir süre sonra tekrar deneyin.' };
    const t = servis({
      pages: [sayfa('https://ofsayt.com/')],
      blockedPages: [pageBlock],
      resources: {
        robots: { state: 'blocked', url: 'https://ofsayt.com/robots.txt', status: 403, reason: WAF.reason, access: WAF },
        sitemap: { state: 'missing', url: null, status: 404 },
        llms: { state: 'missing', url: null, status: 404 },
      },
    });
    await t.svc.runAudit('s1');
    const data = t.auditCreate.mock.calls[0][0].data;
    const issues = data.issues as any[];
    const sayfaIssue = issues.find((i) => i.type === 'crawl_pages_blocked');
    expect(sayfaIssue).toMatchObject({ severity: 'info', checkId: 'crawl_access', fixRoute: 'manual', fixable: false });
    expect(sayfaIssue.description).toContain('1 sayfa erişim engeli nedeniyle taranamadı');
    expect(issues.find((i) => i.type === 'robots_txt_unverified')).toMatchObject({ checkId: 'crawl_access', fixRoute: 'manual' });
    expect(issues.some((i) => i.checkId === 'robots_txt' && i.fixRoute === 'auto_fix'), 'okunamayan robots.txt icin otomatik duzeltme onerildi').toBe(false);
    expect(data.checks.crawlCoverage).toMatchObject({ blockedCount: 1 });
    expect(data.checks.crawlCoverage.name, 'kapsam girdisi kontrol listesinde satir olmamali').toBeUndefined();
  });
});

describe('compareAuditRows — dogrulanamayan kontrol skor sayilmaz', () => {
  it('100 → dogrulanamadi "kotulesti -100" degil "kayboldu"', () => {
    const once = { id: 'a', ranAt: new Date('2026-01-01'), overallScore: 80, checks: { robots_txt: { score: 100 } }, issues: [] };
    const sonra = { id: 'b', ranAt: new Date('2026-02-01'), overallScore: 82, checks: { robots_txt: { score: 0, details: { unverified: true } } }, issues: [] };
    const r = compareAuditRows(once, sonra);
    expect(r.checks.find((c) => c.id === 'robots_txt')).toMatchObject({ durum: 'kayboldu', delta: 0, sonrakiScore: null });
  });
});

describe('getLatest — skordan sonraki deneme engellendiyse cevap bunu soyler', () => {
  it('accessBlocked yalnizca kayit son skordan YENIYSE eklenir', async () => {
    const kv = kvSahte();
    const audit = { id: 'a1', siteId: 's1', ranAt: new Date(Date.now() - 60_000), overallScore: 44, checks: {}, issues: [] };
    const prisma = { ...kv, audit: { findFirst: async () => audit } };
    const svc = new AuditService(prisma as never, null as never, null as never, null as never, null as never, null as never, null as never);

    expect((await svc.getLatest('s1')) as any).not.toHaveProperty('accessBlocked');
    await recordCrawlAccess(kv, 's1', WAF, 'audit');
    expect(((await svc.getLatest('s1')) as any).accessBlocked).toMatchObject({ kind: 'waf', reason: WAF.reason });
  });

  it('kv okunamazsa getLatest yine calisir', async () => {
    const audit = { id: 'a1', siteId: 's1', ranAt: new Date(), overallScore: 70, checks: {}, issues: [] };
    const prisma = { audit: { findFirst: async () => audit }, kvStore: { findUnique: async () => { throw new Error('db yok'); } } };
    const svc = new AuditService(prisma as never, null as never, null as never, null as never, null as never, null as never, null as never);
    expect(((await svc.getLatest('s1')) as any).overallScore).toBe(70);
  });
});

describe('crawl-access kaydi', () => {
  it('suresi gecmis ya da bozuk kayit yok sayilir', async () => {
    const kv = kvSahte();
    kv.rows.set(crawlAccessKey('s1'), { value: JSON.stringify({ ...WAF, at: new Date().toISOString(), source: 'audit' }), expiresAt: new Date(Date.now() - 1000) });
    expect(await readCrawlAccess(kv, 's1')).toBeNull();
    kv.rows.set(crawlAccessKey('s2'), { value: '{bozuk', expiresAt: null });
    expect(await readCrawlAccess(kv, 's2')).toBeNull();
  });
});
