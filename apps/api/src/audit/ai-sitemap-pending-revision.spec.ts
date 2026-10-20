import { describe, it, expect, vi } from 'vitest';

vi.mock('../prisma/prisma.service.js', () => ({ PrismaService: class {} }));
const { AiSitemapService, publicArticleText, publicArticleWhere } = await import('./ai-sitemap.service.js');
const { LlmsFullBuilderService } = await import('./llms-full-builder.service.js');
const { articleContentHash } = await import('../articles/republish-policy.js');

/**
 * Onay bekleyen yeniden yazim (bilinen sinir, 18.10.2026): yari otomatik modda yayindaki
 * yazi yeniden yazilinca kayit READY_TO_PUBLISH / REVIZE_NEEDED'e gecer, yeni metin onay
 * bekler; sitede ESKI metin yayinda kalir.
 *
 * NEDEN VAR: sitemap-ai.xml ve llms-full yalniz PUBLISHED okuyordu; yazi onaylanana kadar
 * iki dosyadan da dusuyor, sitede duran sayfa AI tarayicilarina ilan edilmiyordu. Artik
 * sitede canli (emekli olmayan) adresi olan bu yazilar da listelenir; metin adresteki
 * eski metindir (agentOutputs.liveSnapshot), onaydaki yeni metin ASLA ilan edilmez.
 */

const SITE = 'https://lavantakuafor.com';
const YENI = { title: 'Saç Bakımı 2026', metaTitle: 'Saç Bakımı 2026', metaDescription: 'Yeni özet: onay bekliyor', bodyMd: '# Yeni\n\nOnaydaki yeni metin.' };
const ESKI = { title: 'Saç Bakımı', metaTitle: 'Saç Bakımı', metaDescription: 'Eski özet: yayındaki metin', bodyMd: '# Eski\n\nYayındaki eski metin.' };
const SNAPSHOT = { ...ESKI, faqs: [{ q: 'Eski soru?', a: 'Eski cevap.' }], schemaMarkup: null, slug: 'x', publishedAt: '2026-05-01T10:00:00.000Z', takenAt: '2026-10-01T10:00:00.000Z' };

const kopya = (slug: string, over: Record<string, unknown> = {}) => ({
  targetId: 'wp1', targetType: 'WORDPRESS_REST', ok: true, externalId: '9', externalUrl: `${SITE}/${slug}/`, updatedAt: '2026-05-01T10:00:00.000Z', ...over,
});

type Makale = Record<string, unknown> & { id: string; status: string; publishedAt: Date | null };

const makale = (id: string, slug: string, status: string, publishedTo: unknown[], over: Record<string, unknown> = {}): Makale => ({
  id, slug, status, siteId: 's1', ...YENI, topic: 't', wordCount: 100, frontmatter: { aeo_queries: ['Yeni soru?'] }, editorScore: 81,
  category: null, faqs: [{ q: 'Yeni soru?', a: 'Yeni cevap.' }], heroImageUrl: `${SITE}/wp-content/uploads/${slug}.jpg`,
  publishedAt: new Date('2026-05-01T10:00:00Z'), createdAt: new Date('2026-04-30T10:00:00Z'), publishedTo, ...over,
});

/** Sorgu kosulunu gercekten uygulayan sahte (eski `status: 'PUBLISHED'` bicimi de) */
function eslesir(a: Makale, where: any): boolean {
  if (where.siteId && a.siteId !== where.siteId) return false;
  const tek = (w: any): boolean => {
    if (typeof w.status === 'string' && a.status !== w.status) return false;
    if (w.status?.in && !w.status.in.includes(a.status)) return false;
    if (w.publishedAt?.not === null && a.publishedAt === null) return false;
    return true;
  };
  if (Array.isArray(where.OR)) return where.OR.some(tek);
  return tek(where);
}

