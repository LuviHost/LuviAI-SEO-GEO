import { describe, it, expect } from 'vitest';
import {
  aralikKarari, gorunmeAraligi, gorunmeSayaci, karsilastir, olcumBelirsizligi, sayacTopla,
  soruSayisi, tekrarSayisi, wilsonAraligi, type GunKosumu,
} from './visibility-interval.js';

/**
 * Gorunme sikligi %95 Wilson araligi + "artti/azaldi yalniz araliklar
 * ortusmuyorsa" karari (08.11.2026 kanit denetimi). Referans degerler Wilson
 * skor araligi formulunden (z = 1.959964): 5/10 → [23.66, 76.34] ders
 * kitabi degeri; 0/10 → [0, 27.75].
 */
describe('wilsonAraligi', () => {
  it('5/10 → [23.7, 76.3], ±26.3; oran 50', () => {
    expect(wilsonAraligi(5, 10)).toEqual({ gorunen: 5, olculen: 10, oran: 50, alt: 23.7, ust: 76.3, yariGenislik: 26.3 });
  });

  it('k = 0: alt 0, ust sifir degil (tek turda "hic gorunmedi" kesin degil)', () => {
    expect(wilsonAraligi(0, 10)).toMatchObject({ oran: 0, alt: 0, ust: 27.8, yariGenislik: 13.9 });
    expect(wilsonAraligi(0, 15)).toMatchObject({ alt: 0, ust: 20.4 });
  });

  it('k = n: ust 100, alt 100 degil; aralik [0,100] disina tasmaz', () => {
    expect(wilsonAraligi(10, 10)).toMatchObject({ oran: 100, alt: 72.2, ust: 100 });
  });

  it('tekrar araligi daraltir: ayni oran (%20), 5 cevap → ±29, 15 cevap → ±19', () => {
    // 1/5 = tek tur x 5 soru; 3/15 = 3 tekrar x 5 soru
    expect(wilsonAraligi(1, 5)!.yariGenislik).toBeCloseTo(29.4, 1);
    expect(wilsonAraligi(3, 15)!.yariGenislik).toBeCloseTo(19.1, 1);
  });

  it('olculen 0 / gecersiz → null ("aralik 0" degil, olcum yok)', () => {
    expect(wilsonAraligi(0, 0)).toBeNull();
    expect(wilsonAraligi(1, Number.NaN)).toBeNull();
    expect(wilsonAraligi(3, -1)).toBeNull();
  });

  it('gorunen olculenden buyukse olculene kirpilir', () => {
    expect(wilsonAraligi(12, 10)).toMatchObject({ gorunen: 10, oran: 100 });
  });
});

describe('gorunmeSayaci — skorla ayni havuz (citationCounts)', () => {
  it('atif ya da anilma = gorunme; markali soru ve HATA satiri sayilmaz', () => {
    const probes = [
      { cited: true, brandMentioned: true },                       // gorundu
      { cited: false, brandMentioned: true },                      // gorundu (yalniz anilma)
      { cited: true, brandMentioned: false },                      // gorundu (atif, ad yok)
      { cited: false, brandMentioned: false },                     // gorunmedi
      { cited: false, brandMentioned: true, brandInQuery: true },  // markali → disarida
      { cited: false, brandMentioned: false, excerpt: 'HATA: rate_limited' }, // olcum degil
    ];
    expect(gorunmeSayaci(probes)).toEqual({ gorunen: 3, olculen: 4 });
    expect(gorunmeAraligi(probes)).toMatchObject({ gorunen: 3, olculen: 4, oran: 75 });
  });

  it('sayilacak cevap yoksa aralik null', () => {
    expect(gorunmeAraligi([{ cited: false, brandMentioned: false, excerpt: 'HATA: x' }])).toBeNull();
    expect(gorunmeAraligi([])).toBeNull();
  });

  it('sayacTopla bos/olculemeyeni atlar', () => {
    expect(sayacTopla([{ gorunen: 2, olculen: 5 }, null, { gorunen: 0, olculen: 0 }, { gorunen: 1, olculen: 10 }])).toEqual({ gorunen: 3, olculen: 15 });
  });
});

describe('aralikKarari — yalniz ortusmeyen araliklar "artti/azaldi"', () => {
  it('2/30 → 18/30: araliklar ayrik → artti; tersi azaldi', () => {
    const a = wilsonAraligi(2, 30);
    const b = wilsonAraligi(18, 30);
    expect(aralikKarari(a, b)).toBe('artti');
    expect(aralikKarari(b, a)).toBe('azaldi');
  });

  it('6/15 → 9/15 (puan farki 20) ortusuyor → anlamli degil', () => {
    expect(aralikKarari(wilsonAraligi(6, 15), wilsonAraligi(9, 15))).toBe('anlamli-degil');
  });

  it('sinirlar degisirse (ust == alt) temkinli: anlamli degil', () => {
    const once = { gorunen: 1, olculen: 10, oran: 10, alt: 5, ust: 30, yariGenislik: 12.5 };
    const sonra = { gorunen: 5, olculen: 10, oran: 50, alt: 30, ust: 70, yariGenislik: 20 };
    expect(aralikKarari(once, sonra)).toBe('anlamli-degil');
  });

  it('taraflardan biri yoksa kiyas yok (null)', () => {
    expect(aralikKarari(null, wilsonAraligi(1, 5))).toBeNull();
    expect(karsilastir({ gorunen: 1, olculen: 5 }, { gorunen: 0, olculen: 0 })).toEqual({ karar: null, once: wilsonAraligi(1, 5), sonra: null });
  });
});

