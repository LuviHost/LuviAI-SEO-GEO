import { describe, it, expect, vi } from 'vitest';

vi.mock('../prisma/prisma.service.js', () => ({ PrismaService: class {} }));
const { AiSitemapService, advertisedArticleEntry, articlePublicUrl, loadArticleTargets } = await import('./ai-sitemap.service.js');
const { LlmsFullBuilderService } = await import('./llms-full-builder.service.js');

/**
 * WordPress taslak modundaki kopyalar (bilinen sinir, 18.10.2026): WordPress hedef
 * formunun varsayilani postStatus 'draft'. Bu hedefe "yayinlanan" yazi WordPress'te
 * taslak olarak durur; adaptor yazinin ?p=<id> baglantisini kaydeder ve bu adres giris
 * yapmamis ziyaretciye / AI tarayicisina 404 verir.
 *
 * NEDEN VAR: sitemap-ai.xml ve llms-full / llms.txt bu olu adresi ilan ediyordu. Kural
 * canlilik denetimiyle ayni (republish-policy unseenWordPressDraftCopy) ve KAYITTAKI yazi
 * durumuna bakar (remoteStatus: RanksUp'in son yaziminda WordPress'in bildirdigi), hedefin
 * bugunku ayarina degil: durum 'publish' ise ilan edilir; taslak / bekleyen / ozel yazi ya
 * da durumu bilinmeyen eski kaydin duz ?p= adresi canli gorulene (liveSeenAt) kadar ilan
 * edilmez. Durumu bilinmeyen guzel kalici baglanti ve canli gorulmus adres eskisi gibi ilan
 * edilir. rv18 F2: hedef Taslak'tan Yayında'ya alininca WordPress'te taslak kalan eski
 * yazinin 404 veren ?p= adresi yeniden ilan ediliyordu.
 */

const SITE = 'https://isgetkinlikleri.com';

const TARGETS = [
  { id: 'wp-taslak', type: 'WORDPRESS_REST', config: { postStatus: 'draft' } },
  { id: 'wpx-yayin', type: 'WORDPRESS_XMLRPC', config: { postStatus: 'publish' } },
  { id: 'wp-ayarsiz', type: 'WORDPRESS_REST', config: {} },
  { id: 'ftp1', type: 'FTP', config: { remotePath: '/public_html/blog' } },
];

const wpKopya = (targetId: string, externalUrl: string, over: Record<string, unknown> = {}) => ({
  targetId, targetType: targetId.startsWith('wpx') ? 'WORDPRESS_XMLRPC' : 'WORDPRESS_REST', ok: true, externalId: '1', externalUrl,
  updatedAt: '2026-10-10T10:00:00.000Z', ...over,
});

type Makale = Record<string, unknown> & { id: string; slug: string; status: string; publishedAt: Date | null; publishedTo: unknown[] };

const makale = (id: string, slug: string, publishedTo: unknown[], over: Record<string, unknown> = {}): Makale => ({
  id, slug, status: 'PUBLISHED', siteId: 's1', title: `Başlık ${slug}`, metaTitle: null, metaDescription: `Özet ${slug}`,
  bodyMd: `# ${slug}\n\nMetin.`, topic: 't', wordCount: 100, frontmatter: {}, editorScore: 81, category: null, faqs: null,
  heroImageUrl: null, publishedAt: new Date('2026-10-01T10:00:00Z'), createdAt: new Date('2026-09-30T10:00:00Z'), publishedTo, ...over,
});