function prismaFor(articles: Makale[]) {
  return {
    site: {
      findUnique: vi.fn(async () => ({ id: 's1', url: SITE, user: { deletionRequestedAt: null } })),
      findUniqueOrThrow: vi.fn(async () => ({ id: 's1', name: 'Lavanta', url: SITE, niche: null, language: 'tr', brain: null })),
      update: vi.fn(async () => ({})),
    },
    article: {
      findMany: vi.fn(async (args: any) => {
        if (args?.where?.id?.in) return articles.filter((a) => args.where.id.in.includes(a.id)).map((a) => ({ id: a.id, metaTitle: a.metaTitle, bodyMd: a.bodyMd, agentOutputs: a.agentOutputs }));
        return articles.filter((a) => eslesir(a, args.where));
      }),
    },
    publishTarget: { findMany: vi.fn(async () => []) },
  };
}

const eskiIz = articleContentHash(ESKI);
const NORMAL = { title: 'Yayındaki yazı', metaTitle: 'Yayındaki yazı', metaDescription: 'Normal özet', bodyMd: 'Normal metin.' };
const DUNYA: Makale[] = [
  // Normal yayindaki yazi
  makale('p1', 'yayinda', 'PUBLISHED', [kopya('yayinda', { contentHash: articleContentHash(NORMAL) })], { ...NORMAL, frontmatter: { aeo_queries: ['Normal soru?'] }, faqs: null }),
  // Yeniden yazimi onay bekliyor: kopyanin izi eski metnin izi, goruntu var
  makale('r1', 'onayda', 'READY_TO_PUBLISH', [kopya('onayda', { contentHash: eskiIz })], { agentOutputs: { liveSnapshot: SNAPSHOT } }),
  // Editor revize istedi; izsiz eski kayit + goruntu
  makale('r2', 'revize', 'REVIZE_NEEDED', [kopya('revize')], { agentOutputs: { liveSnapshot: SNAPSHOT } }),
  // Hic yayinlanmamis: sorguya girmez
  makale('r3', 'hic-yayinlanmadi', 'READY_TO_PUBLISH', [], { publishedAt: null }),
  // Tum kopyalari emekli (sitede kaldirilmis): listelenmez
  makale('r4', 'kaldirildi', 'READY_TO_PUBLISH', [kopya('kaldirildi', { missingAt: '2026-10-18T02:20:00.000Z', missingReason: 'public_url_gone' })]),
  // Adresteki metin bilinmiyor (goruntu yok, iz farkli)
  makale('r5', 'bilinmiyor', 'READY_TO_PUBLISH', [kopya('bilinmiyor', { contentHash: 'baska-bir-metnin-izi' })], { agentOutputs: {} }),
];

const blok = (xml: string, slug: string) => xml.split('<url>').find((b) => b.includes(`/${slug}/`)) ?? '';

describe('publicArticleText — onay bekleyen yeniden yazim', () => {
  const satir = { ...YENI, faqs: null, agentOutputs: { liveSnapshot: SNAPSHOT } };
  it('isaretsiz kopyada da adresteki eski metin; kopyanin izi kayit metniyle ayniysa kayit metni', () => {
    expect(publicArticleText(satir, kopya('x', { contentHash: eskiIz }), { pendingRevision: true }).source).toBe('live_snapshot');
    expect(publicArticleText(satir, kopya('x'), { pendingRevision: true }).title).toBe(ESKI.title);
    expect(publicArticleText(satir, kopya('x', { contentHash: articleContentHash(YENI) }), { pendingRevision: true }).source).toBe('row');
    expect(publicArticleText({ ...satir, agentOutputs: null }, kopya('x', { contentHash: 'baska' }), { pendingRevision: true }).source).toBe('unknown');
    // Secenek verilmeyen (PUBLISHED) yazida eski davranis
    expect(publicArticleText(satir, kopya('x')).source).toBe('row');
  });
});

