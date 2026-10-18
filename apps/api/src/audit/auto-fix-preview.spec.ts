import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Probe } from './axo-fetch.js';

/**
 * Kok dosya duzeltmesi — onizleme, guvenli uygulama, yedek ve geri alma.
 * Ag ve yayin hedefi sahte: canli site bir harita (yol → yanit); putRootFile
 * yazdigini canli siteye yansitir (yazim sonrasi dogrulama da gercekci olsun).
 */

type LiveFile = { status: number; text: string; contentType?: string; blocked?: boolean };
const live = new Map<string, LiveFile>();
const puts: Array<{ filename: string; content: string }> = [];
const probeCalls: Array<{ path: string; skipBinary: boolean | undefined }> = [];
/** safeFetchText ile ayni kural: metin disi turde govde yalniz skipBinary:false ile indirilir */
const TEXT_TYPE = /(text\/|xml|json|javascript|xhtml)/i;

vi.mock('./axo-fetch.js', async (orig) => {
  const actual = await orig<typeof import('./axo-fetch.js')>();
  return {
    ...actual,
    probeUrl: vi.fn(async (url: string, opts: { skipBinary?: boolean } = {}): Promise<Probe> => {
      const path = new URL(url).pathname;
      probeCalls.push({ path, skipBinary: opts.skipBinary });
      const f = live.get(path);
      const base = { url, finalUrl: url.split('?')[0], headers: {}, truncated: false, binary: false };
      if (!f) return { ...base, state: 'missing', status: 404, text: '', contentType: 'text/html', block: null };
      if (f.blocked) {
        return { ...base, state: 'blocked', status: 403, text: '', contentType: 'text/html', block: { kind: 'waf', reason: 'Cloudflare güvenlik duvarı RanksUp tarayıcısını engelledi (HTTP 403).', hint: '"RanksUpBot" için izin verin.', vendor: 'cloudflare', status: 403 } };
      }
      const contentType = f.contentType ?? 'text/plain';
      const binary = !TEXT_TYPE.test(contentType) && opts.skipBinary !== false;
      return { ...base, state: f.status >= 200 && f.status < 300 ? 'ok' : 'http_error', status: f.status, text: binary ? '' : f.text, contentType, binary, block: null };
    }),
  };
});

/** Kok dizin dogrulama dosyasi yazimlari (auto-fix.service ROOT_VERIFY_FILENAME) — kok dosyalardan ayri sayilir */
const verifyPuts: Array<{ filename: string; content: string; rootPath: unknown }> = [];

vi.mock('@luviai/adapters', () => ({
  getAdapter: () => class {
    constructor(_creds: unknown, private config: Record<string, unknown> = {}) {}
    get supportsRootFiles() { return true; }
    async putRootFile(filename: string, content: string) {
      // Bu sahte sunucuda her klasor siteyi sunar (tek siteli hesap); cok siteli
      // hesap ve yanlis kok: auto-fix-root-proof.spec.ts
      if (filename === 'ranksup-verify.txt') verifyPuts.push({ filename, content, rootPath: this.config.rootPath });
      else puts.push({ filename, content });
      live.set(`/${filename}`, { status: 200, text: content });
      return { ok: true, externalUrl: `public_html/${filename}` };
    }
  },
}));
vi.mock('@luviai/shared', () => ({ decryptCredentials: (x: unknown) => x }));

const { AutoFixService } = await import('./auto-fix.service.js');
const { GeneratorsService } = await import('./generators.service.js');

const SITE = { id: 's1', userId: 'u1', url: 'https://kuafor.com', name: 'Kuaför', niche: 'güzellik', brain: null };
const TARGET = { type: 'SFTP', name: 'Sunucu', isDefault: true, credentials: {}, config: {} };

