import { describe, it, expect } from 'vitest';
import {
  cmsFromHtml, locateStaticFile, planStaticWrite, staticFileProblem, type StaticFileProbe,
} from './stuck-page-static-write.js';

/**
 * RanksUp disi takili sayfa — tam sayfa HTML'i yalniz dogrulanmis statik
 * .html dosyasinin yerine yazilir; CMS'te oneri elle uygulanir.
 */

const SITE = 'https://www.ornek.com';
const STATIC_HTML = '<!doctype html><html><head><meta charset="utf-8"><title>Yazı</title></head><body><article><p>Metin</p></article></body></html>';
const ftp = (remotePath: unknown = '/public_html/blog') => ({ type: 'FTP', config: { remotePath } });

describe('planStaticWrite — hedef secimi', () => {
  it.each([
    ['WORDPRESS_REST', 'WordPress'],
    ['WORDPRESS_XMLRPC', 'WordPress'],
    ['KOBIPRATIK', 'KobiPratik'],
    ['CUSTOM_PHP', 'Özel PHP uç noktası'],
  ])('%s hedefinde yazim yok, elle uygula nedeni', (type, label) => {
    const plan = planStaticWrite({ targets: [{ type, config: {} }], siteUrl: SITE, platform: null, pageUrl: `${SITE}/blog/yazi/`, html: STATIC_HTML });
    expect(plan.kind).toBe('manual');
    expect((plan as any).reason).toContain(`${label} ile yönetilen sayfalarda değişiklik otomatik yazılmaz`);
    expect((plan as any).reason).toContain('elle uygula');
  });

  it('hic hedef yoksa (ya da yalniz indirilebilir ZIP) neden: dosya hedefi yok', () => {
    for (const targets of [[], [{ type: 'MARKDOWN_ZIP', config: {} }]]) {
      const plan = planStaticWrite({ targets, siteUrl: SITE, platform: null, pageUrl: `${SITE}/blog/yazi.html`, html: STATIC_HTML });
      expect(plan).toEqual({ kind: 'manual', reason: expect.stringContaining('FTP, SFTP ya da cPanel yayın hedefiyle bağlı statik HTML sitelerde') });
    }
  });

  it('dosya hedefi olsa da site bir CMS ise (hedef, platform tahmini ya da sayfa izi) yazilmaz', () => {
    const page = { siteUrl: SITE, pageUrl: `${SITE}/blog/yazi.html` };
    const cases = [
      planStaticWrite({ ...page, targets: [ftp(), { type: 'WORDPRESS_REST', config: {} }], platform: null, html: STATIC_HTML }),
      planStaticWrite({ ...page, targets: [ftp()], platform: 'wordpress', html: STATIC_HTML }),
      planStaticWrite({ ...page, targets: [ftp()], platform: null, html: STATIC_HTML.replace('</head>', '<link rel="stylesheet" href="/wp-content/themes/x/style.css"></head>') }),
    ];
    for (const plan of cases) {
      expect(plan.kind).toBe('manual');
      expect((plan as any).reason).toContain('WordPress tarafından üretiliyor');
    }
  });

  it('Cloudflare eklemeli HTML (okunan metin sunucudaki dosya degil) yazilmaz', () => {
    const html = STATIC_HTML.replace('</body>', '<script src="/cdn-cgi/scripts/5c5dd728/cloudflare-static/email-decode.min.js"></script></body>');
    const plan = planStaticWrite({ targets: [ftp()], siteUrl: SITE, platform: null, pageUrl: `${SITE}/blog/yazi.html`, html });
    expect((plan as any).reason).toContain('Cloudflare');
  });

  it('temiz statik sitede varsayilan dosya hedefine eslenmis konum doner', () => {
    const sftp = { type: 'SFTP', config: { remotePath: 'public_html' } };
    const plan = planStaticWrite({ targets: [sftp, ftp()], siteUrl: SITE, platform: 'cpanel-static', pageUrl: 'https://ornek.com/hakkimizda.html', html: STATIC_HTML });
    expect(plan).toEqual({
      kind: 'write',
      target: sftp,
      location: { fileUrl: 'https://ornek.com/hakkimizda.html', remoteDir: 'public_html', slug: 'hakkimizda' },
    });
  });
});

