import { describe, it, expect, vi } from 'vitest';

vi.mock('../prisma/prisma.service.js', () => ({ PrismaService: class {} }));
const { AiSitemapService, homepageMetaDescription } = await import('./ai-sitemap.service.js');

/**
 * sitemap-ai.xml ana sayfa ozeti.
 *
 * NEDEN VAR: ana sayfa <ai:summary> alanina her musteri icin "<ad> — <nis>
 * alanında hizmet veren Türkiye merkezli platform." yaziliyordu — musterinin
 * isi hakkinda dogrulanmamis bir iddia. Simdi sitenin kendi meta aciklamasi;
 * okunamazsa alan hic yazilmaz.
 */

function svc(opts: { site?: Record<string, unknown>; fetch?: (url: string) => Promise<any> } = {}) {
  const prisma = {
    site: { findUniqueOrThrow: vi.fn(async () => ({ id: 's1', name: 'Lavanta Kuaför', url: 'https://lavantakuafor.com/', niche: 'kuaför', ...opts.site })) },
    article: { findMany: vi.fn(async () => []) },
  };
  const s = new AiSitemapService(prisma as any);
  const fetchMock = vi.fn(opts.fetch ?? (async () => ({ ok: true, binary: false, text: '' })));
  (s as any).fetchText = fetchMock;
  return { s, fetchMock };
}

const homeBlock = (xml: string) => xml.split('<url>')[1]?.split('</url>')[0] ?? '';

describe('homepageMetaDescription', () => {
  it('meta aciklamayi okur; ad buyuk/kucuk harf ve oznitelik sirasi fark etmez', () => {
    expect(homepageMetaDescription('<head><meta name="description" content="  Kadıköy\'de\n kuaför  "></head>')).toBe("Kadıköy'de kuaför");
    expect(homepageMetaDescription('<meta content="Moda salonu" NAME="Description">')).toBe('Moda salonu');
  });

  it('XML\'de gecersiz kontrol karakterleri atilir', () => {
    expect(homepageMetaDescription(`<meta name="description" content="Moda${String.fromCharCode(1)} salon${String.fromCharCode(8)}u">`)).toBe('Moda salonu');
  });

  it('yoksa ya da bossa null; 200 karakterde kesilir', () => {
    expect(homepageMetaDescription('<meta property="og:description" content="og">')).toBeNull();
    expect(homepageMetaDescription('<meta name="description" content="   ">')).toBeNull();
    expect(homepageMetaDescription(`<meta name="description" content="${'a'.repeat(300)}">`)).toHaveLength(200);
  });
});