function build(opts: { targets?: any[] } = {}) {
  const records: any[] = [];
  const kv = new Map<string, any>();
  const prisma = {
    site: { findUniqueOrThrow: vi.fn(async () => ({ ...SITE, publishTargets: opts.targets ?? [TARGET] })) },
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
      baseUrl: 'https://kuafor.com',
      pages: [
        { url: 'https://kuafor.com', title: 'Kuaför', metaDescription: 'Saç', h1: 'Kuaför', canonical: null },
        { url: 'https://kuafor.com/hizmetler', title: 'Hizmetler', metaDescription: 'Kesim', h1: 'Hizmetler', canonical: 'https://kuafor.com/hizmetler/' },
        { url: 'https://kuafor.com/eski', title: 'Eski', metaDescription: 'x', h1: 'Eski', canonical: 'https://kuafor.com/yeni' },
      ],
      sitemapUrl: null, robotsTxt: null, llmsTxt: null, totalPages: 3,
    })),
  };
  const svc = new AutoFixService(prisma as any, crawler as any, new GeneratorsService(), appliedFix as any, {} as any);
  return { svc, prisma, appliedFix, records, crawler, kv };
}

const ROBOTS = 'User-agent: *\nDisallow: /admin/\n\nUser-agent: GPTBot\nDisallow: /\n';

beforeEach(() => {
  live.clear();
  puts.length = 0;
  verifyPuts.length = 0;
  probeCalls.length = 0;
});

