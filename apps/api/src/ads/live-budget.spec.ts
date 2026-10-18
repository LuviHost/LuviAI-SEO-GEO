import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Logger } from '@nestjs/common';

vi.mock('@luviai/shared', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  decrypt: (s: string) => s,
}));

import { autopilotDailyBudget, liveSyncPatch, sameBudget, type LiveCampaignBudget } from './live-budget.js';
import { GoogleAdsClientService } from './google-ads-client.service.js';
import { MetaAdsClientService } from './meta-ads-client.service.js';
import { AdsClientService } from './ads-client.service.js';
import { AdsBudgetGuardService } from './budget-guard.service.js';
import { CampaignOrchestratorService } from './campaign-orchestrator.service.js';
import { BudgetShifterService } from './budget-shifter.service.js';
import { PerformanceSyncService } from './performance-sync.service.js';

/**
 * G3: otopilot yeni butceyi RanksUp'in kopyasindan (budgetAmount) hesaplayip
 * platforma mutlak deger olarak yaziyordu. Bu dosya (1) saf kurallari, (2)
 * GERCEK Google/Meta istemcileri + orchestrator + kaydirici + guard ile sahte
 * fetch arkasindaki canli hesabi kullanarak bayat bir kaydin hicbir yoldan
 * platform yazimina donusmedigini kanitlar.
 */

const live = (over: Partial<LiveCampaignBudget> = {}): LiveCampaignBudget => ({
  status: 'ACTIVE', platformStatus: 'ENABLED', budgetType: 'daily', amount: 100, ...over,
});

describe('saf kurallar', () => {
  it('sameBudget: kurus ve en kucuk birim yuvarlamasi ayni, gercek degisiklik farkli', () => {
    expect(sameBudget(33.33, 33.333333)).toBe(true);
    expect(sameBudget(1234.56, 1235)).toBe(true);
    expect(sameBudget(100, 100.01)).toBe(true);
    expect(sameBudget(50, 50.4)).toBe(false);
    expect(sameBudget(500, 50)).toBe(false);
    expect(sameBudget(Number.NaN, 50)).toBe(false);
  });

  it('autopilotDailyBudget: yalniz platformda ETKIN + kendi gunluk butcesi olan kampanya', () => {
    expect(autopilotDailyBudget(live())).toEqual({ ok: true, amount: 100 });
    for (const l of [
      live({ status: 'PAUSED' }), live({ status: 'ENDED' }), live({ status: 'OTHER' }),
      live({ budgetType: 'shared' }), live({ budgetType: 'lifetime' }), live({ budgetType: null }), live({ amount: null }), live({ amount: 0 }),
    ]) {
      expect(autopilotDailyBudget(l).ok).toBe(false);
    }
  });

  it('liveSyncPatch: kalici son ENDED, butce kurusuna kadar, tur gunluk/toplam; fark yoksa bos', () => {
    const row = { status: 'ACTIVE', budgetType: 'daily', budgetAmount: 500 };
    expect(liveSyncPatch(row, live({ amount: 50 }))).toEqual({ budgetAmount: 50 });
    expect(liveSyncPatch(row, live({ amount: 500 }))).toEqual({});
    expect(liveSyncPatch(row, live({ amount: 500.004 }))).toEqual({});
    expect(liveSyncPatch(row, live({ status: 'ENDED', platformStatus: 'REMOVED' }))).toEqual({ status: 'ENDED', budgetAmount: 100 });
    expect(liveSyncPatch(row, live({ status: 'ENDED', budgetType: null, amount: null }))).toEqual({ status: 'ENDED' });
    expect(liveSyncPatch(row, live({ status: 'PAUSED', amount: 500 }))).toEqual({});
    expect(liveSyncPatch(row, live({ budgetType: 'lifetime', amount: 9000 }))).toEqual({ budgetType: 'lifetime', budgetAmount: 9000 });
    expect(liveSyncPatch(row, live({ budgetType: 'shared', amount: 300 }))).toEqual({ budgetAmount: 300 });
    expect(liveSyncPatch({ status: 'ACTIVE', budgetType: null, budgetAmount: null }, live({ amount: 33.333333 }))).toEqual({ budgetType: 'daily', budgetAmount: 33.33 });
  });
});

// ─────────────────────────────────────────────────────────────
//  Gercek istemcilerle uctan uca
// ─────────────────────────────────────────────────────────────

const GOOGLE_CID = '1234567890';
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

/**
 * Sahte Google + Meta: canli butceler degistirilebilir; her mutate/POST gercek
 * istemcinin gonderdigi govdeden canli degeri gunceller.
 */
