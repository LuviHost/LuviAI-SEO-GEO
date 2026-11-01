import { describe, it, expect, vi } from 'vitest';
import {
  addDays,
  buildRankings,
  compareQueryPeriods,
  dailyTotalsFromRows,
  exactQueryRegexChunks,
  fetchAllRows,
  latestDateFromRows,
  periodWindows,
  rankingDelta,
  snapshotCoverage,
  sparklinesFromRows,
  sumTotals,
  topPageByQuery,
  weeklySiteSummary,
  weightedPosition,
  type QueryMetric,
} from './gsc-aggregate.js';

/**
 * Fikstur: gercek bir sc-domain property'de (ornek.com yerine) 01-02.11.2026
 * olculen degerlerin bicimi. Panel / GSC farklari dosya basinda
 * (gsc-aggregate.ts) anlatildi.
 */
const qm = (query: string, clicks: number, impressions: number, position: number): QueryMetric => ({
  query, clicks, impressions, ctr: impressions > 0 ? clicks / impressions : 0, position,
});

describe('fetchAllRows — sayfalama', () => {
  it('25.000 satirlik sayfalar startRow ile devam eder, kisa sayfada durur', async () => {
    const calls: Array<Record<string, unknown>> = [];
    const api = {
      query: vi.fn(async ({ requestBody }: any) => {
        calls.push(requestBody);
        const n = requestBody.startRow === 0 ? 25_000 : 1_234;
        return { data: { rows: Array.from({ length: n }, (_, i) => ({ keys: [`q${requestBody.startRow + i}`], clicks: 1, impressions: 1 })) } };
      }),
    };
    const r = await fetchAllRows(api, 'sc-domain:ornek.com', { dimensions: ['query'] });
    expect(r.rows).toHaveLength(26_234);
    expect(r.truncated).toBe(false);
    expect(calls.map((c) => c.startRow)).toEqual([0, 25_000]);
    expect(calls.every((c) => c.rowLimit === 25_000)).toBe(true);
  });

  it('maxRows asilirsa truncated=true', async () => {
    const api = { query: async ({ requestBody }: any) => ({ data: { rows: Array.from({ length: requestBody.rowLimit }, () => ({ keys: ['x'] })) } }) };
    const r = await fetchAllRows(api, 's', {}, { maxRows: 30_000 });
    expect(r.rows).toHaveLength(30_000);
    expect(r.truncated).toBe(true);
  });
});

describe('gun toplami ve agirlikli pozisyon', () => {
  it('gun satirlari tarih sirali; bozuk tarih atlanir', () => {
    const d = dailyTotalsFromRows([
      { keys: ['2026-10-17'], clicks: 800, impressions: 50_000, ctr: 0.016, position: 7.4 },
      { keys: ['2026-10-16'], clicks: 760, impressions: 48_000, ctr: 0.0158, position: 7.1 },
      { keys: ['bozuk'], clicks: 1 },
    ]);
    expect(d.map((x) => x.date)).toEqual(['2026-10-16', '2026-10-17']);
    expect(latestDateFromRows([{ keys: ['2026-10-30'] }, { keys: ['2026-10-31'] }, { keys: ['2026-10-29'] }])).toBe('2026-10-31');
  });

  it('pozisyon GOSTERIMLE agirlikli — duz ortalama sessiz gunu buyuk gunle esit sayardi', () => {
    // Duz ortalama (2 + 8) / 2 = 5; gercek: (2*10 + 8*990) / 1000 = 7.94
    expect(weightedPosition([{ impressions: 10, position: 2 }, { impressions: 990, position: 8 }])).toBeCloseTo(7.94, 2);
    const t = sumTotals([
      { clicks: 700, impressions: 46_000, position: 7.0 },
      { clicks: 820, impressions: 50_000, position: 7.8 },
    ]);
    expect(t.clicks).toBe(1520);
    expect(t.impressions).toBe(96_000);
    expect(t.ctr).toBeCloseTo(1520 / 96_000, 6);
    expect(t.position).toBeGreaterThan(7.0);
    expect(t.position).toBeLessThan(7.8);
  });
});