describe('robots.txt — onizleme + onayli birlestirme', () => {
  it('onizleme mevcut dosyayi korur: silinen satir yok, token var', async () => {
    live.set('/robots.txt', { status: 200, text: ROBOTS });
    const { svc } = build();
    const p = await svc.preview('s1', 'robots_txt', { aiTrain: 'no' });
    expect(p).toMatchObject({ canonical: 'robots', filename: 'robots.txt', action: 'merge', canApply: true });
    expect(p.current).toEqual({ exists: true, status: 200, content: ROBOTS });
    expect(p.proposed!.startsWith(ROBOTS)).toBe(true);
    expect(p.proposed).toContain('ai-train=no');
    expect(p.stats.removed).toBe(0);
    expect(p.diff.slice(0, 2)).toEqual([{ op: 'same', text: 'User-agent: *' }, { op: 'same', text: 'Disallow: /admin/' }]);
    expect(p.previewToken).toMatch(/^[a-f0-9]{32}$/);
    expect(puts).toEqual([]);
  });

  it('onaysiz uygulama robots.txt\'ye yazmaz (preview_required)', async () => {
    live.set('/robots.txt', { status: 200, text: ROBOTS });
    const { svc } = build();
    const r: any = await svc.runAutoFix('s1', ['robots_txt']);
    expect(r.errors).toEqual([expect.objectContaining({ fix: 'robots_txt', code: 'preview_required' })]);
    expect(puts).toEqual([]);
  });

  it('token ile onizlenen icerik AYNEN yazilir, yedek kaydedilir, canlida dogrulanir', async () => {
    live.set('/robots.txt', { status: 200, text: ROBOTS });
    const { svc, records } = build();
    const p = await svc.preview('s1', 'robots_txt');
    const r: any = await svc.runAutoFix('s1', ['robots_txt'], { confirm: { robots_txt: p.previewToken! }, userId: 'u9' });
    expect(r.applied).toEqual(['robots_txt']);
    expect(puts).toEqual([{ filename: 'robots.txt', content: p.proposed }]);
    expect(r.files[0]).toMatchObject({ fix: 'robots_txt', verified: true, action: 'merge' });
    const rec = records.find((x) => x.status === 'APPLIED');
    expect(rec).toMatchObject({ userId: 'u9', kind: 'auto_fix', fixType: 'robots_txt', target: 'https://kuafor.com/robots.txt' });
    expect(rec.detail.previous).toMatchObject({ existed: true, status: 200, content: ROBOTS });
    expect(rec.detail.verified).toBe(true);
  });

  it('dosya onizlemeden sonra degistiyse uygulanmaz (preview_stale)', async () => {
    live.set('/robots.txt', { status: 200, text: ROBOTS });
    const { svc } = build();
    const p = await svc.preview('s1', 'robots');
    live.set('/robots.txt', { status: 200, text: `${ROBOTS}Disallow: /yeni/\n` });
    const r: any = await svc.runAutoFix('s1', ['robots'], { confirm: { robots: p.previewToken! } });
    expect(r.errors[0].code).toBe('preview_stale');
    expect(puts).toEqual([]);
  });

  it('engelli robots.txt: reddedilir, token yok', async () => {
    live.set('/robots.txt', { status: 403, text: '', blocked: true });
    const { svc } = build();
    const p = await svc.preview('s1', 'robots_txt');
    expect(p).toMatchObject({ action: 'refuse', canApply: false, previewToken: null });
    expect(p.reason).toMatch(/güvenilir okunamadı/);
  });

  it('soft-404 (HTML) robots.txt: yazilmaz ama elle kullanim icin oneri gosterilir', async () => {
    live.set('/robots.txt', { status: 200, text: '<!doctype html><html><body>app</body></html>', contentType: 'text/html' });
    const { svc } = build();
    const p = await svc.preview('s1', 'robots_txt');
    expect(p.action).toBe('refuse');
    expect(p.canApply).toBe(false);
    expect(p.proposed).toMatch(/User-agent: GPTBot/);
  });

  it('Cloudflare Managed robots.txt: blok sunucu dosyasina kopyalanmasin diye otomatik yazilmaz; eklenecek satirlar gosterilir', async () => {
    const cf = '# BEGIN Cloudflare Managed content\nUser-Agent: *\nContent-signal: search=yes,ai-train=no\nAllow: /\n\nUser-agent: GPTBot\nDisallow: /\n# END Cloudflare Managed Content\n\nUser-agent: *\nDisallow: /admin/\n';
    live.set('/robots.txt', { status: 200, text: cf });
    const { svc } = build();
    const p = await svc.preview('s1', 'robots_txt');
    expect(p).toMatchObject({ action: 'refuse', canApply: false, previewToken: null });
    expect(p.reason).toMatch(/Cloudflare/);
    expect(p.current.exists).toBe(true);
    expect(p.stats.removed).toBe(0);
    expect(p.stats.added).toBeGreaterThan(0);
  });

  it('WordPress izleri varsa sanal robots.txt uyarisi notlarda', async () => {
    live.set('/robots.txt', { status: 200, text: 'User-agent: *\nDisallow: /wp-admin/\nAllow: /wp-admin/admin-ajax.php\n\nSitemap: https://kuafor.com/wp-sitemap.xml\n' });
    const { svc } = build();
    const p = await svc.preview('s1', 'robots_txt');
    expect(p.action).toBe('merge');
    expect(p.notes.some((n) => /eklentinin robots ayarları artık uygulanmaz/.test(n))).toBe(true);
  });

  it('robots.txt yoksa yeni dosya; canli site haritasi varsa Sitemap satiri eklenir', async () => {
    live.set('/sitemap.xml', { status: 200, text: '<?xml version="1.0"?><urlset></urlset>', contentType: 'application/xml' });
    const { svc } = build();
    const p = await svc.preview('s1', 'robots_txt');
    expect(p.action).toBe('create');
    expect(p.proposed).toMatch(/^Sitemap: https:\/\/kuafor\.com\/sitemap\.xml$/m);
  });

  it('eksik bir sey yoksa action none, fark bos', async () => {
    const { svc } = build();
    live.set('/sitemap.xml', { status: 200, text: '<urlset></urlset>', contentType: 'application/xml' });
    const first = await svc.preview('s1', 'robots_txt');
    live.set('/robots.txt', { status: 200, text: first.proposed! });
    const second = await svc.preview('s1', 'robots_txt');
    expect(second).toMatchObject({ action: 'none', canApply: false, diff: [], previewToken: null });
  });

  it('yayin hedefi yoksa onizleme calisir ama uygulanamaz (elle yukleme)', async () => {
    live.set('/robots.txt', { status: 200, text: ROBOTS });
    const { svc } = build({ targets: [] });
    const p = await svc.preview('s1', 'robots_txt');
    expect(p.canApply).toBe(false);
    expect(p.reason).toMatch(/yayın hedefi yok/);
    expect(p.proposed).not.toBeNull();
  });
});

