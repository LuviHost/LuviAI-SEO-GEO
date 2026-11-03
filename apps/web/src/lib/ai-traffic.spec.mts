/**
 * "AI'dan gelen trafik" panel yardımcıları — GA4 neden metinleri sunucunun
 * nedenleriyle aynı, çubuk/pay biçimi, ölçüm notu.
 * Calistirma: cd apps/web && ../api/node_modules/.bin/vitest run --root . src/lib
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { GA_REASON_TEXT, MEASUREMENT_NOTE, PERIOD_OPTIONS, barPct, botRatioNotes, ratioText, hasSeries, isHttpUrl, pageLabel, shareText, shortDay } from './ai-traffic';

describe('GA4 nedenleri sunucuyla aynı', () => {
  it('api AiTrafficGaReason birleşimindeki her nedenin metni var', () => {
    const api = readFileSync(new URL('../../../api/src/analytics/ai-traffic.service.ts', import.meta.url), 'utf8');
    const m = api.match(/export type AiTrafficGaReason = ([^;]+);/);
    expect(m).toBeTruthy();
    const reasons = [...m![1].matchAll(/'([a-z_]+)'/g)].map((x) => x[1]).sort();
    expect(Object.keys(GA_REASON_TEXT).sort()).toEqual(reasons);
    // Bağlı değil yolu bağlantı akışına yönlendirir
    expect(GA_REASON_TEXT.not_connected.cta).toBe(true);
    // API kapalı: kullanıcının düzeltebileceği bir şey değil — bağlantı butonu yok
    expect(GA_REASON_TEXT.api_disabled.cta).toBe(false);
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

describe('bağlantı ve sayfa etiketi', () => {
  it('yalnız http(s) bağlantı olur', () => {
    expect(isHttpUrl('https://o.com/a')).toBe(true);
    expect(isHttpUrl('javascript:alert(1)')).toBe(false);
    expect(isHttpUrl(null)).toBe(false);
  });
  it('tek host: yalnız yol; çok host: host + yol', () => {
    expect(pageLabel({ host: 'o.com', page: '/fiyat' }, false)).toBe('/fiyat');
    expect(pageLabel({ host: 'magaza.o.com', page: '/fiyat' }, true)).toBe('magaza.o.com/fiyat');
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

describe('bot isteği / ziyaret oranı', () => {
  it('ratioText: tam sayı ya da bir ondalık, geçersizde tire', () => {
    expect(ratioText(340)).toBe('340 : 1');
    expect(ratioText(2.46)).toBe('2,5 : 1');
    expect(ratioText(1234.4)).toBe('1.234 : 1');
    expect(ratioText(null)).toBe('—');
    expect(ratioText(0)).toBe('—');
  });

  it('notlar: dışarıda kalan taklit ve doğrulanamayan istekler sayısıyla yazılır', () => {
    const n = botRatioNotes({ verified: 10, unverified: 1500, unknown: 0, referrals: 2, referralSource: 'tracker', ratio: 5 });
    expect(n[0]).toMatch(/^1\.500 istek .*taklit olabilir/);
    expect(n.some((t) => /izleme kodundan/.test(t))).toBe(true);
    expect(botRatioNotes({ verified: 1, unverified: 0, unknown: 0, referrals: 1, referralSource: 'ga4', ratio: 1 })).toEqual([]);
  });

  it("dönem seçenekleri sunucunun kabul ettikleriyle aynı (28, 90, 'ay')", () => {
    const api = readFileSync(new URL('../../../api/src/analytics/ai-traffic.ts', import.meta.url), 'utf8');
    expect(api).toMatch(/export type AiTrafficPeriod = 28 \| 90 \| 'ay';/);
    expect(PERIOD_OPTIONS.map((o) => o.value).sort()).toEqual([28, 90, 'ay'].sort());
  });
});
