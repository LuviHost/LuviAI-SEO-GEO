/**
 * Sayı/tarih biçimleri — TR/EN ayraçları.
 * Çalıştırma: cd mobile && ../apps/api/node_modules/.bin/vitest run --root . src
 */
import { describe, expect, it } from 'vitest';
import { formatDate, formatDateTime, formatDecimal, formatInt, formatPercent } from './format';

describe('formatInt', () => {
  it('binlik ayraç dile göre', () => {
    expect(formatInt(12400, 'tr')).toBe('12.400');
    expect(formatInt(12400, 'en')).toBe('12,400');
    expect(formatInt(1234567, 'tr')).toBe('1.234.567');
    expect(formatInt(999, 'tr')).toBe('999');
    expect(formatInt(0, 'en')).toBe('0');
  });

  it('yuvarlar, negatif ve geçersiz değerleri işler', () => {
    expect(formatInt(1499.6, 'tr')).toBe('1.500');
    expect(formatInt(-2500, 'tr')).toBe('-2.500');
    expect(formatInt(Number.NaN, 'tr')).toBe('—');
  });
});

describe('formatDecimal / formatPercent', () => {
  it('ondalık ayraç dile göre', () => {
    expect(formatDecimal(4.567, 'tr')).toBe('4,6');
    expect(formatDecimal(4.567, 'en')).toBe('4.6');
  });

  it('yüzde işareti Türkçede başta', () => {
    expect(formatPercent(0.1234, 'tr')).toBe('%12,3');
    expect(formatPercent(0.1234, 'en')).toBe('12.3%');
    expect(formatPercent(Number.POSITIVE_INFINITY, 'tr')).toBe('—');
  });
});

describe('formatDate / formatDateTime', () => {
  it('geçersiz ya da boş tarihte boş döner', () => {
    expect(formatDate(null, 'tr')).toBe('');
    expect(formatDate('bozuk', 'tr')).toBe('');
    expect(formatDateTime(undefined, 'en')).toBe('');
  });

  it('geçerli tarihi gün ve yılla biçimler (İstanbul saati)', () => {
    // 2026-10-17 22:30 UTC = 18 Ekim 01:30 İstanbul — gün sınırı İstanbul'a göre
    const s = formatDate('2026-10-17T22:30:00Z', 'tr');
    expect(s).toContain('18');
    expect(s).toContain('2026');
  });
});
