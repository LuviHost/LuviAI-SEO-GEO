/**
 * Search Console donem etiketleri: "Son 30 gün" kartlari verinin gercek
 * kapsamini soyler; yukselen sorgu rozetinin isareti degerden gelir.
 * Calistirma: cd apps/web && ../api/node_modules/.bin/vitest run --root . src/lib
 */
import { describe, expect, it } from 'vitest';
import { coverageLabel, coverageRange, formatGscRange, sinceGscDay, trendBadgeText } from './gsc-coverage';

const eksik = {
  requestedDays: 30, coveredDays: 15, from: '2026-10-16', to: '2026-10-30',
  windowFrom: '2026-10-01', windowTo: '2026-10-30', complete: false,
};

describe('coverageLabel', () => {
  it('eksik kapsamda gercek araligi soyler', () => {
    expect(coverageLabel(eksik, 30)).toBe("Son 30 gün (veri 16 Ekim'den beri, 15 gün)");
  });
  it('tam kapsamda ya da eski API yanitinda yalniz donem', () => {
    expect(coverageLabel({ ...eksik, coveredDays: 30, from: '2026-10-01', complete: true }, 30)).toBe('Son 30 gün');
    expect(coverageLabel(undefined, 30)).toBe('Son 30 gün');
  });
  it('ay ekleri dogru', () => {
    expect(sinceGscDay('2026-01-05')).toBe("5 Ocak'tan");
    expect(sinceGscDay('2026-09-05')).toBe("5 Eylül'den");
    expect(sinceGscDay('2026-04-05')).toBe("5 Nisan'dan");
  });
});

describe('formatGscRange', () => {
  it('ayni ay, farkli ay, farkli yil', () => {
    expect(formatGscRange('2026-10-02', '2026-10-31')).toBe('2–31 Ekim');
    expect(formatGscRange('2026-09-16', '2026-10-15')).toBe('16 Eylül – 15 Ekim');
    expect(formatGscRange('2025-12-20', '2026-01-02')).toBe('20 Aralık 2025 – 2 Ocak 2026');
    expect(coverageRange(eksik)).toBe('16–30 Ekim');
    expect(coverageRange(null)).toBeNull();
  });
});

describe('trendBadgeText', () => {
  it('isaret degerden: dusus eksi, yukselis arti, onceki donem yoksa "yeni"', () => {
    expect(trendBadgeText({ growthPct: 125 })).toBe('+%125');
    expect(trendBadgeText({ growthPct: -88 })).toBe('−%88');
    expect(trendBadgeText({ growthPct: 31386 })).toBe('+%31.386');
    expect(trendBadgeText({ growthPct: null, isNew: true })).toBe('yeni');
  });
});
