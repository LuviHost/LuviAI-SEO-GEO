import { describe, it, expect } from 'vitest';
import {
  citationScore, citationCounts, isErrorProbe, measuredOnly, allProbesFailed, providerOutcome,
} from './citation-score.js';

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

/**
 * HATA satirlari (429, 503, bos cevap) olcum DEGILDIR. Eskiden markasiz havuzda
 * "anilmadi" sayiliyordu: tum sorulari hata alan saglayici 0 puan aliyordu.
 */
describe('HATA satirlari skora ve sayaclara girmez', () => {
  const HATA = (code = 'rate_limited') => ({ cited: false, brandMentioned: false, excerpt: `HATA: ${code}` });

  it('tum probe\'lar HATA ise skor null, havuz 0 (0 puan DEGIL)', () => {
    const c = citationCounts([HATA(), HATA('upstream_unavailable'), HATA(), HATA('bos cevap (finishReason=MAX_TOKENS)'), HATA()]);
    expect(c.score).toBeNull();
    expect(c.poolSize).toBe(0);
    expect(c).toMatchObject({ cited: 0, mentioned: 0, citedNotMentioned: 0 });
  });

  it('1 basarili alinti + 4 HATA = 100 (20 DEGIL)', () => {
    const c = citationCounts([{ ...P(true, true), excerpt: 'Kaynak: ornek.com' }, HATA(), HATA(), HATA(), HATA()]);
    expect(c.score).toBe(100);
    expect(c.poolSize).toBe(1);
    expect(c.cited).toBe(1);
  });

  it('yalniz-anilma + HATA: payda yalniz olculen satir', () => {
    expect(citationScore([P(false, true), HATA()])).toBe(50);
    expect(citationScore([P(false, false), HATA(), HATA()])).toBe(0); // olculdu ve gorunmedi = gercek 0
  });

  it('eski ham hata satiri ("HATA: HTTP 429: {...}") da hata sayilir', () => {
    expect(isErrorProbe({ excerpt: 'HATA: HTTP 429: {"error":"RESOURCE_EXHAUSTED"}' })).toBe(true);
    expect(isErrorProbe({ excerpt: 'Hata yok, cevap metni' })).toBe(false);
    expect(isErrorProbe({ excerpt: null })).toBe(false);
    expect(isErrorProbe(undefined)).toBe(false);
  });

  it('measuredOnly / allProbesFailed', () => {
    const rows = [HATA(), { cited: true, brandMentioned: false, excerpt: 'metin' }];
    expect(measuredOnly(rows)).toHaveLength(1);
    expect(allProbesFailed(rows)).toBe(false);
    expect(allProbesFailed([HATA(), HATA()])).toBe(true);
    expect(allProbesFailed([])).toBe(false); // soru sorulmadi — "olculemedi" degil
  });
});

describe('providerOutcome — canli olcum ve backfill ayni kural', () => {
  const HATA = { cited: false, brandMentioned: false, excerpt: 'HATA: rate_limited' };

  it('hepsi HATA: available false, skor null, neden ilk hata kodu', () => {
    expect(providerOutcome([HATA, { ...HATA, excerpt: 'HATA: timeout' }], { available: true }))
      .toEqual({ available: false, score: null, reason: 'HATA: rate_limited' });
  });

  it('kismi hata: available korunur, skor olculen satirlardan', () => {
    expect(providerOutcome([P(true, true), HATA, HATA], { available: true }))
      .toEqual({ available: true, score: 100, reason: null });
  });

  it('probe yoksa (anahtar yok / sorgu yok) mevcut durum ve neden korunur', () => {
    expect(providerOutcome([], { available: false, reason: 'API anahtari yok' }))
      .toEqual({ available: false, score: null, reason: 'API anahtari yok' });
    expect(providerOutcome([], { available: true })).toEqual({ available: true, score: null, reason: null });
  });
});
