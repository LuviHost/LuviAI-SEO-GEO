import { describe, it, expect } from 'vitest';
import { hostMentioned, urlHostMatches, citedPathsFor, registrableDomain, extractAppStoreRefs } from './host-match.js';

describe('hostMentioned — etiket sinirli', () => {
  it('kendi alan adi ve alt alan adi eslesir; cumle sonu noktasi sorun degil', () => {
    expect(hostMentioned('kaynak: ranksup.ai uzerinden', 'ranksup.ai')).toBe(true);
    expect(hostMentioned('bkz. blog.ranksup.ai', 'ranksup.ai')).toBe(true);
    expect(hostMentioned('en iyisi ranksup.ai.', 'ranksup.ai')).toBe(true);
    expect(hostMentioned('(ranksup.ai)', 'ranksup.ai')).toBe(true);
  });
  it('benzer ama BASKA alan adlari eslesmez (eski includes hatasi)', () => {
    expect(hostMentioned('notranksup.ai harika', 'ranksup.ai')).toBe(false);
    expect(hostMentioned('ranksup.ai.tr de var', 'ranksup.ai')).toBe(false);
    expect(hostMentioned('x-ranksup.ai', 'ranksup.ai')).toBe(false);
    expect(hostMentioned('luvihost.com.tr', 'luvihost.com')).toBe(false);
  });
});

describe('urlHostMatches', () => {
  it('tam host / alt alan / www', () => {
    expect(urlHostMatches('https://www.ranksup.ai/a', 'ranksup.ai')).toBe(true);
    expect(urlHostMatches('https://blog.ranksup.ai/a', 'ranksup.ai')).toBe(true);
    expect(urlHostMatches('ranksup.ai/a', 'ranksup.ai')).toBe(true);
  });
  it('baska alanlar', () => {
    expect(urlHostMatches('https://notranksup.ai/a', 'ranksup.ai')).toBe(false);
    expect(urlHostMatches('https://ranksup.ai.tr/a', 'ranksup.ai')).toBe(false);
    expect(urlHostMatches('https://example.com/?ref=ranksup.ai', 'ranksup.ai')).toBe(false);
  });
});

describe('citedPathsFor', () => {
  it('kendi URL yollarini cikarir, benzer alan adlarini atlar', () => {
    const t = 'https://ranksup.ai/blog/x ve notranksup.ai/y ile ranksup.ai/z, ayrica blog.ranksup.ai/w.';
    expect(citedPathsFor(t, 'ranksup.ai')).toEqual(['/blog/x', '/z', '/w']);
  });
});

describe('registrableDomain', () => {
  it('.com.tr gibi iki etiketli sonekler', () => {
    expect(registrableDomain('ofsayt.com.tr')).toBe('ofsayt.com.tr');
    expect(registrableDomain('www.mackolik.com.tr')).toBe('mackolik.com.tr');
    expect(registrableDomain('blog.example.co.uk')).toBe('example.co.uk');
    expect(registrableDomain('app.ranksup.ai')).toBe('ranksup.ai');
  });
});

describe('extractAppStoreRefs — tam metinden magaza referanslari', () => {
  it('iOS id, slug ve Android paket', () => {
    const t = 'Indir: https://apps.apple.com/tr/app/ranksup-ai/id6800496220 ya da https://play.google.com/store/apps/details?id=ai.ranksup.app&hl=tr';
    expect(extractAppStoreRefs(t).sort()).toEqual(['android:ai.ranksup.app', 'ios:6800496220', 'iosslug:ranksup-ai']);
  });
  it('id123 artik id1234 ile eslesmez (rakam siniri)', () => {
    expect(extractAppStoreRefs('https://apps.apple.com/app/id1234567')).toEqual(['ios:1234567']);
    expect(extractAppStoreRefs('https://apps.apple.com/app/id1234567').includes('ios:123456')).toBe(false);
  });
});