describe('sitemap-ai.xml — onay bekleyen yeniden yazim listelenir, metni adresteki eski metin', () => {
  it('sorgu PUBLISHED + daha once yayinlanmis onay bekleyenler; liste yalniz sitede canli adresi olanlar', async () => {
    const prisma = prismaFor(DUNYA);
    const s = new AiSitemapService(prisma as any);
    (s as any).fetchText = vi.fn(async () => ({ ok: true, binary: false, text: '' }));
    const { xml } = await s.build('s1');

    expect((prisma.article.findMany.mock.calls[0] as any)[0].where).toEqual(publicArticleWhere('s1'));
    expect(publicArticleWhere('s1')).toEqual({
      siteId: 's1',
      OR: [{ status: 'PUBLISHED' }, { status: { in: ['READY_TO_PUBLISH', 'REVIZE_NEEDED'] }, publishedAt: { not: null } }],
    });

    expect(blok(xml, 'yayinda')).toContain('<ai:topic>Normal soru?</ai:topic>');
    for (const slug of ['onayda', 'revize']) {
      const b = blok(xml, slug);
      expect(b, slug).toContain(`<loc>${SITE}/${slug}/</loc>`);
      expect(b, slug).toContain(`<ai:summary>${ESKI.metaDescription}</ai:summary>`);
      expect(b, slug).toContain(`<image:title>${ESKI.title}</image:title>`);
      // Onaydaki metnin sorulari ve ozeti ilan edilmez
      expect(b, slug).not.toContain('<ai:topics>');
      expect(b, slug).not.toContain('Yeni özet');
    }
    // Adresteki metin bilinmiyor: adres var, ozet ve gorsel basligi (yeni baslik) yok
    const bilinmeyen = blok(xml, 'bilinmiyor');
    expect(bilinmeyen).toContain(`<loc>${SITE}/bilinmiyor/</loc>`);
    expect(bilinmeyen).not.toContain('<ai:summary>');
    expect(bilinmeyen).not.toContain('<image:title>');
    expect(bilinmeyen).toContain('<image:loc>');
    expect(xml).not.toContain('/hic-yayinlanmadi/');
    expect(xml).not.toContain('/kaldirildi/');
    expect(xml).not.toContain(YENI.title);

    // Agir alanlar yalniz onay bekleyen (ve sitede adresi olan) yazilar icin
    expect((prisma.article.findMany.mock.calls[1] as any)[0].where.id.in.sort()).toEqual(['r1', 'r2', 'r5']);
  });
});

describe('llms-full / llms.txt — onay bekleyen yeniden yazim', () => {
  it('adresteki eski metinle listelenir; metni bilinmeyen ve sitede adresi olmayan onay bekleyen yazi listelenmez', async () => {
    const prisma = prismaFor(DUNYA);
    const svc = new LlmsFullBuilderService(prisma as any);
    const r = await svc.build('s1');
    const txt = (prisma.site.update.mock.calls[0] as any)[0].data.llmsFullTxt as string;

    expect(r.articles).toBe(3);
    expect(txt).toContain('## Makaleler (3)');
    expect(txt).toContain('### Yayındaki yazı');
    expect(txt).toContain(`**URL:** ${SITE}/onayda/`);
    expect(txt).toContain(`**URL:** ${SITE}/revize/`);
    expect(txt.match(new RegExp(`### ${ESKI.title}\\n`, 'g'))).toHaveLength(2);
    expect(txt).toContain(`**Ozet:** ${ESKI.metaDescription}`);
    expect(txt).toContain('Yayındaki eski metin.');
    expect(txt).toContain('- *Eski soru?* → Eski cevap.');
    expect(txt).not.toMatch(/Saç Bakımı 2026|Yeni özet|Onaydaki yeni metin/);
    for (const slug of ['bilinmiyor', 'hic-yayinlanmadi', 'kaldirildi']) expect(txt, slug).not.toContain(`/${slug}/`);

    const kisa = await svc.buildShortIndex('s1');
    expect(kisa).toContain(`- [${ESKI.title}](${SITE}/onayda/): ${ESKI.metaDescription}`);
    expect(kisa).toContain(`- [${ESKI.title}](${SITE}/revize/): ${ESKI.metaDescription}`);
    expect(kisa).not.toMatch(/bilinmiyor|hic-yayinlanmadi|kaldirildi|Saç Bakımı 2026/);
  });
});
