import { describe, it, expect } from 'vitest';
import { remeasureVerdict, afterWindowStart, REMEASURE_MIN_ROWS } from './remeasure-verdict.js';

const T = { weak: 0.4, lost: 0.01 };
const row = (date: string, provider: string, cited: boolean) => ({ date, provider, cited });
const day = (date: string, citedCount: number, total = 7) =>
  Array.from({ length: total }, (_, i) => row(date, `p${i}`, i < citedCount));

describe('remeasureVerdict — hukum birimi gun + satir', () => {
  it('tek tik (tek gun, 7 satir, %57 atif) -> ON SONUC, kesin hukum yok', () => {
    // Eski kod burada WON diyordu.
    const v = remeasureVerdict(day('2026-08-21', 4), T);
    expect(v.verdict).toBe('PRELIMINARY');
    expect(v.total).toBe(7); expect(v.dayCount).toBe(1);
    expect(v.rate).toBeCloseTo(4 / 7);
  });

  it('2 farkli gun + >=6 satir, oran >= %40 -> WON', () => {
    const v = remeasureVerdict([...day('2026-08-21', 3), ...day('2026-08-22', 3)], T);
    expect(v.verdict).toBe('WON');
    expect(v.dayCount).toBe(2);
  });

  it('2 gun ama toplam satir 6\'nin altinda -> hala ON SONUC', () => {
    const v = remeasureVerdict([...day('2026-08-21', 2, 3), ...day('2026-08-22', 1, 2)], T);
    expect(v.total).toBeLessThan(REMEASURE_MIN_ROWS);
    expect(v.verdict).toBe('PRELIMINARY');
  });

  it('kesin hukum: oran %1-%40 -> WEAK, <=%1 -> LOST', () => {
    expect(remeasureVerdict([...day('2026-08-21', 1), ...day('2026-08-22', 1)], T).verdict).toBe('WEAK');
    expect(remeasureVerdict([...day('2026-08-21', 0), ...day('2026-08-22', 0)], T).verdict).toBe('LOST');
  });

  it('wonProviders atif alan saglayicilarin benzersiz listesi', () => {
    const v = remeasureVerdict([row('2026-08-21', 'openai', true), row('2026-08-22', 'openai', true), row('2026-08-22', 'gemini', false)], T);
    expect(v.wonProviders).toEqual(['openai']);
  });

  it('bos satir -> ON SONUC, oran 0', () => {
    const v = remeasureVerdict([], T);
    expect(v.verdict).toBe('PRELIMINARY'); expect(v.rate).toBe(0);
  });
});

describe('afterWindowStart — yayin gunu alt siniri, gun basina yuvarlama', () => {
  const now = new Date('2026-08-21T16:00:00Z');

  it('yayin tarihi yoksa son 7 gunun basi (UTC gun)', () => {
    expect(afterWindowStart(now, null).toISOString()).toBe('2026-08-14T00:00:00.000Z');
  });

  it('yayin pencereden sonraysa yayin GUNU (saat degil) alt sinir olur', () => {
    // 14:00'te yayin, 16:00'da kosum: satir date=00:00 -> yuvarlama olmadan dislanirdi
    expect(afterWindowStart(now, new Date('2026-08-21T14:00:00Z')).toISOString()).toBe('2026-08-21T00:00:00.000Z');
  });

  it('yayin pencereden onceyse pencere basi kalir', () => {
    expect(afterWindowStart(now, new Date('2026-07-01T10:00:00Z')).toISOString()).toBe('2026-08-14T00:00:00.000Z');
  });
});
