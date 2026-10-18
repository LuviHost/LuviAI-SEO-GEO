import { describe, it, expect, vi } from 'vitest';
import { AnalyticsService } from './analytics.service.js';
import { ReportsService } from './reports.service.js';

/**
 * GSC markali/markasiz ayriminin iki cagirani (panel ozeti ve donem raporu)
 * sitenin host'unu verir. Jenerik turetilmis markada ("emlak" ← emlak.com)
 * host'suz hesap "emlak ilanlari" gibi her sektor aramasini markali sayip
 * markasiz payi %0 gosteriyordu.
 * Vitest dekorator metadata'si uretmedigi icin servisler elle kurulur.
 */

const q = (query: string, clicks: number) => ({ query, clicks, impressions: clicks * 10 });

function snapshot(date: string, queryDetails: unknown[]) {
  return {
    date: new Date(`${date}T00:00:00Z`), totalClicks: 0, totalImpressions: 0, avgCtr: 0, avgPosition: 0,
    queryDetails, pageDetails: [],
  };
}

const SNAPSHOTS = [
  snapshot('2026-10-10', [q('emlak ilanları', 300), q('emlak.com', 50)]),
  snapshot('2026-10-11', [q('satılık daire emlak', 100), q('emlak.com giriş', 25)]),
];
const SITE = { name: 'emlak', url: 'https://www.emlak.com' };

/** Bilinmeyen her prisma cagrisina bos ama gecerli cevap; testin konusu olanlar ayrica verilir */
function fakePrisma(models: Record<string, Record<string, (...a: any[]) => any>>) {
  const defaults: Record<string, (...a: any[]) => any> = {
    findMany: async () => [], findFirst: async () => null, findUnique: async () => null,
    count: async () => 0, aggregate: async () => ({ _avg: {}, _sum: {} }), groupBy: async () => [],
  };
  return new Proxy({}, {
    get: (_t, model: string) => new Proxy({}, {
      get: (_m, method: string) => vi.fn(models[model]?.[method] ?? defaults[method] ?? (async () => null)),
    }),
  });
}

describe('AnalyticsService.getOverview — brandSplit', () => {
  it('host ile: sektor aramasi markasiz, alan adi markali; gunluk seri ayni karar', async () => {
    const prisma = fakePrisma({
      analyticsSnapshot: { findMany: async () => SNAPSHOTS },
      site: { findUnique: async () => SITE },
    });
    const svc = new AnalyticsService(prisma as never, {} as never);
    const { brandSplit } = await svc.getOverview('s1');
    expect(brandSplit).toMatchObject({
      brand: 'emlak',
      branded: { clicks: 75, queries: 2 },
      unbranded: { clicks: 400, queries: 2 },
      unbrandedClickSharePct: 84.2,
    });
    expect(brandSplit!.series.map((s) => s.unbrandedSharePct)).toEqual([85.7, 80]);
  });
});

describe('ReportsService.overview — brandSplit', () => {
  it('donem raporu panel ozetiyle ayni ayrimi verir', async () => {
    const prisma = fakePrisma({
      analyticsSnapshot: { findMany: async (args: any) => (args?.orderBy ? SNAPSHOTS : []) },
      site: { findUnique: async () => SITE },
    });
    const svc = new ReportsService(prisma as never);
    const r = await svc.overview('s1', { from: new Date('2026-10-01'), to: new Date('2026-10-31') });
    expect(r.search.brandSplit).toMatchObject({
      branded: { clicks: 75, queries: 2 },
      unbranded: { clicks: 400, queries: 2 },
      unbrandedClickSharePct: 84.2,
    });
  });
});