describe('donem penceresi ve kapsam', () => {
  it('son veri gunune dayali donem + hemen onceki ESIT donem', () => {
    expect(periodWindows('2026-10-31', 7)).toEqual({
      current: { from: '2026-10-25', to: '2026-10-31' },
      previous: { from: '2026-10-18', to: '2026-10-24' },
    });
    const w = periodWindows('2026-10-30', 30);
    expect(w.current).toEqual({ from: '2026-10-01', to: '2026-10-30' });
    expect(w.previous.to).toBe('2026-09-30');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });

  it('30 gunluk pencerede yalniz 16-30 Ekim kayitliysa kapsam 15 gun, eksik', () => {
    const dates = Array.from({ length: 15 }, (_, i) => addDays('2026-10-16', i));
    const c = snapshotCoverage(dates, '2026-10-01', '2026-10-30', 30);
    expect(c).toMatchObject({ requestedDays: 30, coveredDays: 15, from: '2026-10-16', to: '2026-10-30', complete: false });
    const tam = snapshotCoverage(Array.from({ length: 30 }, (_, i) => addDays('2026-10-01', i)), '2026-10-01', '2026-10-30', 30);
    expect(tam.complete).toBe(true);
  });
});

describe('siralama takibi', () => {
  const current = [
    qm('yas hesaplama', 1367, 114_737, 4.3),
    qm('damga vergisi hesaplama', 120, 9000, 2.1),
    qm('esnaf kefalet kredisi', 40, 3000, 12.5),
    qm('nadir sorgu', 0, 5, 30),
    qm('kira artis orani', 90, 6000, 8.0),
  ];
  const previous = [
    qm('yas hesaplama', 1200, 110_000, 5.9), // 5.9 → 4.3: iyilesti +1.6
    qm('damga vergisi hesaplama', 100, 8000, 2.3), // 0.2 hareket: gurultu
    qm('esnaf kefalet kredisi', 50, 2500, 9.0), // 9.0 → 12.5: dustu
    qm('nadir sorgu', 0, 3, 50), // esik alti: degisim yok
  ];

  it('ozet TUM sorgulardan; ilk 3 / ilk 10 / 11-20 GSC pozisyonuyla', () => {
    const r = buildRankings({ current, previous });
    expect(r.summary).toMatchObject({ total: 5, winning: 1, top10: 3, opportunities: 1 });
    // gosterim-agirlikli (duz ortalama 11.4 olurdu)
    expect(r.summary.avgPosition).toBeCloseTo(weightedPosition(current), 1);
    expect(r.summary.avgPosition).toBeLessThan(6);
    expect(r.summary.queryClicks).toBe(1617);
  });

  it('Degisim onceki esit donemle; esik altinda null, yukselen/dusen >= 1 sira', () => {
    const r = buildRankings({ current, previous });
    const by = new Map(r.keywords.map((k) => [k.query, k]));
    expect(by.get('yas hesaplama')!.delta).toBe(1.6);
    expect(by.get('esnaf kefalet kredisi')!.delta).toBe(-3.5);
    expect(by.get('damga vergisi hesaplama')!.delta).toBe(0.2);
    expect(by.get('nadir sorgu')!.delta).toBeNull();
    expect(by.get('kira artis orani')!.delta).toBeNull(); // onceki donemde yok
    expect(r.summary.improving).toBe(1);
    expect(r.summary.declining).toBe(1);
    expect(by.get('yas hesaplama')).toMatchObject({ clicks: 1367, impressions: 114_737, position: 4.3, ctr: 1.19 });
  });

  it('liste kesilse bile ozet degismez; sparkline yoksa bos dizi (sahte duz cizgi yok)', () => {
    const r = buildRankings({ current, previous, limit: 2 });
    expect(r.keywords.map((k) => k.query)).toEqual(['yas hesaplama', 'damga vergisi hesaplama']);
    expect(r.truncated).toBe(true);
    expect(r.summary.total).toBe(5);
    expect(r.keywords[0].sparkline).toEqual([]);
  });

  it('rankingDelta: bir donem esik altindaysa null', () => {
    expect(rankingDelta({ impressions: 9, position: 3 }, { impressions: 500, position: 9 })).toBeNull();
    expect(rankingDelta({ impressions: 50, position: 3 }, undefined)).toBeNull();
    expect(rankingDelta({ impressions: 50, position: 3 }, { impressions: 50, position: 9 })).toBe(6);
  });

  it('sayfa: sorgunun en cok tiklanan sayfasi; seri: gun sirali', () => {
    const pages = topPageByQuery([
      { keys: ['yas hesaplama', 'https://ornek.com/a'], clicks: 10, impressions: 100 },
      { keys: ['yas hesaplama', 'https://ornek.com/b'], clicks: 30, impressions: 50 },
    ]);
    expect(pages.get('yas hesaplama')).toBe('https://ornek.com/b');
    const s = sparklinesFromRows([
      { keys: ['yas hesaplama', '2026-10-02'], position: 4.44 },
      { keys: ['yas hesaplama', '2026-10-01'], position: 4.1 },
    ]);
    expect(s.get('yas hesaplama')).toEqual([{ date: '2026-10-01', position: 4.1 }, { date: '2026-10-02', position: 4.4 }]);
  });

  it('regex filtresi ozel karakterleri kacislar ve parcalara boler', () => {
    const [one] = exactQueryRegexChunks(['c++ nedir', 'a.b']);
    expect(one).toBe('^(?:c\\+\\+ nedir|a\\.b)$');
    expect(new RegExp(one).test('c++ nedir')).toBe(true);
    expect(new RegExp(one).test('c++ nedirler')).toBe(false);
    const many = exactQueryRegexChunks(Array.from({ length: 300 }, (_, i) => `uzun bir sorgu metni ${i}`), 500);
    expect(many.length).toBeGreaterThan(1);
    expect(many.every((c) => c.length <= 500)).toBe(true);
  });
});

