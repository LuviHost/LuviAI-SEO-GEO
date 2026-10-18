import { describe, it, expect } from 'vitest';
import {
  agentOutputsWithLiveSnapshot, agentOutputsWithRejectedRewrite, isLiveArticle, keepLiveFrontmatter, rejectedRewriteAt,
  rowTextIsLive, sectionPathOf, snapshotToKeep, type ExistingArticleRow,
} from './live-rewrite.js';
import { articleContentHash } from './republish-policy.js';

/**
 * Yayindaki yazinin yeniden yazim kurallari (saf yardimcilar). Hattin
 * butunlesik davranisi pipeline-live-rewrite.spec.ts'te.
 */

const FIRST_AT = new Date('2026-01-05T10:00:00.000Z');
const row = (over: Partial<ExistingArticleRow> = {}): ExistingArticleRow => ({
  status: 'PUBLISHED', slug: 'eski-adres', title: 'Başlık', metaTitle: null, metaDescription: 'Özet', bodyMd: 'metin',
  faqs: null, schemaMarkup: null, publishedAt: FIRST_AT,
  publishedTo: [{ targetId: 't-wp', targetType: 'WORDPRESS_REST', ok: true, externalId: '41' }],
  agentOutputs: null,
  ...over,
});
const HASH = articleContentHash(row());

describe('isLiveArticle', () => {
  it('canli kaydi var ya da PUBLISHED: yayinda; kayitlari unutulmus onaydaki yazi yayinda degil', () => {
    expect(isLiveArticle(row())).toBe(true);
    expect(isLiveArticle(row({ status: 'READY_TO_PUBLISH' }))).toBe(true);
    expect(isLiveArticle(row({ publishedTo: null }))).toBe(true);
    expect(isLiveArticle(row({ status: 'READY_TO_PUBLISH', publishedTo: [] }))).toBe(false);
    expect(isLiveArticle(row({ status: 'GENERATING', publishedTo: [{ targetId: 't', ok: false }] }))).toBe(false);
  });
});

describe('rowTextIsLive — kayit metni gercekten bir canli kopyaya yazildi mi', () => {
  it('bir canli kaydin izi kayit metninin izi: evet (durumdan bagimsiz)', () => {
    expect(rowTextIsLive(row({ status: 'READY_TO_PUBLISH', publishedTo: [{ targetId: 't', ok: true, contentHash: HASH }] }))).toBe(true);
  });

  it('izli kayitlar var ama hicbiri bu metin degil: hayir (yazi PUBLISHED olsa da)', () => {
    expect(rowTextIsLive(row({ publishedTo: [{ targetId: 't', ok: true, contentHash: 'baska' }] }))).toBe(false);
  });

  it('izsiz eski kayitlar: PUBLISHED ve hicbir kopya elle guncelleme beklemiyorsa evet', () => {
    expect(rowTextIsLive(row())).toBe(true);
    expect(rowTextIsLive(row({ publishedTo: null }))).toBe(true);
    // Hicbir hedefe yazilamayan yayin yaziyi PUBLISHED'a dondurur ama metin canlida degildir
    expect(rowTextIsLive(row({ publishedTo: [{ targetId: 't', ok: true, manualUpdatePending: true }] }))).toBe(false);
    expect(rowTextIsLive(row({ status: 'READY_TO_PUBLISH' }))).toBe(false);
  });
});

describe('snapshotToKeep / agentOutputsWithLiveSnapshot', () => {
  const previous = { title: 'Canlıdaki', slug: 'eski-adres', takenAt: '2026-09-01T00:00:00.000Z' };

  it('kayit metni canlidaysa onun goruntusu', () => {
    expect(snapshotToKeep(row(), 'T')).toEqual({
      title: 'Başlık', metaTitle: null, metaDescription: 'Özet', bodyMd: 'metin', faqs: null, schemaMarkup: null,
      slug: 'eski-adres', publishedAt: FIRST_AT.toISOString(), takenAt: 'T',
    });
  });

  it('kayit metni canlida degilse onceki goruntu korunur; o da yoksa goruntu yazilmaz', () => {
    expect(snapshotToKeep(row({ status: 'READY_TO_PUBLISH', agentOutputs: { liveSnapshot: previous } }), 'T')).toEqual(previous);
    expect(snapshotToKeep(row({ status: 'READY_TO_PUBLISH' }), 'T')).toBeNull();
    expect(agentOutputsWithLiveSnapshot({ writer: 1 }, row({ status: 'READY_TO_PUBLISH' }), 'T')).toEqual({ writer: 1 });
    expect(agentOutputsWithLiveSnapshot({ writer: 1 }, row(), 'T')).toMatchObject({ writer: 1, liveSnapshot: { bodyMd: 'metin', takenAt: 'T' } });
  });
});

