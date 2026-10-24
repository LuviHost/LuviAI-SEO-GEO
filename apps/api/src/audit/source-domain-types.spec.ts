import { describe, it, expect } from 'vitest';
import {
  buildCompetitorMatchers, classifySource, hostOf, isPlatformHost, SOURCE_TYPE_LISTS, SOURCE_TYPES, type SourceTypeContext,
} from './source-domain-types.js';
import { registrableDomain } from './host-match.js';

/**
 * Alintilanan kaynak TURU sezgiseli — tek modul. Listeler kurate; buradaki
 * ornekler "rapor hangi satiri hangi eylemle gosterir" sozlesmesidir.
 */

const ctx: SourceTypeContext = { ownHost: 'ornek.com.tr', competitors: buildCompetitorMatchers(['https://www.rakip.com/', 'https://shop.digerrakip.io']) };
const type = (u: string, c: SourceTypeContext = ctx) => classifySource(u, c)?.type;
const key = (u: string, c: SourceTypeContext = ctx) => classifySource(u, c)?.key;

describe('hostOf', () => {
  it('www, buyuk harf ve semasiz girdi', () => {
    expect(hostOf('https://WWW.Ornek.com/x?y=1')).toBe('ornek.com');
    expect(hostOf('ornek.com.tr')).toBe('ornek.com.tr');
    expect(hostOf('')).toBeNull();
    expect(hostOf('localhost')).toBeNull();
    expect(hostOf(null)).toBeNull();
  });
});

describe('classifySource — kendi site ve rakip', () => {
  it('kendi site ve alt alanlari own; anahtar sitenin host\'u', () => {
    expect(type('https://ornek.com.tr/blog/x')).toBe('own');
    expect(type('https://www.ornek.com.tr/')).toBe('own');
    expect(type('https://blog.ornek.com.tr/a')).toBe('own');
    expect(key('https://blog.ornek.com.tr/a')).toBe('ornek.com.tr');
  });

  it('benzer ama farkli alan own DEGIL (etiket siniri)', () => {
    expect(type('https://notornek.com.tr/')).toBe('other');
    expect(type('https://ornek.com.tr.evil.net/')).toBe('other');
  });

  it('rakip host\'u ve alt alanlari competitor; rakip alt alanda tanimliysa ust alan rakip sayilmaz', () => {
    expect(type('https://rakip.com/fiyat')).toBe('competitor');
    expect(type('https://destek.rakip.com/')).toBe('competitor');
    expect(key('https://destek.rakip.com/')).toBe('rakip.com');
    expect(type('https://shop.digerrakip.io/x')).toBe('competitor');
    expect(type('https://digerrakip.io/')).toBe('other');
  });

  it('platform alt alanindaki site (myshop.myshopify.com) own olunca ust alan own olmaz', () => {
    const c = { ownHost: 'magazam.myshopify.com', competitors: [] };
    expect(type('https://magazam.myshopify.com/urun', c)).toBe('own');
    expect(type('https://baskasi.myshopify.com/', c)).toBe('other');
    expect(key('https://baskasi.myshopify.com/', c)).toBe('myshopify.com');
  });

  it('own, listedeki bir siteden once gelir (reddit.com sahibiyse own)', () => {
    expect(type('https://reddit.com/r/x', { ownHost: 'reddit.com', competitors: [] })).toBe('own');
  });
});

