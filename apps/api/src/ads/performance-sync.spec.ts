import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Logger } from '@nestjs/common';
import { PerformanceSyncService } from './performance-sync.service.js';

/**
 * performance-sync metriklerle birlikte canli butceyi ve kalici durumu da
 * kayda isler (G3/G9). Eskiden yalniz metrikler yaziliyordu: reklam hesabinda
 * degisen butce RanksUp'ta hic guncellenmiyor, arsivlenen/silinen/kaldirilan
 * kampanya ETKIN kaliyor ve otopilot ona dokunmayi surduruyordu.
 */

const metrics = { impressions: 1000, clicks: 50, spend: 120, conversions: 3, ctr: 0.05, cpc: 2.4, roas: 4 };

function setup(campaigns: any[], live: Record<string, any>, opts: { metrics?: any } = {}) {
  const rows = new Map(campaigns.map((c) => [c.id, { ...c }]));
  const site = { id: 's1', googleAdsRefreshToken: 'r', googleAdsCustomerId: '1', metaAdsAccessToken: 't', metaAdsAccountId: 'act_1' };
  const prisma: any = {
    adCampaign: {
      findMany: vi.fn(async () => [...rows.values()].map((c) => ({ ...c, site }))),
      update: vi.fn(async ({ where, data }: any) => { rows.set(where.id, { ...rows.get(where.id), ...data }); return rows.get(where.id); }),
    },
  };
  const adsClient: any = {
    getMetrics: vi.fn(async () => (opts.metrics === undefined ? metrics : opts.metrics)),
    getLiveBudget: vi.fn(async (_s: string, _p: string, ext: string) => (live[ext] ? { ok: true, live: live[ext] } : { ok: false })),
  };
  return { svc: new PerformanceSyncService(prisma, adsClient), prisma, rows };
}

const camp = (over: Record<string, unknown> = {}) => ({
  id: 'c1', siteId: 's1', platform: 'google_ads', externalId: '111', status: 'ACTIVE', budgetType: 'daily', budgetAmount: 500, ...over,
});

