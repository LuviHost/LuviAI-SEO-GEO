import { describe, it, expect, vi } from 'vitest';
import { AiSitemapService, articleLastmod, articlePublicEntry, articlePublicUrl } from './ai-sitemap.service.js';

/**
 * T-A madde 6 — sitemap-ai.xml <lastmod>: yerinde guncelleme artik
 * publishedAt'i (ilk yayin) ilerletmiyor; lastmod ilk yayinda kaliyor ve
 * guncellenen sayfa "degismedi" diye ilan ediliyordu. Artik adresi veren canli
 * kopyaya son yazim (publishedTo kaydinin updatedAt'i) ?? publishedAt ?? createdAt.
 * sitemaps.org: "The date of last modification of the page"; Google: "the last
 * significant update to the page".
 */

const SITE = new URL('https://lavantakuafor.com');
const FIRST = new Date('2026-10-01T09:00:00Z');
const CREATED = new Date('2026-09-30T09:00:00Z');
const wp = (over: Record<string, unknown> = {}) => ({ targetId: 'wp1', targetType: 'WORDPRESS_REST', ok: true, externalUrl: 'https://lavantakuafor.com/sac-bakimi/', ...over });

function svcWith(articles: Array<Record<string, unknown>>, targets: unknown[] = []) {
  const prisma = {
    site: {
      findUnique: vi.fn(async () => ({ id: 's1', url: 'https://lavantakuafor.com', user: { deletionRequestedAt: null } })),
      findUniqueOrThrow: vi.fn(async () => ({ id: 's1', url: 'https://lavantakuafor.com' })),
    },
    article: { findMany: vi.fn(async () => articles) },
    publishTarget: { findMany: vi.fn(async () => targets) },
  };
  const s = new AiSitemapService(prisma as any);
  (s as any).fetchText = vi.fn(async () => ({ ok: false, binary: false, text: '' }));
  return s;
}

const article = (over: Record<string, unknown> = {}) => ({
  slug: 'sac-bakimi', title: 'Saç Bakımı', metaDescription: 'Özet', frontmatter: {}, editorScore: 80,
  publishedAt: FIRST, createdAt: CREATED, publishedTo: [wp()], heroImageUrl: null, ...over,
});

const lastmods = (xml: string) => [...xml.matchAll(/<lastmod>([^<]+)<\/lastmod>/g)].map((m) => m[1]);

describe('articleLastmod', () => {
  it('kaydin son yazimi > ilk yayin > kayit tarihi', () => {
    expect(articleLastmod({ updatedAt: '2026-10-15T12:00:00.000Z' }, FIRST, CREATED).toISOString()).toBe('2026-10-15T12:00:00.000Z');
    expect(articleLastmod({}, FIRST, CREATED)).toBe(FIRST);
    expect(articleLastmod({ updatedAt: 'bozuk' }, FIRST, CREATED)).toBe(FIRST);
    expect(articleLastmod(null, null, CREATED)).toBe(CREATED);
  });
});

describe('articlePublicEntry — adres ve onu veren kayit (articlePublicUrl ile ayni kural)', () => {
  it('WordPress kalici baglantisi; dosya hedefinde kanonik adres; bilinmiyorsa null', () => {
    const e = wp({ updatedAt: '2026-10-15T12:00:00.000Z' });
    expect(articlePublicEntry(SITE, 'sac-bakimi', [e], new Map())).toEqual({ url: 'https://lavantakuafor.com/sac-bakimi/', entry: e });
    const ftp = { targetId: 'ftp1', ok: true, externalUrl: 'ftp://h/public_html/blog/sac-bakimi.html' };
    const targets = new Map([['ftp1', { type: 'FTP', config: { remotePath: '/public_html/blog' } }]]);
    expect(articlePublicEntry(SITE, 'sac-bakimi', [ftp], targets)).toEqual({ url: 'https://lavantakuafor.com/blog/sac-bakimi.html', entry: ftp });
    expect(articlePublicEntry(SITE, 'x', [{ targetId: 'z', ok: true, externalUrl: '/tmp/a.zip' }], new Map())).toBeNull();
    expect(articlePublicUrl(SITE, 'sac-bakimi', [e], new Map())).toBe('https://lavantakuafor.com/sac-bakimi/');
  });
});

describe('AiSitemapService — <lastmod>', () => {
  it('yerinde guncellenen yazi: lastmod son yazimin gunu (eskiden ilk yayinda kaliyordu)', async () => {
    const xml = (await svcWith([article({ publishedTo: [wp({ updatedAt: '2026-10-15T12:00:00.000Z' })] })]).getPublicXml('s1'))!;
    expect(lastmods(xml)).toEqual(['2026-10-15']);
  });

  it('son yazim kaydi olmayan eski yayin: ilk yayin tarihi (eski davranis); ilk yayin yoksa kayit tarihi', async () => {
    const xml = (await svcWith([article(), article({ slug: 'eski', publishedAt: null, publishedTo: [wp({ externalUrl: 'https://lavantakuafor.com/eski/' })] })]).getPublicXml('s1'))!;
    expect(lastmods(xml)).toEqual(['2026-10-01', '2026-09-30']);
  });

  it('adresi VEREN kaydin tarihi: baska hedefe (Markdown ZIP) yazmak bu sayfanin tarihini ilerletmez', async () => {
    const xml = (await svcWith([article({
      publishedTo: [
        wp({ updatedAt: '2026-10-10T08:00:00.000Z' }),
        { targetId: 'zip1', targetType: 'MARKDOWN_ZIP', ok: true, externalUrl: '/tmp/a.zip', updatedAt: '2026-10-16T08:00:00.000Z' },
      ],
    })]).getPublicXml('s1'))!;
    expect(lastmods(xml)).toEqual(['2026-10-10']);
  });

  it('musteri canli kopyayi elle guncelledi (mark-updated updatedAt yazar): lastmod o gun', async () => {
    const xml = (await svcWith([article({ publishedTo: [wp({ targetType: 'GHOST', updatedAt: '2026-10-17T10:00:00.000Z', manualUpdatedAt: '2026-10-17T10:00:00.000Z' })] })]).getPublicXml('s1'))!;
    expect(lastmods(xml)).toEqual(['2026-10-17']);
  });
});
