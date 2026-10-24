/**
 * "AI'dan gelen trafik" panel yardımcıları — GA4 neden metinleri sunucunun
 * nedenleriyle aynı, çubuk/pay biçimi, ölçüm notu.
 * Calistirma: cd apps/web && ../api/node_modules/.bin/vitest run --root . src/lib
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { GA_REASON_TEXT, MEASUREMENT_NOTE, barPct, hasSeries, shareText, shortDay } from './ai-traffic';

describe('GA4 nedenleri sunucuyla aynı', () => {
  it('api AiTrafficGaReason birleşimindeki her nedenin metni var', () => {
    const api = readFileSync(new URL('../../../api/src/analytics/ai-traffic.service.ts', import.meta.url), 'utf8');
    const m = api.match(/export type AiTrafficGaReason = ([^;]+);/);
    expect(m).toBeTruthy();
    const reasons = [...m![1].matchAll(/'([a-z_]+)'/g)].map((x) => x[1]).sort();
    expect(Object.keys(GA_REASON_TEXT).sort()).toEqual(reasons);
    // Bağlı değil yolu bağlantı akışına yönlendirir
    expect(GA_REASON_TEXT.not_connected.cta).toBe(true);
  });
});

describe('barPct', () => {
  it('oran, en az 4, sıfır ve geçersiz girdi 0', () => {
    expect(barPct(50, 100)).toBe(50);
    expect(barPct(1, 1000)).toBe(4);
    expect(barPct(100, 100)).toBe(100);
    expect(barPct(0, 100)).toBe(0);
    expect(barPct(5, 0)).toBe(0);
  });
});

describe('shareText / shortDay / hasSeries', () => {
  it('pay biçimi', () => {
    expect(shareText(0.0123)).toBe('%1,2');
    expect(shareText(0)).toBe('%0');
    expect(shareText(0.0004)).toBe('%0,1’den az');
    expect(shareText(null)).toBe('—');
  });
  it('kısa gün ve seri kontrolü', () => {
    expect(shortDay('2026-10-23')).toBe('23 Eki');
    expect(hasSeries([{ total: 0 }, { total: 0 }])).toBe(false);
    expect(hasSeries([{ total: 0 }, { total: 2 }])).toBe(true);
    expect(hasSeries(null)).toBe(false);
  });
});

describe('ölçüm notu', () => {
  it('referer + utm, GA4 çerez onayı ve iki kaynağın toplanmadığı söylenir', () => {
    const t = MEASUREMENT_NOTE.join(' ');
    expect(t).toMatch(/utm_source=chatgpt\.com/);
    expect(t).toMatch(/çerez onayı/);
    expect(t).toMatch(/toplanmaz/);
  });
});