describe('tekrarSayisi / soruSayisi', () => {
  it('tekrar damgasinin en buyugu; damga yoksa 1', () => {
    expect(tekrarSayisi([{ tekrar: 1 }, { tekrar: 3 }, { tekrar: 2 }])).toBe(3);
    expect(tekrarSayisi([{}, {}])).toBe(1);
    expect(tekrarSayisi([])).toBe(1);
  });

  it('farkli soru sayisi (bosluk/harf farki tek soru)', () => {
    expect(soruSayisi([{ query: 'A soru' }, { query: ' a soru ' }, { query: 'B' }, { query: 'B' }, {}])).toBe(2);
  });
});

// ─── getHistory blogu ───────────────────────────────────────────

const gun = (n: number) => new Date(Date.UTC(2026, 10, 20) - n * 86_400_000).toISOString().slice(0, 10);
const kosum = (date: string, asistanlar: GunKosumu['asistanlar'], o: Partial<GunKosumu> = {}): GunKosumu => ({
  date, runAt: `${date}T09:00:00.000Z`, matchVersion: 6, asistanlar, tekrar: 3, soruSayisi: 5, ...o,
});

describe('olcumBelirsizligi', () => {
  it('son olcum: genel + asistan bazinda aralik, tekrar x soru', () => {
    const r = olcumBelirsizligi([
      kosum(gun(8), { openai: { gorunen: 0, olculen: 15 } }),
      kosum(gun(1), { openai: { gorunen: 9, olculen: 15 }, gemini: { gorunen: 3, olculen: 15 } }),
    ], []);
    expect(r.son).toMatchObject({ date: gun(1), tekrar: 3, soruSayisi: 5 });
    expect(r.son!.gorunme).toEqual(wilsonAraligi(12, 30));
    expect(r.son!.asistanlar.openai).toEqual(wilsonAraligi(9, 15));
    expect(r.son!.asistanlar.gemini).toEqual(wilsonAraligi(3, 15));
  });

  it('manset: son 7 gunun birlesik araligi; haftalik kiyas yalniz iki pencerede de olculen asistanlarla', () => {
    const r = olcumBelirsizligi([
      // onceki hafta: openai 1/15, perplexity 15/15 (bu hafta olculemedi → kiyasa girmez)
      kosum(gun(9), { openai: { gorunen: 1, olculen: 15 }, perplexity: { gorunen: 15, olculen: 15 } }),
      // bu hafta: openai 12/15
      kosum(gun(2), { openai: { gorunen: 12, olculen: 15 }, perplexity: { gorunen: 0, olculen: 0 } }),
    ], []);
    expect(r.manset).toEqual({ gorunme: wilsonAraligi(12, 15), olcumSayisi: 1 });
    // ortak kapsam: yalniz openai 1/15 → 12/15 (perplexity'nin 15/15'i "dusus" uretmez)
    expect(r.haftalik).toEqual({ karar: 'artti', once: wilsonAraligi(1, 15), sonra: wilsonAraligi(12, 15) });
  });

  it('karsilastirma penceresinde eski yontemli olcum varsa haftalik kiyas yok', () => {
    const r = olcumBelirsizligi([
      kosum(gun(9), { openai: { gorunen: 0, olculen: 5 } }, { matchVersion: 5, tekrar: 1 }),
      kosum(gun(2), { openai: { gorunen: 15, olculen: 15 } }),
    ], []);
    expect(r.haftalik.karar).toBeNull();
    expect(r.manset.gorunme).toEqual(wilsonAraligi(15, 15));
  });

  it('asistan trendi ve etki: trendin ilk/son gunu; ortusurse anlamli degil', () => {
    const gunler = [
      kosum(gun(20), { openai: { gorunen: 6, olculen: 15 }, gemini: { gorunen: 2, olculen: 30 } }),
      kosum(gun(1), { openai: { gorunen: 9, olculen: 15 }, gemini: { gorunen: 18, olculen: 30 } }),
    ];
    const trends = [
      { provider: 'openai', first: 40, last: 60, firstDate: gun(20), lastDate: gun(1) },
      { provider: 'gemini', first: 7, last: 60, firstDate: gun(20), lastDate: gun(1) },
      // tek olcum: kiyaslanmaz, karar uretilmez
      { provider: 'xai', first: 10, last: 10, firstDate: gun(1), lastDate: gun(1) },
    ];
    const r = olcumBelirsizligi(gunler, trends);
    expect(r.asistanlar.openai.karar).toBe('anlamli-degil'); // 6/15 → 9/15
    expect(r.asistanlar.gemini.karar).toBe('artti');         // 2/30 → 18/30
    expect(r.asistanlar.xai).toBeUndefined();
    // etki: kiyaslanabilir asistanlarin birlesigi 8/45 → 27/45
    expect(r.etki).toEqual(karsilastir({ gorunen: 8, olculen: 45 }, { gorunen: 27, olculen: 45 }));
    expect(r.etki.karar).toBe('artti');
  });

  it('kiyaslanabilir bir asistanin kosum kaydi yoksa (eski veri) etki karari yok', () => {
    const r = olcumBelirsizligi(
      [kosum(gun(1), { openai: { gorunen: 9, olculen: 15 } })],
      [{ provider: 'openai', first: 0, last: 60, firstDate: gun(30), lastDate: gun(1) }],
    );
    expect(r.asistanlar.openai).toEqual({ karar: null, once: null, sonra: null });
    expect(r.etki.karar).toBeNull();
  });

  it('kosum yoksa bos blok', () => {
    expect(olcumBelirsizligi([], [])).toEqual({
      son: null,
      manset: { gorunme: null, olcumSayisi: 0 },
      haftalik: { karar: null, once: null, sonra: null },
      etki: { karar: null, once: null, sonra: null },
      asistanlar: {},
    });
  });
});