const DUNYA: Makale[] = [
  // Taslak modundaki hedef, duz ?p= baglantisi, hic canli gorulmedi: ILAN EDILMEZ
  makale('a1', 'taslak', [wpKopya('wp-taslak', `${SITE}/?p=11`)]),
  // Ayni hedef ama canlilik denetimi adresi canli gordu (musteri yayina almis): ilan edilir
  makale('a2', 'taslak-goruldu', [wpKopya('wp-taslak', `${SITE}/?p=12`, { liveSeenAt: '2026-10-19T02:20:00.000Z' })]),
  // Taslak modundaki hedef ama guzel kalici baglanti: WordPress yaziyi herkese acik bildirmis
  makale('a3', 'guzel', [wpKopya('wp-taslak', `${SITE}/guzel-yazi/`)]),
  // XML-RPC (her zaman ?p= kaydeder): WordPress yazim aninda 'publish' bildirdi: ilan edilir
  makale('a4', 'yayin-modu', [wpKopya('wpx-yayin', `${SITE}/?p=13`, { remoteStatus: 'publish' })]),
  // REST, yazim aninda 'publish' (hedef ayari ne olursa olsun): ilan edilir
  makale('a5', 'ayarsiz', [wpKopya('wp-ayarsiz', `${SITE}/?p=14`, { remoteStatus: 'publish' })]),
  // Hedef silinmis: yayin anindaki ayar bilinmiyor (canlilik denetimi gibi taslak olabilir): ilan edilmez
  makale('a6', 'silinmis-hedef', [wpKopya('wp-silindi', `${SITE}/?p=15`)]),
  // Taslak ?p= + dosya hedefi: dosya hedefinin kanonik adresi ilan edilir
  makale('a7', 'ftp-yedek', [wpKopya('wp-taslak', `${SITE}/?p=16`), { targetId: 'ftp1', targetType: 'FTP', ok: true, externalUrl: 'ftp://ftp.host/public_html/blog/ftp-yedek.html' }]),
  // Onay bekleyen yeniden yazim, sitede ilan edilecek adresi yok: hicbir dosyada listelenmez
  makale('a8', 'onayda', [wpKopya('wp-taslak', `${SITE}/?p=17`)], { status: 'READY_TO_PUBLISH' }),
  // rv18 F2: hedef bugun yayin modunda ama kayit eski (durum bilinmiyor) ve duz ?p=: yazi
  // WordPress'te taslak kalmis olabilir — canli gorulmeden ilan edilmez
  makale('a9', 'eski-kayit', [wpKopya('wpx-yayin', `${SITE}/?p=18`)]),
  // rv18 F2: hedef bugun yayin modunda ama WordPress yaziyi yazim aninda taslak bildirdi
  makale('a10', 'taslak-yazildi', [wpKopya('wp-ayarsiz', `${SITE}/?p=19`, { remoteStatus: 'draft' })]),
  // Ozel yazi guzel baglantiyla kaydedilse de anonim ziyaretciye 404: ilan edilmez
  makale('a11', 'ozel', [wpKopya('wp-ayarsiz', `${SITE}/ozel-yazi/`, { remoteStatus: 'private' })]),
];

function prismaFor(articles: Makale[]) {
  return {
    site: {
      findUnique: vi.fn(async () => ({ id: 's1', url: SITE, user: { deletionRequestedAt: null } })),
      findUniqueOrThrow: vi.fn(async () => ({ id: 's1', name: 'İSG Etkinlikleri', url: SITE, niche: null, language: 'tr', brain: null })),
      update: vi.fn(async () => ({})),
    },
    article: {
      findMany: vi.fn(async (args: any) => {
        if (args?.where?.id?.in) return articles.filter((a) => args.where.id.in.includes(a.id)).map((a) => ({ id: a.id, metaTitle: a.metaTitle, bodyMd: a.bodyMd, agentOutputs: null }));
        return articles.filter((a) => a.status === 'PUBLISHED' || (['READY_TO_PUBLISH', 'REVIZE_NEEDED'].includes(a.status) && a.publishedAt !== null));
      }),
    },
    publishTarget: { findMany: vi.fn(async (args: any) => TARGETS.filter(() => args?.where?.siteId === 's1')) },
  };
}

const ILAN = [`${SITE}/?p=12`, `${SITE}/guzel-yazi/`, `${SITE}/?p=13`, `${SITE}/?p=14`, `${SITE}/blog/ftp-yedek.html`];
const GIZLI = ['?p=11', '?p=15', '?p=16', '?p=17', '?p=18', '?p=19', '/ozel-yazi/'];