describe('sitemap.xml — yalniz yokken olusturulur', () => {
  it('canli /sitemap.xml varsa uzerine yazilmaz', async () => {
    live.set('/sitemap.xml', { status: 200, text: '<?xml version="1.0"?><urlset><url><loc>https://kuafor.com/</loc></url></urlset>', contentType: 'application/xml' });
    const { svc } = build();
    const r: any = await svc.runAutoFix('s1', ['sitemap_xml']);
    expect(r.applied).toEqual([]);
    expect(r.unchanged[0].reason).toMatch(/zaten var/);
    expect(puts).toEqual([]);
  });

  it('robots.txt\'de bildirilen site haritasi (wp-sitemap) varsa yenisi olusturulmaz', async () => {
    live.set('/robots.txt', { status: 200, text: 'User-agent: *\nAllow: /\nSitemap: https://kuafor.com/wp-sitemap.xml\n' });
    live.set('/wp-sitemap.xml', { status: 200, text: '<sitemapindex></sitemapindex>', contentType: 'application/xml' });
    const { svc } = build();
    const p = await svc.preview('s1', 'sitemap');
    expect(p.action).toBe('none');
    expect(p.reason).toMatch(/wp-sitemap\.xml/);
  });

  it('sitemap.xml adresinde site haritasi olmayan icerik varsa reddedilir', async () => {
    live.set('/sitemap.xml', { status: 200, text: '<rss version="2.0"></rss>', contentType: 'application/xml' });
    const { svc } = build();
    expect((await svc.preview('s1', 'sitemap')).action).toBe('refuse');
  });

  it('hic yoksa olusturulur: lastmod yok, canonical disi sayfa yok, yedekte "onceden yoktu"', async () => {
    const { svc, records } = build();
    const r: any = await svc.runAutoFix('s1', ['sitemap']);
    expect(r.applied).toEqual(['sitemap']);
    const xml = puts[0].content;
    expect(xml).toContain('<loc>https://kuafor.com/hizmetler</loc>');
    expect(xml).not.toContain('/eski');
    expect(xml).not.toContain('<lastmod>');
    expect(records[0].detail.previous).toMatchObject({ existed: false, content: null });
  });
});

describe('llms.txt — musterinin dosyasi korunur', () => {
  it('sahibinin llms.txt\'si varsa dokunulmaz', async () => {
    live.set('/llms.txt', { status: 200, text: '# Kendi dosyam\n\n- [a](https://kuafor.com)' });
    const { svc } = build();
    const r: any = await svc.runAutoFix('s1', ['llms_txt']);
    expect(r.unchanged[0].reason).toMatch(/üzerine yazmıyoruz/);
    expect(puts).toEqual([]);
  });

  it('RanksUp\'in yazdigi ve degismemis llms.txt yenilenebilir (eski hali yedeklenir)', async () => {
    const { svc, records } = build();
    await svc.runAutoFix('s1', ['llms']);
    expect(puts.length).toBe(1);
    const p = await svc.preview('s1', 'llms_txt');
    expect(p.action).toBe('regenerate');
    expect(records[0].detail.written.sha256).toMatch(/^[a-f0-9]{64}$/);
  });
});

