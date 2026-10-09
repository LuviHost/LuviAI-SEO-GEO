import { describe, it, expect } from 'vitest';
import {
  buildSearchOpportunities,
  normalizePageKey,
  opportunityDateRange,
  percentileRanks,
  type GaLandingRow,
  type GscPageRow,
} from './search-opportunity.js';

const gsc = (page: string, impressions: number, position: number, clicks = 0): GscPageRow => ({ page, impressions, position, clicks });
const ga = (landingPage: string, sessions: number, sessionKeyEventRate: number, keyEvents: number, engagementRate = 0.5, hostName = 'example.com'): GaLandingRow =>
  ({ hostName, landingPage, sessions, sessionKeyEventRate, keyEvents, engagementRate });

describe('normalizePageKey', () => {
  it('protokol/sorgu/fragman atilir, host kucuk harf, sondaki egik cizgi atilir, yol harf duyarli', () => {
    expect(normalizePageKey('https://EXAMPLE.com/High-Value/?ref=gsc#x')).toBe('example.com/High-Value');
    expect(normalizePageKey('http://example.com/High-Value')).toBe('example.com/High-Value');
    expect(normalizePageKey('example.com/High-Value/')).toBe('example.com/High-Value');
    expect(normalizePageKey('https://example.com/')).toBe('example.com/');
    expect(normalizePageKey('https://example.com')).toBe('example.com/');
  });

  it('Turkce yol: ham ve yuzde kodlu bicim (buyuk/kucuk hex) ayni anahtar', () => {
    const k = normalizePageKey('https://example.com/blog/şirket-kuruluşu');
    expect(normalizePageKey('https://example.com/blog/%C5%9Firket-kurulu%C5%9Fu')).toBe(k);
    expect(normalizePageKey('example.com/blog/%c5%9firket-kurulu%c5%9fu/')).toBe(k);
  });

  it('varsayilan olmayan port korunur; bos / (not set) → null', () => {
    expect(normalizePageKey('https://example.com:8443/a')).toBe('example.com:8443/a');
    expect(normalizePageKey('https://example.com:443/a')).toBe('example.com/a');
    expect(normalizePageKey('(not set)')).toBeNull();
    expect(normalizePageKey('  ')).toBeNull();
  });
});

describe('percentileRanks', () => {
  it('kesin kucuk olanlarin orani; tek deger 1, esitler ayni sira', () => {
    expect(percentileRanks([])).toEqual([]);
    expect(percentileRanks([5])).toEqual([1]);
    expect(percentileRanks([1, 2, 3])).toEqual([0, 0.5, 1]);
    expect(percentileRanks([2, 2, 3])).toEqual([0, 0, 1]);
  });
});

describe('opportunityDateRange', () => {
  it('bitis bugun−3, 28 gunluk pencere', () => {
    expect(opportunityDateRange(new Date('2026-10-09T08:00:00Z'))).toEqual({ startDate: '2026-09-09', endDate: '2026-10-06' });
  });
});

describe('buildSearchOpportunities', () => {
  const gscRows = [
    gsc('https://example.com/a', 1000, 6, 10),
    gsc('https://example.com/b', 100, 5, 2),
    gsc('https://example.com/c?utm=1', 500, 15, 1),
    gsc('https://example.com/d', 5000, 8, 40),   // GA'da yok
    gsc('https://example.com/top', 9000, 2.5),   // zaten ilk 3 → aday degil
    gsc('https://example.com/far', 9000, 25),    // 20'den uzak → aday degil
    gsc('https://example.com/zero', 0, 10),      // gosterim yok
  ];
  const gaRows = [
    ga('/a', 100, 0.1, 10),
    ga('/b/', 10, 0.02, 1),
    ga('/c', 40, 0.05, 3),
    ga('(not set)', 5, 0, 0),
  ];

  it('aday filtresi 4–20, GA eslesenler bilesenlerle once, eslesmeyen sonra; agirlikli siralama', () => {
    const r = buildSearchOpportunities(gscRows, gaRows);
    expect(r.rows.map((x) => x.page)).toEqual([
      'https://example.com/a',       // talep 1, deger 1, erisim .5
      'https://example.com/c?utm=1', // .5, .5, 0
      'https://example.com/b',       // 0, 0, 1
      'https://example.com/d',       // GA eslesmedi → bilesensiz, en sonda
    ]);
    expect(r.rows[0].components).toEqual({ demand: 1, value: 1, reachability: 0.5 });
    expect(r.rows[3]).toMatchObject({ ga: null, components: null, impressions: 5000 });
    expect(r.valueMetric).toBe('sessionKeyEventRate');
    expect(r.coverage).toEqual({ gscPages: 7, gaPages: 3, joined: 3, gscOnly: 1, invalidGaRows: 1 });
    expect(r.totalCandidates).toBe(4);
    expect(r).not.toHaveProperty('rows.0.order');
  });

  it('ayni anahtara dusen satirlar birlestirilir (open-seo sonuncuyu tutuyordu)', () => {
    const r = buildSearchOpportunities(
      [gsc('http://example.com/x', 100, 10, 1), gsc('https://example.com/x/', 300, 6, 9)],
      [ga('/x', 30, 0.1, 2, 0.5), ga('/x/', 10, 0, 0, 0.9)],
    );
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0]).toMatchObject({
      page: 'https://example.com/x/', // en cok gosterim alan URL
      clicks: 10,
      impressions: 400,
      ctr: 0.025,
      position: 7,                    // gosterim agirlikli: (100·10 + 300·6) / 400
      ga: { sessions: 40, keyEvents: 2, engagementRate: 0.6, sessionKeyEventRate: 0.075 },
    });
  });

  it('hic anahtar olay yoksa deger metrigi etkilesim oranina duser', () => {
    const r = buildSearchOpportunities(
      [gsc('https://example.com/a', 100, 5), gsc('https://example.com/b', 100, 5)],
      [ga('/a', 10, 0, 0, 0.9), ga('/b', 10, 0, 0, 0.3)],
    );
    expect(r.valueMetric).toBe('engagementRate');
    expect(r.rows[0].page).toBe('https://example.com/a');
    expect(r.rows[0].components?.value).toBe(1);
  });

  it('farkli host eslesmez; limit uygulanir ama toplam aday sayisi korunur', () => {
    const r = buildSearchOpportunities(
      [gsc('https://www.example.com/a', 100, 5), gsc('https://example.com/b', 50, 5)],
      [ga('/a', 10, 0.1, 1)],
      { limit: 1 },
    );
    expect(r.coverage.joined).toBe(0);
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0].page).toBe('https://www.example.com/a'); // eslesme yok → gosterime gore
    expect(r.totalCandidates).toBe(2);
    // ?limit=abc → NaN: bos liste DEGIL, varsayilan 50
    expect(buildSearchOpportunities([gsc('https://example.com/b', 50, 5)], [], { limit: Number.NaN }).rows).toHaveLength(1);
  });
});
