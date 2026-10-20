import { describe, it, expect, vi } from 'vitest';

vi.mock('../prisma/prisma.service.js', () => ({ PrismaService: class {} }));
const {
  AiSitemapService, advertisedArticleEntry, fileCopyAtConfiguredPath, fileCopyPublicUrl, fullPageCanonicalUrl, recordedRemoteDir,
} = await import('./ai-sitemap.service.js');
const { FtpAdapter } = await import('@luviai/adapters');
const { LlmsFullBuilderService } = await import('./llms-full-builder.service.js');

/**
 * C1 madde 1 — dosya hedefindeki (FTP / SFTP / cPanel) kopyanin herkese acik adresi yazim
 * aninda KAYDEDILEN konumdan (ai-sitemap.service fileCopyPublicUrl), hedefin BUGUNKU klasor
 * ayarindan ve yazinin BUGUNKU slug'indan degil.
 *
 * NEDEN VAR: sitemap-ai ve llms-full / llms.txt adresi bugunku ayardan kuruyordu. Musteri yeni
 * yazilar icin klasoru degistirince (ya da yazinin slug'i degisince) eski sayfa eski adreste
 * yayinda kaliyor, ilan edilen adres ise 404 veriyordu; canlilik denetimi ise kayitli yolu
 * yokluyordu. Konumu kayitli olmayan eski kayitta eski davranis (bugunku ayar + slug) korunur.
 */

const SITE = 'https://ornek.com.tr';

const TARGETS = [
  // Klasor sonradan /public_html/makaleler'e alindi
  { id: 'ftp', type: 'FTP', config: { remotePath: '/public_html/makaleler' } },
  { id: 'sftp', type: 'SFTP', config: { remotePath: '/var/www/html/yeni' } },
  // cPanel genel adresi cPanel sunucu adindan tahmin edildi (sitenin host'u degil)
  { id: 'cp', type: 'CPANEL_API', config: { remotePath: 'public_html/yeni' } },
  { id: 'ftp-ayni', type: 'FTP', config: { remotePath: '/public_html/blog' } },
];

const kayit = (targetId: string, externalUrl?: string) => ({
  targetId, targetType: TARGETS.find((t) => t.id === targetId)?.type, ok: true, ...(externalUrl ? { externalUrl } : {}),
  updatedAt: '2026-10-10T10:00:00.000Z',
});

type Makale = Record<string, unknown> & { id: string; slug: string; status: string; publishedAt: Date | null; publishedTo: unknown[] };

const makale = (id: string, slug: string, publishedTo: unknown[]): Makale => ({
  id, slug, status: 'PUBLISHED', siteId: 's1', title: `Başlık ${id}`, metaTitle: null, metaDescription: `Özet ${id}`,
  bodyMd: `# ${id}\n\nMetin.`, topic: 't', wordCount: 100, frontmatter: {}, editorScore: 81, category: null, faqs: null,
  heroImageUrl: null, publishedAt: new Date('2026-10-01T10:00:00Z'), createdAt: new Date('2026-09-30T10:00:00Z'), publishedTo,
});

const DUNYA: Makale[] = [
  // Klasor degisti: dosya eski klasorde
  makale('klasor', 'klasor-yazisi', [kayit('ftp', 'ftp://ftp.ornek.com.tr/public_html/blog/klasor-yazisi.html')]),
  // Slug degisti (yayindaki dosya eski adla duruyor; yeniden yayin slug_changed ile engellenir)
  makale('slug', 'yeni-slug', [kayit('ftp-ayni', 'ftp://ftp.ornek.com.tr/public_html/blog/eski-slug.html')]),
  // Konumu kayitli olmayan eski kayit: bugunku ayar + yazinin slug'i
  makale('eski', 'eski-kayit', [kayit('ftp')]),
  makale('sftp', 'sftp-yazisi', [kayit('sftp', '/var/www/html/rehber/sftp-yazisi.html')]),
  makale('cpanel', 'cpanel-yazisi', [kayit('cp', 'https://srv12.hosting.com/blog/cpanel-yazisi')]),
];