describe('AiSitemapService.build — ana sayfa ozeti', () => {
  it('sitenin kendi meta aciklamasi yazilir (XML kacisli); uydurma "Türkiye merkezli platform" yok', async () => {
    const { s, fetchMock } = svc({
      fetch: async () => ({ ok: true, binary: false, text: '<meta name="description" content="Saç & bakım <Moda>">' }),
    });
    const { xml } = await s.build('s1');
    expect(fetchMock).toHaveBeenCalledWith('https://lavantakuafor.com/', expect.objectContaining({ timeoutMs: 6000 }));
    expect(homeBlock(xml)).toContain('<ai:summary>Saç &amp; bakım &lt;Moda&gt;</ai:summary>');
    expect(xml).not.toMatch(/Türkiye merkezli|hizmet veren/);
  });

  it('ana sayfa her istekte yeniden okunmaz (surec ici onbellek, 6 saat; okunamayan 30 dk)', async () => {
    const { s, fetchMock } = svc({ fetch: async () => ({ ok: true, binary: false, text: '<meta name="description" content="Moda">' }) });
    await s.build('s1');
    const ikinci = await s.build('s1');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(homeBlock(ikinci.xml)).toContain('<ai:summary>Moda</ai:summary>');
    const simdi = Date.now();
    const saat = vi.spyOn(Date, 'now').mockReturnValue(simdi + 7 * 60 * 60_000);
    try {
      await s.build('s1');
      expect(fetchMock).toHaveBeenCalledTimes(2);
    } finally {
      saat.mockRestore();
    }

    const hata = svc({ fetch: async () => { throw new Error('timeout'); } });
    await hata.s.build('s1');
    await hata.s.build('s1');
    expect(hata.fetchMock).toHaveBeenCalledTimes(1);
    const sonra = vi.spyOn(Date, 'now').mockReturnValue(simdi + 31 * 60_000);
    try {
      await hata.s.build('s1');
      expect(hata.fetchMock).toHaveBeenCalledTimes(2);
    } finally {
      sonra.mockRestore();
    }
  });

  it('okunamazsa (hata, 4xx/5xx, ikili icerik, aciklama yok) ozet alani hic yazilmaz', async () => {
    const durumlar = [
      async () => { throw new Error('timeout'); },
      async () => ({ ok: false, binary: false, text: '' }),
      async () => ({ ok: true, binary: true, text: '' }),
      async () => ({ ok: true, binary: false, text: '<title>Lavanta</title>' }),
    ];
    for (const fetch of durumlar) {
      const { s } = svc({ fetch });
      const { xml, urls } = await s.build('s1');
      const blok = homeBlock(xml);
      expect(blok).toContain('<loc>https://lavantakuafor.com/</loc>');
      expect(blok).not.toContain('ai:summary');
      expect(urls).toBe(1);
    }
  });
});

// ────────────────────────────────────────────────────────────
//  Herkese acik uc: yalniz sitenin kamusal adresleri, onbellek, 404
// ────────────────────────────────────────────────────────────

const { articlePublicUrl, sameSiteUrl, parseSiteUrl, articlePriority, xmlText, PUBLIC_SITEMAP_TTL_MS } = await import('./ai-sitemap.service.js');

const SITE = new URL('https://www.lavantakuafor.com/');

describe('sameSiteUrl — capraz gonderim: harita yalniz onu gosteren host\'un adreslerini icerir', () => {
  it('ayni host (www farki yok sayilir) sitenin protokol + host\'uyla yazilir', () => {
    expect(sameSiteUrl(SITE, 'http://lavantakuafor.com/sac-bakimi/')).toBe('https://www.lavantakuafor.com/sac-bakimi/');
    expect(sameSiteUrl(SITE, 'https://WWW.LavantaKuafor.com/?p=12')).toBe('https://www.lavantakuafor.com/?p=12');
  });

  it('baska host, ftp://, sunucu yolu, goreli yol, kimlik bilgili ya da farkli portlu adres reddedilir', () => {
    for (const raw of [
      'https://github.com/a/b/blob/main/content/blog/x.md',
      'https://app.contentful.com/spaces/s/entries/e',
      'https://blog.lavantakuafor.com/x',
      'ftp://lavantakuafor.com/public_html/blog/x.html',
      '/var/www/html/blog/x.html',
      'blog/x.html',
      'https://user:pw@lavantakuafor.com/x',
      'https://lavantakuafor.com:8443/x',
      'javascript:alert(1)',
      undefined, null, 42,
    ]) {
      expect(sameSiteUrl(SITE, raw), String(raw)).toBeNull();
    }
  });
});

