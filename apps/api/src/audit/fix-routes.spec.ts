import { describe, it, expect } from 'vitest';
import { fixRouteFor, fixRouteForIssue, partitionFixes, withFixRoutes, annotateAuditFixRoutes, isAutoFixKey, canonicalFixKey, ROOT_FIX_FILENAME } from './fix-routes.js';

describe('fixRouteFor', () => {
  it('kok dosyalar auto_fix', () => {
    for (const k of ['sitemap_xml', 'robots_txt', 'llms_txt', 'sitemap', 'robots', 'llms']) {
      expect(fixRouteFor(k)).toBe('auto_fix');
    }
  });
  it('agent_json / auth_md artik otomatik duzeltilmez (siteye dogrulanmamis bilgi yayinliyordu)', () => {
    expect(fixRouteFor('agent_json')).toBe('manual');
    expect(fixRouteFor('auth_md')).toBe('manual');
    expect(partitionFixes(['auth_md', 'agent_json', 'robots_txt'])).toEqual({ supported: ['robots_txt'], unsupported: ['auth_md', 'agent_json'] });
  });
  it('kanonik anahtar ve dosya adi', () => {
    expect(canonicalFixKey('robots_txt')).toBe('robots');
    expect(canonicalFixKey('sitemap')).toBe('sitemap');
    expect(canonicalFixKey('auth_md')).toBeNull();
    expect(canonicalFixKey('__proto__')).toBeNull();
    expect(ROOT_FIX_FILENAME.llms).toBe('llms.txt');
  });
  it('meta/sema/geo snippet kontrolleri snippet', () => {
    for (const k of ['meta_title', 'meta_description', 'canonical', 'open_graph', 'twitter_card', 'schema_markup', 'geo_faq', 'geo_definition', 'geo_citation_format']) {
      expect(fixRouteFor(k)).toBe('snippet');
    }
  });
  it('image_alt gorseller sayfasina yonlenir', () => {
    expect(fixRouteFor('image_alt')).toBe('images');
  });
  it('otomatik yolu olmayanlar manual', () => {
    for (const k of ['geo_freshness', 'ai_citation', 'https', 'pagespeed', 'internal_linking', undefined, null, '']) {
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

describe('tip istisnasi — robots engeli otomatik duzeltilmez', () => {
  it('robots_txt altindaki AI arama/egitim botu engeli manual; robots_missing ve robots_no_sitemap auto_fix', () => {
    const out = withFixRoutes([
      { checkId: 'robots_txt', type: 'robots_ai_search_blocked', fixable: false },
      { checkId: 'robots_txt', type: 'robots_ai_training_blocked', fixable: false },
      { checkId: 'robots_txt', type: 'robots_missing', fixable: true },
      { checkId: 'robots_txt', type: 'robots_no_sitemap', fixable: true },
    ]);
    expect(out.map((i) => [i.type, i.fixRoute, i.fixable])).toEqual([
      ['robots_ai_search_blocked', 'manual', false],
      ['robots_ai_training_blocked', 'manual', false],
      ['robots_missing', 'auto_fix', true],
      ['robots_no_sitemap', 'auto_fix', true],
    ]);
    expect(fixRouteForIssue({ checkId: 'robots_txt', type: 'robots_ai_search_blocked' })).toBe('manual');
    // Tip yoksa eski kural: kontrol anahtari
    expect(fixRouteForIssue({ checkId: 'robots_txt' })).toBe('auto_fix');
  });

  it('kayitli audit: checks[robots_txt].issues ve siteWide de manual okunur', () => {
    const a: any = annotateAuditFixRoutes({
      issues: [{ checkId: 'robots_txt', type: 'robots_ai_search_blocked', fixable: true }],
      checks: { robots_txt: { id: 'robots_txt', issues: [{ type: 'robots_ai_search_blocked', fixable: false }, { type: 'robots_no_sitemap', fixable: true }] } },
      issueGroups: { byTemplate: [], siteWide: [{ checkId: 'robots_txt', type: 'robots_ai_search_blocked', fixable: true }], byCheck: [] },
    });
    expect(a.issues[0]).toMatchObject({ fixRoute: 'manual', fixable: false });
    expect(a.checks.robots_txt.issues.map((i: any) => i.fixRoute)).toEqual(['manual', 'auto_fix']);
    expect(a.issueGroups.siteWide[0]).toMatchObject({ fixRoute: 'manual', fixable: false });
  });

  it('kayitli sablon: yalniz manual sorunu olan robots_txt butona girmez, auto_fix sorunu olan girer', () => {
    const a: any = annotateAuditFixRoutes({
      issueGroups: {
        byTemplate: [
          { template: '/a', fixableCheckIds: ['robots_txt'], issues: [{ checkId: 'robots_txt', type: 'robots_ai_search_blocked', fixable: true }] },
          { template: '/b', fixableCheckIds: ['robots_txt'], issues: [{ checkId: 'robots_txt', type: 'robots_ai_search_blocked' }, { checkId: 'robots_txt', type: 'robots_no_sitemap' }] },
          // Sorun listesi olmayan cok eski kayit: yalniz anahtara bakilir
          { template: '/c', fixableCheckIds: ['sitemap_xml', 'meta_title'] },
        ],
        siteWide: [],
        byCheck: [],
      },
    });
    expect(a.issueGroups.byTemplate.map((t: any) => t.fixableCheckIds)).toEqual([[], ['robots_txt'], ['sitemap_xml']]);
  });
});