function fakePlatforms(state: { google: number; meta: number; metaStatus?: string }) {
  const googleMutates: any[] = [];
  const metaPosts: Array<{ id: string; daily: number }> = [];
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: any, init?: any) => {
    const url = String(input);
    if (url === 'https://oauth2.googleapis.com/token') return json(200, { access_token: 'at' });
    if (url.endsWith('/googleAds:search')) {
      const q: string = JSON.parse(String(init.body)).query;
      if (q.includes('customer.currency_code')) return json(200, { results: [{ customer: { currencyCode: 'TRY' } }] });
      if (q.includes('metrics.')) {
        // Son 30 gun: harcama 900, tiklama orani %5, ROAS 6 (otopilot artis kosulu)
        return json(200, { results: [{
          campaign: { id: '111', status: 'ENABLED' },
          metrics: { impressions: '1000', clicks: '50', costMicros: '900000000', conversions: 10, conversionsValue: 5400, ctr: 0.05, averageCpc: 18000000 },
        }] });
      }
      const rn = `customers/${GOOGLE_CID}/campaignBudgets/999`;
      return json(200, { results: [{
        // Yayindaki kampanya: campaign.status ENABLED + serving_status SERVING (google-ads-client googleLiveStatus)
        campaign: { status: 'ENABLED', servingStatus: 'SERVING', campaignBudget: rn },
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
        const id = url.split('/').pop()!;
        const daily = Number(new URLSearchParams(String(init.body)).get('daily_budget'));
        metaPosts.push({ id, daily });
        state.meta = daily / 100;
        return json(200, { success: true });
      }
      if (url.includes('fields=currency')) return json(200, { currency: 'TRY' });
      if (url.includes('?fields=effective_status')) {
        return json(200, { id: '222', effective_status: state.metaStatus ?? 'ACTIVE', daily_budget: String(Math.round(state.meta * 100)) });
      }
    }
    return json(404, {});
  });
  return { googleMutates, metaPosts };
}

function realStack(rowsInit: any[]) {
  const rows = new Map(rowsInit.map((c) => [c.id, { ...c }]));
  const kv = new Map<string, string>();
  const site = { id: 's1', name: 'Site', googleAdsRefreshToken: 'rt', googleAdsCustomerId: '123-456-7890', metaAdsAccessToken: 'mt', metaAdsAccountId: 'act_1' };
  const prisma: any = {
    site: {
      findMany: vi.fn(async () => [site]),
      findUniqueOrThrow: vi.fn(async () => site),
    },
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
  return {
    rows,
    kv,
    webhook,
    orchestrator: new CampaignOrchestratorService(prisma, adsClient, google, meta, webhook, guard),
    shifter: new BudgetShifterService(prisma, adsClient, guard),
    sync: new PerformanceSyncService(prisma, adsClient),
  };
}

const gRow = (over: Record<string, unknown> = {}) => ({
  id: 'g1', siteId: 's1', platform: 'google_ads', externalId: '111', name: 'G', objective: 'sales', status: 'ACTIVE',
  budgetType: 'daily', budgetAmount: 500, spend: 900, ctr: 0.05, roas: 6, autopilotActions: null, ...over,
});
const mRow = (over: Record<string, unknown> = {}) => ({
  id: 'm1', siteId: 's1', platform: 'meta_ads', externalId: '222', name: 'M', objective: 'sales', status: 'ACTIVE',
  budgetType: 'daily', budgetAmount: 500, spend: 900, ctr: 0.01, roas: 2, autopilotActions: null, ...over,
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
});

describe('uctan uca: bayat kayit platform yazimina donusmez', () => {
  it('Google: canli 50, kayit 500 → ilk tur YAZIM YOK (eskiden 600 yaziliyordu); kayit 50; sonraki tur 50 → 60', async () => {
    const state = { google: 50, meta: 0 };
    const p = fakePlatforms(state);
    const s = realStack([gRow()]);
    await s.orchestrator.optimizeAutopilotCampaigns();
    expect(p.googleMutates).toHaveLength(0);
    expect(state.google).toBe(50);
    expect(s.rows.get('g1').budgetAmount).toBe(50);
    expect(s.webhook.notify).not.toHaveBeenCalled();

    await s.orchestrator.optimizeAutopilotCampaigns();
    expect(p.googleMutates).toHaveLength(1);
    expect(p.googleMutates[0].operations[0].update.amountMicros).toBe('60000000');
    expect(state.google).toBe(60);
    expect(s.webhook.notify.mock.calls[0][0].message).toContain('50 → 60');
    expect(s.webhook.notify.mock.calls[0][0].message).toContain('Üst sınır 100');
  });

  it('Meta (CBO): canli 50, kayit 500 → yazim yok', async () => {
    const state = { google: 0, meta: 50 };
    const p = fakePlatforms(state);
    const s = realStack([mRow({ ctr: 0.05, roas: 6 })]);
    await s.orchestrator.optimizeAutopilotCampaigns();
    expect(p.metaPosts).toHaveLength(0);
    expect(s.rows.get('m1').budgetAmount).toBe(50);
  });

  it('performance-sync kaydi esitler, ayni tur otopilot canli degerden +%20 yapar (ADS_AUTOPILOT sirasi)', async () => {
    const state = { google: 50, meta: 0 };
    const p = fakePlatforms(state);
    const s = realStack([gRow()]);
    await s.sync.syncAllActive();
    expect(s.rows.get('g1').budgetAmount).toBe(50);
    await s.orchestrator.optimizeAutopilotCampaigns();
    expect(p.googleMutates.map((b) => b.operations[0].update.amountMicros)).toEqual(['60000000']);
  });

  it('kaydirici: zayifin (Meta) canli butcesi 50, kaydi 500 → zayif 400 YAPILMAZ, Google artirilmaz', async () => {
    const state = { google: 500, meta: 50 };
    const p = fakePlatforms(state);
    const s = realStack([gRow({ roas: 6 }), mRow({ roas: 2 })]);
    await s.shifter.shiftBudgets();
    expect(p.metaPosts).toHaveLength(0);
    expect(p.googleMutates).toHaveLength(0);
    expect(state).toMatchObject({ google: 500, meta: 50 });
    expect(s.rows.get('m1').budgetAmount).toBe(50);
  });

  it('kaydirici: arsivlenmis Meta kampanyasi → yazim yok, kayit ENDED (eskiden Meta "azaltildi" sayilip Google artiriliyordu)', async () => {
    const state = { google: 500, meta: 500, metaStatus: 'ARCHIVED' };
    const p = fakePlatforms(state);
    const s = realStack([gRow({ roas: 6 }), mRow({ roas: 2 })]);
    await s.shifter.shiftBudgets();
    expect(p.metaPosts).toHaveLength(0);
    expect(p.googleMutates).toHaveLength(0);
    expect(s.rows.get('m1').status).toBe('ENDED');
  });
});
