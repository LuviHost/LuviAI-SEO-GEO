import { describe, it, expect, vi } from 'vitest';
import { AnalyticsService } from './analytics.service.js';
import { GscLiveService } from './gsc-live.service.js';
import { addDays, isoDay } from './gsc-aggregate.js';

/**
 * Servis testleri — sahte webmasters istemcisiyle (ag yok). Gercek bir
 * property'de olculen hatalarin (gsc-aggregate.ts dosya basi) servis
 * seviyesinde geri gelmedigini dogrular. Vitest dekorator metadata'si
 * uretmedigi icin servisler elle kurulur.
 */

type Body = Record<string, any>;
type Row = { keys?: string[]; clicks?: number; impressions?: number; ctr?: number; position?: number };

const LATEST = '2026-10-30';
const row = (keys: string[], clicks: number, impressions: number, position: number): Row => ({
  keys, clicks, impressions, ctr: impressions ? clicks / impressions : 0, position,
});

/** Istek govdesine gore cevap veren sahte searchanalytics */
function fakeApi(route: (b: Body) => Row[]) {
  const calls: Body[] = [];
  const api = {
    query: vi.fn(async ({ requestBody }: { requestBody: Body }) => {
      calls.push(requestBody);
      const all = route(requestBody);
      const start = requestBody.startRow ?? 0;
      return { data: { rows: all.slice(start, start + (requestBody.rowLimit ?? 1000)) } };
    }),
  };
  return { api, calls };
}

const dims = (b: Body) => (b.dimensions ?? []).join(',');

function setup(route: (b: Body) => Row[], site: Record<string, unknown> = {}) {
  const upsert = vi.fn(async () => ({}));
  const siteRow = {
    id: 's1', name: 'Ornek', url: 'https://ornek.com',
    gscPropertyUrl: 'sc-domain:ornek.com', gscRefreshToken: 'sifreli', ...site,
  };
  const prisma: any = {
    site: { findUnique: async () => siteRow, findUniqueOrThrow: async () => siteRow },
    analyticsSnapshot: { upsert, findMany: vi.fn(async () => []), findFirst: vi.fn(async () => null) },
    article: { findMany: async () => [], update: async () => ({}) },
  };
  const gscOAuth: any = { getAuthenticatedClient: async () => ({}) };
  const live = new GscLiveService(prisma, gscOAuth);
  const fake = fakeApi(route);
  live.apiFactory = () => fake.api;
  const svc = new AnalyticsService(prisma, gscOAuth, live);
  return { svc, live, prisma, upsert, ...fake };
}

describe('snapshot toplami — GSC gun agregasi, ilk-50 sayfa toplami DEGIL', () => {
  it('captureSnapshot toplam ve pozisyonu [date] satirindan yazar; sayfalar yalniz detay', async () => {
    const { svc, upsert } = setup((b) => {
      if (dims(b) === 'date') return [row([b.startDate], 760, 48_000, 7.1)];
      // ilk 50 sayfa toplami 690 tiklama / 31.000 gosterim, duz ortalama sira 5.5 — eski yanlis tanim
      if (dims(b) === 'page') return [row(['https://ornek.com/a'], 500, 20_000, 4), row(['https://ornek.com/b'], 190, 11_000, 7)];
      if (dims(b) === 'query,page') return [row(['yas hesaplama', 'https://ornek.com/a'], 40, 3000, 4.2)];
      return [];
    });
    await svc.captureSnapshot('s1', new Date('2026-10-16T00:00:00Z'));
    expect(upsert).toHaveBeenCalledTimes(1);
    const arg = (upsert.mock.calls[0] as any)[0];
    expect(arg.create).toMatchObject({ totalClicks: 760, totalImpressions: 48_000, avgPosition: 7.1 });
    expect(arg.create.avgCtr).toBeCloseTo(760 / 48_000, 6);
    expect(arg.create.pageDetails).toHaveLength(2);
    expect(arg.create.queryDetails[0]).toMatchObject({ query: 'yas hesaplama', page: 'https://ornek.com/a' });
    expect(arg.update).toMatchObject({ totalClicks: 760, totalImpressions: 48_000, avgPosition: 7.1 });
  });

  it('GSC bos donerse hicbir sey yazilmaz', async () => {
    const { svc, upsert } = setup(() => []);
    await svc.captureSnapshot('s1', new Date('2026-10-31T00:00:00Z'));
    expect(upsert).not.toHaveBeenCalled();
  });

  it('backfill: her gun KENDI detayini alir (tum donem listesi son gune yazilmaz); detaysiz gun mevcut detayi ezmez', async () => {
    const days = ['2026-10-28', '2026-10-29', '2026-10-30'];
    const { svc, upsert, calls } = setup((b) => {
      if (dims(b) === 'date') return days.filter((d) => d >= b.startDate && d <= b.endDate).map((d, i) => row([d], 700 + i, 45_000, 7.2));
      if (dims(b) === 'page') return [row([`https://ornek.com/${b.startDate}`], 10, 100, 3)];
      if (dims(b) === 'query,page') return [row([`sorgu ${b.startDate}`, 'https://ornek.com/a'], 5, 50, 3)];
      return [];
    });
    const r = await svc.backfillSnapshots('s1', 30, { detailDays: 2 });
    expect(r.saved).toBe(3);
    expect(r.detailedDays).toBe(2);
    expect(r.totalClicks).toBe(700 + 701 + 702);
    // Toplamlar tek [date] istegiyle
    expect(calls.filter((c) => dims(c) === 'date')).toHaveLength(1);
    const byDay = new Map(upsert.mock.calls.map((c: any) => [isoDay(c[0].where.siteId_date.date), c[0]]));
    expect(byDay.get('2026-10-30').create.queryDetails[0].query).toBe('sorgu 2026-10-30');
    expect(byDay.get('2026-10-29').create.queryDetails[0].query).toBe('sorgu 2026-10-29');
    // detay cekilmeyen gun: create bos liste, update detay alanina DOKUNMAZ
    expect(byDay.get('2026-10-28').create.queryDetails).toEqual([]);
    expect('queryDetails' in byDay.get('2026-10-28').update).toBe(false);
    expect('pageDetails' in byDay.get('2026-10-28').update).toBe(false);
  });
});

