import { describe, it, expect } from 'vitest';
import { AuditChecksService } from './audit-checks.service.js';
import { groupIssues } from './issue-grouping.js';

/**
 * H1 eksik sayfa adresleri (details.missingH1Pages).
 *
 * NEDEN VAR: musteri raporu her sayfa sorunu icin ornek adres gosterir; H1
 * kontrolu yalniz sayiyi tutuyordu ("24 sayfada H1 yok" — hangi 24?). Alan adi
 * bilerek `missingPages` degil: issue-grouping pagesFromDetails o adi okur ve
 * ayni kontroldeki h1_duplicate sorununu da eksik H1'li sayfalara yazardi.
 */
const sayfa = (url: string, h1: string | null) => ({
  url, title: 'Yeterince uzun bir sayfa basligi burada', metaDescription: 'x'.repeat(120), h1, h2s: [], textSample: '',
  ogTags: {}, twitterTags: {}, canonical: url, hreflangs: [], jsonLdBlocks: [], schemaTypes: [], lang: 'tr',
  imageAltStats: { total: 0, withAlt: 0, emptyAlt: 0, absent: 0, ariaDecorative: 0, suspicious: 0, excluded: 0 },
  images: [], imagesCapped: false, outboundLinks: [],
}) as any;

const tarama = (pages: any[]) => ({ baseUrl: 'https://site.com', pages, sitemapUrl: null, robotsTxt: null, llmsTxt: null, totalPages: pages.length }) as any;

describe('h1_uniqueness — eksik H1 adresleri', () => {
  it('eksik H1li sayfalar en fazla 50 adresle details.missingH1Pages icinde; sayi degismedi', async () => {
    const pages = [
      ...Array.from({ length: 60 }, (_, i) => sayfa(`https://site.com/eksik-${i}`, null)),
      sayfa('https://site.com/a', 'Ayni'),
      sayfa('https://site.com/b', 'Ayni'),
    ];
    const h1 = (await new AuditChecksService().runAllChecks(tarama(pages))).find((c) => c.id === 'h1_uniqueness')!;
    expect(h1.details?.missing).toBe(60);
    expect(h1.details?.missingH1Pages).toHaveLength(50);
    expect(h1.details?.missingH1Pages[0]).toBe('https://site.com/eksik-0');
    expect(h1.issues.map((i) => i.type).sort()).toEqual(['h1_duplicate', 'h1_missing']);
  });

  it('sablon gruplamasi degismedi: h1 sorunlari site geneli kalir, eksik H1 sayfalarina dagitilmaz', async () => {
    const pages = [sayfa('https://site.com/blog/eksik-yazi', null), sayfa('https://site.com/a', 'Ayni'), sayfa('https://site.com/b', 'Ayni')];
    const checks = await new AuditChecksService().runAllChecks(tarama(pages));
    const issues = checks.flatMap((c) => c.issues.map((i) => ({ ...i, checkId: c.id })));
    const g = groupIssues(issues as any, Object.fromEntries(checks.map((c) => [c.id, c])));
    const h1Turleri = g.siteWide.filter((s) => s.checkId === 'h1_uniqueness').map((s) => s.type).sort();
    expect(h1Turleri).toEqual(['h1_duplicate', 'h1_missing']);
    expect(g.byTemplate.flatMap((t) => t.issues).some((i) => i.checkId === 'h1_uniqueness')).toBe(false);
  });
});