describe('articlePublicUrl — makalenin bu sitedeki gercek adresi; bilinmiyorsa listelenmez', () => {
  const targets = new Map([
    ['ftp1', { type: 'FTP', config: { remotePath: '/public_html/blog' } }],
    ['sftp1', { type: 'SFTP', config: { remotePath: '/public_html/yazilar' } }],
    ['gh1', { type: 'GITHUB', config: { contentPath: 'content/blog' } }],
  ]);

  it('WordPress: yayin hedefinin bildirdigi kalici baglanti', () => {
    const p = [{ targetId: 'wp1', targetType: 'WORDPRESS_REST', ok: true, externalUrl: 'https://lavantakuafor.com/2026/10/sac-bakimi/' }];
    expect(articlePublicUrl(SITE, 'sac-bakimi', p, targets)).toBe('https://www.lavantakuafor.com/2026/10/sac-bakimi/');
  });

  it('FTP/SFTP: adaptor ftp:// ya da sunucu yolu dondurur → yayinin kanonik adresi (resolveArticleUrl)', () => {
    expect(articlePublicUrl(SITE, 'sac-bakimi', [{ targetId: 'ftp1', targetType: 'FTP', ok: true, externalUrl: 'ftp://ftp.lavantakuafor.com/public_html/blog/sac-bakimi.html' }], targets))
      .toBe('https://www.lavantakuafor.com/blog/sac-bakimi.html');
    expect(articlePublicUrl(SITE, 'sac-bakimi', [{ targetId: 'sftp1', targetType: 'SFTP', ok: true, externalUrl: '/public_html/yazilar/sac-bakimi.html' }], targets))
      .toBe('https://www.lavantakuafor.com/yazilar/sac-bakimi.html');
  });

  it('GitHub dosyasi, markdown zip, yonetim paneli adresi, silinmis hedef ya da kayit yok: listelenmez (eskiden /blog/<slug>.html uyduruluyordu)', () => {
    expect(articlePublicUrl(SITE, 'x', [{ targetId: 'gh1', targetType: 'GITHUB', ok: true, externalUrl: 'https://github.com/a/b/blob/main/content/blog/x.md' }], targets)).toBeNull();
    expect(articlePublicUrl(SITE, 'x', [{ targetId: 'zip1', targetType: 'MARKDOWN_ZIP', ok: true, externalUrl: '/tmp/x.zip' }], targets)).toBeNull();
    expect(articlePublicUrl(SITE, 'x', [{ targetId: 'ftp-silindi', targetType: 'FTP', ok: true, externalUrl: 'ftp://h/x.html' }], targets)).toBeNull();
    expect(articlePublicUrl(SITE, 'x', null, targets)).toBeNull();
    expect(articlePublicUrl(SITE, 'x', [{ targetId: 'wp1', ok: false, externalUrl: 'https://lavantakuafor.com/x/' }], targets)).toBeNull();
  });
});

describe('articlePriority — editor skoru olcegi yazinin tarihine gore', () => {
  it('3 Agustos 2026 oncesi 60, sonrasi 90 uzerinden; 0.9 tavan', () => {
    expect(articlePriority(48, new Date('2026-07-01T00:00:00Z'))).toBe('0.8'); // 0.4 + (48/60)*0.5
    // 90 olcekli yazi: eski /60 formulu 72'yi 0.9 tavanina vuruyordu (yeni yazilarin hepsi ayni oncelik)
    expect(articlePriority(72, new Date('2026-09-01T00:00:00Z'))).toBe('0.8');
    expect(articlePriority(36, new Date('2026-09-01T00:00:00Z'))).toBe('0.6');
    expect(articlePriority(90, new Date('2026-09-01T00:00:00Z'))).toBe('0.9');
    expect(articlePriority(null, new Date('2026-09-01T00:00:00Z'))).toBe('0.8');
  });
});

describe('xmlText — musteri metni XML\'i bozmaz', () => {
  it('kontrol karakterleri ve eslesmemis vekil atilir, ozel karakterler kacislanir; Turkce ve emoji korunur', () => {
    const raw = `Saç${String.fromCharCode(1)} & "bakım" <rehberi>${String.fromCharCode(0xd800)} 💇`;
    expect(xmlText(raw)).toBe('Saç &amp; &quot;bakım&quot; &lt;rehberi&gt; 💇');
  });
});

