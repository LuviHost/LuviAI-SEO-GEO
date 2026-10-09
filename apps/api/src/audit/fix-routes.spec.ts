import { describe, it, expect } from 'vitest';
import { fixRouteFor, partitionFixes, withFixRoutes, annotateAuditFixRoutes, isAutoFixKey } from './fix-routes.js';

describe('fixRouteFor', () => {
  it('kok dosyalar auto_fix', () => {
    for (const k of ['sitemap_xml', 'robots_txt', 'llms_txt', 'sitemap', 'robots', 'llms', 'agent_json', 'auth_md']) {
      expect(fixRouteFor(k)).toBe('auto_fix');
    }
  });
  it('meta/sema/geo snippet kontrolleri snippet', () => {
    for (const k of ['meta_title', 'meta_description', 'canonical', 'open_graph', 'twitter_card', 'schema_markup', 'geo_faq', 'geo_definition', 'geo_citation_format']) {
      expect(fixRouteFor(k)).toBe('snippet');
    }
  });
  it('otomatik yolu olmayanlar manual (image_alt gorseller sayfasi gelene kadar)', () => {
    for (const k of ['image_alt', 'geo_freshness', 'ai_citation', 'https', 'pagespeed', 'internal_linking', undefined, null, '']) {
      expect(fixRouteFor(k as any)).toBe('manual');
    }
  });
});

describe('partitionFixes', () => {
  it('uretilemeyen anahtarlar ACIKCA doner, takma adlar tekillesir', () => {
    const r = partitionFixes(['sitemap', 'sitemap_xml', 'meta_title', 'robots_txt', 'geo_faq', 'meta_title']);
    expect(r.supported).toEqual(['sitemap', 'robots_txt']);
    expect(r.unsupported).toEqual(['meta_title', 'geo_faq']);
  });
  it('gecersiz girdi patlamaz', () => {
    expect(partitionFixes(undefined)).toEqual({ supported: [], unsupported: [] });
    expect(partitionFixes(['', 3, null] as any)).toEqual({ supported: [], unsupported: [] });
    expect(isAutoFixKey('__proto__')).toBe(false);
  });
});

describe('withFixRoutes / annotateAuditFixRoutes', () => {
  it('fixable rotadan turetilir; geo_freshness eskiden fixable:true idi ama yolu yok', () => {
    const out = withFixRoutes([
      { checkId: 'geo_freshness', type: 'geo_low_freshness', fixable: true },
      { checkId: 'sitemap_xml', type: 'sitemap_missing', fixable: true },
      { checkId: 'meta_title', type: 'meta_title_missing', fixable: true },
    ]);
    expect(out.map((i) => [i.fixRoute, i.fixable])).toEqual([['manual', false], ['auto_fix', true], ['snippet', true]]);
  });

  it('ESKI audit: sablon butonundaki snippet kontrolleri ayiklanir, kayit degismez', () => {
    const old = {
      id: 'a1',
      issues: [{ checkId: 'meta_title', type: 'meta_title_missing', fixable: true }],
      issueGroups: {
        byTemplate: [{ template: '/blog/*', fixableCheckIds: ['meta_title', 'schema_markup'], issues: [{ checkId: 'meta_title', type: 'x', fixable: true }] }],
        siteWide: [{ checkId: 'robots_txt', type: 'robots_missing', fixable: true }],
        byCheck: [],
      },
    };
    const a: any = annotateAuditFixRoutes(old);
    expect(a.issueGroups.byTemplate[0].fixableCheckIds).toEqual([]);
    expect(a.issueGroups.byTemplate[0].issues[0].fixRoute).toBe('snippet');
    expect(a.issueGroups.siteWide[0].fixRoute).toBe('auto_fix');
    expect(a.issues[0].fixRoute).toBe('snippet');
    expect(old.issueGroups.byTemplate[0].fixableCheckIds).toEqual(['meta_title', 'schema_markup']);
  });

  it('checks[id].issues kontrol anahtariyla rotalanir', () => {
    const a: any = annotateAuditFixRoutes({
      checks: {
        robots_txt: { id: 'robots_txt', issues: [{ type: 'robots_missing', fixable: true }] },
        meta_title: { id: 'meta_title', issues: [{ type: 'meta_title_missing', fixable: true }] },
        pagespeed: null,
      },
    });
    expect(a.checks.robots_txt.issues[0].fixRoute).toBe('auto_fix');
    expect(a.checks.meta_title.issues[0].fixRoute).toBe('snippet');
    expect(a.checks.pagespeed).toBeNull();
  });

  it('issueGroups olmayan cok eski audit patlamaz', () => {
    expect(annotateAuditFixRoutes({ issues: null, issueGroups: null } as any)).toEqual({ issues: null, issueGroups: null });
  });
});