describe('yukselen / dusen sorgular', () => {
  // Panelde "esnaf kefalet kredisi 2.204 gosterim +%31.386" goruluyordu; gercek:
  // son 7 gun 258, onceki 7 gun 2.115 (−%88). Damga vergisi 122 vs 2.647 (−%95).
  const current = [
    qm('esnaf kefalet kredisi', 10, 258, 9),
    qm('damga vergisi hesaplama', 4, 122, 3),
    qm('kira artis orani', 60, 900, 5), // 400 → 900: +%125
    qm('yeni cikan sorgu', 5, 300, 8), // onceki 3 gosterim: "yeni"
    qm('kucuk sorgu', 1, 40, 8), // esik alti
    qm('sabit sorgu', 20, 1000, 4), // 950 → 1000: +%5, yukselen degil
  ];
  const previous = [
    qm('esnaf kefalet kredisi', 80, 2115, 6),
    qm('damga vergisi hesaplama', 60, 2647, 2),
    qm('kira artis orani', 20, 400, 6),
    qm('yeni cikan sorgu', 0, 3, 40),
    qm('kucuk sorgu', 0, 2, 50),
    qm('sabit sorgu', 19, 950, 4),
  ];

  it('dusen sorgu ASLA yukselen gorunmez; isaret dogru', () => {
    const r = compareQueryPeriods(current, previous);
    expect(r.rising.map((t) => t.query)).not.toContain('esnaf kefalet kredisi');
    expect(r.rising.map((t) => t.query)).not.toContain('damga vergisi hesaplama');
    const esnaf = r.falling.find((t) => t.query === 'esnaf kefalet kredisi')!;
    expect(esnaf).toMatchObject({ recentImp: 258, prevImp: 2115, growthPct: -88, isNew: false });
    expect(r.falling.find((t) => t.query === 'damga vergisi hesaplama')!.growthPct).toBe(-95);
  });

  it('esik: en az 50 gosterim; onceki < 10 ise yuzde yerine "yeni"', () => {
    const r = compareQueryPeriods(current, previous);
    expect(r.rising.map((t) => t.query)).toEqual(['kira artis orani', 'yeni cikan sorgu']);
    expect(r.rising[0].growthPct).toBe(125);
    expect(r.rising[1]).toMatchObject({ isNew: true, growthPct: null });
  });
});

describe('haftalik e-posta ozeti', () => {
  it('son 7 VERI gunu (bugun degil) ve onceki hafta; eksik onceki hafta karsilastirilmaz', () => {
    const rows = Array.from({ length: 10 }, (_, i) => ({
      date: new Date(`${addDays('2026-10-21', i)}T00:00:00Z`), // 21..30 Ekim
      totalClicks: 100, totalImpressions: 1000, avgPosition: 7,
    }));
    const w = weeklySiteSummary(rows)!;
    expect(w.current).toEqual({ from: '2026-10-24', to: '2026-10-30' });
    expect(w.coveredDays).toBe(7);
    expect(w.clicks).toBe(700);
    expect(w.prevCoveredDays).toBe(3);
    expect(w.comparable).toBe(false); // 3 gune karsi 7 gun = sahte buyume
    expect(w.position).toBeCloseTo(7, 6);
  });
});