type PubArticle = {
  slug: string; title: string; metaDescription: string | null; frontmatter: unknown; editorScore: number | null;
  publishedAt: Date | null; createdAt: Date; publishedTo: unknown; heroImageUrl: string | null;
};
const pub = (over: Partial<PubArticle> = {}): PubArticle => ({
  slug: 'sac-bakimi', title: 'Saç Bakımı', metaDescription: 'Saç bakımı rehberi', frontmatter: { aeo_queries: ['Saç nasıl bakılır?'] },
  editorScore: 81, publishedAt: new Date('2026-10-01T09:00:00Z'), createdAt: new Date('2026-09-30T09:00:00Z'),
  publishedTo: [{ targetId: 'wp1', targetType: 'WORDPRESS_REST', ok: true, externalUrl: 'https://lavantakuafor.com/sac-bakimi/' }],
  heroImageUrl: 'https://ranksup.ai/blog/sac-bakimi/hero.webp',
  ...over,
});

function publicSvc(opts: { site?: Record<string, unknown> | null; articles?: PubArticle[]; targets?: any[] } = {}) {
  const prisma = {
    site: {
      findUnique: vi.fn(async () => (opts.site === null ? null : {
        id: 's1', url: 'https://lavantakuafor.com', user: { deletionRequestedAt: null }, ...opts.site,
      })),
      findUniqueOrThrow: vi.fn(async () => ({ id: 's1', url: 'https://lavantakuafor.com' })),
    },
    article: { findMany: vi.fn(async () => opts.articles ?? []) },
    publishTarget: { findMany: vi.fn(async () => opts.targets ?? []) },
  };
  const s = new AiSitemapService(prisma as any);
  const fetchMock = vi.fn(async () => ({ ok: true, binary: false, text: '<meta name="description" content="Kuaför">' }));
  (s as any).fetchText = fetchMock;
  return { s, prisma, fetchMock };
}

describe('AiSitemapService — herkese acik harita icerigi', () => {
  it('yalniz sitenin kamusal adresleri; sitede olmayan yazi listelenmez, uydurma /blog/ yolu yok', async () => {
    const { s, prisma } = publicSvc({
      articles: [
        pub(),
        pub({ slug: 'zip-yazi', publishedTo: [{ targetId: 'zip1', targetType: 'MARKDOWN_ZIP', ok: true, externalUrl: '/tmp/a.zip' }] }),
        pub({ slug: 'eski', publishedTo: null }),
        pub({ slug: 'ftp-yazi', publishedTo: [{ targetId: 'ftp1', targetType: 'FTP', ok: true, externalUrl: 'ftp://h/public_html/blog/ftp-yazi.html' }] }),
        // ayni adres ikinci kez yazilmaz
        pub({ slug: 'kopya' }),
      ],
      targets: [{ id: 'ftp1', type: 'FTP', config: { remotePath: '/public_html/blog' } }],
    });
    const xml = (await s.getPublicXml('s1'))!;
    const locs = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
    expect(locs).toEqual([
      'https://lavantakuafor.com/',
      'https://lavantakuafor.com/sac-bakimi/',
      'https://lavantakuafor.com/blog/ftp-yazi.html',
    ]);
    expect(xml).not.toContain('/blog/sac-bakimi.html');
    expect(xml).not.toContain('zip-yazi');
    // Govde ve ajan ciktilari okunmaz; hedeflerin yalniz ayari (kimlik bilgisi degil)
    const select = (prisma.article.findMany.mock.calls[0] as any)[0].select;
    expect(select.bodyMd).toBeUndefined();
    expect(select.agentOutputs).toBeUndefined();
    expect((prisma.publishTarget.findMany.mock.calls[0] as any)[0]).toEqual({ where: { siteId: 's1' }, select: { id: true, type: true, config: true } });
  });

  it('hedef ayarina yalniz sitede adresi olmayan bir yayin kaydi varsa bakilir', async () => {
    const { s, prisma } = publicSvc({ articles: [pub()] });
    await s.getPublicXml('s1');
    expect(prisma.publishTarget.findMany).not.toHaveBeenCalled();
  });

  it('ana sayfada lastmod yok (tarih sayfanin degistigi gun olmali); bos ozet yazilmaz; gorsel yalniz sitenin host\'undaysa', async () => {
    const { s } = publicSvc({
      articles: [
        pub({ metaDescription: '   ', frontmatter: { aeo_queries: ['Soru?', 42, ''] } }),
        pub({ slug: 'gorselli', heroImageUrl: 'https://lavantakuafor.com/wp-content/uploads/hero.jpg', publishedTo: [{ targetId: 'wp1', ok: true, externalUrl: 'https://lavantakuafor.com/gorselli/' }] }),
      ],
    });
    const xml = (await s.getPublicXml('s1'))!;
    const blocks = xml.split('<url>').slice(1);
    expect(blocks[0]).not.toContain('<lastmod>');
    expect(blocks[1]).toContain('<lastmod>2026-10-01</lastmod>');
    expect(blocks[1]).not.toContain('<ai:summary>');
    expect(blocks[1]).toContain('<ai:topic>Soru?</ai:topic>');
    expect(blocks[1]).not.toMatch(/<ai:topic>(42)?<\/ai:topic>/);
    // RanksUp sunucusundaki hero gorseli listelenmez (Google iki alan adinin dogrulanmasini ister)
    expect(blocks[1]).not.toContain('image:image');
    expect(blocks[2]).toContain('<image:loc>https://lavantakuafor.com/wp-content/uploads/hero.jpg</image:loc>');
  });
});

