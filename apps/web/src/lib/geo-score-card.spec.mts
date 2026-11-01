/**
 * GEO skor karti gosterimi: olculemeyen sutun (score null) "ölçülmedi" okunur,
 * 0 gibi gosterilmez; ozet kac sutunun olculdugunu soyler.
 * Calistirma: cd apps/web && ../api/node_modules/.bin/vitest run --root . src/lib
 */
import { describe, expect, it } from 'vitest';
import { isPillarMeasured, measuredSummary, pillarScoreText, pillarUnmeasuredReason } from './geo-score-card';

const p = (score: number | null, unmeasuredReason?: string) => ({ score, unmeasuredReason });

describe('geo-score-card gosterimi', () => {
  it('null puan "ölçülmedi", 0 puan 0 olarak okunur', () => {
    expect(pillarScoreText(p(null))).toBe('ölçülmedi');
    expect(pillarScoreText(p(0))).toBe('0');
    expect(pillarScoreText(p(67))).toBe('67');
    expect(isPillarMeasured(p(0))).toBe(true);
    expect(isPillarMeasured(p(null))).toBe(false);
  });

  it('neden API metninden; yoksa notr varsayilan', () => {
    expect(pillarUnmeasuredReason(p(null, 'Son 9 günde AI ölçümü yok'))).toBe('Son 9 günde AI ölçümü yok');
    expect(pillarUnmeasuredReason(p(null))).toMatch(/ölçülemedi/);
  });

  it('ozet: tumu olculduyse null, kismi ve hic olculmeyen durum ayri', () => {
    expect(measuredSummary({ pillars: [p(10), p(0)] as any })).toBeNull();
    expect(measuredSummary({ pillars: [p(10), p(null), p(null), p(50), p(null), p(70)] as any }))
      .toBe("6 sütundan 3'ü ölçüldü · ağırlıklı ortalama yalnız ölçülenlerden");
    expect(measuredSummary({ pillars: [p(10), p(null), p(null), p(null), p(null), p(null)] as any })).toMatch(/^6 sütundan 1'i ölçüldü/);
    expect(measuredSummary({ pillars: [p(null), p(null)] as any })).toBe('2 sütunun hiçbiri ölçülemedi');
  });
});