describe('classifySource — turler', () => {
  it.each([
    ['https://www.reddit.com/r/turkey/comments/x', 'forum', 'reddit.com'],
    ['https://old.reddit.com/r/x', 'forum', 'reddit.com'],
    ['https://eksisozluk.com/baslik--123', 'forum', 'eksisozluk.com'],
    ['https://forum.donanimhaber.com/x', 'forum', 'forum.donanimhaber.com'],
    ['https://www.donanimhaber.com/haber-x', 'news', 'donanimhaber.com'],
    ['https://www.technopat.net/2026/10/x', 'news', 'technopat.net'],
    ['https://stackoverflow.com/questions/1', 'forum', 'stackoverflow.com'],
    ['https://unix.stackexchange.com/q/1', 'forum', 'stackexchange.com'],
    ['https://news.ycombinator.com/item?id=1', 'forum', 'news.ycombinator.com'],
    ['https://www.g2.com/products/x/reviews', 'review', 'g2.com'],
    ['https://www.capterra.com/p/1/x/', 'review', 'capterra.com'],
    ['https://www.sikayetvar.com/marka', 'review', 'sikayetvar.com'],
    ['https://tr.trustpilot.com/review/x', 'review', 'trustpilot.com'],
    ['https://www.producthunt.com/products/x', 'review', 'producthunt.com'],
    ['https://alternativeto.net/software/x/', 'review', 'alternativeto.net'],
    ['https://www.youtube.com/watch?v=1', 'video', 'youtube.com'],
    ['https://m.youtube.com/watch?v=1', 'video', 'youtube.com'],
    ['https://youtu.be/abc', 'video', 'youtu.be'],
    ['https://vimeo.com/1', 'video', 'vimeo.com'],
    ['https://www.tiktok.com/@marka/video/1', 'social', 'tiktok.com'],
    ['https://www.linkedin.com/pulse/x', 'social', 'linkedin.com'],
    ['https://x.com/marka/status/1', 'social', 'x.com'],
    ['https://twitter.com/marka', 'social', 'twitter.com'],
    ['https://www.instagram.com/p/1', 'social', 'instagram.com'],
    ['https://tr-tr.facebook.com/marka', 'social', 'facebook.com'],
    ['https://tr.wikipedia.org/wiki/X', 'encyclopedia', 'wikipedia.org'],
    ['https://en.m.wikipedia.org/wiki/X', 'encyclopedia', 'wikipedia.org'],
    ['https://webrazzi.com/2026/10/x', 'news', 'webrazzi.com'],
    ['https://www.chip.com.tr/haber/x', 'news', 'chip.com.tr'],
    ['https://www.hurriyet.com.tr/ekonomi/x', 'news', 'hurriyet.com.tr'],
    ['https://www.bbc.co.uk/news/x', 'news', 'bbc.co.uk'],
    ['https://techcrunch.com/2026/x', 'news', 'techcrunch.com'],
    ['https://apps.apple.com/tr/app/x/id123', 'marketplace', 'apps.apple.com'],
    ['https://play.google.com/store/apps/details?id=x', 'marketplace', 'play.google.com'],
    ['https://www.trendyol.com/x', 'marketplace', 'trendyol.com'],
    ['https://www.amazon.com.tr/dp/1', 'marketplace', 'amazon.com.tr'],
    ['https://developers.google.com/search/docs', 'docs', 'developers.google.com'],
    ['https://platform.openai.com/docs/x', 'docs', 'platform.openai.com'],
    ['https://docs.stripe.com/api', 'docs', 'docs.stripe.com'],
    ['https://developer.paypal.com/x', 'docs', 'developer.paypal.com'],
    ['https://community.hubspot.com/t5/x', 'forum', 'community.hubspot.com'],
  ])('%s → %s (%s)', (url, t, k) => {
    expect(classifySource(url, ctx)).toEqual({ type: t, key: k });
  });

  it('ycombinator.com koku forum degil; news.ycombinator.com forum. gartner.com other', () => {
    expect(classifySource('https://www.ycombinator.com/companies/x', ctx)).toEqual({ type: 'other', key: 'ycombinator.com' });
    expect(type('https://news.ycombinator.com/item?id=1')).toBe('forum');
    expect(classifySource('https://www.gartner.com/reviews/x', ctx)).toEqual({ type: 'other', key: 'gartner.com' });
  });

  it('barindirma platformu alt alanlari tam host\'la ayri satir (farkli yayinci)', () => {
    expect(classifySource('https://ali.github.io/blog', ctx)).toEqual({ type: 'other', key: 'ali.github.io' });
    expect(classifySource('https://veli.github.io/', ctx)).toEqual({ type: 'other', key: 'veli.github.io' });
    expect(key('https://yazar.substack.com/p/x')).toBe('yazar.substack.com');
    expect(key('https://x.blogspot.com/2026/1')).toBe('x.blogspot.com');
    expect(key('https://site.netlify.app/')).toBe('site.netlify.app');
    expect(key('https://app.vercel.app/')).toBe('app.vercel.app');
    expect(key('https://p.pages.dev/')).toBe('p.pages.dev');
    expect(key('https://blog.wordpress.com/')).toBe('blog.wordpress.com');
    expect(key('https://yazar.medium.com/x')).toBe('yazar.medium.com');
    // Kok medium.com/@yazar tek satir
    expect(classifySource('https://medium.com/@yazar/x', ctx)).toEqual({ type: 'other', key: 'medium.com' });
  });

  it('google.com altinda magaza, belge ve bilinmeyen alt alan ayri satir', () => {
    expect(key('https://play.google.com/store/apps/details?id=x')).toBe('play.google.com');
    expect(key('https://developers.google.com/x')).toBe('developers.google.com');
    expect(classifySource('https://blog.google.com/x', ctx)).toEqual({ type: 'other', key: 'blog.google.com' });
    // Google Dokumanlar belge paylasimi — "docs." oneki teknik belge sayilmaz
    expect(classifySource('https://docs.google.com/document/d/1', ctx)).toEqual({ type: 'other', key: 'docs.google.com' });
  });

  it('listede olmayan site other; anahtar kayit edilebilir alan (.com.tr dahil)', () => {
    expect(classifySource('https://blog.bilinmeyen.com.tr/yazi', ctx)).toEqual({ type: 'other', key: 'bilinmeyen.com.tr' });
    expect(classifySource('https://www.ornekblog.co.uk/x', ctx)).toEqual({ type: 'other', key: 'ornekblog.co.uk' });
  });

  it('URL cozulemezse probe domain alanina duser; ikisi de yoksa null', () => {
    expect(classifySource('::bozuk::', ctx, 'reddit.com')).toEqual({ type: 'forum', key: 'reddit.com' });
    expect(classifySource(undefined, ctx, null)).toBeNull();
  });
});

