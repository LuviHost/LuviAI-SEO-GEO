import { describe, it, expect, vi } from 'vitest';

vi.mock('../prisma/prisma.service.js', () => ({ PrismaService: class {} }));
const { AiSitemapService, articlePublicEntry, publicArticleText } = await import('./ai-sitemap.service.js');
const { LlmsFullBuilderService } = await import('./llms-full-builder.service.js');
const { articleContentHash } = await import('../articles/republish-policy.js');

/**
 * K6 — sitemap-ai.xml ve llms-full ADRESTEKI sayfanin metnini ilan eder;
 * cop kutusundaki kopya adres vermez (C3 trashedAt).
 *
 * NEDEN VAR: ozet/baslik/metin her zaman kayittan okunuyordu. Adresi veren
 * kopya "elle guncelleme bekliyor" (manualUpdatePending) ise o adresteki sayfa
 * yazinin ESKI metnini gosterir; AI'lara adresle birlikte sayfada olmayan yeni
 * baslik, ozet ve metin ilan ediliyordu. Cop kutusundaki WordPress kopyasinin
 * adresi (404) de ilan ediliyordu.
 */

const SITE = 'https://lavantakuafor.com';
const YENI = { title: 'Saç Bakımı 2026', metaTitle: 'Saç Bakımı 2026', metaDescription: 'Yeni özet: 2026 rehberi', bodyMd: '# Yeni\n\nYeni metin gövdesi.' };
const ESKI = { title: 'Saç Bakımı', metaTitle: 'Saç Bakımı', metaDescription: 'Eski özet: temel rehber', bodyMd: '# Eski\n\nYayındaki eski metin.' };
const SNAPSHOT = { ...ESKI, faqs: [{ q: 'Eski soru?', a: 'Eski cevap.' }], schemaMarkup: null, slug: 'sac-bakimi', publishedAt: '2026-05-01T10:00:00.000Z', takenAt: '2026-10-01T10:00:00.000Z' };

const kopya = (over: Record<string, unknown> = {}) => ({
  targetId: 'gh1', targetType: 'GHOST', ok: true, externalUrl: `${SITE}/sac-bakimi/`, updatedAt: '2026-05-01T10:00:00.000Z', ...over,
});

describe('publicArticleText', () => {
  const satir = { ...YENI, faqs: [{ q: 'Yeni soru?', a: 'Yeni cevap.' }], agentOutputs: { liveSnapshot: SNAPSHOT } };

  it('isaretsiz kopya: kayit metni', () => {
    expect(publicArticleText(satir, kopya())).toMatchObject({ source: 'row', title: YENI.title, metaDescription: YENI.metaDescription });
  });

  it('isaretli kopya + goruntu (kopyada iz yok ya da iz goruntuyle ayni): yeniden yazimdan onceki metin', () => {
    for (const entry of [kopya({ manualUpdatePending: true }), kopya({ manualUpdatePending: true, contentHash: articleContentHash(ESKI) })]) {
      expect(publicArticleText(satir, entry)).toEqual({
        source: 'live_snapshot', title: ESKI.title, metaDescription: ESKI.metaDescription, bodyMd: ESKI.bodyMd, faqs: SNAPSHOT.faqs,
      });
    }
  });

  it('isaret bayatsa (kopyanin izi kayit metniyle ayni) kayit metni', () => {
    expect(publicArticleText(satir, kopya({ manualUpdatePending: true, contentHash: articleContentHash(YENI) })).source).toBe('row');
  });

  it('kopya goruntuden de eski metni gosteriyorsa ya da goruntu yoksa: metin ilan edilmez (unknown)', () => {
    const dahaEski = articleContentHash({ title: 'İlk sürüm', metaTitle: '', metaDescription: 'ilk', bodyMd: 'ilk' });
    expect(publicArticleText(satir, kopya({ manualUpdatePending: true, contentHash: dahaEski }))).toEqual({
      source: 'unknown', title: null, metaDescription: null, bodyMd: null, faqs: null,
    });
    expect(publicArticleText({ ...satir, agentOutputs: {} }, kopya({ manualUpdatePending: true })).source).toBe('unknown');
  });
});

