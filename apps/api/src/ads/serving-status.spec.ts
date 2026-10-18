import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Logger } from '@nestjs/common';

vi.mock('@luviai/shared', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  decrypt: (s: string) => s,
}));

import { GoogleAdsClientService } from './google-ads-client.service.js';
import { MetaAdsClientService } from './meta-ads-client.service.js';
import { AdsClientService } from './ads-client.service.js';
import { AdsBudgetGuardService } from './budget-guard.service.js';
import { BudgetShifterService } from './budget-shifter.service.js';
import { PerformanceSyncService } from './performance-sync.service.js';
import { CampaignOrchestratorService } from './campaign-orchestrator.service.js';

/**
 * R9 — yayinda OLMAYAN kampanya otopilotta "etkin gunluk butce" sayilmaz.
 *
 * NEDEN VAR: Google canli okumasi yalniz campaign.status seciyordu. Bitis
 * tarihi gecen kampanya ENABLED kalir (serving_status ENDED ayri alan); kod
 * onu 'ACTIVE' sayiyordu: kaydirici (6 saatte bir, haftada 2 artis) yayindaki
 * Meta kampanyasinin butcesini %20 %20 kesip harcayamayan bitmis kampanyaya
 * veriyordu (4 haftada 500 → ~84), ters yonde Meta'ya GERCEK +100 verip
 * "ikisinin toplam bütçesi değişmez" sozunu bozuyordu; orchestrator bitmis
 * kampanyayi x2'ye kadar artirip "iyi performans gösteriyor" webhook'u
 * atiyordu. Meta'da ayni bosluk: bitis tarihi gecen kampanya/ad set
 * effective_status ACTIVE gorunur.
 *
 * GERCEK Google/Meta istemcileri + AdsClient + guard + kaydirici +
 * orchestrator + performance-sync, worker sirasiyla (sync → orchestrator →
 * shifter), sahte fetch arkasinda.
 */

const GOOGLE_CID = '1234567890';
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const graphTime = (ms: number) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, '+0000');

interface PlatformState {
  google: number;
  /** campaign.serving_status (null: yanitta yok) */
  googleServing: string | null;
  meta: number;
  /** Meta CBO kampanyasinin stop_time'i (yoksa surekli) */
  metaStop?: string;
}

function fakePlatforms(state: PlatformState) {
  const gaql: string[] = [];
  const googleMutates: any[] = [];
  const metaPosts: Array<{ id: string; daily: number }> = [];
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: any, init?: any) => {
    const url = String(input);
    if (url === 'https://oauth2.googleapis.com/token') return json(200, { access_token: 'at' });
    if (url.endsWith('/googleAds:search')) {
      const q: string = JSON.parse(String(init.body)).query;
      gaql.push(q);
      if (q.includes('customer.currency_code')) return json(200, { results: [{ customer: { currencyCode: 'TRY' } }] });
      if (q.includes('metrics.')) return json(200, { results: [] }); // metrikler kayittaki gibi kalir
      const rn = `customers/${GOOGLE_CID}/campaignBudgets/999`;
      return json(200, { results: [{
        campaign: { status: 'ENABLED', campaignBudget: rn, ...(state.googleServing === null ? {} : { servingStatus: state.googleServing }) },
        campaignBudget: { resourceName: rn, explicitlyShared: false, referenceCount: '1', period: 'DAILY', amountMicros: String(Math.round(state.google * 1_000_000)) },
      }] });
    }
    if (url.endsWith('/campaignBudgets:mutate')) {
      const body = JSON.parse(String(init.body));
      googleMutates.push(body);
      state.google = Number(body.operations[0].update.amountMicros) / 1_000_000;
      return json(200, { results: [{ resourceName: 'x' }] });
    }
    if (url.includes('graph.facebook.com')) {
      if (init?.method === 'POST') {
        const daily = Number(new URLSearchParams(String(init.body)).get('daily_budget'));
        metaPosts.push({ id: url.split('/').pop()!, daily });
        state.meta = daily / 100;
        return json(200, { success: true });
      }
      if (url.includes('fields=currency')) return json(200, { currency: 'TRY' });
      if (url.includes('?fields=effective_status')) {
        return json(200, { id: '222', effective_status: 'ACTIVE', daily_budget: String(Math.round(state.meta * 100)), ...(state.metaStop ? { stop_time: state.metaStop } : {}) });
      }
      if (url.includes('/insights')) return json(200, { data: [] });
    }
    return json(404, {});
  });
  return { gaql, googleMutates, metaPosts };
}