const ILAN = [
  `${SITE}/blog/klasor-yazisi.html`,
  `${SITE}/blog/eski-slug.html`,
  `${SITE}/makaleler/eski-kayit.html`,
  `${SITE}/rehber/sftp-yazisi.html`,
  `${SITE}/blog/cpanel-yazisi.html`,
];
// Bugunku ayar / bugunku slug ile kurulan (404 veren) adresler
const OLU = [
  `${SITE}/makaleler/klasor-yazisi.html`,
  `${SITE}/blog/yeni-slug.html`,
  `${SITE}/yeni/sftp-yazisi.html`,
  `${SITE}/yeni/cpanel-yazisi.html`,
];

function prismaFor(articles: Makale[]) {
  return {
    site: {
      findUnique: vi.fn(async () => ({ id: 's1', url: SITE, user: { deletionRequestedAt: null } })),
      findUniqueOrThrow: vi.fn(async () => ({ id: 's1', name: 'Örnek', url: SITE, niche: null, language: 'tr', brain: null })),
      update: vi.fn(async () => ({})),
    },
    article: {
      findMany: vi.fn(async (args: any) => {
        if (args?.where?.id?.in) return articles.filter((a) => args.where.id.in.includes(a.id)).map((a) => ({ id: a.id, metaTitle: a.metaTitle, bodyMd: a.bodyMd, agentOutputs: null }));
        return articles;
      }),
    },
    publishTarget: { findMany: vi.fn(async () => TARGETS) },
  };
}

describe('sitemap-ai.xml / llms-full.txt / llms.txt — dosya kopyasinin adresi kayittaki konumdan', () => {
  it('sitemap-ai: klasoru ya da slug\'i degisen kopyanin GERCEK adresi ilan edilir; bugunku ayardan kurulan 404 adres yok', async () => {
    const s = new AiSitemapService(prismaFor(DUNYA) as any);
    (s as any).fetchText = vi.fn(async () => ({ ok: true, binary: false, text: '' }));
    const { xml } = await s.build('s1');
    for (const url of ILAN) expect(xml, url).toContain(`<loc>${url}</loc>`);
    for (const url of OLU) expect(xml, url).not.toContain(url);
  });

  it('llms-full.txt ve llms.txt ayni adresleri yazar', async () => {
    const prisma = prismaFor(DUNYA);
    const svc = new LlmsFullBuilderService(prisma as any);
    await svc.build('s1');
    const txt = (prisma.site.update.mock.calls[0] as any)[0].data.llmsFullTxt as string;
    for (const url of ILAN) expect(txt, url).toContain(`**URL:** ${url}`);
    for (const url of OLU) expect(txt, url).not.toContain(url);
    const kisa = await svc.buildShortIndex('s1');
    expect(kisa).toContain(`- [Başlık klasor](${SITE}/blog/klasor-yazisi.html): Özet klasor`);
    expect(kisa).toContain(`- [Başlık slug](${SITE}/blog/eski-slug.html): Özet slug`);
    for (const url of OLU) expect(kisa, url).not.toContain(url);
  });
});

