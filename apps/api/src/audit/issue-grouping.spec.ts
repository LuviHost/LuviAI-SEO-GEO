import { describe, it, expect } from 'vitest';
import { urlTemplate, groupIssues } from './issue-grouping.js';

describe('urlTemplate', () => {
  it('slug, rakam ve tarih segmentleri * olur; ilk 3 segment; kok /', () => {
    expect(urlTemplate('https://x.com/')).toBe('/');
    expect(urlTemplate('https://x.com/blog/nasil-yapilir/')).toBe('/blog/*');
    expect(urlTemplate('https://x.com/urunler/x-100/detay')).toBe('/urunler/*/detay');
    expect(urlTemplate('https://x.com/2026/08/27/baslik-uzun')).toBe('/*/*/*');
    expect(urlTemplate('https://x.com/hakkimizda')).toBe('/hakkimizda');
    expect(urlTemplate('/blog/yazi-1?utm=x#top', 'https://x.com')).toBe('/blog/*');
  });
  it('gecersiz URL patlamaz', () => {
    expect(urlTemplate('http://')).toBe('/');
  });
});

describe('groupIssues', () => {
  const checks = {
    meta_title: { id: 'meta_title', name: 'Meta Title', details: { missingPages: ['https://x.com/blog/a-1', 'https://x.com/blog/b-2', 'https://x.com/urunler/p-9/detay'] } },
    internal_linking: { id: 'internal_linking', name: 'Iç Linkleme', details: { orphans: ['https://x.com/blog/c-3'] } },
    sitemap_xml: { id: 'sitemap_xml', name: 'Sitemap' },
  };
  const issues = [
    { type: 'meta_title_missing', severity: 'critical' as const, checkId: 'meta_title', fixable: true, page: 'https://x.com/blog/a-1' },
    { type: 'orphan_pages', severity: 'warning' as const, checkId: 'internal_linking', fixable: false },
    { type: 'sitemap_missing', severity: 'critical' as const, checkId: 'sitemap_xml', fixable: true },
  ];

  it('sayfali sorunlar sablona dagilir, sayfasizlar siteWide\'a duser', () => {
    const g = groupIssues(issues, checks);
    expect(g.siteWide).toEqual([{ type: 'sitemap_missing', checkId: 'sitemap_xml', severity: 'critical', fixable: true }]);
    const blog = g.byTemplate.find((t) => t.template === '/blog/*')!;
    expect(blog.pageCount).toBe(3);           // a-1, b-2 (title) + c-3 (orphan)
    expect(blog.issues.map((i) => i.type).sort()).toEqual(['meta_title_missing', 'orphan_pages']);
    expect(blog.fixableCheckIds).toEqual(['meta_title']);
    expect(blog.criticalCount).toBe(1);
    const urun = g.byTemplate.find((t) => t.template === '/urunler/*/detay')!;
    expect(urun.pageCount).toBe(1);
  });

  it('byCheck en agir severity ve sayiya gore siralanir', () => {
    const g = groupIssues(issues, checks);
    expect(g.byCheck[0].worstSeverity).toBe('critical');
    expect(g.byCheck.map((c) => c.checkId)).toContain('internal_linking');
  });

  it('en cok sayfali sablon once; ornek sayfa 5 ile sinirli', () => {
    const many = Array.from({ length: 12 }, (_, i) => `https://x.com/blog/post-${i}`);
    const g = groupIssues(
      [{ type: 'meta_desc_missing', severity: 'critical', checkId: 'meta_description', fixable: false }],
      { meta_description: { id: 'meta_description', name: 'Meta Description', details: { missingPages: many } } },
    );
    expect(g.byTemplate[0].pageCount).toBe(12);
    expect(g.byTemplate[0].samplePages).toHaveLength(5);
  });
});
