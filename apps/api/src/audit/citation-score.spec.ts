import { describe, it, expect } from 'vitest';
import { citationScore, citationCounts } from './citation-score.js';

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

describe('citationCounts — "atif var, marka anilmadi" sayaci', () => {
  it('cited && !brandMentioned ayri sayilir; skora etkisi yok (cited zaten tam puan)', () => {
    const c = citationCounts([P(true, false), P(true, true), P(false, true), P(false, false)]);
    expect(c.cited).toBe(2);
    expect(c.mentioned).toBe(1);          // anildi ama alintilanmadi
    expect(c.citedNotMentioned).toBe(1);  // alintilandi ama anilmadi — "kaynak oldun, oneri degilsin"
    expect(c.score).toBe(63);             // (100+100+50+0)/4 = 62.5 -> 63
  });

  it('markali probe bu sayaca da girmez', () => {
    expect(citationCounts([P(true, false, true)]).citedNotMentioned).toBe(0);
  });
});