describe('rejectedRewrite', () => {
  const rejected = { at: '2026-10-10T00:00:00.000Z', topic: 'K', verdict: 'FAIL', score: 20, maxScore: 90, title: null, wordCount: 3, blockingIssues: [], geoGateIssues: [], totalCostUsd: 1 };

  it('onceki ajan ciktilari korunur, ozet eklenir; tarihi okunur', () => {
    const merged = agentOutputsWithRejectedRewrite({ writer: { output: 'x' }, liveSnapshot: { slug: 's' } }, rejected);
    expect(merged).toEqual({ writer: { output: 'x' }, liveSnapshot: { slug: 's' }, rejectedRewrite: rejected });
    expect(agentOutputsWithRejectedRewrite(null, rejected)).toEqual({ rejectedRewrite: rejected });
    expect(rejectedRewriteAt(merged)?.toISOString()).toBe('2026-10-10T00:00:00.000Z');
    expect(rejectedRewriteAt({ rejectedRewrite: { at: 'bozuk' } })).toBeNull();
    expect(rejectedRewriteAt(null)).toBeNull();
  });
});

describe('keepLiveFrontmatter — adres ve ilk yayin tarihi frontmatter\'da da korunur', () => {
  const md = ['---', 'title: "Yeni Başlık"', 'slug: "yeni-slug"', "date_published: '2026-10-18'", 'persona: Mert', '---', '# Yeni Başlık', '', 'slug: govdede kalir', 'date_published: govdede kalir'].join('\n');

  it('yalniz bastaki bloktaki mevcut satirlar; tirnak bicimi korunur; govdeye dokunulmaz', () => {
    const r = keepLiveFrontmatter(md, { title: 'Yeni Başlık', slug: 'yeni-slug', date_published: '2026-10-18', persona: 'Mert' }, { slug: 'eski-adres', publishedAt: FIRST_AT });
    expect(r.bodyMd.split('\n').slice(0, 6)).toEqual(['---', 'title: "Yeni Başlık"', 'slug: "eski-adres"', "date_published: '2026-01-05'", 'persona: Mert', '---']);
    expect(r.bodyMd).toContain('\nslug: govdede kalir\ndate_published: govdede kalir');
    expect(r.frontmatter).toEqual({ title: 'Yeni Başlık', slug: 'eski-adres', date_published: '2026-01-05', persona: 'Mert' });
  });

  it('blokta olmayan alan eklenmez; ilk yayin tarihi yoksa tarih degismez; blok yoksa metin aynen', () => {
    const noDate = keepLiveFrontmatter(['---', 'slug: x', '---', 'govde'].join('\n'), { slug: 'x' }, { slug: 'eski', publishedAt: null });
    expect(noDate.bodyMd).toBe(['---', 'slug: eski', '---', 'govde'].join('\n'));
    expect(noDate.frontmatter).toEqual({ slug: 'eski' });
    const noBlock = keepLiveFrontmatter('# Başlık\n\nslug: x', {}, { slug: 'eski', publishedAt: FIRST_AT });
    expect(noBlock.bodyMd).toBe('# Başlık\n\nslug: x');
    expect(noBlock.frontmatter).toEqual({ slug: 'eski' });
  });

  it('girdi nesnesi degistirilmez (gray-matter sonucu onbellekli)', () => {
    const fm = { slug: 'yeni', date_published: '2026-10-18' };
    keepLiveFrontmatter(md, fm, { slug: 'eski-adres', publishedAt: FIRST_AT });
    expect(fm).toEqual({ slug: 'yeni', date_published: '2026-10-18' });
  });
});

describe('sectionPathOf', () => {
  it('son parca haric yol; tek parcada ya da gecersiz adreste null', () => {
    expect(sectionPathOf('https://s.com/blog/yazi/')).toBe('/blog');
    expect(sectionPathOf('https://s.com/a/b/yazi.html')).toBe('/a/b');
    expect(sectionPathOf('https://s.com/yazi/')).toBeNull();
    expect(sectionPathOf('yazi')).toBeNull();
  });
});