describe('locateStaticFile — adres → dosya', () => {
  const at = (pageUrl: string, remotePath: unknown = '/public_html/blog') => locateStaticFile({ pageUrl, siteUrl: SITE, remotePath });

  it('RanksUp makale adresleriyle ayni esleme: klasor kokten sonra URL yolu', () => {
    expect(at('https://www.ornek.com/blog/yazi.html')).toEqual({ fileUrl: 'https://www.ornek.com/blog/yazi.html', remoteDir: '/public_html/blog', slug: 'yazi' });
    expect(at('https://ornek.com/blog/yazi/')).toEqual({ fileUrl: 'https://ornek.com/blog/yazi/index.html', remoteDir: '/public_html/blog/yazi', slug: 'index' });
    // Uzantisiz adres (cPanel MultiViews): dogrulama .html dosyasini okur
    expect(at('https://ornek.com/blog/yazi')).toEqual({ fileUrl: 'https://ornek.com/blog/yazi.html', remoteDir: '/public_html/blog', slug: 'yazi' });
    // Turkce harfli adres dosya adina cozulur
    expect(at('https://ornek.com/blog/%C3%A7ay-rehberi.html')).toMatchObject({ slug: 'çay-rehberi', fileUrl: 'https://ornek.com/blog/%C3%A7ay-rehberi.html' });
    expect(at('https://ornek.com/hizmet/seo.html', 'htdocs')).toEqual({ fileUrl: 'https://ornek.com/hizmet/seo.html', remoteDir: 'htdocs/hizmet', slug: 'seo' });
  });

  it('esleme guvensizse neden doner', () => {
    expect((at('https://ornek.com/') as any).reason).toContain('Anasayfa');
    expect((at('https://ornek.com/index.html', 'public_html') as any).reason).toContain('Anasayfa');
    expect((at('https://ornek.com/blog/yazi.php') as any).reason).toContain('.php');
    expect((at('https://ornek.com/blog/yazi.HTML') as any).reason).toContain('.HTML');
    expect((at('https://ornek.com/hakkimizda.html') as any).reason).toContain('klasörüne (/public_html/blog → /blog/)');
    // Kok isareti klasor sinirinda: SFTP yer tutucusundaki tam yol URL'ye eslenmez (elle)
    expect((at('https://ornek.com/blog/yazi.html', '/home/user/public_html/blog') as any).reason).toContain('dışında');
    expect((at('https://ornek.com/blog/yazi.html', '') as any).reason).toContain('Remote path');
    expect((at('https://ornek.com/blog/yazi.html', '/') as any).reason).toContain('Remote path');
    expect((locateStaticFile({ pageUrl: 'https://ornek.com/blog/yazi.html', siteUrl: SITE, remotePath: undefined }) as any).reason).toContain('Remote path');
  });

  it('yol gecisi ve garip parcalar reddedilir', () => {
    // Nokta parcalarini URL ayristiricisi cozer ("/blog/%2e%2e/x.html" → "/x.html"): dosya yoluna ".." hic ulasmaz
    expect(at('https://ornek.com/blog/%2e%2e/blog/x.html')).toMatchObject({ remoteDir: '/public_html/blog', slug: 'x' });
    for (const bad of ['https://ornek.com/blog/a%2Fb.html', 'https://ornek.com/blog/a%5Cb.html', 'https://ornek.com/blog//x.html', 'https://ornek.com/blog/%00x.html', 'https://ornek.com/blog/%E0%A4%A.html', 'https://ornek.com/blog/.html']) {
      expect((at(bad) as any).reason, bad).toContain('güvenli bir dosya yoluna');
    }
  });

  it('yalniz sitenin kendi alan adi (www farki serbest; alt alan ve baska alan yok)', () => {
    expect(at('https://ornek.com/blog/x.html')).toHaveProperty('slug', 'x');
    expect((at('https://blog.ornek.com/blog/x.html') as any).reason).toContain('kendi alan adında değil');
    expect((at('https://baska.com/blog/x.html') as any).reason).toContain('kendi alan adında değil');
    expect((locateStaticFile({ pageUrl: 'https://ornek.com/blog/x.html', siteUrl: null, remotePath: '/public_html/blog' }) as any).reason).toContain('kendi alan adında değil');
  });
});