describe('AiSitemapService.getPublicXml — 404 ve onbellek', () => {
  it('bilinmeyen site, silme talepli hesap ya da gecersiz site adresi: null (uc 404)', async () => {
    const unknown = publicSvc({ site: null });
    expect(await unknown.s.getPublicXml('yok')).toBeNull();
    expect(unknown.prisma.article.findMany).not.toHaveBeenCalled();
    expect(await publicSvc({ site: { user: { deletionRequestedAt: new Date() } } }).s.getPublicXml('s1')).toBeNull();
    expect(await publicSvc({ site: { url: 'ftp://lavantakuafor.com' } }).s.getPublicXml('s1')).toBeNull();
  });

  it('asiri uzun ya da bos kimlik DB\'ye gitmez', async () => {
    const { s, prisma } = publicSvc();
    expect(await s.getPublicXml('x'.repeat(65))).toBeNull();
    expect(await s.getPublicXml('')).toBeNull();
    expect(prisma.site.findUnique).not.toHaveBeenCalled();
  });

  it('uretilen XML 10 dk onbellekte; sure dolunca yeniden uretilir', async () => {
    const { s, prisma } = publicSvc({ articles: [pub()] });
    const first = await s.getPublicXml('s1');
    expect(await s.getPublicXml('s1')).toBe(first);
    expect(prisma.article.findMany).toHaveBeenCalledTimes(1);
    expect(PUBLIC_SITEMAP_TTL_MS).toBe(10 * 60_000);
    const later = vi.spyOn(Date, 'now').mockReturnValue(Date.now() + PUBLIC_SITEMAP_TTL_MS + 1000);
    try {
      await s.getPublicXml('s1');
      expect(prisma.article.findMany).toHaveBeenCalledTimes(2);
    } finally {
      later.mockRestore();
    }
  });

  it('ayni sitenin es zamanli istekleri tek uretimi bekler', async () => {
    const { s, prisma } = publicSvc({ articles: [pub()] });
    const [a, b, c] = await Promise.all([s.getPublicXml('s1'), s.getPublicXml('s1'), s.getPublicXml('s1')]);
    expect(a).toBe(b);
    expect(b).toBe(c);
    expect(prisma.site.findUnique).toHaveBeenCalledTimes(1);
  });

  it('parseSiteUrl yalniz http(s)', () => {
    expect(parseSiteUrl('https://a.com')?.host).toBe('a.com');
    expect(parseSiteUrl('ftp://a.com')).toBeNull();
    expect(parseSiteUrl('a.com')).toBeNull();
    expect(parseSiteUrl(undefined)).toBeNull();
  });
});
