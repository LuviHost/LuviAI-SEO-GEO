import { describe, it, expect } from 'vitest';
import { citationScore } from './citation-score.js';

/**
 * Skor formulu testleri.
 *
 * Bu formul hem canli olcumde (scoreFromProbes) hem gecmis snapshot backfill
 * script'inde kosuyor — sinirlar burada sabit: ikisi ayrisirsa tarihsel
 * grafik "duzeltme mi, gercek dusus mu" sorusuna cevap veremez.
 */
const P = (cited: boolean, mentioned: boolean, branded?: boolean) =>
  ({ cited, brandMentioned: mentioned, brandInQuery: branded });

describe('citationScore — markasiz havuz kurali', () => {
  it('bos dizi null doner', () => {
    expect(citationScore([])).toBeNull();
  });

  it('tum probe\'lar markaliysa null doner (sifir degil)', () => {
    // "skor 0" = olculduk ve gorunmedik; "null" = olculecek markasiz soru yok.
    expect(citationScore([P(true, true, true), P(false, true, true)])).toBeNull();
  });

  it('markali probe skora hic katilmaz', () => {
    // markasiz: 1 cited -> 100. Markali cited eklenince degismemeli.
    expect(citationScore([P(true, true, false)])).toBe(100);
    expect(citationScore([P(true, true, false), P(true, true, true), P(true, true, true)])).toBe(100);
  });

  it('citation tam, yalniz-anilma yarim puan', () => {
    expect(citationScore([P(true, true), P(false, true)])).toBe(75);   // (100+50)/2
    expect(citationScore([P(false, true), P(false, false)])).toBe(25); // (50+0)/2
  });

  it('brandInQuery tanimsiz probe markasiz sayilir (eski JSON uyumu)', () => {
    expect(citationScore([{ cited: true, brandMentioned: true }])).toBe(100);
  });
});
