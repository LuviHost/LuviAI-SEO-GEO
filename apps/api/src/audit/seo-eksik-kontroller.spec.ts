import { describe, it, expect } from 'vitest';
import { AuditChecksService } from './audit-checks.service.js';
import { groupIssues } from './issue-grouping.js';
import { fixRouteForIssue } from './fix-routes.js';
import { buildClientReport } from '../client-report/client-report-build.js';
import { mukellefGirdisi } from '../client-report/client-report.fixture.js';

/**
 * Dort yeni bulgu (25.11.2026): acilmayan sayfalar, canonical hedefi, baglanti
 * metni, Google dizin durumu. Hepsi BILGI / UYARI: genel puan degismez
 * (kaynaklar: link-text.ts, canonical-target.ts, gsc-url-inspection.ts,
 * audit-checks.service).
 */
const sayfa = (url: string, extra: Record<string, unknown> = {}) => ({
  url, title: 'Yeterince uzun bir sayfa basligi burada', metaDescription: 'x'.repeat(120), h1: url, h2s: [], textSample: '',
  ogTags: {}, twitterTags: {}, canonical: url, hreflangs: [], jsonLdBlocks: [], schemaTypes: [], lang: 'tr',
  imageAltStats: { total: 0, withAlt: 0, emptyAlt: 0, absent: 0, ariaDecorative: 0, suspicious: 0, excluded: 0 },
  images: [], imagesCapped: false, outboundLinks: ['https://site.com/', 'https://site.com/a', 'https://site.com/b'],
  robotsSignals: { metas: [], header: null },
  ...extra,
}) as any;

const tarama = (pages: any[], extra: Record<string, unknown> = {}) =>
  ({ baseUrl: 'https://site.com', pages, sitemapUrl: null, robotsTxt: null, llmsTxt: null, totalPages: pages.length, ...extra }) as any;

const temelSayfalar = () => [sayfa('https://site.com/'), sayfa('https://site.com/a'), sayfa('https://site.com/b')];

const yeniAlanlar = {
  brokenPages: [
    { url: 'https://site.com/eski/', status: 404, kind: 'not_found', source: 'sitemap' },
    { url: 'https://site.com/cokme', status: 500, kind: 'server_error', source: 'home-link' },
  ],
  canonicalProblems: [{ page: 'https://site.com/a', target: 'https://site.com/eski-a', status: 404, kind: 'not_found' }],
  canonicalTargetsChecked: 2,
  indexInspection: {
    property: 'sc-domain:site.com', inspected: 3, indexedCount: 2, failed: 0,
    notIndexed: [{ url: 'https://site.com/b', verdict: 'NEUTRAL', coverageState: 'Tarandı - şu anda dizine eklenmedi' }],
  },
};

const kontroller = async (pages: any[], extra: Record<string, unknown> = {}) => {
  const checks = await new AuditChecksService().runAllChecks(tarama(pages, extra));
  return { checks, by: Object.fromEntries(checks.map((c) => [c.id, c])) as Record<string, any> };
};

