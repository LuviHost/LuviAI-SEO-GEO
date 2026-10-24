import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * AiTrafficService — GA4 kablolamasi (googleapis sahte), kv_store onbellegi,
 * GA4 bagli degil yolu ve her durumda donen izleme kodu serisi.
 */
const runReport = vi.fn();
vi.mock('googleapis', () => ({
  google: { analyticsdata: () => ({ properties: { runReport } }) },
}));

const { AiTrafficService } = await import('./ai-traffic.service.js');
const { aiSessionSourceRegex } = await import('./ai-traffic.js');

const NOW = new Date('2026-10-24T10:00:00Z');
const CONNECTED = { gaPropertyId: '123', gaRefreshToken: 'enc' };

function setup(opts: { site?: any; cache?: any; hits?: any[]; client?: any } = {}) {
  const kv = new Map<string, any>(opts.cache ? [[opts.cache.key, opts.cache.row]] : []);
  const prisma = {
    site: { findUnique: vi.fn(async () => (opts.site === undefined ? CONNECTED : opts.site)) },
    aiReferrerHit: { findMany: vi.fn(async () => opts.hits ?? []) },
    kvStore: {
      findUnique: vi.fn(async ({ where }: any) => kv.get(where.key) ?? null),
      upsert: vi.fn(async ({ where, create }: any) => { kv.set(where.key, create); return create; }),
    },
  };
  const gaOAuth = { getAuthenticatedClient: vi.fn(async () => (opts.client === undefined ? {} : opts.client)) };
  return { svc: new AiTrafficService(prisma as any, gaOAuth as any), prisma, gaOAuth, kv };
}

const row = (dims: string[], mets: number[]) => ({ dimensionValues: dims.map((value) => ({ value })), metricValues: mets.map((m) => ({ value: String(m) })) });

function gaReplies() {
  runReport.mockImplementation(async ({ requestBody }: any) => {
    const dims = (requestBody.dimensions ?? []).map((d: any) => d.name).join(',');
    if (dims === 'date,sessionSource') return { data: { rows: [row(['20261020', 'chatgpt.com'], [7, 4, 1, 0])] } };
    if (dims === 'sessionSource,landingPage') return { data: { rows: [row(['chatgpt.com', '/blog'], [7, 4, 1])], rowCount: 1 } };
    return { data: { rows: [row([], [700])] } };
  });
}

