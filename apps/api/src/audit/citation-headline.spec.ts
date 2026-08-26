import { describe, it, expect } from 'vitest';
import { providerHeadline, buildHeadline } from './citation-headline.js';

/**
 * Manset formulu testleri — manset chart ve overview'da ayni sayiyi soylemeli;
 * formul tek yerde, sinirlar burada sabit.
 */
const pt = (date: string, score: number | null) => ({ date, score });

describe('providerHeadline — 7 gunluk pencere', () => {
  it('bos seri null/0 doner', () => {
    expect(providerHeadline([])).toEqual({ last7Avg: null, runCount: 0, deltaVsPrev: null });
  });

  it('tek olcum: ortalama olcumun kendisi, runCount 1, delta yok', () => {
    expect(providerHeadline([pt('2026-08-20', 61)])).toEqual({ last7Avg: 61, runCount: 1, deltaVsPrev: null });
  });

  it('pencere serinin son noktasina gore kurulur, bugune gore degil', () => {
    // Cron durmus olsa da eldeki son hafta anlatilir
    const s = [pt('2026-07-01', 10), pt('2026-07-02', 20), pt('2026-07-03', 30)];
    expect(providerHeadline(s).last7Avg).toBe(20);
    expect(providerHeadline(s).runCount).toBe(3);
  });

  it('7 gunden eski noktalar pencereye girmez', () => {
    const s = [pt('2026-08-01', 100), pt('2026-08-15', 40), pt('2026-08-21', 60)];
    // son nokta 21 -> pencere 15..21 -> 40,60
    expect(providerHeadline(s).last7Avg).toBe(50);
    expect(providerHeadline(s).runCount).toBe(2);
  });

  it('null skorlar (kota/hata gunleri) ortalamaya girmez', () => {
    const s = [pt('2026-08-19', null), pt('2026-08-20', 40), pt('2026-08-21', 60)];
    expect(providerHeadline(s)).toEqual({ last7Avg: 50, runCount: 2, deltaVsPrev: null });
  });

  it('onceki pencereye gore puan farki', () => {
    const s = [
      pt('2026-08-08', 20), pt('2026-08-10', 40), // onceki hafta ort 30
      pt('2026-08-15', 60), pt('2026-08-21', 80), // bu hafta ort 70
    ];
    expect(providerHeadline(s).deltaVsPrev).toBe(40);
  });
});

describe('buildHeadline — saglayicilar arasi manset', () => {
  it('tum saglayicilar tek olcumse method first-run', () => {
    const h = buildHeadline({ openai: [pt('2026-08-21', 50)], gemini: [pt('2026-08-21', 70)] });
    expect(h.score).toBe(60);
    expect(h.method).toBe('first-run');
    expect(h.runCount).toBe(1);
  });

  it('bir saglayici bile >=2 olcumluyse rolling; tek olcumlu saglayici kendi degeriyle katilir', () => {
    const h = buildHeadline({
      openai: [pt('2026-08-20', 40), pt('2026-08-21', 60)], // ort 50
      gemini: [pt('2026-08-21', 70)],
    });
    expect(h.score).toBe(60);
    expect(h.method).toBe('rolling');
    expect(h.runCount).toBe(2);
  });

  it('tek gunluk zipla mansete tam yansimaz (eski davranisin duzeltildigi nokta)', () => {
    // Eski manset = son gun = 90. Yeni manset son haftanin ortalamasi.
    const h = buildHeadline({ openai: [pt('2026-08-15', 30), pt('2026-08-18', 30), pt('2026-08-21', 90)] });
    expect(h.score).toBe(50);
  });

  it('gunluk seri saglayicilar-arasi ortalama ve tarih sirali', () => {
    const h = buildHeadline({
      openai: [pt('2026-08-21', 40), pt('2026-08-20', 20)],
      gemini: [pt('2026-08-21', 60)],
    });
    expect(h.daily).toEqual([pt('2026-08-20', 20), pt('2026-08-21', 50)]);
  });

  it('hic veri yoksa score/method null', () => {
    const h = buildHeadline({ openai: [pt('2026-08-21', null)] });
    expect(h.score).toBeNull();
    expect(h.method).toBeNull();
    expect(h.daily).toEqual([]);
  });
});