describe('yeni bulgular — denetim kontrolleri', () => {
  it('genel puan ve kontrol puanlari DEGISMEZ', async () => {
    const svc = new AuditChecksService();
    const pages = temelSayfalar();
    pages[1].genericLinkCount = 3;
    pages[1].genericLinks = [{ text: 'Devamı', href: '/b' }];
    const once = await svc.runAllChecks(tarama(temelSayfalar()));
    const sonra = await svc.runAllChecks(tarama(pages, yeniAlanlar));
    expect(svc.computeOverallScore(sonra)).toBe(svc.computeOverallScore(once));
    expect(sonra.map((c) => [c.id, c.score])).toEqual(once.map((c) => [c.id, c.score]));
  });

  it('acilmayan sayfa: internal_linking altinda uyari, sayi ve ornekler details icinde', async () => {
    const { by } = await kontroller(temelSayfalar(), yeniAlanlar);
    const il = by.internal_linking;
    const issue = il.issues.find((i: any) => i.type === 'broken_pages');
    expect(issue).toMatchObject({ severity: 'warning', fixable: false });
    expect(issue.description).toContain('Site haritasında ve ana sayfadaki bağlantılarda açılmayan 2 adres');
    expect(il.details.brokenPageCount).toBe(2);
    expect(il.details.brokenPagesList[0]).toBe('https://site.com/eski/ (HTTP 404, site haritasında)');
  });

  it('canonical hedefi: canonical altinda uyari, elle duzeltilir (snippet araci degil)', async () => {
    const { by } = await kontroller(temelSayfalar(), yeniAlanlar);
    const issue = by.canonical.issues.find((i: any) => i.type === 'canonical_target_broken');
    expect(issue).toMatchObject({ severity: 'warning', page: 'https://site.com/a' });
    expect(issue.description).toContain('https://site.com/eski-a → HTTP 404');
    expect(by.canonical.details).toMatchObject({ canonicalTargetsChecked: 2, canonicalTargetBrokenCount: 1 });
    expect(fixRouteForIssue({ checkId: 'canonical', type: 'canonical_target_broken' })).toBe('manual');
    expect(fixRouteForIssue({ checkId: 'canonical', type: 'canonical_missing' })).toBe('snippet');
  });

  it('baglanti metni: bilgi; yalniz taranan sayfalarda olculur', async () => {
    const pages = temelSayfalar().map((p) => ({ ...p, genericLinkCount: 0, genericLinks: [] }));
    pages[2] = { ...pages[2], genericLinkCount: 2, genericLinks: [{ text: 'buraya tıklayın', href: '/a' }] };
    const { by } = await kontroller(pages);
    const issue = by.internal_linking.issues.find((i: any) => i.type === 'link_text_generic');
    expect(issue.severity).toBe('info');
    expect(issue.description).toContain('1 sayfada 2 bağlantının');
    expect(by.internal_linking.details).toMatchObject({ genericLinkCount: 2, genericLinkPageCount: 1 });
    // Eski tarama (alan yok): olculmedi, details'e sayi yazilmaz
    const eski = await kontroller(temelSayfalar());
    expect(eski.by.internal_linking.details.genericLinkCount).toBeUndefined();
    expect(eski.by.internal_linking.details.brokenPageCount).toBeUndefined();
  });

  it('Google dizini: Search Console verisi varsa uyari; yoksa bulgu yok', async () => {
    const { by } = await kontroller(temelSayfalar(), yeniAlanlar);
    const g = by.google_ai_eligibility;
    const issue = g.issues.find((i: any) => i.type === 'google_not_indexed');
    expect(issue).toMatchObject({ severity: 'warning', page: 'https://site.com/b' });
    expect(issue.description).toContain('sorulan 3 sayfadan 1 tanesi Google dizininde değil');
    expect(g.details).toMatchObject({ indexInspected: 3, indexedCount: 2, notIndexedCount: 1, notIndexedPages: ['https://site.com/b'] });
    const bos = await kontroller(temelSayfalar());
    expect(bos.by.google_ai_eligibility.issues.some((i: any) => i.type === 'google_not_indexed')).toBe(false);
    expect(bos.by.google_ai_eligibility.details.indexInspected).toBeUndefined();
  });

  it('sablon gruplamasi: yeni bulgular yetim sayfalara yazilmaz; yetim sorunu kendi sayfalarinda kalir', async () => {
    const pages = [...temelSayfalar(), sayfa('https://site.com/blog/yetim')];
    pages[3].outboundLinks = [];
    const { checks, by } = await kontroller(pages, yeniAlanlar);
    const issues = checks.flatMap((c) => c.issues.map((i) => ({ ...i, checkId: c.id })));
    const g = groupIssues(issues as any, by);
    const blog = g.byTemplate.find((t) => t.template.startsWith('/blog'));
    expect(blog?.issues.map((i) => i.type)).toEqual(['orphan_pages']);
    expect(g.siteWide.map((s) => s.type)).toContain('broken_pages');
  });
});

describe('yeni bulgular — musteri raporu', () => {
  it('sayfa sorunu satirlari: baslik, sayi, ornekler; Google metni (coverageState) rapora girmez', async () => {
    const pages = temelSayfalar();
    pages[1].genericLinkCount = 1;
    pages[1].genericLinks = [{ text: 'Devamı', href: '/b' }];
    const { checks } = await kontroller(pages, yeniAlanlar);
    const g = mukellefGirdisi();
    const a = g.audit as any;
    for (const id of ['internal_linking', 'canonical', 'google_ai_eligibility']) a.checks[id] = checks.find((c) => c.id === id);
    const yeni = checks.flatMap((c) => c.issues.map((i) => ({ ...i, checkId: c.id })))
      .filter((i) => ['broken_pages', 'canonical_target_broken', 'link_text_generic', 'google_not_indexed'].includes(i.type));
    a.issues = [...a.issues, ...yeni];
    const r = buildClientReport(g, new Date('2026-11-25T10:00:00Z'));
    if (r.seo.olculemedi) throw new Error('seo');
    const by = Object.fromEntries(r.seo.sayfaSorunlari.map((s) => [s.tur, s]));
    expect(by.broken_pages).toMatchObject({ sayi: 2, birim: 'adres', onem: 'uyari' });
    expect(by.broken_pages.ornekler[0]).toContain('/eski/');
    expect(by.canonical_target_broken).toMatchObject({ sayi: 1, birim: 'sayfa' });
    expect(by.link_text_generic).toMatchObject({ sayi: 1, onem: 'bilgi' });
    expect(by.google_not_indexed).toMatchObject({ sayi: 1, ornekler: ['https://site.com/b'] });
    expect(by.google_not_indexed.aciklama).toContain("Search Console'a göre sorulan 3 sayfadan 1 tanesi");
    expect(JSON.stringify(r)).not.toContain('Tarandı - şu anda dizine eklenmedi');
  });
});