describe('geri alma ve gecmis', () => {
  it('robots birlestirmesi geri alinir: onceki icerik aynen yazilir, kayit REVERTED', async () => {
    live.set('/robots.txt', { status: 200, text: ROBOTS });
    const { svc, records, appliedFix } = build();
    const p = await svc.preview('s1', 'robots_txt');
    await svc.runAutoFix('s1', ['robots_txt'], { confirm: { robots_txt: p.previewToken! } });
    const rec = records.find((x) => x.status === 'APPLIED');
    const history = await svc.history('s1');
    expect(history[0]).toMatchObject({ id: rec.id, revertible: true, filename: 'robots.txt' });
    const r = await svc.revert('s1', rec.id, 'u1');
    expect(r.ok).toBe(true);
    expect(puts[puts.length - 1]).toEqual({ filename: 'robots.txt', content: ROBOTS });
    expect(appliedFix.geriAlindi).toHaveBeenCalledWith(rec.id);
    expect(rec.status).toBe('REVERTED');
  });

  it('dosya bizden sonra degistiyse geri alma reddedilir', async () => {
    live.set('/robots.txt', { status: 200, text: ROBOTS });
    const { svc, records } = build();
    const p = await svc.preview('s1', 'robots_txt');
    await svc.runAutoFix('s1', ['robots_txt'], { confirm: { robots_txt: p.previewToken! } });
    live.set('/robots.txt', { status: 200, text: 'User-agent: *\nDisallow: /\n' });
    const r = await svc.revert('s1', records[0].id);
    expect(r).toMatchObject({ ok: false, code: 'changed' });
  });

  it('onceden olmayan dosya geri alinamaz; ne yapilacagi soylenir', async () => {
    const { svc, records } = build();
    await svc.runAutoFix('s1', ['sitemap']);
    const r = await svc.revert('s1', records[0].id);
    expect(r).toMatchObject({ ok: false, code: 'was_absent' });
    expect(r.error).toMatch(/sunucudan silmen gerekir/);
    expect((await svc.history('s1'))[0]).toMatchObject({ revertible: false });
  });
});

describe('okunamayan site — dosya uretilmez (crawl.homeAccess)', () => {
  const WAF_HOME = {
    state: 'blocked' as const, kind: 'waf', url: 'https://kuafor.com/', status: 403, vendor: 'cloudflare',
    reason: 'Cloudflare güvenlik duvarı RanksUp tarayıcısını engelledi (HTTP 403).', hint: '"RanksUpBot" için izin verin.',
  };
  const blockedCrawl = {
    baseUrl: 'https://kuafor.com', pages: [], sitemapUrl: null, robotsTxt: null, llmsTxt: null, totalPages: 0,
    homeAccess: WAF_HOME, blockedPages: [WAF_HOME], robotsDisallowed: [], stoppedEarly: WAF_HOME.reason,
  };

  it('anasayfa engelliyse sitemap uretilmez: neden + izin talimati, "sayfa bulunamadi" denmez', async () => {
    const { svc, crawler } = build();
    crawler.crawl.mockResolvedValueOnce(blockedCrawl as any);
    const p = await svc.preview('s1', 'sitemap');
    expect(p).toMatchObject({ action: 'refuse', canApply: false, previewToken: null, proposed: null });
    expect(p.reason).toContain('Erişim engellendi: Cloudflare güvenlik duvarı');
    expect(p.reason).toContain('RanksUpBot');
    expect(p.reason).toContain('sitemap.xml üretmiyoruz');
    expect(p.reason).not.toMatch(/sayfa bulunamadı/);
    // Anasayfa okunamazsa tarama orada durur (404/500 dahil) — bos tarama yapilmaz
    expect(crawler.crawl).toHaveBeenCalledWith('https://kuafor.com', 30, { stopIfHomeUnreadable: true });
  });

  it('kuyruk yolunda da llms.txt yuklenmez (refused), kayit acilmaz', async () => {
    const { svc, crawler, records } = build();
    crawler.crawl.mockResolvedValueOnce(blockedCrawl as any);
    const r: any = await svc.runAutoFix('s1', ['llms']);
    expect(r.applied).toEqual([]);
    expect(r.errors).toEqual([expect.objectContaining({ fix: 'llms', code: 'refused' })]);
    expect(r.errors[0].error).toContain('llms.txt üretmiyoruz');
    expect(puts).toEqual([]);
    expect(records).toEqual([]);
  });

  it('bot korumasi taramayi yarida kestiyse dosya uretilir ama kac sayfadan uretildigi soylenir', async () => {
    const { svc, crawler } = build();
    crawler.crawl.mockResolvedValueOnce({
      baseUrl: 'https://kuafor.com',
      pages: [{ url: 'https://kuafor.com', title: 'Kuaför', metaDescription: 'Saç', h1: 'Kuaför', canonical: null }],
      sitemapUrl: null, robotsTxt: null, llmsTxt: null, totalPages: 1,
      homeAccess: null, blockedPages: [WAF_HOME], robotsDisallowed: [], stoppedEarly: WAF_HOME.reason,
    } as any);
    const p = await svc.preview('s1', 'sitemap');
    expect(p.canApply).toBe(true);
    expect(p.notes.some((n) => n.includes('erken durdu') && n.includes('1 sayfadan'))).toBe(true);
  });
});