/** 30 gunluk donem + onceki 30 gun; gercek degerlerin bicimi */
function rankRoute(b: Body): Row[] {
  const cur = b.startDate === addDays(LATEST, -29);
  const prev = b.startDate === addDays(LATEST, -59);
  switch (dims(b)) {
    case 'date':
      return [row([addDays(LATEST, -1)], 700, 45_000, 7), row([LATEST], 720, 46_000, 7)];
    case '':
      return cur ? [row([], 23_116, 1_431_800, 6.86)] : [];
    case 'query':
      if (cur) {
        return [
          row(['yas hesaplama'], 1367, 114_737, 4.3),
          row(['damga vergisi hesaplama'], 300, 20_000, 2.5),
          row(['esnaf kefalet kredisi'], 40, 4000, 12.5),
          row(['nadir sorgu'], 0, 4, 35),
        ];
      }
      if (prev) {
        return [
          row(['yas hesaplama'], 1100, 100_000, 5.9),
          row(['damga vergisi hesaplama'], 280, 19_000, 2.6),
          row(['esnaf kefalet kredisi'], 60, 4500, 9.0),
        ];
      }
      return [];
    case 'query,page':
      return [row(['yas hesaplama', 'https://ornek.com/yas'], 1300, 110_000, 4.3)];
    case 'query,date':
      return [
        row(['yas hesaplama', addDays(LATEST, -1)], 40, 4000, 4.5),
        row(['yas hesaplama', LATEST], 45, 4100, 4.1),
      ];
    default:
      return [];
  }
}

describe('siralama takibi — canli GSC donem agregasi', () => {
  it('ozet ve sorgu degerleri GSC ile ayni; Degisim onceki esit donemle; trend gercek gunluk sira', async () => {
    const { svc, calls } = setup(rankRoute);
    const r: any = await svc.getRankings('s1', 30);
    expect(r.source).toBe('gsc');
    expect(r.period).toMatchObject({ days: 30, startDate: '2026-10-01', endDate: LATEST, previousStartDate: '2026-09-01', previousEndDate: '2026-09-30' });
    expect(r.summary).toMatchObject({
      total: 4, winning: 1, top10: 2, opportunities: 1,
      improving: 1, declining: 1,
      totalClicks: 23_116, totalImpressions: 1_431_800, avgPosition: 6.9,
      queryClicks: 1707,
    });
    const yas = r.keywords.find((k: any) => k.query === 'yas hesaplama');
    expect(yas).toMatchObject({ clicks: 1367, impressions: 114_737, position: 4.3, delta: 1.6, previousPosition: 5.9, page: 'https://ornek.com/yas' });
    expect(yas.sparkline).toEqual([{ date: addDays(LATEST, -1), position: 4.5 }, { date: LATEST, position: 4.1 }]);
    // Seri yalniz ust sorgular icin cekilir, digerleri bos (sahte duz cizgi yok)
    expect(r.keywords.find((k: any) => k.query === 'esnaf kefalet kredisi').sparkline).toEqual([]);
    const spark = calls.find((c) => dims(c) === 'query,date')!;
    expect(spark.dimensionFilterGroups[0].filters[0].operator).toBe('includingRegex');
    // Esik alti sorgu karsilastirilmaz
    expect(r.keywords.find((k: any) => k.query === 'nadir sorgu').delta).toBeNull();
  });

  it('sonuc onbellekte: ikinci istek GSC\'ye gitmez', async () => {
    const { svc, api } = setup(rankRoute);
    await svc.getRankings('s1', 30);
    const n = api.query.mock.calls.length;
    await svc.getRankings('s1', 30);
    expect(api.query.mock.calls.length).toBe(n);
  });

  it('GSC bagli degilse snapshot\'a dusmez: hasData false, neden not_connected', async () => {
    const { svc, prisma } = setup(rankRoute, { gscRefreshToken: null });
    const r: any = await svc.getRankings('s1', 30);
    expect(r).toMatchObject({ hasData: false, summary: null, reason: 'not_connected' });
    expect(prisma.analyticsSnapshot.findMany).not.toHaveBeenCalled();
  });

  it('GSC hata verirse bos ve neden gsc_error (eski ilk-100 hesabina donulmez)', async () => {
    const { svc } = setup(() => { throw new Error('quota'); });
    const r: any = await svc.getRankings('s1', 7);
    expect(r).toMatchObject({ hasData: false, reason: 'gsc_error' });
  });
});