describe('fileCopyPublicUrl / fileCopyAtConfiguredPath', () => {
  const site = new URL(SITE);
  const hedef = (id: string) => TARGETS.find((t) => t.id === id)!;

  it('kayitli adres sitedeyse (cPanel genel adresi) aynen; dosya hedefi olmayan hedef: null', () => {
    expect(fileCopyPublicUrl(site, { externalUrl: 'https://www.ornek.com.tr/blog/yazi' }, hedef('cp'), 'yazi')).toBe(`${SITE}/blog/yazi`);
    expect(fileCopyPublicUrl(site, { externalUrl: `${SITE}/yazi/` }, { type: 'WORDPRESS_REST', config: {} }, 'yazi')).toBeNull();
  });

  it('kayit verilmezse (yayinci bu yayinda YAZACAGI kopyayi sorar) bugunku ayar + yazinin slug\'i', () => {
    expect(fileCopyPublicUrl(site, null, hedef('ftp'), 'yeni-yazi')).toBe(`${SITE}/makaleler/yeni-yazi.html`);
    expect(fileCopyPublicUrl(site, undefined, hedef('sftp'), 'yeni-yazi')).toBe(`${SITE}/yeni/yeni-yazi.html`);
  });

  it('ayar degismediyse sonuc eskisiyle birebir ayni — remotePath \'/\' ile baslamayan (sunucu adi yola yapisik) FTP dahil', () => {
    const yapisik = { type: 'FTP', config: { remotePath: 'blog' } };
    expect(fileCopyAtConfiguredPath('FTP', 'ftp://ftp.hostblog/yazi.html', yapisik.config)).toBe(true);
    expect(fileCopyPublicUrl(site, { externalUrl: 'ftp://ftp.hostblog/yazi.html' }, yapisik, 'yazi')).toBe(`${SITE}/blog/yazi.html`);
    // Kok klasor (adaptor varsayilani '/': `//yazi.html`)
    expect(fileCopyAtConfiguredPath('FTP', 'ftp://ftp.host//yazi.html', {})).toBe(true);
    expect(fileCopyPublicUrl(site, { externalUrl: 'ftp://ftp.host//yazi.html' }, { type: 'FTP', config: {} }, 'yazi')).toBe(`${SITE}/yazi.html`);
    // cPanel: genel adres ayardaki publicBaseUrl ya da yolsuz sunucu adresi
    expect(fileCopyAtConfiguredPath('CPANEL_API', 'https://srv12.hosting.com/yeni/yazi', { remotePath: '/public_html/yeni/' })).toBe(true);
    expect(fileCopyAtConfiguredPath('CPANEL_API', 'https://cdn.baska.com/site/yeni/yazi', { remotePath: 'public_html/yeni', publicBaseUrl: 'https://cdn.baska.com/site/' })).toBe(true);
  });

  it('goreli remotePath\'li FTP: adaptorun bugunku (ayracli) kaydi ayni klasorde sayilir; klasor degisince eski kopyanin adresi tam klasorle okunur', async () => {
    // Kayit GERCEK adaptorden (packages/adapters ftp.ts; kutuphane istemcisi sahte, ag yok)
    class KayitFtp extends FtpAdapter {
      protected createClient(): any {
        return { access: async () => {}, uploadFrom: async () => {}, close: () => {} };
      }
    }
    const goreli = { remotePath: 'public_html/blog' };
    const r = await new KayitFtp({ host: 'ftp.host', user: 'u', password: 'p' }, goreli).publish({ slug: 'yazi', title: 'T', bodyHtml: '<p>x</p>', bodyMd: 'x' });
    const kayit = r.externalUrl!;
    expect(kayit).toBe('ftp://ftp.host/public_html/blog/yazi.html');
    // Ayar degismedi: kopya bugunku klasorde (yayinci self-canonical'i ve ilan bu kayittan)
    expect(fileCopyAtConfiguredPath('FTP', kayit, goreli)).toBe(true);
    expect(fileCopyPublicUrl(site, { externalUrl: kayit }, { type: 'FTP', config: goreli }, 'yazi')).toBe(`${SITE}/blog/yazi.html`);
    // Klasor sonradan degisti: eski kopya eski klasorde; sunucu adi yola yapismadigi icin klasorun
    // ilk parcasi kaybolmaz (yapisik kayitta adres /yazi.html okunuyordu)
    const tasindi = { type: 'FTP', config: { remotePath: 'public_html/makaleler' } };
    expect(fileCopyAtConfiguredPath('FTP', kayit, tasindi.config)).toBe(false);
    expect(fileCopyPublicUrl(site, { externalUrl: kayit }, tasindi, 'yazi')).toBe(`${SITE}/blog/yazi.html`);
    expect(recordedRemoteDir(kayit)).toBe('/public_html/blog');
    // Sonek benzerligi yanilmaz: baska klasordeki ayracli kayit bu goreli klasor degildir
    expect(fileCopyAtConfiguredPath('FTP', 'ftp://ftp.host/eski/public_html/blog/yazi.html', goreli)).toBe(false);
    // Eski yapisik kayit round 20'deki gibi okunur
    expect(fileCopyAtConfiguredPath('FTP', 'ftp://ftp.hostpublic_html/blog/yazi.html', goreli)).toBe(true);
    expect(recordedRemoteDir('ftp://ftp.hostpublic_html/blog/yazi.html')).toBe('/blog');
  });

  it('klasor degistiyse kayitli konum: FTP / SFTP dosya yolu, cPanel genel adresin yolu (publicBaseUrl\'in kendi yolu atilir)', () => {
    expect(fileCopyAtConfiguredPath('FTP', 'ftp://ftp.host/public_html/blog/yazi.html', { remotePath: '/public_html/makaleler' })).toBe(false);
    // Sonek benzerligi yanilmaz: /eski/blog klasoru /blog ayari degildir
    expect(fileCopyAtConfiguredPath('FTP', 'ftp://ftp.host/eski/blog/yazi.html', { remotePath: '/blog' })).toBe(false);
    expect(fileCopyPublicUrl(site, { externalUrl: 'ftp://ftp.host/eski/blog/yazi.html' }, { type: 'FTP', config: { remotePath: '/blog' } }, 'yazi'))
      .toBe(`${SITE}/eski/blog/yazi.html`);
    expect(fileCopyAtConfiguredPath('SFTP', '/var/www/html/rehber/yazi.html', { remotePath: '/var/www/html/yeni' })).toBe(false);
    expect(fileCopyPublicUrl(site, { externalUrl: 'https://cdn.baska.com/site/blog/yazi' }, { type: 'CPANEL_API', config: { remotePath: 'public_html/yeni', publicBaseUrl: 'https://cdn.baska.com/site' } }, 'yazi'))
      .toBe(`${SITE}/blog/yazi.html`);
    // Eski kayitta adres (url alani) de okunur
    expect(fileCopyPublicUrl(site, { url: 'ftp://ftp.host/public_html/blog/yazi.html' }, hedef('ftp'), 'yazi')).toBe(`${SITE}/blog/yazi.html`);
  });

  it('persona sohbeti ve llms-full\'un kullandigi advertisedArticleEntry de ayni adresi verir', () => {
    const targets = new Map(TARGETS.map((t) => [t.id, { type: t.type, config: t.config }]));
    DUNYA.forEach((a, i) => expect(advertisedArticleEntry(site, a.slug, a.publishedTo, targets)?.url, a.id).toBe(ILAN[i]));
  });
});