describe('yayin hedefi adres denetimi (publish-target-url)', () => {
  it('ic ag adresli SFTP hedefine yazilmaz: Turkce neden, FAILED kaydi, adaptor istegi yok', async () => {
    const { svc, records } = build({ targets: [{ ...TARGET, credentials: { host: '10.0.0.5', username: 'u', password: 'p' } }] });
    const r: any = await svc.runAutoFix('s1', ['sitemap']);
    expect(r.applied).toEqual([]);
    expect(r.errors).toEqual([expect.objectContaining({ fix: 'sitemap', code: 'write_failed' })]);
    expect(r.errors[0].error).toMatch(/^Yayın hedefine bağlanılmadı — Host: özel veya iç ağ adresi/);
    expect(puts).toEqual([]);
    expect(records).toEqual([expect.objectContaining({ status: 'FAILED', fixType: 'sitemap' })]);
    expect(records[0].error).toContain('Yayın hedefine bağlanılmadı');
  });

  it('genel IP\'li hedefe yazim surer', async () => {
    const { svc } = build({ targets: [{ ...TARGET, credentials: { host: '185.10.20.30', username: 'u', password: 'p' } }] });
    const r: any = await svc.runAutoFix('s1', ['sitemap']);
    expect(r.applied).toEqual(['sitemap']);
    expect(puts).toHaveLength(1);
  });
});