describe('staticFileProblem — sayfayi bu dosya mi sunuyor', () => {
  const FILE = 'https://ornek.com/blog/yazi.html';
  const probe = (p: Partial<Exclude<StaticFileProbe, { error: string }>> = {}): StaticFileProbe => ({
    ok: true, status: 200, url: FILE, redirected: false, contentType: 'text/html',
    headers: { 'last-modified': 'Tue, 01 Sep 2026 10:00:00 GMT', etag: '"abc"' }, text: STATIC_HTML, truncated: false, binary: false, ...p,
  });

  it('birebir ayni statik dosya: sorun yok (Cloudflare cerezi dinamik sayilmaz)', () => {
    expect(staticFileProblem(probe(), FILE, STATIC_HTML)).toBeNull();
    expect(staticFileProblem(probe({ headers: { 'last-modified': 'x', 'set-cookie': '__cf_bm=abc; Expires=Wed, 21 Oct 2026 07:28:00 GMT; Path=/' } }), FILE, STATIC_HTML)).toBeNull();
  });

  it.each([
    ['okuma hatasi', { error: 'dosya adresi okunamadı (timeout)' } as StaticFileProbe, 'okunamadı (timeout)'],
    ['yonlendirme', probe({ redirected: true, url: 'https://ornek.com/blog/yazi/' }), 'yönlendiriyor'],
    ['404', probe({ ok: false, status: 404 }), 'HTTP 404'],
    ['HTML degil', probe({ contentType: 'application/json' }), 'HTML sayfası değil'],
    ['kesik', probe({ truncated: true }), '2 MB'],
    ['icerik farkli (dinamik ya da arada degisti)', probe({ text: STATIC_HTML.replace('Metin', 'Yeni metin') }), 'aynı değil'],
    ['Last-Modified yok', probe({ headers: {} }), 'Last-Modified'],
    ['oturum cerezi', probe({ headers: { 'last-modified': 'x', 'set-cookie': 'PHPSESSID=1; path=/, __cf_bm=2; path=/' } }), 'PHPSESSID'],
    ['uygulama sunucusu', probe({ headers: { 'last-modified': 'x', 'x-powered-by': 'PHP/8.2.1' } }), 'PHP/8.2.1'],
  ])('%s → otomatik yazilmaz', (_ad, p, beklenen) => {
    const r = staticFileProblem(p, FILE, STATIC_HTML);
    expect(r).toContain(beklenen);
    expect(r).toContain('elle uygula');
  });
});

describe('cmsFromHtml', () => {
  it('generator etiketi (oznitelik sirasi fark etmez) ve bilinen izler', () => {
    expect(cmsFromHtml('<meta content="WordPress 6.6" name="generator">')).toBe('Wordpress');
    expect(cmsFromHtml('<meta name="generator" content="Joomla! - Open Source Content Management">')).toBe('Joomla');
    expect(cmsFromHtml('<script src="/media/jui/js/jquery.min.js"></script>')).toBe('Joomla');
    expect(cmsFromHtml('<script>jQuery.extend(Drupal.settings, {})</script>')).toBe('Drupal');
  });

  it('statik site uretecleri ve sade HTML CMS sayilmaz', () => {
    expect(cmsFromHtml('<meta name="generator" content="Hugo 0.128.0">')).toBeNull();
    expect(cmsFromHtml(STATIC_HTML)).toBeNull();
  });
});