describe('articlePublicEntry — cop kutusundaki kopya adres vermez (C3)', () => {
  const site = new URL(SITE);
  it('cop kutusundaki kopya atlanir; yalniz o varsa adres yok', () => {
    const cop = { targetId: 'wp1', targetType: 'WORDPRESS_REST', ok: true, externalUrl: `${SITE}/eski-adres/`, trashedAt: '2026-10-10T10:00:00.000Z' };
    expect(articlePublicEntry(site, 'sac-bakimi', [cop, kopya()], new Map())?.url).toBe(`${SITE}/sac-bakimi/`);
    expect(articlePublicEntry(site, 'sac-bakimi', [cop], new Map())).toBeNull();
    // Bos trashedAt cop kutusu sayilmaz
    expect(articlePublicEntry(site, 'sac-bakimi', [{ ...cop, trashedAt: '' }], new Map())?.url).toBe(`${SITE}/eski-adres/`);
  });

  it('silinmis bulunan kopya (missingAt, D3) da adres vermez; kural republish-policy entryRetired', () => {
    const silinmis = { targetId: 'wp1', targetType: 'WORDPRESS_REST', ok: true, externalUrl: `${SITE}/olu-adres/`, missingAt: '2026-10-11T10:00:00.000Z' };
    expect(articlePublicEntry(site, 'sac-bakimi', [silinmis, kopya()], new Map())?.url).toBe(`${SITE}/sac-bakimi/`);
    expect(articlePublicEntry(site, 'sac-bakimi', [silinmis], new Map())).toBeNull();
  });
});

type Makale = Record<string, unknown> & { id: string };

function prismaFor(articles: Makale[], extra: Record<string, Record<string, unknown>> = {}) {
  return {
    site: {
      findUnique: vi.fn(async () => ({ id: 's1', url: SITE, user: { deletionRequestedAt: null } })),
      findUniqueOrThrow: vi.fn(async () => ({ id: 's1', name: 'Lavanta', url: SITE, niche: null, language: 'tr', brain: null })),
      update: vi.fn(async () => ({})),
    },
    article: {
      findMany: vi.fn(async (args: any) => {
        // Ikinci sorgu: yalniz istenen kimliklerin agir alanlari
        if (args?.where?.id?.in) return args.where.id.in.map((id: string) => ({ id, ...extra[id] }));
        return articles;
      }),
    },
    publishTarget: { findMany: vi.fn(async () => []) },
  };
}

const makale = (id: string, slug: string, publishedTo: unknown[], over: Record<string, unknown> = {}): Makale => ({
  id, slug, ...YENI, topic: 't', wordCount: 100, frontmatter: { aeo_queries: ['Yeni soru?'] }, editorScore: 81,
  category: null, faqs: [{ q: 'Yeni soru?', a: 'Yeni cevap.' }], heroImageUrl: `${SITE}/wp-content/uploads/${slug}.jpg`,
  publishedAt: new Date('2026-05-01T10:00:00Z'), createdAt: new Date('2026-04-30T10:00:00Z'), publishedTo, ...over,
});

describe('sitemap-ai.xml — ozet adresteki sayfanin metninden', () => {
  function sitemap(articles: Makale[], extra: Record<string, Record<string, unknown>> = {}) {
    const prisma = prismaFor(articles, extra);
    const s = new AiSitemapService(prisma as any);
    (s as any).fetchText = vi.fn(async () => ({ ok: true, binary: false, text: '' }));
    return { s, prisma };
  }
  const blok = (xml: string, slug: string) => xml.split('<url>').find((b) => b.includes(`/${slug}/`)) ?? '';

  it('isaretli kopya + goruntu: ozet ve gorsel basligi eski metinden, AEO sorulari yok; isaretsiz makale aynen', async () => {
    const { s, prisma } = sitemap(
      [
        makale('a1', 'sac-bakimi', [kopya({ manualUpdatePending: true })]),
        makale('a2', 'boya', [kopya({ externalUrl: `${SITE}/boya/` })]),
      ],
      { a1: { metaTitle: YENI.metaTitle, bodyMd: YENI.bodyMd, agentOutputs: { liveSnapshot: SNAPSHOT } } },
    );
    const { xml } = await s.build('s1');
    const isaretli = blok(xml, 'sac-bakimi');
    expect(isaretli).toContain(`<ai:summary>${ESKI.metaDescription}</ai:summary>`);
    expect(isaretli).not.toContain('Yeni özet');
    expect(isaretli).not.toContain('<ai:topics>');
    expect(isaretli).toContain(`<image:title>${ESKI.title}</image:title>`);
    const normal = blok(xml, 'boya');
    expect(normal).toContain(`<ai:summary>${YENI.metaDescription}</ai:summary>`);
    expect(normal).toContain('<ai:topic>Yeni soru?</ai:topic>');
    // Agir alanlar yalniz isaretli makale icin, ikinci sorguda
    expect(prisma.article.findMany).toHaveBeenCalledTimes(2);
    expect((prisma.article.findMany.mock.calls[1] as any)[0]).toEqual({
      where: { id: { in: ['a1'] } }, select: { id: true, metaTitle: true, bodyMd: true, agentOutputs: true },
    });
  });

  it('eski metin bilinmiyorsa adres listelenir ama ozet ve sorular yazilmaz; cop kutusundaki kopya listelenmez', async () => {
    const { s } = sitemap(
      [
        makale('a1', 'sac-bakimi', [kopya({ manualUpdatePending: true })]),
        makale('a3', 'kaldirildi', [kopya({ targetId: 'wp1', targetType: 'WORDPRESS_REST', externalUrl: `${SITE}/kaldirildi/`, trashedAt: '2026-10-10T10:00:00.000Z' })]),
      ],
      { a1: { metaTitle: YENI.metaTitle, bodyMd: YENI.bodyMd, agentOutputs: {} } },
    );
    const { xml } = await s.build('s1');
    const isaretli = blok(xml, 'sac-bakimi');
    expect(isaretli).toContain(`<loc>${SITE}/sac-bakimi/</loc>`);
    expect(isaretli).not.toContain('<ai:summary>');
    expect(isaretli).not.toContain('<ai:topics>');
    expect(xml).not.toContain('/kaldirildi/');
  });
});

