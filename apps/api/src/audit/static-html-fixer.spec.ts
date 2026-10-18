import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import type { SafeTextResult } from '../common/safe-fetch.js';

const published: any[] = [];
vi.mock('@luviai/adapters', async (orig) => {
  const real: any = await orig();
  class FakeAdapter {
    constructor(private readonly creds: any, private readonly cfg: any) {}
    // cfg: adaptore verilen yapilandirma (remotePath = yazilacak klasor)
    async publish(p: any) { published.push({ ...p, cfg: this.cfg }); return { ok: true }; }
  }
  return { ...real, getAdapter: () => FakeAdapter };
});
vi.mock('@luviai/shared', async (orig) => ({ ...(await orig() as any), decryptCredentials: (c: any) => c ?? {} }));
const fetchMock = vi.fn();
vi.mock('../common/safe-fetch.js', async (orig) => {
  const real: any = await orig();
  return { ...real, safeFetchText: (...a: any[]) => fetchMock(...a) };
});

const { StaticHtmlFixerService } = await import('./static-html-fixer.service.js');
const { SafeFetchError } = await import('../common/safe-fetch.js');

const PAGE_URL = 'https://site.com/hakkimizda.html';
const res = (r: Partial<SafeTextResult> & { status: number }): SafeTextResult => ({
  ok: r.status >= 200 && r.status < 300, url: PAGE_URL, redirected: false, contentType: 'text/html',
  headers: {}, text: '', truncated: false, binary: false, ...r,
});
const HTML = '<html><head><meta charset="utf-8"><title>Eski</title></head><body><img src="/a.jpg" alt=""></body></html>';
const SNIPPETS: any[] = [{ type: 'meta_title', generatedSnippet: '<title>Yeni Başlık</title>', pageUrl: PAGE_URL }];
const CHALLENGE = res({ status: 200, text: '<html><head><title>Just a moment...</title></head><body>cf_chl_opt</body></html>' });
/** Statik dosya sunan sunucunun basliklari (dosya tarihi var, cerez / uygulama izi yok) */
const STATIC = { 'content-type': 'text/html; charset=utf-8', 'last-modified': 'Mon, 12 Oct 2026 09:00:00 GMT' };
/** Her adres icin ayni statik sayfa (sayfa okumasi + dosya dogrulamasi) */
const serveStatic = (text = HTML, headers: Record<string, string> = STATIC) =>
  fetchMock.mockImplementation(async (url: string) => res({ status: 200, text, url, headers }));

type Target = { type: string; credentials?: Record<string, unknown>; config?: Record<string, unknown> };
function build(credentials: Record<string, unknown> = {}, siteUrl = 'https://site.com', opts: { remotePath?: string; targets?: Target[]; platform?: string | null } = {}) {
  const targets = opts.targets ?? [{ type: 'SFTP', credentials, config: { remotePath: opts.remotePath ?? 'public_html' } }];
  const prisma = {
    site: { findUniqueOrThrow: vi.fn(async () => ({ url: siteUrl, platform: opts.platform ?? null, publishTargets: targets })) },
  };
  const appliedFix = { topluKaydet: vi.fn(async () => {}) };
  const svc = new StaticHtmlFixerService(prisma as any, appliedFix as any);
  return Object.assign(svc, { appliedFixMock: appliedFix, prismaMock: prisma });
}

beforeEach(() => { fetchMock.mockReset(); published.length = 0; });

