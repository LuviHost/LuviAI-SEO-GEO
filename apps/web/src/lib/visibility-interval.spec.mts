/**
 * Calistirma: cd apps/web && ../api/node_modules/.bin/vitest run --root . src/lib
 *
 * Panel kurali (08.11.2026 kanit denetimi): fark yalniz araliklar ortusmuyorsa
 * "arttı/azaldı"; karar API'den (olcum blogu) gelir, burada okunur.
 */
import { describe, expect, it } from 'vitest';
import { aralikAciklamasi, kararAciklamasi, kararMetni, kararYonu, plusMinus, sorularaGore, tekrarSoruEtiketi } from './visibility-interval';
import { geoImpact } from '../components/geo-impact';

const ar = (gorunen: number, olculen: number, alt: number, ust: number) =>
  ({ gorunen, olculen, oran: Math.round((gorunen / olculen) * 1000) / 10, alt, ust, yariGenislik: (ust - alt) / 2 });

describe('gosterim yardimcilari', () => {
  it('±X yuvarlanir; aralik yoksa gosterilmez', () => {
    expect(plusMinus(ar(6, 15, 19.8, 64.3))).toBe('±22');
    expect(plusMinus(null)).toBeNull();
    expect(aralikAciklamasi(ar(6, 15, 19.8, 64.3))).toContain('%95 güven aralığı %20–%64');
  });

  it('"N tekrar × M soru"', () => {
    expect(tekrarSoruEtiketi({ date: '2026-11-08', runAt: '', tekrar: 3, soruSayisi: 5, gorunme: null, asistanlar: {} })).toBe('3 tekrar × 5 soru');
    expect(tekrarSoruEtiketi(null)).toBeNull();
  });

  it('yon ve metin: karar yoksa da "anlamlı değişim yok"', () => {
    expect(kararYonu('artti')).toBe('up');
    expect(kararYonu('azaldi')).toBe('down');
    expect(kararYonu('anlamli-degil')).toBe('flat');
    expect(kararYonu(null)).toBe('flat');
    expect(kararMetni(undefined)).toBe('anlamlı değişim yok');
    expect(kararAciklamasi({ karar: 'anlamli-degil', once: ar(6, 15, 19.8, 64.3), sonra: ar(9, 15, 35.7, 80.2) })).toMatch(/örtüşüyor/);
    expect(kararAciklamasi(null)).toMatch(/hesaplanamadı/);
  });

  it('sorularaGore: tekrarlar tek soru altinda, tekrar sirasiyla; eski kayit tek elemanli', () => {
    const g = sorularaGore([
      { query: 'B', tekrar: 2 }, { query: 'A', tekrar: 1 }, { query: 'B', tekrar: 1 }, { query: ' a ', tekrar: 2 },
    ]);
    expect(g.map((x) => [x.query, x.probes.map((p) => p.tekrar)])).toEqual([['B', [1, 2]], ['A', [1, 2]]]);
    expect(sorularaGore([{ query: 'X' }, { query: 'Y' }]).map((x) => x.probes.length)).toEqual([1, 1]);
  });
});

describe('geoImpact — RanksUp Etkisi yonu aralik kararindan', () => {
  const trends = [
    { provider: 'openai', first: 0, last: 60, firstDate: '2026-10-01', lastDate: '2026-11-01' },
    { provider: 'gemini', first: 20, last: 30, firstDate: '2026-10-01', lastDate: '2026-11-01' },
  ];
  const olcum = (karar: string | null, openai: string | null = null) => ({
    etki: { karar, once: null, sonra: null },
    asistanlar: { openai: { karar: openai, once: null, sonra: null } },
  });

  it('skor 10 → 45 ama araliklar ortusuyor: yon flat, "artik gorunuyorsun" yok', () => {
    const g = geoImpact({ trends, byProvider: {}, olcum: olcum('anlamli-degil', 'anlamli-degil') });
    expect(g.state).toBe('compare');
    expect(g.lastAvg).toBeGreaterThan(g.firstAvg!);
    expect(g.yon).toBe('flat');
    expect(g.newEngines).toEqual([]);
  });

  it('araliklar ayrik: yon up; yalniz araligi artan asistan "yeni"', () => {
    const g = geoImpact({ trends, byProvider: {}, olcum: olcum('artti', 'artti') });
    expect(g).toMatchObject({ yon: 'up', karar: 'artti', newEngines: ['openai'] });
  });

  it('eski API (olcum blogu yok): fark degisim diye okunmaz', () => {
    const g = geoImpact({ trends, byProvider: {} });
    expect(g).toMatchObject({ state: 'compare', karar: null, yon: 'flat', newEngines: [] });
  });
});