describe('platformdaki rakip — platformun tamami rakip olmaz', () => {
  const c: SourceTypeContext = {
    ownHost: 'ornek.com',
    competitors: buildCompetitorMatchers([
      'https://www.trendyol.com/magaza/rakip-m-123',
      'https://www.linkedin.com/company/rakip/',
      'https://apps.apple.com/tr/app/rakip/id123',
      'https://medium.com/@rakip',
      'https://rakip.github.io/',
      'https://hepsiburada.com', // yolsuz platform adresi: yok sayilir
    ]),
  };

  it('eslestiriciler: platformda host + yol oneki; yolsuz platform adresi atlanir', () => {
    expect(c.competitors).toEqual([
      { host: 'trendyol.com', pathPrefix: '/magaza/rakip-m-123', key: 'trendyol.com/magaza/rakip-m-123' },
      { host: 'linkedin.com', pathPrefix: '/company/rakip', key: 'linkedin.com/company/rakip' },
      { host: 'apps.apple.com', pathPrefix: '/tr/app/rakip/id123', key: 'apps.apple.com/tr/app/rakip/id123' },
      { host: 'medium.com', pathPrefix: '/@rakip', key: 'medium.com/@rakip' },
      { host: 'rakip.github.io', pathPrefix: null, key: 'rakip.github.io' },
    ]);
  });

  it.each([
    ['https://www.trendyol.com/magaza/rakip-m-123?sst=1', 'competitor', 'trendyol.com/magaza/rakip-m-123'],
    ['https://www.trendyol.com/magaza/rakip-m-123/urunler', 'competitor', 'trendyol.com/magaza/rakip-m-123'],
    ['https://www.trendyol.com/magaza/rakip-m-1234', 'marketplace', 'trendyol.com'],
    ['https://www.trendyol.com/baska-urun-p-9', 'marketplace', 'trendyol.com'],
    ['https://www.linkedin.com/company/rakip/posts', 'competitor', 'linkedin.com/company/rakip'],
    ['https://www.linkedin.com/company/baskasi', 'social', 'linkedin.com'],
    ['https://apps.apple.com/tr/app/rakip/id123', 'competitor', 'apps.apple.com/tr/app/rakip/id123'],
    ['https://apps.apple.com/tr/app/oyun/id999', 'marketplace', 'apps.apple.com'],
    ['https://medium.com/@rakip/yazi-1', 'competitor', 'medium.com/@rakip'],
    ['https://medium.com/@baskasi/yazi', 'other', 'medium.com'],
    ['https://rakip.github.io/docs', 'competitor', 'rakip.github.io'],
    ['https://www.hepsiburada.com/x', 'marketplace', 'hepsiburada.com'],
  ])('%s → %s', (url, t, k) => {
    expect(classifySource(url, c)).toEqual({ type: t, key: k });
  });

  it('isPlatformHost', () => {
    expect(isPlatformHost('trendyol.com')).toBe(true);
    expect(isPlatformHost('apps.apple.com')).toBe(true);
    expect(isPlatformHost('blog.google.com')).toBe(true);
    expect(isPlatformHost('medium.com')).toBe(true);
    expect(isPlatformHost('rakip.github.io')).toBe(false);
    expect(isPlatformHost('rakip.com')).toBe(false);
  });
});

describe('listeler tutarli', () => {
  it('her listedeki alan kayit edilebilir alanin kendisi ve tek bir listede', () => {
    const seen = new Map<string, string>();
    for (const [t, list] of Object.entries(SOURCE_TYPE_LISTS)) {
      if (t === 'docs') continue; // docs host duzeyi
      for (const d of list) {
        expect(registrableDomain(d), `${d} kayit edilebilir alan olmali`).toBe(d);
        expect(seen.has(d), `${d} hem ${seen.get(d)} hem ${t}`).toBe(false);
        seen.set(d, t);
        expect(classifySource(`https://${d}/`, { ownHost: null, competitors: [] })?.type, d).toBe(t);
      }
    }
  });

  it('SOURCE_TYPES rapor ve panelin bildigi tum turleri kapsar', () => {
    expect([...SOURCE_TYPES]).toEqual(['own', 'competitor', 'forum', 'review', 'social', 'video', 'encyclopedia', 'news', 'marketplace', 'docs', 'other']);
  });
});
