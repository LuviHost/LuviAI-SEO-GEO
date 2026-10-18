import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Logger } from '@nestjs/common';
import type { Probe } from './axo-fetch.js';

/**
 * G11 — kok dosya yalniz SITEYI SUNDUGU KANITLANAN klasore yazilir.
 *
 * Sahte paylasimli hosting: tek hesapta ana.com (public_html) ve eklenti alan
 * adi ek.com (public_html/ek.com). Klasor → dosya tablosu gercek bir disk gibi
 * davranir; canli adres yalniz alan adinin kendi klasorunden okur. Adaptor
 * (cPanel / FTP) config.rootPath'e, yoksa kendi varsayilanina yazar — gercek
 * adaptorlerle ayni kural (packages/adapters cpanel-api.ts 'public_html',
 * ftp.ts giris dizini).
 *
 * Eski davranis: ek.com icin "/sitemap.xml yok → olustur" karari cPanel'de
 * public_html'e, yani ANA ALAN ADININ sitemap.xml / llms.txt'sinin uzerine
 * yaziliyordu; yedek ek.com'dan okundugu icin geri alma "was_absent" diyordu.
 */

vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);

/** klasor → (dosya adi → icerik) */
const disk = new Map<string, Map<string, string>>();
/** alan adi → sunuldugu klasor */
const docRoots = new Map<string, string>();
/** WAF arkasindaki yollar (yalniz o adres engelli; karar adimi okuyabilir) */
const blockedPaths = new Set<string>();
/** Onbellekte takili (yazimdan sonra eski yaniti donen) yollar: host+path */
const staleCache = new Map<string, { status: number; text: string }>();
/** Yazilamayan klasorler (yok / yetki) */
const unwritableDirs = new Set<string>();
const writes: Array<{ dir: string; filename: string; content: string; type: string }> = [];

const norm = (p: unknown) => String(p ?? '').replace(/\\/g, '/').split('/').filter(Boolean).join('/');
const fileAt = (dir: string, name: string) => disk.get(dir)?.get(name);
const put = (dir: string, name: string, content: string) => {
  if (!disk.has(dir)) disk.set(dir, new Map());
  disk.get(dir)!.set(name, content);
};