function realStack(rowsInit: any[]) {
  const rows = new Map(rowsInit.map((c) => [c.id, { ...c }]));
  const kv = new Map<string, string>();
  const site = { id: 's1', name: 'Site', googleAdsRefreshToken: 'rt', googleAdsCustomerId: '123-456-7890', metaAdsAccessToken: 'mt', metaAdsAccountId: 'act_1' };
  const prisma: any = {
    site: { findMany: vi.fn(async () => [site]), findUniqueOrThrow: vi.fn(async () => site) },
    adCampaign: {
      findMany: vi.fn(async ({ where }: any = {}) => [...rows.values()]
        .filter((c) => !where?.status || c.status === where.status)
        .map((c) => ({ ...c, site }))),
      update: vi.fn(async ({ where, data }: any) => { rows.set(where.id, { ...rows.get(where.id), ...data }); return rows.get(where.id); }),
    },
    kvStore: {
      findUnique: vi.fn(async ({ where }: any) => (kv.has(where.key) ? { key: where.key, value: kv.get(where.key) } : null)),
      upsert: vi.fn(async ({ where, create }: any) => { kv.set(where.key, create.value); return {}; }),
      deleteMany: vi.fn(async ({ where }: any) => { kv.delete(where.key); return { count: 1 }; }),
    },
  };
  const google = new GoogleAdsClientService(prisma);
  const meta = new MetaAdsClientService(prisma);
  const adsClient = new AdsClientService(prisma, google, meta);
  const guard = new AdsBudgetGuardService(prisma);
  const webhook: any = { notify: vi.fn(async () => ({})) };
  const sync = new PerformanceSyncService(prisma, adsClient);
  const orchestrator = new CampaignOrchestratorService(prisma, adsClient, google, meta, webhook, guard);
  const shifter = new BudgetShifterService(prisma, adsClient, guard);
  // apps/worker ADS_AUTOPILOT sirasi
  const tur = async () => {
    await sync.syncAllActive();
    await orchestrator.optimizeAutopilotCampaigns();
    await shifter.shiftBudgets();
  };
  return { rows, webhook, tur, orchestrator, shifter };
}

const gRow = (over: Record<string, unknown> = {}) => ({
  id: 'g1', siteId: 's1', platform: 'google_ads', externalId: '111', name: 'G', objective: 'sales', status: 'ACTIVE',
  budgetType: 'daily', budgetAmount: 500, spend: 900, ctr: 0.02, roas: 8, autopilotActions: null, startDate: new Date('2026-01-01T00:00:00Z'), ...over,
});
const mRow = (over: Record<string, unknown> = {}) => ({
  id: 'm1', siteId: 's1', platform: 'meta_ads', externalId: '222', name: 'M', objective: 'sales', status: 'ACTIVE',
  budgetType: 'daily', budgetAmount: 500, spend: 900, ctr: 0.01, roas: 4, autopilotActions: null, startDate: new Date('2026-01-01T00:00:00Z'), ...over,
});

