import { describe, it, expect } from 'vitest';
import { assessStability, STABILITY_MIN_DAYS } from './visibility-variance.js';

const d = (score: number | null, n = 35) => ({ score, n });

describe('assessStability — oran tabanli oynaklik', () => {
  it(`${STABILITY_MIN_DAYS} gunden az gecerli veri -> yetersiz-veri`, () => {
    expect(assessStability([d(40), d(50), d(null), d(45)]).label).toBe('yetersiz-veri');
    expect(assessStability([]).dayCount).toBe(0);
  });

  it('sabit seri -> istikrarli, oran 0', () => {
    const s = assessStability([d(40), d(40), d(40), d(40), d(40)]);
    expect(s.label).toBe('istikrarli');
    expect(s.ratio).toBe(0);
    expect(s.dayCount).toBe(5);
  });

  it('binom gurultusu sinirindaki dalgalanma istikrarli sayilir (n kucukken bile)', () => {
    // p~0.3, n=7: beklenen sd ~%17. Gunluk 20/30/40/30/20 (sd ~%7.5) gurultunun icinde.
    const s = assessStability([d(20, 7), d(30, 7), d(40, 7), d(30, 7), d(20, 7)]);
    expect(s.label).toBe('istikrarli');
    expect(s.ratio!).toBeLessThanOrEqual(1.5);
  });

  it('ayni dalgalanma buyuk n\'de (gurultu kucuk) oynak sayilir', () => {
    // n=500: beklenen sd ~%2; gozlenen ~%7.5 -> oran ~3.7
    const s = assessStability([d(20, 500), d(30, 500), d(40, 500), d(30, 500), d(20, 500)]);
    expect(s.label).toBe('oynak');
    expect(s.ratio!).toBeGreaterThan(2.5);
  });

  it('ara bolge -> dalgali', () => {
    // n=35, p~0.3: beklenen ~%7.7; gozlenen ~%15 -> oran ~2
    const s = assessStability([d(15, 35), d(45, 35), d(15, 35), d(45, 35)]);
    expect(s.label).toBe('dalgali');
  });

  it('p=0 tam sabit -> istikrarli; p=0 ama hareket varsa bolme hatasi yok', () => {
    expect(assessStability([d(0), d(0), d(0), d(0)]).label).toBe('istikrarli');
    // p ortalamasi 0 olamaz hareket varsa; p=1 sinirini test et: 100,100,100,100
    expect(assessStability([d(100), d(100), d(100), d(100)]).label).toBe('istikrarli');
  });

  it('null gunler ve n=0 gunler sayilmaz', () => {
    const s = assessStability([d(null), d(40, 0), d(40), d(40), d(40), d(40)]);
    expect(s.dayCount).toBe(4);
    expect(s.label).toBe('istikrarli');
  });
});