describe('metin disi Content-Type ile sunulan kok dosyalar', () => {
  const OCTET = 'application/octet-stream';
  const RULES = 'User-agent: *\nDisallow: /admin/\nDisallow: /odeme/\n';

  it('octet-stream robots.txt gercek icerigiyle okunur: kurallar korunur ve yeni gruplara kopyalanir', async () => {
    live.set('/robots.txt', { status: 200, text: RULES, contentType: OCTET });
    const { svc } = build();
    const p = await svc.preview('s1', 'robots_txt');
    expect(p).toMatchObject({ action: 'merge', canApply: true });
    expect(p.current).toEqual({ exists: true, status: 200, content: RULES });
    expect(p.proposed!.startsWith(RULES)).toBe(true);
    expect(p.stats.removed).toBe(0);
    const { parseRobots, robotsAllows } = await import('./robots-merge.js');
    const after = parseRobots(p.proposed!);
    expect(robotsAllows(after, 'GPTBot', '/admin/')).toBe(false);
    expect(robotsAllows(after, 'ClaudeBot', '/odeme/x')).toBe(false);
    expect(probeCalls.filter((c) => c.path === '/robots.txt').every((c) => c.skipBinary === false)).toBe(true);
  });

  it('ikili govdeli robots.txt (NUL / bozuk bayt) birlestirilmez', async () => {
    live.set('/robots.txt', { status: 200, text: '\u0000\u0001PK\u0003\u0004\uFFFD', contentType: OCTET });
    const { svc } = build();
    const p = await svc.preview('s1', 'robots_txt');
    expect(p).toMatchObject({ action: 'refuse', canApply: false, previewToken: null });
  });

  it('octet-stream llms.txt "yok" sayilmaz: onizlemesiz toplu yolda da uzerine yazilmaz', async () => {
    live.set('/llms.txt', { status: 200, text: '# Kendi dosyam\n\n- [a](https://kuafor.com)', contentType: OCTET });
    const { svc } = build();
    const r: any = await svc.runAutoFix('s1', ['llms_txt']);
    expect(r.applied).toEqual([]);
    expect(r.unchanged[0].reason).toMatch(/üzerine yazmıyoruz/);
    expect(puts).toEqual([]);
  });

  it('octet-stream sitemap.xml: XML ise "var", degilse reddedilir; ikisinde de yazilmaz', async () => {
    live.set('/sitemap.xml', { status: 200, text: '<?xml version="1.0"?><urlset><url><loc>https://kuafor.com/</loc></url></urlset>', contentType: OCTET });
    const { svc } = build();
    expect((await svc.preview('s1', 'sitemap')).action).toBe('none');
    live.set('/sitemap.xml', { status: 200, text: '\u0000\u0001garbage', contentType: OCTET });
    const r: any = await svc.runAutoFix('s1', ['sitemap']);
    expect(r.applied).toEqual([]);
    expect(r.errors[0]).toMatchObject({ fix: 'sitemap', code: 'refused' });
    expect(puts).toEqual([]);
  });

  it('robots.txt\'de bildirilen .xml.gz site haritasi (application/gzip) var sayilir; yenisi olusturulmaz', async () => {
    live.set('/robots.txt', { status: 200, text: 'User-agent: *\nAllow: /\nSitemap: https://kuafor.com/sitemap.xml.gz\n' });
    live.set('/sitemap.xml.gz', { status: 200, text: '\u001f\uFFFD\u0008', contentType: 'application/gzip' });
    const { svc } = build();
    const p = await svc.preview('s1', 'sitemap');
    expect(p.action).toBe('none');
    expect(p.reason).toMatch(/sitemap\.xml\.gz/);
  });

  it('geri alma octet-stream ile sunulan canli dosyayi okuyup karsilastirir', async () => {
    live.set('/robots.txt', { status: 200, text: RULES, contentType: OCTET });
    const { svc, records } = build();
    const p = await svc.preview('s1', 'robots_txt');
    await svc.runAutoFix('s1', ['robots_txt'], { confirm: { robots_txt: p.previewToken! } });
    const rec = records.find((x) => x.status === 'APPLIED');
    expect(rec.detail.previous).toMatchObject({ existed: true, content: RULES });
    // Sunucu yazilan dosyayi da octet-stream ile sunuyor
    live.set('/robots.txt', { status: 200, text: p.proposed!, contentType: OCTET });
    const r = await svc.revert('s1', rec.id);
    expect(r.ok).toBe(true);
    expect(puts[puts.length - 1]).toEqual({ filename: 'robots.txt', content: RULES });
  });
});

describe('robots.txt — yalniz CR satir sonu uctan uca', () => {
  it('"User-agent: * / Disallow: /" (CR): 21 bota Allow: / eklenmez; botlar engelli kalir', async () => {
    const cr = 'User-agent: *\rDisallow: /\r';
    live.set('/robots.txt', { status: 200, text: cr });
    const { svc } = build();
    const p = await svc.preview('s1', 'robots_txt');
    expect(p.action).toBe('merge');
    expect(p.notes.join(' ')).not.toMatch(/zaten tam erişimleri vardı/);
    const { parseRobots, robotsAllows } = await import('./robots-merge.js');
    const norm = parseRobots(p.proposed!.replace(/\r\n?/g, '\n'));
    for (const bot of ['GPTBot', 'ClaudeBot', 'CCBot', 'Google-Extended']) expect(robotsAllows(norm, bot, '/'), bot).toBe(false);
    expect(p.diff.slice(0, 2)).toEqual([{ op: 'same', text: 'User-agent: *' }, { op: 'same', text: 'Disallow: /' }]);
    expect(p.stats.removed).toBe(0);
  });
});

describe('cikarilan duzeltmeler', () => {
  it('auth_md ve agent_json artik yazilmaz', async () => {
    const { svc } = build();
    const r: any = await svc.runAutoFix('s1', ['auth_md', 'agent_json']);
    expect(r).toMatchObject({ reason: 'nothing-auto-fixable', unsupported: ['auth_md', 'agent_json'] });
    expect(puts).toEqual([]);
    await expect(svc.preview('s1', 'auth_md')).rejects.toThrow();
  });
});