beforeEach(() => {
  vi.stubEnv('GOOGLE_CLIENT_ID', 'cid');
  vi.stubEnv('GOOGLE_CLIENT_SECRET', 'sec');
  vi.stubEnv('GOOGLE_ADS_LOGIN_CUSTOMER_ID', '');
  for (const level of ['log', 'warn', 'error'] as const) vi.spyOn(Logger.prototype, level).mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe('R9 — bitmis/askidaki Google kampanyasi (ENABLED + serving_status ≠ SERVING)', () => {
  it('canli okuma campaign.serving_status secer', async () => {
    const p = fakePlatforms({ google: 500, googleServing: 'SERVING', meta: 500 });
    const s = realStack([gRow()]);
    await s.tur();
    expect(p.gaql.find((q) => q.includes('campaign_budget.amount_micros'))).toContain('campaign.serving_status');
  });

  it('bitmis Google KAZANAN: 4 hafta boyunca yayindaki Meta butcesi kesilmez, bitmis kampanyaya hicbir sey yazilmaz', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    let t = Date.parse('2026-10-01T00:00:00Z');
    vi.setSystemTime(t);
    const state: PlatformState = { google: 500, googleServing: 'ENDED', meta: 500 };
    const p = fakePlatforms(state);
    const s = realStack([gRow(), mRow()]);
    for (let i = 0; i < 8; i++) {
      await s.tur();
      t += 3.5 * 86_400_000;
      vi.setSystemTime(t);
    }
    // Eskiden: Meta 500 → 83.89, Google 500 → 916
    expect(state).toMatchObject({ google: 500, meta: 500 });
    expect(p.googleMutates).toHaveLength(0);
    expect(p.metaPosts).toHaveLength(0);
    expect(s.webhook.notify).not.toHaveBeenCalled();
    // Kalici son DEGIL: kayit ETKIN kalir (bitis tarihi uzatilinca otopilot devam eder)
    expect(s.rows.get('g1').status).toBe('ACTIVE');
  });

  it('bitmis Google KAYBEDEN: Meta gercek +%20 almaz (toplam harcama artmaz)', async () => {
    const state: PlatformState = { google: 500, googleServing: 'ENDED', meta: 500 };
    const p = fakePlatforms(state);
    const s = realStack([gRow({ roas: 4 }), mRow({ roas: 8 })]);
    await s.shifter.shiftBudgets();
    expect(state).toMatchObject({ google: 500, meta: 500 });
    expect(p.metaPosts).toHaveLength(0);
    expect(p.googleMutates).toHaveLength(0);
  });

  it('orchestrator askidaki/bekleyen ya da durumu gelmeyen kampanyayi "iyi performans" diye artirmaz', async () => {
    for (const serving of ['ENDED', 'SUSPENDED', 'PENDING', 'NONE', null]) {
      const state: PlatformState = { google: 500, googleServing: serving, meta: 0 };
      const p = fakePlatforms(state);
      const s = realStack([gRow({ ctr: 0.05, roas: 8 })]);
      await s.orchestrator.optimizeAutopilotCampaigns();
      expect(p.googleMutates).toHaveLength(0);
      expect(s.webhook.notify).not.toHaveBeenCalled();
      expect(state.google).toBe(500);
      vi.restoreAllMocks();
      for (const level of ['log', 'warn', 'error'] as const) vi.spyOn(Logger.prototype, level).mockImplementation(() => undefined);
    }
  });

  it('musteri bitis tarihini uzatinca (SERVING) otopilot kaldigi yerden devam eder: +%20', async () => {
    const state: PlatformState = { google: 500, googleServing: 'ENDED', meta: 0 };
    const p = fakePlatforms(state);
    const s = realStack([gRow({ ctr: 0.05, roas: 8 })]);
    await s.tur();
    expect(p.googleMutates).toHaveLength(0);
    state.googleServing = 'SERVING';
    await s.tur();
    expect(p.googleMutates.map((b) => b.operations[0].update.amountMicros)).toEqual(['600000000']);
  });
});

describe('R9 — Meta kampanyasinin yayin takvimi bitmis (CBO stop_time gecmis)', () => {
  it('bitmis Meta KAZANAN: yayindaki Google kesilmez, Meta\'ya yazilmaz', async () => {
    const state: PlatformState = { google: 500, googleServing: 'SERVING', meta: 500, metaStop: graphTime(Date.now() - 3 * 86_400_000) };
    const p = fakePlatforms(state);
    const s = realStack([gRow({ roas: 4 }), mRow({ roas: 8 })]);
    await s.tur();
    expect(state).toMatchObject({ google: 500, meta: 500 });
    expect(p.googleMutates).toHaveLength(0);
    expect(p.metaPosts).toHaveLength(0);
    expect(s.rows.get('m1').status).toBe('ACTIVE');
  });

  it('kontrol: takvimi suren iki kampanyada kaydirma bugunku gibi yapilir (ROAS 8 / 4)', async () => {
    const state: PlatformState = { google: 500, googleServing: 'SERVING', meta: 500, metaStop: graphTime(Date.now() + 30 * 86_400_000) };
    const p = fakePlatforms(state);
    const s = realStack([gRow({ roas: 4 }), mRow({ roas: 8 })]);
    await s.shifter.shiftBudgets();
    expect(state).toMatchObject({ google: 400, meta: 600 });
    expect(p.googleMutates).toHaveLength(1);
    expect(p.metaPosts).toEqual([{ id: '222', daily: 60000 }]);
  });
});