describe('fullPageCanonicalUrl — tam sayfanin canonical\'i (yayinci)', () => {
  const site = new URL(SITE);
  const targets = new Map(TARGETS.map((t) => [t.id, { type: t.type, config: t.config }]));
  const ftp = { id: 'ftp', type: 'FTP', config: { remotePath: '/public_html/makaleler' } };

  it('yazilan kopyanin kaydi baska klasoru gosteriyorsa yazimdan sonraki (bugunku) klasor; ayni klasorse kayit', () => {
    const eskiKlasor = [kayit('ftp', 'ftp://ftp.ornek.com.tr/public_html/blog/yazi.html')];
    expect(fullPageCanonicalUrl(site, 'yazi', eskiKlasor, targets, ftp)).toBe(`${SITE}/makaleler/yazi.html`);
    const ayni = [kayit('ftp', 'ftp://ftp.ornek.com.tr/public_html/makaleler/yazi.html')];
    expect(fullPageCanonicalUrl(site, 'yazi', ayni, targets, ftp)).toBe(`${SITE}/makaleler/yazi.html`);
  });

  it('baska canli kopya ilan ediliyorsa o; hic canli gorulmemis WordPress taslagi atlanir; adres bilinmiyorsa null', () => {
    const wpTaslak = { targetId: 'wp', targetType: 'WORDPRESS_REST', ok: true, externalUrl: `${SITE}/?p=41` };
    const sftpCanli = kayit('sftp', '/var/www/html/rehber/yazi.html');
    expect(fullPageCanonicalUrl(site, 'yazi', [wpTaslak, sftpCanli], targets, ftp)).toBe(`${SITE}/rehber/yazi.html`);
    expect(fullPageCanonicalUrl(site, 'yazi', [wpTaslak], targets, ftp)).toBe(`${SITE}/makaleler/yazi.html`);
    expect(fullPageCanonicalUrl(site, 'yazi', [wpTaslak], targets, { id: 'zip', type: 'MARKDOWN_ZIP' })).toBeNull();
  });
});