describe('AiTrafficService.get', () => {
  beforeEach(() => { runReport.mockReset(); });

  it('GA4 bagli degil: Google\'a gidilmez, ga null + reason, izleme kodu serisi yine doner', async () => {
    const { svc, gaOAuth } = setup({
      site: { gaPropertyId: null, gaRefreshToken: null },
      hits: [{ date: new Date('2026-10-20T00:00:00Z'), referrer: 'chatgpt', hits: 3, topUrls: [] }],
    });
    const r = await svc.get('s1', '28', NOW);
    expect(r.ga).toBeNull();
    expect(r.reason).toBe('not_connected');
    expect(r.tracker.totalHits).toBe(3);
    expect(r.dateRange).toEqual({ startDate: '2026-09-26', endDate: '2026-10-23' });
    expect(r.measurement.gaSourceDomains).toContain('chatgpt.com');
    expect(runReport).not.toHaveBeenCalled();
    expect(gaOAuth.getAuthenticatedClient).not.toHaveBeenCalled();
  });

  it('GA4 bagli: uc rapor, ayni mulk ve pencere, regex tek kaynaktan; sonuc onbellege yazilir', async () => {
    gaReplies();
    const { svc, prisma, kv } = setup();
    const r = await svc.get('s1', '90', NOW);
    expect(runReport).toHaveBeenCalledTimes(3);
    for (const [arg] of runReport.mock.calls) {
      expect(arg.property).toBe('properties/123');
      expect(arg.requestBody.dateRanges).toEqual([{ startDate: '2026-07-26', endDate: '2026-10-23' }]);
      if (arg.requestBody.dimensionFilter) expect(arg.requestBody.dimensionFilter.filter.stringFilter.value).toBe(aiSessionSourceRegex());
    }
    expect(r.ga?.totals.sessions).toBe(7);
    expect(r.ga?.siteSessions).toBe(700);
    expect(r.ga?.aiShare).toBeCloseTo(0.01);
    expect(r.ga?.landingPages[0].page).toBe('/blog');
    expect(r.ga?.daily).toHaveLength(90);
    expect(prisma.kvStore.upsert).toHaveBeenCalledTimes(1);
    const saved = kv.get('ai-traffic:v1:s1:90');
    expect(JSON.parse(saved.value).fingerprint).toBe('2026-10-23|123');
    expect(saved.expiresAt.getTime() - Date.now()).toBeGreaterThan(5.9 * 3600_000);
  });

  it('onbellek isabeti: Google\'a gidilmez; mulk degistiyse (parmak izi) yeniden cekilir', async () => {
    gaReplies();
    const env = { fingerprint: '2026-10-23|123', data: { totals: { sessions: 42 }, generatedAt: 'x' } };
    const cache = { key: 'ai-traffic:v1:s1:28', row: { value: JSON.stringify(env), expiresAt: new Date(Date.now() + 3600_000) } };
    const hit = await setup({ cache }).svc.get('s1', '28', NOW);
    expect((hit.ga as any).totals.sessions).toBe(42);
    expect(runReport).not.toHaveBeenCalled();

    const moved = await setup({ cache, site: { gaPropertyId: '999', gaRefreshToken: 'enc' } }).svc.get('s1', '28', NOW);
    expect(runReport).toHaveBeenCalled();
    expect(moved.ga?.totals.sessions).toBe(7);
  });

  it('gelir metrigi reddedilirse gelirsiz tekrar dener', async () => {
    let dailyCalls = 0;
    runReport.mockImplementation(async ({ requestBody }: any) => {
      const dims = (requestBody.dimensions ?? []).map((d: any) => d.name).join(',');
      if (dims === 'date,sessionSource') {
        dailyCalls++;
        if (requestBody.metrics.some((m: any) => m.name === 'totalRevenue')) throw Object.assign(new Error('Field totalRevenue is not valid'), { code: 400 });
        return { data: { rows: [row(['20261020', 'claude.ai'], [2, 1, 0])] } };
      }
      return { data: { rows: [] } };
    });
    const r = await setup().svc.get('s1', '28', NOW);
    expect(dailyCalls).toBe(2);
    expect(r.ga?.revenueAvailable).toBe(false);
    expect(r.ga?.totals.revenue).toBeNull();
    expect(r.ga?.byAssistant[0].key).toBe('claude');
  });

  it('yetki hatalari nedene cevrilir, onbellege yazilmaz; tracker yine doner', async () => {
    runReport.mockRejectedValue(Object.assign(new Error('invalid_grant'), { code: 401 }));
    const a = setup();
    const r = await a.svc.get('s1', '28', NOW);
    expect(r).toMatchObject({ ga: null, reason: 'auth_error' });
    expect(r.tracker.totalHits).toBe(0);
    expect(a.prisma.kvStore.upsert).not.toHaveBeenCalled();

    runReport.mockRejectedValue(Object.assign(new Error('User does not have sufficient permissions'), { code: 403 }));
    expect((await setup().svc.get('s1', '28', NOW)).reason).toBe('permission');

    runReport.mockRejectedValue(new Error('socket hang up'));
    expect((await setup().svc.get('s1', '28', NOW)).reason).toBe('unavailable');
  });

  it('OAuth istemcisi alinamazsa not_connected', async () => {
    const r = await setup({ client: null }).svc.get('s1', '28', NOW);
    expect(r).toMatchObject({ ga: null, reason: 'not_connected' });
    expect(runReport).not.toHaveBeenCalled();
  });
});