describe('yukselen sorgular — son 7 tam GSC gunu vs onceki 7', () => {
  it('dusen sorgu yukselen gorunmez; pencere GSC son veri gunune dayanir', async () => {
    const { svc, calls } = setup((b) => {
      if (dims(b) === 'date') return [row([LATEST], 700, 45_000, 7)];
      if (dims(b) === 'query' && b.startDate === addDays(LATEST, -6)) {
        return [row(['esnaf kefalet kredisi'], 10, 258, 9), row(['kira artis orani'], 60, 900, 5)];
      }
      if (dims(b) === 'query' && b.startDate === addDays(LATEST, -13)) {
        return [row(['esnaf kefalet kredisi'], 80, 2115, 6), row(['kira artis orani'], 20, 400, 6)];
      }
      return [];
    });
    const r: any[] = await svc.getTrendingQueries('s1');
    expect(r.map((t) => t.query)).toEqual(['kira artis orani']);
    expect(r[0]).toMatchObject({ recentImp: 900, prevImp: 400, growthPct: 125, isNew: false, from: '2026-10-24', to: LATEST });
    const q = calls.filter((c) => dims(c) === 'query');
    expect(q.map((c) => [c.startDate, c.endDate])).toEqual([['2026-10-24', LATEST], ['2026-10-17', '2026-10-23']]);
  });
});

describe('genel bakis — kapsam ve marka payi', () => {
  it('marka payi GSC donem sorgularindan; bosluklu marka yazimi markali; anonim tiklama ayrica', async () => {
    const { svc, prisma } = setup((b) => {
      if (dims(b) === 'query') {
        return [
          row(['ornekpratik giris'], 100, 1000, 1.2),
          row(['ornek pratik'], 50, 500, 1.1),
          row(['yas hesaplama'], 850, 60_000, 4.3),
        ];
      }
      if (dims(b) === '') return [row([], 1100, 70_000, 5)];
      return [];
    }, { name: 'Ornekpratik', url: 'https://ornekpratik.com' });
    const snaps = Array.from({ length: 15 }, (_, i) => ({
      date: new Date(`${addDays('2026-10-16', i)}T00:00:00Z`),
      totalClicks: 700, totalImpressions: 45_000, avgCtr: 0.0155, avgPosition: 7, queryDetails: [], pageDetails: [],
    }));
    prisma.analyticsSnapshot.findFirst.mockResolvedValue({ date: new Date('2026-10-30T00:00:00Z') });
    prisma.analyticsSnapshot.findMany.mockResolvedValue(snaps);
    // Pencere bugune gore secilir — test tarihi sabit
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-02T10:00:00Z'));
    let o: any;
    try {
      o = await svc.getOverview('s1', 30);
    } finally {
      vi.useRealTimers();
    }
    expect(o.coverage).toMatchObject({ requestedDays: 30, coveredDays: 15, from: '2026-10-16', to: '2026-10-30', complete: false, windowFrom: '2026-10-01', windowTo: '2026-10-30' });
    expect(o.totals.clicks).toBe(15 * 700);
    expect(o.brandSplit).toMatchObject({
      source: 'gsc',
      branded: { clicks: 150, queries: 2 },
      unbranded: { clicks: 850, queries: 1 },
      unbrandedClickSharePct: 85,
      anonymizedClicks: 100,
      from: '2026-10-01',
      to: '2026-10-30',
    });
  });
});