describe('sitemap-ai.xml — hic canli gorulmemis WordPress taslak baglantisi ilan edilmez', () => {
  it('taslak ?p= adresleri yok; guzel baglanti, yayin modu, canli gorulmus adres ve dosya hedefinin adresi var', async () => {
    const prisma = prismaFor(DUNYA);
    const s = new AiSitemapService(prisma as any);
    (s as any).fetchText = vi.fn(async () => ({ ok: true, binary: false, text: '' }));
    const { xml } = await s.build('s1');
    for (const url of ILAN) expect(xml, url).toContain(`<loc>${url}</loc>`);
    for (const p of GIZLI) expect(xml, p).not.toContain(p);
    // Hedef ayari (postStatus) kayitli adreslerin hepsi sitede olsa da okundu
    expect(prisma.publishTarget.findMany).toHaveBeenCalledTimes(1);
  });
});

describe('llms-full.txt / llms.txt — ayni kural', () => {
  it('taslak ?p= adresi URL olarak yazilmaz; yayindaki yazi adressiz listelenir (adresi cozulemeyen yazinin kurali), onay bekleyen yazi hic listelenmez', async () => {
    const prisma = prismaFor(DUNYA);
    const svc = new LlmsFullBuilderService(prisma as any);
    const r = await svc.build('s1');
    const txt = (prisma.site.update.mock.calls[0] as any)[0].data.llmsFullTxt as string;
    // a1-a7 ve a9-a11 PUBLISHED (adressizler URL'siz listelenir); onay bekleyen a8 yok
    expect(r.articles).toBe(10);
    for (const url of ILAN) expect(txt, url).toContain(`**URL:** ${url}`);
    for (const p of GIZLI) expect(txt, p).not.toContain(p);
    expect(txt).toContain('### Başlık taslak');
    expect(txt).toContain('### Başlık eski-kayit');
    expect(txt).not.toContain('Başlık onayda');

    const kisa = await svc.buildShortIndex('s1');
    expect(kisa).toContain('- Başlık taslak: Özet taslak');
    expect(kisa).toContain(`- [Başlık taslak-goruldu](${SITE}/?p=12): Özet taslak-goruldu`);
    expect(kisa).toContain(`- [Başlık ftp-yedek](${SITE}/blog/ftp-yedek.html): Özet ftp-yedek`);
    for (const p of GIZLI) expect(kisa, p).not.toContain(p);
  });
});

describe('advertisedArticleEntry / loadArticleTargets', () => {
  const site = new URL(SITE);
  const targets = new Map(TARGETS.map((t) => [t.id, { type: t.type, config: t.config }]));

  it('ilan kurali (advertisedArticleEntry; site haritasi, llms-full, persona sohbeti, canonical ve JSON-LD bunu kullanir) ham kuraldan ayri: articlePublicUrl degismedi', () => {
    const list = [wpKopya('wp-taslak', `${SITE}/?p=11`)];
    expect(advertisedArticleEntry(site, 'taslak', list, targets)).toBeNull();
    expect(articlePublicUrl(site, 'taslak', list, targets)).toBe(`${SITE}/?p=11`);
  });

  it('hedef ayari, kayitli adres hic canli gorulmemis duz ?p= baglantisiysa da okunur; guzel baglanti ya da canli gorulmus adres icin okunmaz (eskisi gibi)', async () => {
    const findMany = vi.fn(async () => TARGETS);
    const prisma = { publishTarget: { findMany } };
    const m = await loadArticleTargets(prisma, 's1', site, [{ publishedTo: [wpKopya('wp-taslak', `${SITE}/?p=11`)] }]);
    expect(findMany).toHaveBeenCalledTimes(1);
    expect(m.get('wp-taslak')).toEqual({ type: 'WORDPRESS_REST', config: { postStatus: 'draft' } });

    findMany.mockClear();
    await loadArticleTargets(prisma, 's1', site, [
      { publishedTo: [wpKopya('wp-taslak', `${SITE}/guzel-yazi/`)] },
      { publishedTo: [wpKopya('wp-taslak', `${SITE}/?p=12`, { liveSeenAt: '2026-10-19T02:20:00.000Z' })] },
    ]);
    expect(findMany).not.toHaveBeenCalled();
  });
});