beforeEach(() => {
  vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('syncAllActive', () => {
  it('reklam hesabinda degisen gunluk butce kayda islenir (canli 50, kayit 500)', async () => {
    const { svc, rows } = setup([camp()], { '111': { status: 'ACTIVE', platformStatus: 'ENABLED', budgetType: 'daily', amount: 50 } });
    await expect(svc.syncAllActive()).resolves.toEqual({ synced: 1, failed: 0, flagged: 0, ended: 0, budgetsResynced: 1 });
    expect(rows.get('c1')).toMatchObject({ budgetAmount: 50, status: 'ACTIVE', impressions: 1000, roas: 4 });
  });

  it('arsivlenen/silinen (Meta) ya da kaldirilan (Google) kampanya ENDED olur; metrikler yine yazilir', async () => {
    const { svc, rows } = setup([
      camp({ id: 'm1', platform: 'meta_ads', externalId: '201' }),
      camp({ id: 'm2', platform: 'meta_ads', externalId: '202' }),
      camp({ id: 'g1', externalId: '203' }),
    ], {
      '201': { status: 'ENDED', platformStatus: 'ARCHIVED', budgetType: null, amount: null },
      '202': { status: 'ENDED', platformStatus: 'DELETED', budgetType: null, amount: null },
      '203': { status: 'ENDED', platformStatus: 'REMOVED', budgetType: 'daily', amount: 500 },
    });
    await expect(svc.syncAllActive()).resolves.toMatchObject({ synced: 3, ended: 3, budgetsResynced: 0 });
    for (const id of ['m1', 'm2', 'g1']) expect(rows.get(id).status).toBe('ENDED');
    // Butcesi okunamayan arsivli kampanyanin kayitli butcesine dokunulmaz
    expect(rows.get('m1').budgetAmount).toBe(500);
  });

  it('platformda duraklatilmis kampanya ETKIN kalir (otopilot canli durumu okuyup dokunmaz)', async () => {
    const { svc, rows } = setup([camp()], { '111': { status: 'PAUSED', platformStatus: 'PAUSED', budgetType: 'daily', amount: 500 } });
    await svc.syncAllActive();
    expect(rows.get('c1').status).toBe('ACTIVE');
  });

  it('toplam butceye gecmis kampanyanin turu ve tutari islenir', async () => {
    const { svc, rows } = setup([camp()], { '111': { status: 'ACTIVE', platformStatus: 'ACTIVE', budgetType: 'lifetime', amount: 9000 } });
    await svc.syncAllActive();
    expect(rows.get('c1')).toMatchObject({ budgetType: 'lifetime', budgetAmount: 9000 });
  });

  it('metrik gelmese de canli durum islenir; canli okuma basarisizsa butce ve durum korunur', async () => {
    const a = setup([camp()], { '111': { status: 'ENDED', platformStatus: 'REMOVED', budgetType: null, amount: null } }, { metrics: null });
    await expect(a.svc.syncAllActive()).resolves.toMatchObject({ synced: 0, failed: 1, ended: 1 });
    expect(a.rows.get('c1').status).toBe('ENDED');

    const b = setup([camp()], {});
    await expect(b.svc.syncAllActive()).resolves.toMatchObject({ synced: 1, failed: 0, ended: 0, budgetsResynced: 0 });
    expect(b.rows.get('c1')).toMatchObject({ budgetAmount: 500, status: 'ACTIVE', impressions: 1000 });
  });

  it('R18: baslangic tarihi yalniz platformda YAYINDA gorulen ve tarihi bos kampanyaya yazilir; sonra degismez', async () => {
    const yayinda = { status: 'ACTIVE', platformStatus: 'ENABLED', budgetType: 'daily', amount: 500 };
    const a = setup([camp({ startDate: null })], { '111': yayinda });
    const once = Date.now();
    await a.svc.syncAllActive();
    const yazilan = a.rows.get('c1').startDate as Date;
    expect(yazilan).toBeInstanceOf(Date);
    expect(yazilan.getTime()).toBeGreaterThanOrEqual(once);

    // Var olan tarih ezilmez (duraklatilip yeniden acilan kampanyanin ilk baslangici)
    const eski = new Date('2026-01-01T00:00:00Z');
    const b = setup([camp({ startDate: eski })], { '111': yayinda });
    await b.svc.syncAllActive();
    expect(b.rows.get('c1').startDate).toBe(eski);
    expect(b.prisma.adCampaign.update.mock.calls[0][0].data).not.toHaveProperty('startDate');

    // Yayinda olmayan (duraklatilmis, bitmis/baslamamis Google, okunamayan) kampanyaya yazilmaz
    for (const live of [
      { status: 'PAUSED', platformStatus: 'PAUSED', budgetType: 'daily', amount: 500 },
      { status: 'OTHER', platformStatus: 'ENABLED/ENDED', budgetType: 'daily', amount: 500 },
    ]) {
      const c = setup([camp({ startDate: null })], { '111': live });
      await c.svc.syncAllActive();
      expect(c.rows.get('c1').startDate).toBeNull();
    }
    const d = setup([camp({ startDate: null })], {});
    await d.svc.syncAllActive();
    expect(d.rows.get('c1').startDate).toBeNull();
  });

  it('fark yoksa butce/durum alani yazilmaz (yalniz metrikler)', async () => {
    const { svc, prisma } = setup([camp()], { '111': { status: 'ACTIVE', platformStatus: 'ENABLED', budgetType: 'daily', amount: 500 } });
    await svc.syncAllActive();
    const data = prisma.adCampaign.update.mock.calls[0][0].data;
    expect(data).not.toHaveProperty('budgetAmount');
    expect(data).not.toHaveProperty('status');
    expect(data).not.toHaveProperty('budgetType');
  });
});