describe('StaticHtmlFixerService — okunamayan sayfa musterinin dosyasinin yerine YAZILMAZ', () => {
  it('saglam UTF-8 statik sayfa yamalanip yazilir', async () => {
    serveStatic();
    const r = await build().write('s1', PAGE_URL, SNIPPETS);
    expect(r.ok).toBe(true);
    expect(published).toHaveLength(1);
    expect(published[0].bodyHtml).toContain('Yeni Başlık');
  });

  it('bot dogrulama ekrani (200) yamalanip yazilmaz; neden ve izin talimati doner', async () => {
    fetchMock.mockResolvedValue(CHALLENGE);
    const r = await build().write('s1', PAGE_URL, SNIPPETS);
    expect(r.ok).toBe(false);
    expect(r.error).toContain('Sayfa indirilemedi');
    expect(r.error).toContain('RanksUpBot');
    expect(published).toHaveLength(0);
  });

  it('2 MB tavaninda kesilen sayfa yazilmaz', async () => {
    fetchMock.mockResolvedValue(res({ status: 200, text: HTML, truncated: true }));
    const r = await build().write('s1', PAGE_URL, SNIPPETS);
    expect(r).toMatchObject({ ok: false });
    expect(r.error).toContain('2 MB');
    expect(published).toHaveLength(0);
  });

  it('UTF-8 disi karakter kumesi bildiren sayfa yazilmaz (adaptorler UTF-8 yazar)', async () => {
    fetchMock.mockResolvedValue(res({ status: 200, text: HTML.replace('utf-8', 'windows-1254') }));
    const r = await build().write('s1', PAGE_URL, SNIPPETS);
    expect(r.ok).toBe(false);
    expect(r.error).toContain('windows-1254');
    expect(published).toHaveLength(0);
  });

  it('karakter kumesi bildirmeyen ama gecerli UTF-8 olmayan sayfa da yazilmaz', async () => {
    // safeFetchText bildirimsiz windows-1254 baytlarini UTF-8 cozer → U+FFFD
    fetchMock.mockResolvedValue(res({ status: 200, text: '<html><head><title>Eski</title></head><body>Kuru�e�me</body></html>' }));
    const r = await build().write('s1', PAGE_URL, SNIPPETS);
    expect(r.ok).toBe(false);
    expect(r.error).toContain('UTF-8 değil');
    expect(published).toHaveLength(0);
  });

  it('gorsel alt metni yazimi da ayni kurallara uyar', async () => {
    fetchMock.mockResolvedValue(CHALLENGE);
    const r = await build().writeImageAlts('s1', PAGE_URL, [{ id: 'i1', srcRaw: '/a.jpg', src: 'https://site.com/a.jpg', alt: 'Yeni alt' }]);
    expect(r.ok).toBe(false);
    expect(r.error).toContain('RanksUpBot');
    expect(published).toHaveLength(0);
  });

  it('onizleme: okunamayan sayfada nedeni tasiyan 400 (eskiden duz Error → 500)', async () => {
    fetchMock.mockRejectedValue(new SafeFetchError('blocked_address', 'ozel'));
    // Kapsam icindeki adres ic aga cikiyor (DNS degisimi): okuma korumasi ayri katman
    const p = build({}, 'http://169.254.169.254').preview('s1', 'http://169.254.169.254/latest/meta-data/', SNIPPETS);
    await expect(p).rejects.toBeInstanceOf(BadRequestException);
    await expect(p).rejects.toThrow(/iç ağa/);
  });

  it('onizleme karakter kumesini de bildirir', async () => {
    fetchMock.mockResolvedValue(res({ status: 200, text: HTML }));
    const r = await build().preview('s1', PAGE_URL, SNIPPETS);
    expect(r).toMatchObject({ truncated: false, charset: 'utf-8' });
  });
});

