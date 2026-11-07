import { describe, it, expect } from 'vitest';
import { CITATION_TEKRAR_VARSAYILAN, citationTekrar, tekrarSayisiFor } from './citation-repeat.js';

/** CITATION_TEKRAR: varsayilan 3, [1, 5]; deneme planinda 1 (gerekce citation-repeat.ts MALIYET INCELEMESI) */
describe('citationTekrar', () => {
  it('tanimsiz / bos / sayi degil → varsayilan 3', () => {
    expect(CITATION_TEKRAR_VARSAYILAN).toBe(3);
    expect(citationTekrar({})).toBe(3);
    expect(citationTekrar({ CITATION_TEKRAR: '' })).toBe(3);
    expect(citationTekrar({ CITATION_TEKRAR: '   ' })).toBe(3);
    expect(citationTekrar({ CITATION_TEKRAR: 'uc' })).toBe(3);
  });

  it('1-5 araligina kirpilir; ondalik asagi yuvarlanir', () => {
    expect(citationTekrar({ CITATION_TEKRAR: '1' })).toBe(1);
    expect(citationTekrar({ CITATION_TEKRAR: '5' })).toBe(5);
    expect(citationTekrar({ CITATION_TEKRAR: '0' })).toBe(1);
    expect(citationTekrar({ CITATION_TEKRAR: '-4' })).toBe(1);
    expect(citationTekrar({ CITATION_TEKRAR: '9' })).toBe(5);
    expect(citationTekrar({ CITATION_TEKRAR: '2.9' })).toBe(2);
    expect(citationTekrar({ CITATION_TEKRAR: ' 4 ' })).toBe(4);
  });
});

describe('tekrarSayisiFor — plan', () => {
  it('deneme (TRIAL / trial) her zaman 1, env ne derse desin', () => {
    expect(tekrarSayisiFor('TRIAL', { CITATION_TEKRAR: '5' })).toBe(1);
    expect(tekrarSayisiFor('trial', {})).toBe(1);
  });

  it('ucretli planlar env degerini alir', () => {
    for (const plan of ['STARTER', 'PRO', 'AGENCY', 'ENTERPRISE']) {
      expect(tekrarSayisiFor(plan, {}), plan).toBe(3);
      expect(tekrarSayisiFor(plan, { CITATION_TEKRAR: '2' }), plan).toBe(2);
    }
    expect(tekrarSayisiFor(undefined, {})).toBe(3);
  });
});
