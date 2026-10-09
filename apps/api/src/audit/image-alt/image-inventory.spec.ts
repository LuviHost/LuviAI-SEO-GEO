import { describe, it, expect } from 'vitest';
import { collectCandidates, nextStatus } from './image-inventory.js';
import type { ExtractedImage } from '../../sites/image-extract.js';

const img = (hash: string, over: Partial<ExtractedImage> = {}): ExtractedImage => ({
  srcRaw: `/${hash}.png`, src: `https://x.com/${hash}.png`, srcHash: hash,
  altState: 'absent', alt: null, width: null, height: null, linked: false, linkHref: null,
  wpAttachmentId: null, ariaDecorative: false, excluded: false, flags: [], context: {},
  ...over,
});

describe('collectCandidates', () => {
  it('aday = alt siz (aria disi) + supheli; alt="" ve aria-hidden aday degil', () => {
    const r = collectCandidates([{ url: 'https://x.com/a', lang: 'tr', images: [
      img('h1'),
      img('h2', { altState: 'present', alt: 'IMG_0001.jpg', flags: ['filename_like'] }),
      img('h3', { altState: 'empty', alt: '' }),
      img('h4', { ariaDecorative: true }),
      img('h5', { altState: 'present', alt: 'Kırmızı bisiklet' }),
    ] }]);
    expect(r.candidates.map((c) => [c.srcHash, c.reason])).toEqual([['h1', 'absent'], ['h2', 'suspicious']]);
    expect(r.candidates[0].pageLang).toBe('tr');
    expect([...r.good.keys()]).toEqual(['h5']);
  });

  it('ayni gorsel birden cok sayfada: tek kayit, sayfa sayisi, en kotu durum', () => {
    const r = collectCandidates([
      { url: 'https://x.com/a', images: [img('logo', { altState: 'present', alt: 'logo.png', flags: ['filename_like'] })] },
      { url: 'https://x.com/b', images: [img('logo')] },
      { url: 'https://x.com/c', images: [img('logo')] },
    ]);
    expect(r.candidates).toHaveLength(1);
    expect(r.candidates[0]).toMatchObject({ pageCount: 3, reason: 'absent', samplePages: ['https://x.com/a', 'https://x.com/b', 'https://x.com/c'] });
  });

  it('bir sayfada sorunlu olan gorsel "iyi" sayilmaz', () => {
    const r = collectCandidates([
      { url: 'https://x.com/a', images: [img('g', { altState: 'present', alt: 'Güzel açıklama' })] },
      { url: 'https://x.com/b', images: [img('g')] },
    ]);
    expect(r.good.has('g')).toBe(false);
    expect(r.candidates[0].srcHash).toBe('g');
  });

  it('tavan: once absent, sonra cok sayfada gecen; capped isaretlenir', () => {
    const r = collectCandidates([{ url: 'https://x.com/a', images: [
      img('s1', { altState: 'present', alt: 'resim', flags: ['generic'] }),
      img('a1'),
      img('a2'),
    ] }], 2);
    expect(r.candidates.map((c) => c.srcHash)).toEqual(['a1', 'a2']);
    expect(r.capped).toBe(true);
  });
});

describe('nextStatus — kullanicinin isi korunur', () => {
  it('tekrar aday: VERIFIED geriledi → NEW; oneri/onay/uygulama korunur', () => {
    expect(nextStatus('VERIFIED', 'candidate')).toBe('NEW');
    for (const s of ['NEW', 'SUGGESTED', 'APPROVED', 'APPLIED', 'DISMISSED', 'DECORATIVE']) {
      expect(nextStatus(s, 'candidate')).toBe(s);
    }
  });
  it('iyi alt la goruldu: APPLIED → VERIFIED, digerleri ayni', () => {
    expect(nextStatus('APPLIED', 'good')).toBe('VERIFIED');
    expect(nextStatus('SUGGESTED', 'good')).toBe('SUGGESTED');
  });
});
