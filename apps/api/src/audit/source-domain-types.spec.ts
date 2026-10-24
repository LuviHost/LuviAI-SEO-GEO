import { describe, it, expect } from 'vitest';
import { classifySource, hostOf, SOURCE_TYPE_LISTS, SOURCE_TYPES, type SourceTypeContext } from './source-domain-types.js';
import { registrableDomain } from './host-match.js';

/**
 * Alintilanan kaynak TURU sezgiseli — tek modul. Listeler kurate; buradaki
 * ornekler "rapor hangi satiri hangi eylemle gosterir" sozlesmesidir.
 */

const ctx: SourceTypeContext = { ownHost: 'ornek.com.tr', competitorHosts: ['rakip.com', 'shop.digerrakip.io'] };
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
    const c = { ownHost: 'magazam.myshopify.com', competitorHosts: [] };
    expect(type('https://magazam.myshopify.com/urun', c)).toBe('own');
    expect(type('https://baskasi.myshopify.com/', c)).toBe('other');
    expect(key('https://baskasi.myshopify.com/', c)).toBe('myshopify.com');
  });

  it('own, listedeki bir siteden once gelir (reddit.com sahibiyse own)', () => {
    expect(type('https://reddit.com/r/x', { ownHost: 'reddit.com', competitorHosts: [] })).toBe('own');
  });
});

describe('classifySource — turler', () => {
  it.each([
    ['https://www.reddit.com/r/turkey/comments/x', 'forum', 'reddit.com'],
    ['https://old.reddit.com/r/x', 'forum', 'reddit.com'],
    ['https://eksisozluk.com/baslik--123', 'forum', 'eksisozluk.com'],
    ['https://forum.donanimhaber.com/x', 'forum', 'donanimhaber.com'],
    ['https://www.technopat.net/sosyal/konu/x', 'forum', 'technopat.net'],
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

describe('listeler tutarli', () => {
  it('her listedeki alan kayit edilebilir alanin kendisi ve tek bir listede', () => {
    const seen = new Map<string, string>();
    for (const [t, list] of Object.entries(SOURCE_TYPE_LISTS)) {
      if (t === 'docs') continue; // docs host duzeyi
      for (const d of list) {
        expect(registrableDomain(d), `${d} kayit edilebilir alan olmali`).toBe(d);
        expect(seen.has(d), `${d} hem ${seen.get(d)} hem ${t}`).toBe(false);
        seen.set(d, t);
        expect(classifySource(`https://${d}/`, { ownHost: null, competitorHosts: [] })?.type, d).toBe(t);
      }
    }
  });

  it('SOURCE_TYPES rapor ve panelin bildigi tum turleri kapsar', () => {
    expect([...SOURCE_TYPES]).toEqual(['own', 'competitor', 'forum', 'review', 'video', 'encyclopedia', 'news', 'marketplace', 'docs', 'other']);
  });
});
