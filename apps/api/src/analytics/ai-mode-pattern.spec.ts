import { describe, it, expect } from 'vitest';
import { assessAiModeQuery, summarizeAiMode } from './ai-mode-pattern.js';

const q = (query: string, impressions = 50, clicks = 3, position: number | null = 6) =>
  ({ query, impressions, clicks, position });

describe('assessAiModeQuery', () => {
  it('TR soru kalibi + uzun kuyruk → aiModeLikely', () => {
    const a = assessAiModeQuery(q('damga vergisi nasıl hesaplanır 2026 kira sözleşmesi'));
    expect(a.signals).toContain('question');
    expect(a.signals).toContain('long-tail');
    expect(a.aiModeLikely).toBe(true);
  });

  it('mi/mı soneki soru sayilir', () => {
    const a = assessAiModeQuery(q('kobi için e-fatura zorunlu mu 2026'));
    expect(a.signals).toContain('question');
  });

  it('kisa marka sorgusu → sinyal yok', () => {
    const a = assessAiModeQuery(q('kobipratik', 500, 120, 1));
    expect(a.aiModeLikely).toBe(false);
    expect(a.signals).toEqual([]);
  });

  it('POZISYON SARTI: iyi siralanan tiklamasiz uzun sorgu → zero-click-ranked', () => {
    const a = assessAiModeQuery(q('en uygun kobi kredisi hangi banka veriyor', 40, 0, 5));
    expect(a.signals).toContain('zero-click-ranked');
    expect(a.aiModeLikely).toBe(true);
  });

  it('POZISYON SARTI: pozisyon 40\'taki tiklamasiz sorgu sadece kotu siralamadir → sinyal YOK', () => {
    const a = assessAiModeQuery(q('ikinci el araba alirken dikkat edilmesi gerekenler listesi', 40, 0, 40));
    expect(a.signals).not.toContain('zero-click-ranked');
    // soru kelimesi yok → likely degil
    expect(a.aiModeLikely).toBe(false);
  });

  it('gosterim esigi altinda zero-click sayilmaz', () => {
    const a = assessAiModeQuery(q('en uygun kobi kredisi hangi banka veriyor', 5, 0, 3));
    expect(a.signals).not.toContain('zero-click-ranked');
  });

  it('karsilastirma kalibi isaretlenir ama tek basina likely yapmaz', () => {
    const a = assessAiModeQuery(q('trendyol vs hepsiburada', 100, 10, 4));
    expect(a.signals).toContain('comparison');
    expect(a.aiModeLikely).toBe(false);
  });

  it('EN soru + uzun kuyruk', () => {
    expect(assessAiModeQuery(q('how do i calculate stamp duty on a lease')).aiModeLikely).toBe(true);
  });
});

describe('summarizeAiMode', () => {
  it('pay yuzdesi', () => {
    const list = [
      assessAiModeQuery(q('damga vergisi nasıl hesaplanır 2026 kira')),
      assessAiModeQuery(q('kobipratik', 500, 120, 1)),
    ];
    expect(summarizeAiMode(list)).toEqual({ total: 2, likely: 1, sharePct: 50 });
    expect(summarizeAiMode([])).toEqual({ total: 0, likely: 0, sharePct: 0 });
  });
});
