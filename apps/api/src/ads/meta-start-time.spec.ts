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
import { PerformanceSyncService } from './performance-sync.service.js';
import { CampaignOrchestratorService } from './campaign-orchestrator.service.js';
import { budgetGuardKey } from './budget-guard.js';

/**
 * Meta — baslangici GELECEKTE olan reklam seti otopilotun "canli gunluk
 * butce"sine girmez (Google serving_status PENDING'in karsiligi).
 *
 * NEDEN VAR: Meta'da baslamamis ad set icin ayri bir effective_status yok
 * (ACTIVE gorunur; baslangic start_time alaninda, Reklam Yoneticisi "Scheduled").
 * Canli okuma yalniz end_time'a bakiyordu: haftaya baslayacak 400 TRY'lik ad
 * set bugunku 100 TRY'lik yayinla toplanip canli butce 500 okunuyordu.
 * performance-sync kaydi 500'e esitliyor, orchestrator +%20 ile 600 yaziyor,
 * budget-guard tabani 500 (tavan 1000) oluyordu; artisin 80 TRY'si musterinin
 * henuz baslamamis yayininin butcesine yaziliyordu.
 *
 * GERCEK Meta istemcisi + AdsClient + guard + performance-sync + orchestrator,
 * worker sirasiyla (sync → orchestrator), sahte Graph API arkasinda.
 */

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const graphTime = (ms: number) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, '+0000');

interface AdSetState { id: string; daily: number; start: string }

function fakeMeta(adsets: AdSetState[]) {
  const posts: Array<{ id: string; daily: number }> = [];
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: any, init?: any) => {
    const url = String(input);
    if (!url.includes('graph.facebook.com')) return json(404, {});
    if (init?.method === 'POST') {
      const id = url.split('/').pop()!;
      const daily = Number(new URLSearchParams(String(init.body)).get('daily_budget'));
      posts.push({ id, daily });
      const a = adsets.find((x) => x.id === id);
      if (a) a.daily = daily;
      return json(200, { success: true });
    }
    if (url.includes('fields=currency')) return json(200, { currency: 'TRY' });
    if (url.includes('/insights')) return json(200, { data: [] }); // metrikler kayittaki gibi kalir
    if (url.includes('/adsets?')) {
      return json(200, { data: adsets.map((a) => ({ id: a.id, status: 'ACTIVE', daily_budget: String(a.daily), start_time: a.start })) });
    }
    // Ad set butceli kampanya (CBO degil)
    if (url.includes('?fields=effective_status')) return json(200, { id: '222', effective_status: 'ACTIVE' });
    return json(404, {});
  });
  return { posts };
}

function realStack(rowsInit: any[]) {
  const rows = new Map(rowsInit.map((c) => [c.id, { ...c }]));
  const kv = new Map<string, string>();
  const site = { id: 's1', name: 'Site', metaAdsAccessToken: 'mt', metaAdsAccountId: 'act_1' };
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
  const tur = async () => {
    await sync.syncAllActive();
    await orchestrator.optimizeAutopilotCampaigns();
  };
  return { rows, kv, webhook, tur };
}

const mRow = (over: Record<string, unknown> = {}) => ({
  id: 'm1', siteId: 's1', platform: 'meta_ads', externalId: '222', name: 'M', objective: 'sales', status: 'ACTIVE',
  budgetType: 'daily', budgetAmount: 100, spend: 900, ctr: 0.05, roas: 8, autopilotActions: null,
  startDate: new Date('2026-01-01T00:00:00Z'), ...over,
});

beforeEach(() => {
  for (const level of ['log', 'warn', 'error'] as const) vi.spyOn(Logger.prototype, level).mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('Meta — henuz baslamamis reklam seti otopilotun canli butcesine girmez', () => {
  it('+%20 yalniz yayindaki ad set\'e yazilir; guard tabani 100 (eskiden 500), haftaya baslayacak ad set\'in butcesi aynen kalir', async () => {
    const adsets: AdSetState[] = [
      { id: '301', daily: 10_000, start: graphTime(Date.now() - 7 * 86_400_000) },
      { id: '302', daily: 40_000, start: graphTime(Date.now() + 7 * 86_400_000) },
    ];
    const p = fakeMeta(adsets);
    const s = realStack([mRow()]);
    await s.tur();

    // Eskiden: kayit 500'e esitlenir, sonra 301 → 12000 ve 302 → 48000 yazilirdi
    expect(p.posts).toEqual([{ id: '301', daily: 12_000 }]);
    expect(adsets.find((a) => a.id === '302')!.daily).toBe(40_000);
    expect(s.rows.get('m1').budgetAmount).toBe(120);
    const guard = JSON.parse(s.kv.get(budgetGuardKey('s1', 'm1'))!);
    expect(guard.baseline).toBe(100);
    expect(s.webhook.notify).toHaveBeenCalledTimes(1);
    expect(s.webhook.notify.mock.calls[0][0].meta).toMatchObject({ oldBudget: 100, newBudget: 120, ceiling: 200 });
  });

  it('ad set baslayinca canli toplam buyur: kayit esitlenir ama artis yapilmaz (tavan ilk degisiklikteki yayindan, 200) — baslamis yayina da sessizce yazilmaz', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    let t = Date.parse('2026-10-10T00:00:00Z');
    vi.setSystemTime(t);
    const adsets: AdSetState[] = [
      { id: '301', daily: 10_000, start: graphTime(t - 7 * 86_400_000) },
      { id: '302', daily: 40_000, start: graphTime(t + 2 * 86_400_000) },
    ];
    const p = fakeMeta(adsets);
    const s = realStack([mRow()]);
    await s.tur();
    expect(p.posts).toEqual([{ id: '301', daily: 12_000 }]);

    // 3 gun sonra (bekleme suresi gecti) 302 yayinda: canli toplam 120 + 400 = 520.
    // performance-sync kaydi esitler; orchestrator artis yapmaz cunku 520 tavanin (200) ustunde.
    t += 3 * 86_400_000;
    vi.setSystemTime(t);
    await s.tur();
    expect(s.rows.get('m1').budgetAmount).toBe(520);
    await s.tur();
    expect(p.posts).toHaveLength(1);
    expect(adsets.find((a) => a.id === '302')!.daily).toBe(40_000);
    expect(s.webhook.notify).toHaveBeenCalledTimes(1);
  });
});