vi.mock('./axo-fetch.js', async (orig) => {
  const actual = await orig<typeof import('./axo-fetch.js')>();
  return {
    ...actual,
    probeUrl: vi.fn(async (url: string): Promise<Probe> => {
      const u = new URL(url);
      const host = u.hostname.replace(/^www\./, '');
      const name = u.pathname.replace(/^\//, '');
      const base = { url, finalUrl: url.split('?')[0], headers: {}, truncated: false, binary: false, contentType: 'text/plain' };
      if (blockedPaths.has(name)) {
        return { ...base, state: 'blocked', status: 403, text: '', block: { kind: 'waf', reason: 'Cloudflare güvenlik duvarı RanksUp tarayıcısını engelledi (HTTP 403).', hint: '"RanksUpBot" için izin verin.', vendor: 'cloudflare', status: 403 } };
      }
      const stale = staleCache.get(`${host}/${name}`);
      if (stale) return { ...base, state: stale.status === 200 ? 'ok' : 'missing', status: stale.status, text: stale.text, block: null };
      const root = docRoots.get(host);
      const text = root !== undefined ? fileAt(root, name) : undefined;
      if (text === undefined) return { ...base, state: 'missing', status: 404, text: '', contentType: 'text/html', block: null };
      const contentType = name.endsWith('.xml') ? 'application/xml' : 'text/plain';
      return { ...base, state: 'ok', status: 200, text, contentType, block: null };
    }),
  };
});

const DEFAULT_ROOT: Record<string, string> = { CPANEL_API: 'public_html', FTP: '', SFTP: '' };

vi.mock('@luviai/adapters', () => ({
  getAdapter: (type: string) => class {
    constructor(_creds: unknown, private config: Record<string, unknown> = {}) {}
    get supportsRootFiles() { return true; }
    async putRootFile(filename: string, content: string) {
      // Gercek adaptorlerle ayni: config.rootPath (bos dize FTP'de giris dizini), yoksa varsayilan
      const dir = this.config.rootPath !== undefined && this.config.rootPath !== null
        ? (norm(this.config.rootPath) || (type === 'CPANEL_API' ? 'public_html' : ''))
        : DEFAULT_ROOT[type] ?? '';
      if (unwritableDirs.has(dir)) return { ok: false, error: `553 ${dir || '/'}: izin yok` };
      writes.push({ dir, filename, content, type });
      put(dir, filename, content);
      return { ok: true, externalUrl: `${dir}/${filename}` };
    }
  },
}));
vi.mock('@luviai/shared', () => ({ decryptCredentials: (x: unknown) => x }));
// Adres denetimi DNS'e gider; bu testin konusu degil (kendi testi: auto-fix-preview.spec.ts)
const { blockReason } = vi.hoisted(() => ({ blockReason: { value: null as string | null } }));
vi.mock('../publish-targets/publish-target-url.js', () => ({ publishTargetBlockReason: vi.fn(async () => blockReason.value) }));

const { AutoFixService, ROOT_VERIFY_FILENAME, rootDirCandidates } = await import('./auto-fix.service.js');
const { GeneratorsService } = await import('./generators.service.js');

const CPANEL_EK = { type: 'CPANEL_API', name: 'cPanel', isDefault: true, credentials: {}, config: { remotePath: '/public_html/ek.com/blog' } };
const CPANEL_ANA = { type: 'CPANEL_API', name: 'cPanel', isDefault: true, credentials: {}, config: { remotePath: 'public_html/blog' } };

const ANA_SITEMAP = '<?xml version="1.0"?><urlset><url><loc>https://ana.com/</loc></url></urlset>';
const ANA_LLMS = '# Ana Şirket\n\n> Elle yazılmış llms.txt\n';
const ANA_ROBOTS = 'User-agent: *\nDisallow: /private/\n';

function build(siteUrl: string, target: any) {
  const records: any[] = [];
  const kv = new Map<string, any>();
  const host = new URL(siteUrl).hostname;
  const prisma = {
    site: { findUniqueOrThrow: vi.fn(async () => ({ id: 's1', userId: 'u1', url: siteUrl, name: host, niche: 'mobilya', brain: null, publishTargets: [target] })) },
    kvStore: {
      upsert: vi.fn(async ({ where, create, update }: any) => { kv.set(where.key, kv.has(where.key) ? { ...kv.get(where.key), ...update } : create); }),
      findUnique: vi.fn(async ({ where }: any) => kv.get(where.key) ?? null),
      deleteMany: vi.fn(async ({ where }: any) => { kv.delete(where.key); return { count: 1 }; }),
    },
    appliedFix: {
      findFirst: vi.fn(async ({ where }: any) => {
        const rows = records.filter((r) => (!where.id || r.id === where.id) && r.siteId === where.siteId && r.kind === where.kind
          && (!where.status || r.status === where.status) && (!where.fixType?.in || where.fixType.in.includes(r.fixType)));
        return rows[rows.length - 1] ?? null;
      }),
      findMany: vi.fn(async () => [...records].reverse()),
    },
    audit: { findFirst: vi.fn(async () => null), update: vi.fn() },
  };
  const appliedFix = {
    kaydet: vi.fn(async (k: any) => { records.push({ id: `fix-${records.length + 1}`, appliedAt: new Date(), revertedAt: null, error: null, ...k }); }),
    geriAlindi: vi.fn(async (id: string) => { const r = records.find((x) => x.id === id); if (r) { r.status = 'REVERTED'; r.revertedAt = new Date(); } }),
  };
  const crawler = {
    crawl: vi.fn(async () => ({
      baseUrl: siteUrl,
      pages: [
        { url: siteUrl, title: host, metaDescription: 'Mobilya', h1: host, canonical: null },
        { url: `${siteUrl}/koltuk`, title: 'Koltuk', metaDescription: 'Koltuk', h1: 'Koltuk', canonical: null },
      ],
      sitemapUrl: null, robotsTxt: null, llmsTxt: null, totalPages: 2,
    })),
  };
  const svc = new AutoFixService(prisma as any, crawler as any, new GeneratorsService(), appliedFix as any, {} as any);
  return { svc, records };
}

const rootWrites = () => writes.filter((w) => w.filename !== ROOT_VERIFY_FILENAME);
const verifyWrites = () => writes.filter((w) => w.filename === ROOT_VERIFY_FILENAME);

beforeEach(() => {
  disk.clear();
  docRoots.clear();
  blockedPaths.clear();
  staleCache.clear();
  unwritableDirs.clear();
  writes.length = 0;
  blockReason.value = null;
  // Tek cPanel hesabi: ana.com public_html'den, eklenti alan adi ek.com public_html/ek.com'dan sunulur
  docRoots.set('ana.com', 'public_html');
  docRoots.set('ek.com', 'public_html/ek.com');
  put('public_html', 'sitemap.xml', ANA_SITEMAP);
  put('public_html', 'llms.txt', ANA_LLMS);
  put('public_html', 'robots.txt', ANA_ROBOTS);
  disk.set('public_html/ek.com', new Map());
});

describe('eklenti alan adi (cPanel) — ana alan adinin dosyalari ezilmez', () => {
  it('ek.com icin sitemap + llms: kanitlanan public_html/ek.com\'a yazilir; ana.com\'un dosyalari AYNEN kalir', async () => {
    const { svc, records } = build('https://ek.com', CPANEL_EK);
    const r: any = await svc.runAutoFix('s1', ['sitemap', 'llms']);
    expect(r.applied).toEqual(['sitemap', 'llms']);
    expect(r.errors).toEqual([]);
    // Ana alan adi dokunulmadi
    expect(fileAt('public_html', 'sitemap.xml')).toBe(ANA_SITEMAP);
    expect(fileAt('public_html', 'llms.txt')).toBe(ANA_LLMS);
    // Yazim ek.com'un kendi klasorune
    expect(rootWrites().map((w) => `${w.dir}/${w.filename}`)).toEqual(['public_html/ek.com/sitemap.xml', 'public_html/ek.com/llms.txt']);
    expect(fileAt('public_html/ek.com', 'sitemap.xml')).toContain('<loc>https://ek.com/koltuk</loc>');
    // Kanit: once adaptorun varsayilani (public_html — ek.com'u sunmuyor), sonra public_html/ek.com
    expect(verifyWrites().map((w) => w.dir)).toEqual(['public_html', 'public_html/ek.com']);
    // Kanit turda bir kez (llms icin tekrar yoklanmadi)
    expect(verifyWrites()).toHaveLength(2);
    expect(r.files.every((f: any) => f.verified === true)).toBe(true);
    expect(r.unverified).toEqual([]);
    const applied = records.filter((x) => x.status === 'APPLIED');
    expect(applied.map((x) => x.detail.rootPath)).toEqual(['public_html/ek.com', 'public_html/ek.com']);
  });

  it('dogrulama dosyasi her denemede yeni rastgele icerik tasir (onbellekten eslesme olamaz)', async () => {
    const { svc } = build('https://ek.com', CPANEL_EK);
    await svc.runAutoFix('s1', ['sitemap']);
    disk.get('public_html/ek.com')!.delete('sitemap.xml');
    await svc.runAutoFix('s1', ['sitemap']);
    const contents = verifyWrites().map((w) => w.content);
    expect(new Set(contents).size).toBe(contents.length);
    for (const c of contents) expect(c).toMatch(/^ranksup-root-verification\n[a-f0-9]{32}\n$/);
  });

  it('ana alan adinin kendisi: varsayilan kok ilk denemede kanitlanir (eski davranis korunur)', async () => {
    disk.get('public_html')!.delete('sitemap.xml');
    const { svc } = build('https://ana.com', CPANEL_ANA);
    const r: any = await svc.runAutoFix('s1', ['sitemap']);
    expect(r.applied).toEqual(['sitemap']);
    expect(verifyWrites().map((w) => w.dir)).toEqual(['public_html']);
    expect(rootWrites().map((w) => w.dir)).toEqual(['public_html']);
  });
});

describe('kanitlanamayan kok — hicbir kok dosya yazilmaz', () => {
  it('hicbir aday klasor siteyi sunmuyor: wrong_root, ne yazilacagi + denenen klasorler soylenir, FAILED kaydi', async () => {
    // FTP giris dizini (''), yazi klasoru 'blog' — site 'site-kok' klasorunden sunuluyor, remotePath bunu gostermiyor
    docRoots.set('site.com', 'site-kok');
    disk.set('site-kok', new Map());
    const ftp = { type: 'FTP', name: 'FTP', isDefault: true, credentials: {}, config: { remotePath: '/blog' } };
    const { svc, records } = build('https://site.com', ftp);
    const r: any = await svc.runAutoFix('s1', ['sitemap', 'llms']);
    expect(r.applied).toEqual([]);
    expect(r.errors.map((e: any) => [e.fix, e.code])).toEqual([['sitemap', 'wrong_root'], ['llms', 'wrong_root']]);
    expect(r.errors[0].error).toContain('site.com sitesini sunmuyor');
    expect(r.errors[0].error).toContain('denenen klasörler: giriş klasörü, blog');
    expect(r.errors[0].error).toContain('elle yükleyebilirsin');
    expect(rootWrites()).toEqual([]);
    // Kanit turda bir kez denendi (2 klasor), ikinci dosya icin tekrar yazilmadi
    expect(verifyWrites().map((w) => w.dir)).toEqual(['', 'blog']);
    expect(records.map((x) => [x.fixType, x.status, x.detail.code])).toEqual([['sitemap', 'FAILED', 'wrong_root'], ['llms', 'FAILED', 'wrong_root']]);
  });

  it('FTP giris dizini sunulmuyor ama remotePath public_html icinde: public_html bulunur ve oraya yazilir', async () => {
    docRoots.set('site.com', 'public_html');
    disk.get('public_html')!.delete('sitemap.xml');
    const ftp = { type: 'FTP', name: 'FTP', isDefault: true, credentials: {}, config: { remotePath: '/public_html/blog' } };
    const { svc } = build('https://site.com', ftp);
    const r: any = await svc.runAutoFix('s1', ['sitemap']);
    expect(r.applied).toEqual(['sitemap']);
    expect(verifyWrites().map((w) => w.dir)).toEqual(['', 'public_html']);
    expect(rootWrites().map((w) => `${w.dir}/${w.filename}`)).toEqual(['public_html/sitemap.xml']);
  });

  it('dogrulama adresi WAF arkasinda: root_unverified, tek denemede durur, kok dosya yazilmaz', async () => {
    // Karar adimi engeli zaten reddeder; kanit adimini sinamak icin yalniz dogrulama yolu engelli
    blockedPaths.add(ROOT_VERIFY_FILENAME);
    const { svc } = build('https://ek.com', CPANEL_EK);
    const r: any = await svc.runAutoFix('s1', ['sitemap']);
    expect(r.errors).toEqual([expect.objectContaining({ fix: 'sitemap', code: 'root_unverified' })]);
    expect(r.errors[0].error).toContain('doğrulayamadan');
    expect(r.errors[0].error).toContain('RanksUpBot');
    expect(verifyWrites()).toHaveLength(1);
    expect(rootWrites()).toEqual([]);
  });

  it('hicbir klasore yuklenemedi: write_failed (adaptor hatasi aynen)', async () => {
    unwritableDirs.add('public_html');
    unwritableDirs.add('public_html/ek.com');
    unwritableDirs.add('public_html/ek.com/blog');
    const { svc } = build('https://ek.com', CPANEL_EK);
    const r: any = await svc.runAutoFix('s1', ['sitemap']);
    expect(r.errors).toEqual([expect.objectContaining({ fix: 'sitemap', code: 'write_failed' })]);
    expect(r.errors[0].error).toContain('553 public_html: izin yok');
    expect(rootWrites()).toEqual([]);
  });

  it('adres denetimi reddederse hic yukleme yok: write_failed, Turkce neden aynen', async () => {
    blockReason.value = 'Yayın hedefine bağlanılmadı — cPanel host: özel veya iç ağ adresi kullanılamaz; herkese açık bir adres girin.';
    const { svc } = build('https://ek.com', CPANEL_EK);
    const r: any = await svc.runAutoFix('s1', ['sitemap']);
    expect(r.errors).toEqual([expect.objectContaining({ code: 'write_failed', error: blockReason.value })]);
    expect(writes).toEqual([]);
  });
});

describe('geri alma da kanitlanmis koke yazar', () => {
  it('site artik baska klasorden sunuluyorsa geri alma yazmaz (wrong_root)', async () => {
    put('public_html/ek.com', 'robots.txt', 'User-agent: *\nDisallow: /sepet/\n');
    const { svc, records } = build('https://ek.com', CPANEL_EK);
    const p = await svc.preview('s1', 'robots_txt');
    expect(p.canApply).toBe(true);
    const r: any = await svc.runAutoFix('s1', ['robots_txt'], { confirm: { robots_txt: p.previewToken! } });
    expect(r.applied).toEqual(['robots_txt']);
    expect(fileAt('public_html', 'robots.txt')).toBe(ANA_ROBOTS);
    const rec = records.find((x) => x.status === 'APPLIED');
    // ek.com tasindi: yeni klasor adaylarin hicbiri degil (dosya oraya kopyalandi, canli icerik ayni)
    const written = fileAt('public_html/ek.com', 'robots.txt')!;
    put('ek-yeni', 'robots.txt', written);
    docRoots.set('ek.com', 'ek-yeni');
    writes.length = 0;
    const rv = await svc.revert('s1', rec.id);
    expect(rv).toMatchObject({ ok: false, code: 'wrong_root' });
    expect(rootWrites()).toEqual([]);
    expect(fileAt('public_html', 'robots.txt')).toBe(ANA_ROBOTS);
  });

  it('ayni klasorden sunuluyorsa onceki icerik kanitlanan klasore geri yazilir', async () => {
    const own = 'User-agent: *\nDisallow: /sepet/\n';
    put('public_html/ek.com', 'robots.txt', own);
    const { svc, records } = build('https://ek.com', CPANEL_EK);
    const p = await svc.preview('s1', 'robots_txt');
    await svc.runAutoFix('s1', ['robots_txt'], { confirm: { robots_txt: p.previewToken! } });
    const rec = records.find((x) => x.status === 'APPLIED');
    const rv = await svc.revert('s1', rec.id);
    expect(rv.ok).toBe(true);
    expect(fileAt('public_html/ek.com', 'robots.txt')).toBe(own);
    expect(fileAt('public_html', 'robots.txt')).toBe(ANA_ROBOTS);
  });
});

describe('yuklendi ama sitede gorunmuyor — duz basari sayilmaz', () => {
  it('onbellek eski yaniti donuyor: applied + files[].verified false + unverified listesinde neden', async () => {
    staleCache.set('ek.com/sitemap.xml', { status: 404, text: '' });
    const { svc, records } = build('https://ek.com', CPANEL_EK);
    const r: any = await svc.runAutoFix('s1', ['sitemap']);
    expect(r.applied).toEqual(['sitemap']);
    expect(r.files[0]).toMatchObject({ fix: 'sitemap', verified: false });
    expect(r.unverified).toEqual([expect.objectContaining({ fix: 'sitemap', filename: 'sitemap.xml', url: 'https://ek.com/sitemap.xml' })]);
    expect(r.unverified[0].reason).toContain('henüz görünmüyor');
    expect(records.find((x) => x.status === 'APPLIED').detail.verified).toBe(false);
  });
});

describe('onizleme dogrulama dosyasini belgeler', () => {
  it('uygulanabilir onizlemede ranksup-verify.txt notu var', async () => {
    const { svc } = build('https://ek.com', CPANEL_EK);
    const p = await svc.preview('s1', 'sitemap');
    expect(p.canApply).toBe(true);
    expect(p.notes.some((n) => n.includes(ROOT_VERIFY_FILENAME))).toBe(true);
    // Onizleme hicbir sey yazmaz (dogrulama dosyasi dahil)
    expect(writes).toEqual([]);
  });
});

describe('rootDirCandidates — aday kok klasorler (hicbiri kanitsiz kullanilmaz)', () => {
  it('cPanel: varsayilan public_html, sonra remotePath\'in web kokunden baslayan ust klasorleri', () => {
    expect(rootDirCandidates({ type: 'CPANEL_API', config: { remotePath: '/public_html/ek.com/blog' } })).toEqual(['public_html', 'public_html/ek.com', 'public_html/ek.com/blog']);
    expect(rootDirCandidates({ type: 'CPANEL_API', config: { remotePath: 'public_html/blog' } })).toEqual(['public_html', 'public_html/blog']);
  });

  it('FTP/SFTP: giris dizini, sonra web koku klasoru (mutlak SFTP yolu giris dizinine gore)', () => {
    expect(rootDirCandidates({ type: 'FTP', config: { remotePath: '/public_html/blog' } })).toEqual(['', 'public_html', 'public_html/blog']);
    expect(rootDirCandidates({ type: 'SFTP', config: { remotePath: '/home/user/public_html/blog' } })).toEqual(['', 'public_html', 'public_html/blog']);
    expect(rootDirCandidates({ type: 'FTP', config: { remotePath: '/ek.com/blog' } })).toEqual(['', 'ek.com', 'ek.com/blog']);
  });

  it('kayitli rootPath once; .. iceren yoldan klasor turetilmez; en fazla 4 aday', () => {
    expect(rootDirCandidates({ type: 'CPANEL_API', config: { rootPath: '/public_html/ek.com/', remotePath: 'public_html/ek.com/blog' } })[0]).toBe('public_html/ek.com');
    expect(rootDirCandidates({ type: 'FTP', config: { remotePath: '/public_html/../etc' } })).toEqual(['']);
    expect(rootDirCandidates({ type: 'CPANEL_API', config: { remotePath: 'public_html/a/b/c/d/e' } })).toHaveLength(4);
    expect(rootDirCandidates({ type: 'FTP', config: null })).toEqual(['']);
  });
});
