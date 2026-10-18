import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Yayin hedefi adres denetimi — toplu yayinda HER hedef adaptor istegi
 * atilmadan hemen once denetlenir (publish-target-url.ts).
 *
 * NEDEN VAR: adaptorler (packages/adapters) duz fetch / FTP / SSH ile
 * kullanicinin girdigi adrese baglanir ve tek bir giris noktalari yok. Kayittan
 * sonra ic aga cevrilen bir hedef sunucumuzu ic aga istek atmaya zorluyordu.
 * Bozuk hedef YALNIZ kendisini atlamali: ayni makalenin diger hedefleri
 * yayinlanmali, is cokmemeli.
 *
 * Adresler IP olarak yazilir — denetim DNS'e gitmez, test agdan bagimsiz.
 */

const published: Array<{ type: string; creds: any }> = [];
const llmsPushed: Array<{ type: string; creds: any }> = [];

vi.mock('@luviai/adapters', async (orig) => {
  const real: any = await orig();
  const make = (type: string) => class {
    constructor(private creds: any) {}
    get needsFullPage() { return false; }
    async publish() { published.push({ type, creds: this.creds }); return { ok: true, externalUrl: `https://yayin.example/${type}` }; }
    async pushLlms() { llmsPushed.push({ type, creds: this.creds }); return { ok: true }; }
  };
  return { ...real, getAdapter: (type: string) => make(type) };
});
vi.mock('@luviai/shared', async (orig) => ({ ...(await orig() as any), decryptCredentials: (c: any) => c ?? {} }));
// Agir bagimliliklar (sharp, LLM SDK'lari) bu testte gereksiz — bos siniflar
vi.mock('../prisma/prisma.service.js', () => ({ PrismaService: class {} }));
vi.mock('./image-generator.service.js', () => ({ ImageGeneratorService: class {} }));
vi.mock('../audit/ai-indexing-pinger.service.js', () => ({ AiIndexingPingerService: class {} }));
vi.mock('../audit/llms-full-builder.service.js', () => ({ LlmsFullBuilderService: class {} }));
vi.mock('./link-validator.service.js', () => ({ LinkValidatorService: class {} }));
vi.mock('../sites/site-url-inventory.service.js', () => ({ SiteUrlInventoryService: class {} }));
vi.mock('./qa-gate.service.js', () => ({ QaGateService: class {} }));
vi.mock('../llm/llm-provider.service.js', () => ({ LLMProviderService: class {} }));
vi.mock('./hero-alt.js', () => ({ describeHeroImage: vi.fn(async () => null) }));

const { PublisherService } = await import('./publisher.service.js');

// Hedef secimi artik kodda (selectPublishTargets): hedef verilmeyen yayin
// varsayilan + aktif hedefleri alir — satirlar gercekteki gibi bu alanlari tasir
const ON = { isDefault: true, isActive: true };
const BAD = { id: 't-bad', type: 'WORDPRESS_REST', credentials: { siteUrl: 'http://169.254.169.254', username: 'u', appPassword: 'p' }, config: {}, ...ON };
const BAD_FTP = { id: 't-ftp', type: 'FTP', credentials: { host: '10.0.0.5', user: 'u', password: 'p' }, config: {}, ...ON };
const GOOD_GH = { id: 't-gh', type: 'GITHUB', credentials: { token: 'x', owner: 'o', repo: 'r' }, config: {}, ...ON };
const GOOD_WP = { id: 't-wp', type: 'WORDPRESS_REST', credentials: { siteUrl: 'https://93.184.216.34', username: 'u', appPassword: 'p' }, config: {}, ...ON };

function build(targets: any[]) {
  const articleUpdates: any[] = [];
  // Satir durum tutar: yayinci sonda kaydi yeniden okuyup kosullu yazar (K10)
  const row: any = {
    id: 'a1', siteId: 's1', slug: 'yazi', title: 'Yazı', bodyMd: '# Yazı\n\nMetin.', heroImageUrl: 'https://cdn.example/hero.jpg',
    metaTitle: null, metaDescription: null, category: null, schemaMarkup: null, frontmatter: {}, inlineImages: [],
    publishedTo: null, updatedAt: new Date('2026-10-01T00:00:00.000Z'),
    site: { id: 's1', url: 'https://site.example', name: 'Site', userId: 'u1', publishTargets: targets },
  };
  const write = (data: any) => {
    const rest = { ...data };
    delete rest.updatedAt;
    articleUpdates.push({ where: { id: 'a1' }, data: rest });
    Object.assign(row, rest, { updatedAt: new Date(row.updatedAt.getTime() + 1000) });
  };
  const prisma = {
    article: {
      findUniqueOrThrow: vi.fn(async () => row),
      findUnique: vi.fn(async () => ({ ...row })),
      update: vi.fn(async (a: any) => { write(a.data); return {}; }),
      updateMany: vi.fn(async (a: any) => {
        if (a.where?.updatedAt instanceof Date && a.where.updatedAt.getTime() !== row.updatedAt.getTime()) return { count: 0 };
        write(a.data);
        return { count: 1 };
      }),
    },
    publishTarget: { findMany: vi.fn(async () => targets.slice(0, 1)), update: vi.fn(async () => ({})) },
    site: { findUnique: vi.fn(async () => ({ llmsFullTxt: 'tam metin' })) },
  };
  const n = {} as any;
  const indexingPinger = { pingUrl: vi.fn(async () => ({})) };
  const llmsFullBuilder = { build: vi.fn(async () => ({ articles: 1, bytes: 10 })), buildShortIndex: vi.fn(async () => '# kisa') };
  const linkValidator = { validateArticleMarkdown: vi.fn(async (_s: string, md: string) => ({ bodyMd: md, report: { remapped: 0, unlinked: 0 } })) };
  const urlInventory = { invalidate: vi.fn() };
  const svc = new PublisherService(
    prisma as any, n, indexingPinger as any, llmsFullBuilder as any, linkValidator as any, urlInventory as any, n, n,
  );
  return { svc, prisma, articleUpdates, row };
}

