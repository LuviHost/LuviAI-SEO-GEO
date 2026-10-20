import { describe, it, expect } from 'vitest';
import { resolveArticleUrl } from './article-url.util.js';
import { advertisedArticleEntry, fullPageCanonicalUrl } from '../audit/ai-sitemap.service.js';

/**
 * Dosya hedefinin (FTP / SFTP / cPanel) klasor yolundan sayfanin adresi.
 *
 * NEDEN (canli oncesi inceleme 21, r2): yalniz BASTAKI kok dizini atiliyor ve bolum kucuk
 * harfe cevriliyordu. SFTP formunun ornek yolu /home/user/public_html/blog adresi
 * https://site.com/home/user/public_html/blog/yazi.html yapiyordu; public_html/Rehber ise
 * /rehber/... (harf duyarli sunucuda 404). Bu adres site haritasi, llms, persona, JSON-LD ve
 * canonical icin tek kaynak.
 */
const SITE = 'https://site.com';
const dosya = (type: string, remotePath: string | undefined) => ({ type, config: remotePath === undefined ? {} : { remotePath } });

describe('resolveArticleUrl — dosya hedefi klasoru', () => {
  it('son kok parcasina kadar (dahil) atilir: cPanel, DirectAdmin, Plesk, Debian, nginx duzenleri', () => {
    const want = `${SITE}/blog/yazi.html`;
    for (const remotePath of [
      '/home/user/public_html/blog',
      '/var/www/site.com/public_html/blog',
      '/var/www/html/blog',
      '/home/user/domains/site.com/public_html/blog',
      '/var/www/vhosts/site.com/httpdocs/blog',
      '/var/www/site.com/html/blog',
      '/opt/lampp/htdocs/blog',
      '/site/wwwroot/blog',
      '/home/user/www/blog',
      '~/public_html/blog',
    ]) {
      for (const type of ['SFTP', 'FTP', 'CPANEL_API']) {
        expect(resolveArticleUrl(SITE, 'yazi', dosya(type, remotePath)), `${type} ${remotePath}`).toEqual({ url: want, sectionPath: '/blog' });
      }
    }
  });

  it('sitenin alan adini tasiyan klasor kok sayilir (cPanel eklenti alani, nginx /var/www/<alan>)', () => {
    expect(resolveArticleUrl(SITE, 'yazi', dosya('SFTP', '/home/user/site.com/blog')).url).toBe(`${SITE}/blog/yazi.html`);
    expect(resolveArticleUrl(SITE, 'yazi', dosya('SFTP', '/var/www/www.site.com/blog')).url).toBe(`${SITE}/blog/yazi.html`);
    expect(resolveArticleUrl(SITE, 'yazi', dosya('FTP', 'public_html/site.com')).url).toBe(`${SITE}/yazi.html`);
  });

  it('klasorun harfleri korunur (harf duyarli sunucu)', () => {
    expect(resolveArticleUrl(SITE, 'yazi', dosya('FTP', 'public_html/Rehber'))).toEqual({ url: `${SITE}/Rehber/yazi.html`, sectionPath: '/Rehber' });
    expect(resolveArticleUrl(SITE, 'yazi', dosya('SFTP', '/home/u/public_html/Blog/Yazilar')).url).toBe(`${SITE}/Blog/Yazilar/yazi.html`);
  });

  it('kok parcasi olmayan dosya sistemi yolunda adres tahmin edilmez (null)', () => {
    for (const remotePath of ['/home/user/blog', '/var/www/blog', '/srv/site/blog', '/home2/user/blog', '~/blog']) {
      expect(resolveArticleUrl(SITE, 'yazi', dosya('SFTP', remotePath)), remotePath).toEqual({ url: null, sectionPath: null });
    }
  });

  it('bugunku olagan ayarlar degismez', () => {
    const r = (type: string, p: string | undefined) => resolveArticleUrl(`${SITE}/`, 'yazi', dosya(type, p)).url;
    expect(r('CPANEL_API', 'public_html/blog')).toBe(`${SITE}/blog/yazi.html`);
    expect(r('FTP', '/public_html/blog')).toBe(`${SITE}/blog/yazi.html`);
    expect(r('FTP', '/blog')).toBe(`${SITE}/blog/yazi.html`);
    expect(r('FTP', 'blog/')).toBe(`${SITE}/blog/yazi.html`);
    expect(r('SFTP', '/a/b')).toBe(`${SITE}/a/b/yazi.html`);
    expect(r('FTP', 'www/blog')).toBe(`${SITE}/blog/yazi.html`);
    expect(r('FTP', '/public_html')).toBe(`${SITE}/yazi.html`);
    expect(r('FTP', '/')).toBe(`${SITE}/yazi.html`);
    expect(r('FTP', undefined)).toBe(`${SITE}/yazi.html`);
  });

  it('dosya hedefi olmayanlarda eski kural (URL yolu oneki; kucuk harf)', () => {
    expect(resolveArticleUrl(SITE, 'yazi', { type: 'KOBIPRATIK', config: { defaultPathPrefix: '/Pratik-Kobi-Rehberi' } }))
      .toEqual({ url: `${SITE}/pratik-kobi-rehberi/yazi`, sectionPath: '/pratik-kobi-rehberi' });
    expect(resolveArticleUrl(SITE, 'yazi', { type: 'WORDPRESS_REST', config: {} }).url).toBe(`${SITE}/yazi`);
    expect(resolveArticleUrl(SITE, 'yazi', null).url).toBe(`${SITE}/yazi`);
  });
});

/** Inceleyicinin ornegi: ilan edilen adres ve ilk yayindaki canonical ayni kuraldan */
describe('ilan edilen adres / canonical — sunucu yolu remotePath', () => {
  const site = new URL(SITE);
  const cases: Array<[string, string | null]> = [
    ['/home/user/public_html/blog', `${SITE}/blog/my-post.html`],
    ['/var/www/site.com/public_html/blog', `${SITE}/blog/my-post.html`],
    ['/var/www/html/blog', `${SITE}/blog/my-post.html`],
    ['public_html/Rehber', `${SITE}/Rehber/my-post.html`],
    ['/home/user/blog', null],
  ];
  for (const [remotePath, want] of cases) {
    for (const type of ['SFTP', 'FTP']) {
      it(`${type} ${remotePath} → ${want ?? 'adres yok'}`, () => {
        const t = { id: 't1', type, config: { remotePath } };
        const targets = new Map([[t.id, { type, config: t.config }]]);
        const rec = type === 'SFTP' ? `${remotePath}/my-post.html` : `ftp://h/${remotePath.replace(/^\//, '')}/my-post.html`;
        const pt = [{ targetId: 't1', targetType: type, ok: true, externalUrl: rec }];
        expect(advertisedArticleEntry(site, 'my-post', pt, targets)?.url ?? null).toBe(want);
        expect(fullPageCanonicalUrl(site, 'my-post', [], targets, t)).toBe(want);
      });
    }
  }
});