describe('llms-full / llms.txt — metin adresteki sayfanin metninden', () => {
  it('isaretli kopya + goruntu: baslik, ozet, metin ve SSS eski metinden', async () => {
    const prisma = prismaFor(
      [makale('a1', 'sac-bakimi', [kopya({ manualUpdatePending: true })])],
      { a1: { metaTitle: YENI.metaTitle, bodyMd: YENI.bodyMd, agentOutputs: { liveSnapshot: SNAPSHOT } } },
    );
    const svc = new LlmsFullBuilderService(prisma as any);
    await svc.build('s1');
    const txt = (prisma.site.update.mock.calls[0] as any)[0].data.llmsFullTxt as string;
    expect(txt).toContain(`### ${ESKI.title}\n`);
    expect(txt).toContain(`**URL:** ${SITE}/sac-bakimi/`);
    expect(txt).toContain(`**Ozet:** ${ESKI.metaDescription}`);
    expect(txt).toContain('Yayındaki eski metin.');
    expect(txt).toContain('- *Eski soru?* → Eski cevap.');
    expect(txt).not.toMatch(/Saç Bakımı 2026|Yeni özet|Yeni metin|Yeni soru/);

    const kisa = await svc.buildShortIndex('s1');
    expect(kisa).toContain(`- [${ESKI.title}](${SITE}/sac-bakimi/): ${ESKI.metaDescription}`);
  });

  it('eski metin bilinmiyorsa adres verilir, metin ilan edilmez ve nedeni yazilir; cop kutusundaki kopya adres vermez', async () => {
    const prisma = prismaFor(
      [
        makale('a1', 'sac-bakimi', [kopya({ manualUpdatePending: true })]),
        makale('a3', 'kaldirildi', [kopya({ targetId: 'wp1', externalUrl: `${SITE}/kaldirildi/`, trashedAt: '2026-10-10T10:00:00.000Z' })], { title: 'Kaldırılan yazı' }),
      ],
      { a1: { metaTitle: YENI.metaTitle, bodyMd: YENI.bodyMd, agentOutputs: null } },
    );
    const svc = new LlmsFullBuilderService(prisma as any);
    await svc.build('s1');
    const txt = (prisma.site.update.mock.calls[0] as any)[0].data.llmsFullTxt as string;
    const ilk = txt.slice(txt.indexOf('### '), txt.indexOf('---', txt.indexOf('### ')));
    expect(ilk).toContain(`**URL:** ${SITE}/sac-bakimi/`);
    expect(ilk).toContain('Bu adresteki sayfa yazının daha eski bir sürümünü gösteriyor');
    expect(ilk).not.toMatch(/\*\*Ozet:\*\*|Yeni metin|Yeni soru/);
    expect(txt).not.toContain('/kaldirildi/');
    expect(txt).toContain('### Kaldırılan yazı');

    const kisa = await svc.buildShortIndex('s1');
    expect(kisa).toContain(`- [${YENI.title}](${SITE}/sac-bakimi/)\n`);
    expect(kisa).toContain('- Kaldırılan yazı: Yeni özet');
  });
});
