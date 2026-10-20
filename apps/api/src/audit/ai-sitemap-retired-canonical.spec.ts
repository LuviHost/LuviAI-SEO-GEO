import { describe, it, expect, vi } from 'vitest';

vi.mock('../prisma/prisma.service.js', () => ({ PrismaService: class {} }));
const { advertisedArticleEntry, flagRetiredCanonicalCopies, fullPageCanonicalUrl } = await import('./ai-sitemap.service.js');
const { LIVENESS_MISSING_REASON } = await import('../articles/republish-policy.js');

/**
 * canli-oncesi-21 madde 3 — emekli kopyanin adresini canonical bildiren tam sayfa kopyasi.
 *
 * NEDEN VAR: dosya kopyasinin (FTP / SFTP / cPanel / GitHub) sayfasina yazilan canonical yazinin
 * ilan edilen adresidir (fullPageCanonicalUrl); bu cogu zaman WordPress kopyasidir. WordPress
 * kopyasi emekliye ayrilinca (canlilik denetimi: adres iki kez 404; yayinci: cop kutusu /
 * silinmis) site haritasi dosya kopyasini ilan etmeye baslar, dosya sayfasi ise hala 404 veren
 * adresi kanonik bildirir. Boyle kopya "elle guncelleme bekliyor" diye isaretlenir: hedefe
 * yeniden yayin sayfayi bugunku canonical'la yeniden yazar.
 */

const site = new URL('https://site.com');
const SLUG = 'my-post';
const WP_URL = 'https://site.com/my-post/';
const FTP_URL = 'https://site.com/blog/my-post.html';
const NOW = '2026-10-20T05:20:00.000Z';
const targets = new Map([
  ['wp', { type: 'WORDPRESS_REST', config: {} }],
  ['ftp', { type: 'FTP', config: { remotePath: '/blog' } }],
  ['gh', { type: 'GITHUB', config: {} }],
  ['zip', { type: 'MARKDOWN_ZIP', config: {} }],
]);
const wp = { targetId: 'wp', targetType: 'WORDPRESS_REST', ok: true, externalUrl: WP_URL, remoteStatus: 'publish' };
const ftp = (over: Record<string, unknown> = {}) => ({ targetId: 'ftp', targetType: 'FTP', ok: true, externalUrl: 'ftp://h/blog/my-post.html', contentHash: 'h1', ...over });
const retire = (e: Record<string, unknown>) => ({ ...e, missingAt: NOW, missingReason: LIVENESS_MISSING_REASON });
const flag = (before: unknown[], after: unknown[]) => flagRetiredCanonicalCopies({ site, slug: SLUG, before, after, targets, now: NOW });

describe('flagRetiredCanonicalCopies', () => {
  it('reviewer senaryosu: FTP sayfasinin canonical\'i WordPress; WordPress emekliye ayrilinca site haritasi FTP\'yi ilan eder, FTP isaretlenir', () => {
    const before = [wp, ftp({ canonicalUrl: WP_URL })];
    expect(fullPageCanonicalUrl(site, SLUG, before, targets, { id: 'ftp', type: 'FTP', config: { remotePath: '/blog' } })).toBe(WP_URL);
    const after = [retire(wp), before[1]];
    expect(advertisedArticleEntry(site, SLUG, after, targets)?.url).toBe(FTP_URL);
    const r = flag(before, after);
    expect(r.flagged).toEqual(['ftp']);
    expect(r.publishedTo[1]).toEqual({ ...before[1], manualUpdatePending: true, manualUpdatePendingSince: NOW });
    // Emekli kayit ve girdi degismez
    expect(r.publishedTo[0]).toBe(after[0]);
    expect(after[1]).not.toHaveProperty('manualUpdatePending');
  });

  it('kendi adresini (ya da hic) canonical bildiren sayfa isaretlenmez', () => {
    for (const canonicalUrl of [FTP_URL, null]) {
      const before = [wp, ftp({ canonicalUrl })];
      const r = flag(before, [retire(wp), before[1]]);
      expect(r.flagged).toEqual([]);
      expect(r.publishedTo[1]).toBe(before[1]);
    }
  });

  it('canonical kaydi olmayan eski kopya: emeklilikten onceki listeyle bugun yazilacak canonical sayilir', () => {
    const before = [wp, ftp()];
    expect(flag(before, [retire(wp), before[1]]).flagged).toEqual(['ftp']);
  });

  it('GitHub sayfasi da (canonical ilan edilen adres) isaretlenir; Markdown ZIP disa aktarimi ve CMS kopyalari degil', () => {
    const gh = { targetId: 'gh', targetType: 'GITHUB', ok: true, externalUrl: 'https://github.com/o/r/blob/main/my-post.html', canonicalUrl: WP_URL };
    const zip = { targetId: 'zip', targetType: 'MARKDOWN_ZIP', ok: true, externalUrl: '/srv/x.zip', canonicalUrl: WP_URL };
    const before = [wp, ftp({ canonicalUrl: WP_URL }), gh, zip];
    const r = flag(before, [retire(wp), ...before.slice(1)]);
    expect(r.flagged).toEqual(['ftp', 'gh']);
    expect(r.publishedTo[3]).toBe(zip);
  });

  it('ilan edilen adres degismediyse ya da ilan edilen kopya canli kaldiysa hicbir sey degismez', () => {
    // Emekliye ayrilan kopya ilan edilen degil (baska bir WordPress kopyasi ilan ediliyor)
    const wp2 = { ...wp, targetId: 'wp2', externalUrl: 'https://site.com/eski/' };
    const before = [wp, wp2, ftp({ canonicalUrl: WP_URL })];
    const after = [wp, retire(wp2), before[2]];
    expect(flag(before, after)).toEqual({ publishedTo: after, flagged: [] });
    // Hicbir emeklilik yok
    expect(flag(before, before).flagged).toEqual([]);
  });

  it('zaten isaretli kopyanin ilk isaret ani korunur (yeniden isaretlenmez)', () => {
    const marked = ftp({ canonicalUrl: WP_URL, manualUpdatePending: true, manualUpdatePendingSince: '2026-10-01T00:00:00.000Z' });
    const before = [wp, marked];
    const r = flag(before, [retire(wp), marked]);
    expect(r.flagged).toEqual([]);
    expect(r.publishedTo[1]).toBe(marked);
  });
});