describe('StaticHtmlFixerService — kapsam: yalniz sitenin kendi sayfalari', () => {
  const FOREIGN = ['https://site.com.evil.com/a.html', 'https://notsite.com/a.html', 'https://site.com@evil.com/a.html'];

  it('onizleme: baska sitenin adresi istek ATILMADAN Turkce 400', async () => {
    for (const url of FOREIGN) {
      const p = build().preview('s1', url, SNIPPETS);
      await expect(p, url).rejects.toBeInstanceOf(BadRequestException);
      await expect(p, url).rejects.toThrow(/Statik HTML önizlemesi yalnızca sitenin kendi alan adında yapılabilir \(site\.com;/);
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('yazim: baska sitenin adresi okunmaz, musterinin sunucusuna YAZILMAZ', async () => {
    serveStatic();
    for (const url of FOREIGN) {
      const p = build({ host: '185.10.20.30' }).write('s1', url, SNIPPETS);
      await expect(p, url).rejects.toBeInstanceOf(BadRequestException);
      await expect(p, url).rejects.toThrow(/Statik HTML yazımı yalnızca sitenin kendi alan adında/);
    }
    expect(fetchMock).not.toHaveBeenCalled();
    expect(published).toHaveLength(0);
  });

  it('onizlemede www\'li hali ve alt alan adi kabul edilir; yazimda www kabul, alt alan adi elle', async () => {
    serveStatic();
    for (const url of ['https://www.site.com/hakkimizda.html', 'https://blog.site.com/yazi.html']) {
      await expect(build().preview('s1', url, SNIPPETS), url).resolves.toMatchObject({ pageUrl: url });
    }
    const w = await build({ host: '185.10.20.30' }).write('s1', 'https://www.site.com/hakkimizda.html', SNIPPETS);
    expect(w.ok).toBe(true);
    expect(published).toHaveLength(1);
    // Alt alan adi baska klasorden / sunucudan sunulabilir: hangi dosya oldugu bilinemez
    const sub = await build({ host: '185.10.20.30' }).write('s1', 'https://blog.site.com/yazi.html', SNIPPETS);
    expect(sub).toMatchObject({ ok: false, manual: true });
    expect(sub.error).toContain('kendi alan adında değil');
    expect(published).toHaveLength(1);
  });
});

describe('StaticHtmlFixerService — yayin hedefi adres denetimi', () => {
  it('ic ag adresli SFTP hedefine sayfa yazilmaz; Turkce neden doner', async () => {
    serveStatic();
    const r = await build({ host: '127.0.0.1' }).write('s1', PAGE_URL, SNIPPETS);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/^Yayın hedefine bağlanılmadı — Host: özel veya iç ağ adresi/);
    expect(published).toHaveLength(0);
  });

  it('gorsel alt metni: dosya gonderilmediyse gorseller "degisti" SAYILMAZ (uygulandi diye islenmesin)', async () => {
    serveStatic();
    const r = await build({ host: '10.1.2.3' }).writeImageAlts('s1', PAGE_URL, [{ id: 'i1', srcRaw: '/a.jpg', src: 'https://site.com/a.jpg', alt: 'Yeni alt' }]);
    expect(r.ok).toBe(false);
    expect(r.error).toContain('Yayın hedefine bağlanılmadı');
    expect(r.perImage.i1).toMatchObject({ changed: false, reason: 'write_failed' });
    expect(published).toHaveLength(0);
  });

  it('genel IP\'li hedefe yazim surer', async () => {
    serveStatic();
    const r = await build({ host: '185.10.20.30' }).write('s1', PAGE_URL, SNIPPETS);
    expect(r.ok).toBe(true);
    expect(published).toHaveLength(1);
  });
});

describe('StaticHtmlFixerService — adres → dosya eslemesi (stuck-page-static-write kurallari)', () => {
  it('/blog/x.html + hedef klasoru public_html/blog → public_html/blog/x.html (eskiden public_html/blog/blog/x.html)', async () => {
    serveStatic();
    const svc = build({ host: '185.10.20.30' }, 'https://site.com', { remotePath: 'public_html/blog' });
    const r = await svc.write('s1', 'https://site.com/blog/x.html', SNIPPETS);
    expect(r).toMatchObject({ ok: true, remoteDir: 'public_html/blog', filename: 'x.html', fileUrl: 'https://site.com/blog/x.html' });
    expect(published).toHaveLength(1);
    expect(published[0]).toMatchObject({ slug: 'x', cfg: { remotePath: 'public_html/blog' } });
    // Kayit dogru dosyayi gosterir
    expect(svc.appliedFixMock.topluKaydet).toHaveBeenCalledWith([expect.objectContaining({ status: 'APPLIED', detail: { remoteDir: 'public_html/blog', filename: 'x.html' } })]);
  });

  it('.php / .htm sayfa: adaptor yalniz "<ad>.html" yazar — yazilmaz, elle uygulama nedeni (snippet yonergesiyle)', async () => {
    serveStatic();
    for (const url of ['https://site.com/iletisim.php', 'https://site.com/hakkimizda.htm']) {
      const svc = build({ host: '185.10.20.30' });
      const r = await svc.write('s1', url, SNIPPETS);
      expect(r, url).toMatchObject({ ok: false, manual: true });
      expect(r.error, url).toContain('.html dosyasına karşılık gelmiyor');
      expect(r.error, url).toContain("Snippet'leri aşağıdaki kartlardan kopyalayıp");
      // Takili sayfa ekranina ait yonerge bu akista gosterilmez
      expect(r.error, url).not.toContain('Takılı Sayfalar');
      expect(svc.appliedFixMock.topluKaydet).not.toHaveBeenCalled();
    }
    expect(published).toHaveLength(0);
  });

  it('anasayfa yazilmaz ("/" eskiden index.html\'e yaziliyordu)', async () => {
    serveStatic();
    for (const url of ['https://site.com/', 'https://site.com', 'https://site.com/index.html']) {
      const r = await build({ host: '185.10.20.30' }).write('s1', url, SNIPPETS);
      expect(r, url).toMatchObject({ ok: false, manual: true });
      expect(r.error, url).toContain('Anasayfa otomatik yazılmaz');
    }
    expect(published).toHaveLength(0);
  });

  it('uzantisiz adres: .html dosyasi okunup dogrulanir, o dosya yazilir', async () => {
    serveStatic();
    const r = await build({ host: '185.10.20.30' }).write('s1', 'https://site.com/hakkimizda', SNIPPETS);
    expect(r).toMatchObject({ ok: true, remoteDir: 'public_html', filename: 'hakkimizda.html' });
    expect(fetchMock.mock.calls.map((c) => c[0])).toEqual(['https://site.com/hakkimizda', 'https://site.com/hakkimizda.html']);
  });

  it('klasor adresi /blog/yazi/ → <klasor>/yazi/index.html', async () => {
    serveStatic();
    const r = await build({ host: '185.10.20.30' }, 'https://site.com', { remotePath: 'public_html/blog' }).write('s1', 'https://site.com/blog/yazi/', SNIPPETS);
    expect(r).toMatchObject({ ok: true, remoteDir: 'public_html/blog/yazi', filename: 'index.html' });
    expect(published[0]).toMatchObject({ slug: 'index', cfg: { remotePath: 'public_html/blog/yazi' } });
  });

  it('hedef klasoru disindaki adres yazilmaz', async () => {
    serveStatic();
    const r = await build({ host: '185.10.20.30' }, 'https://site.com', { remotePath: 'public_html/blog' }).write('s1', 'https://site.com/hakkimizda.html', SNIPPETS);
    expect(r).toMatchObject({ ok: false, manual: true });
    expect(r.error).toContain('klasörüne');
    expect(published).toHaveLength(0);
  });

  it('dinamik uretilen sayfa (dosya tarihi yok / PHP / cerez / farkli icerik) yazilmaz, kayit tutulmaz', async () => {
    const cases: Array<[string, Record<string, string>, string | undefined]> = [
      ['Last-Modified', { 'content-type': 'text/html; charset=utf-8' }, undefined],
      ['X-Powered-By', { ...STATIC, 'x-powered-by': 'PHP/8.2' }, undefined],
      ['çerez', { ...STATIC, 'set-cookie': 'PHPSESSID=abc; path=/' }, undefined],
      ['aynı değil', STATIC, HTML.replace('Eski', 'Eski (dosya)')],
    ];
    for (const [needle, headers, fileText] of cases) {
      fetchMock.mockReset();
      fetchMock.mockImplementation(async (url: string) => res({
        status: 200, url, headers, text: fileText && url.endsWith('.html') && fetchMock.mock.calls.length > 1 ? fileText : HTML,
      }));
      const svc = build({ host: '185.10.20.30' });
      const r = await svc.write('s1', PAGE_URL, SNIPPETS);
      expect(r, needle).toMatchObject({ ok: false, manual: true });
      expect(r.error, needle).toContain('doğrulanamadı');
      expect(r.error, needle).toContain(needle);
      expect(svc.appliedFixMock.topluKaydet, needle).not.toHaveBeenCalled();
    }
    expect(published).toHaveLength(0);
  });

  it('CMS: WordPress izi tasiyan sayfa, platform tahmini ya da WordPress hedefi varken yazilmaz', async () => {
    serveStatic(HTML.replace('</head>', '<link rel="stylesheet" href="/wp-content/themes/x/style.css"></head>'));
    const a = await build({ host: '185.10.20.30' }).write('s1', PAGE_URL, SNIPPETS);
    expect(a).toMatchObject({ ok: false, manual: true });
    expect(a.error).toContain('WordPress tarafından üretiliyor');

    serveStatic();
    const b = await build({ host: '185.10.20.30' }, 'https://site.com', { platform: 'wordpress' }).write('s1', PAGE_URL, SNIPPETS);
    expect(b.error).toContain('WordPress tarafından üretiliyor');

    fetchMock.mockClear();
    const c = await build({}, 'https://site.com', { targets: [{ type: 'WORDPRESS_REST', config: {} }] }).write('s1', PAGE_URL, SNIPPETS);
    expect(c).toMatchObject({ ok: false, manual: true });
    expect(c.error).toContain('WordPress ile yönetilen sayfalarda');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(published).toHaveLength(0);
  });

  it('dosya hedefi yoksa sayfa okunmadan neden doner', async () => {
    const r = await build({}, 'https://site.com', { targets: [] }).write('s1', PAGE_URL, SNIPPETS);
    expect(r).toMatchObject({ ok: false, manual: true });
    expect(r.error).toContain('FTP, SFTP ya da cPanel');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('yonlendirme sonrasi SON adres eslenir', async () => {
    // /eski.html → /yeni.html'e yonleniyor: yazilacak dosya yeni.html
    fetchMock.mockImplementation(async (url: string) => (url === 'https://site.com/eski.html'
      ? res({ status: 200, url: 'https://site.com/yeni.html', redirected: true, text: HTML, headers: STATIC })
      : res({ status: 200, url, text: HTML, headers: STATIC })));
    const r = await build({ host: '185.10.20.30' }).write('s1', 'https://site.com/eski.html', SNIPPETS);
    expect(r).toMatchObject({ ok: true, filename: 'yeni.html', fileUrl: 'https://site.com/yeni.html' });
  });

  it('gorsel alt metni: dogrulanamayan dosyaya yazilmaz; gorseller "degisti" sayilmaz', async () => {
    serveStatic(HTML, { 'content-type': 'text/html; charset=utf-8' });
    const r = await build({ host: '185.10.20.30' }).writeImageAlts('s1', PAGE_URL, [{ id: 'i1', srcRaw: '/a.jpg', src: 'https://site.com/a.jpg', alt: 'Yeni alt' }]);
    expect(r).toMatchObject({ ok: false, manual: true });
    expect(r.error).toContain('Alt metnini sayfanın HTML kodunda elle güncelle.');
    expect(r.perImage.i1).toMatchObject({ changed: false, reason: 'manual' });
    expect(published).toHaveLength(0);
  });

  it('gorsel alt metni: dogrulanmis statik dosyaya cerrahi yama yazilir', async () => {
    serveStatic();
    const r = await build({ host: '185.10.20.30' }).writeImageAlts('s1', PAGE_URL, [{ id: 'i1', srcRaw: '/a.jpg', src: 'https://site.com/a.jpg', alt: 'Yeni alt' }]);
    expect(r).toMatchObject({ ok: true, remoteDir: 'public_html', filename: 'hakkimizda.html' });
    expect(r.perImage.i1.changed).toBe(true);
    expect(published[0].bodyHtml).toContain('alt="Yeni alt"');
  });
});