beforeEach(() => { published.length = 0; llmsPushed.length = 0; });

describe('PublisherService — yayin hedefi adres denetimi', () => {
  it('ic ag adresli hedef atlanir (Turkce neden), diger hedefler yayinlanir', async () => {
    const { svc, articleUpdates } = build([BAD, GOOD_GH, BAD_FTP, GOOD_WP]);
    const results = await svc.publishArticle('a1', [], { overrideQa: true });

    const byId = Object.fromEntries(results.map((r) => [r.targetId, r]));
    expect(byId['t-bad']).toMatchObject({ ok: false });
    expect(byId['t-bad'].error).toBe('Yayın hedefine bağlanılmadı — Site URL: özel veya iç ağ adresi kullanılamaz; herkese açık bir adres girin.');
    expect(byId['t-ftp'].ok).toBe(false);
    expect(byId['t-ftp'].error).toContain('Host');
    expect(byId['t-gh']).toMatchObject({ ok: true, externalUrl: 'https://yayin.example/GITHUB' });
    expect(byId['t-wp']).toMatchObject({ ok: true });

    // Adaptore yalniz guvenli hedefler ulasti
    expect(published.map((p) => p.type).sort()).toEqual(['GITHUB', 'WORDPRESS_REST']);
    expect(published.some((p) => p.creds.siteUrl === BAD.credentials.siteUrl)).toBe(false);
    // En az bir hedef basarili → makale yayinlandi sayilir, publishedTo yalniz basarililar
    const pub = articleUpdates.find((u) => u.data?.status === 'PUBLISHED');
    expect(pub.data.publishedTo.map((r: any) => r.targetId).sort()).toEqual(['t-gh', 't-wp']);
  });

  it('llms.txt gonderiminde de ic ag adresli hedef atlanir', async () => {
    const { svc } = build([BAD, GOOD_GH]);
    await svc.publishArticle('a1', [], { overrideQa: true });
    expect(llmsPushed.map((p) => p.type)).toEqual(['GITHUB']);
  });

  it('tum hedefler reddedilirse makale PUBLISHED olmaz, is cokmez', async () => {
    const { svc, articleUpdates } = build([BAD, BAD_FTP]);
    const results = await svc.publishArticle('a1', [], { overrideQa: true });
    expect(results.every((r) => !r.ok)).toBe(true);
    expect(published).toEqual([]);
    expect(articleUpdates.some((u) => u.data?.status === 'PUBLISHED')).toBe(false);
  });

  it('lastUsedAt yazilamasa da yayinlanan hedef basarili sayilir', async () => {
    const { svc, prisma } = build([GOOD_GH]);
    prisma.publishTarget.update.mockRejectedValueOnce(new Error('db gecici hata'));
    const [r] = await svc.publishArticle('a1', [], { overrideQa: true });
    expect(r).toMatchObject({ targetId: 't-gh', ok: true });
  });
});

describe('PublisherService — publishedTo hedef bazinda birlestirilir (G4)', () => {
  it('tek hedefe yeniden yayin diger hedeflerin kaydini SILMEZ; ayni hedefin eski kaydi yenisiyle degisir, yeni kayit basta', async () => {
    const { svc, articleUpdates, row } = build([GOOD_GH]);
    // GitHub kaydi AYNI dosya (yazi.md): yeniden yayin onun uzerine yazar. Dosya
    // adi slug'dan farkli olsaydi yeni dosya acilirdi — o durum kopya sayilir ve
    // publisher-republish.spec.ts'te (slug_changed) sinanir.
    const previous = [
      { targetId: 't-wp-old', targetType: 'WORDPRESS_REST', ok: true, externalUrl: 'https://site.example/yazi/', externalId: '100' },
      { targetId: 't-gh', targetType: 'GITHUB', ok: true, externalUrl: 'https://github.com/o/r/blob/main/yazi.md', externalId: 'eski-sha' },
    ];
    row.publishedTo = previous;
    await svc.publishArticle('a1', ['t-gh'], { overrideQa: true });
    const pub = articleUpdates.find((u) => u.data?.status === 'PUBLISHED');
    expect(pub.data.publishedTo.map((r: any) => r.targetId)).toEqual(['t-gh', 't-wp-old']);
    // WordPress yazisinin kimligi ve adresi korunur (eskiden tumden eziliyordu)
    expect(pub.data.publishedTo[1]).toEqual(previous[0]);
    expect(pub.data.publishedTo[0]).toMatchObject({ targetId: 't-gh', ok: true, externalUrl: 'https://yayin.example/GITHUB' });
  });

  it('basarisiz yayin onceki kaydi silmez (kopya hala canlida)', async () => {
    const { mergePublishedTo } = await import('./publisher.service.js');
    const previous = [{ targetId: 't1', ok: true, externalUrl: 'https://s/a' }, null, 'bozuk'];
    expect(mergePublishedTo(previous, [])).toEqual([previous[0]]);
    expect(mergePublishedTo(undefined, [{ targetId: 't2', targetType: 'FTP', ok: true }])).toEqual([{ targetId: 't2', targetType: 'FTP', ok: true }]);
  });
});
