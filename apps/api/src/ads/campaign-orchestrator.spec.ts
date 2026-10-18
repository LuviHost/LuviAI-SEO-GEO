import { describe, it, expect, vi, afterEach } from 'vitest';
import { CampaignOrchestratorService } from './campaign-orchestrator.service.js';
import { AdsBudgetGuardService } from './budget-guard.service.js';
import { budgetGuardKey } from './budget-guard.js';

/**
 * Otopilot butce artisi ve duraklatma: (1) artis budget-guard'dan gecer,
 * (2) RanksUp kaydi yalniz platform onaylarsa degisir, (3) gecmise once/sonra
 * tutarlari yazilir, (4) hesap RanksUp'in kopyasindan DEGIL reklam
 * platformundaki canli butceden yapilir; kopya bayatsa o tur yazim olmaz.
 * Vitest dekorator metadatasi uretmedigi icin servis elle kurulur.
 */

const T0 = new Date('2026-10-01T00:00:00.000Z');

function campaign(over: Record<string, unknown> = {}) {
  return {
    id: 'c1', siteId: 's1', platform: 'google_ads', externalId: '111', name: 'Kampanya A', objective: 'sales',
    status: 'ACTIVE', budgetType: 'daily', budgetAmount: 100, spend: 500, ctr: 0.05, roas: 6, autopilotActions: null,
    ...over,
  };
}

type Live = { status: string; platformStatus: string; budgetType: string | null; amount: number | null };

/**
 * Sahte reklam platformu: canli butce externalId basina tutulur (varsayilan
 * kayittaki butce). updateBudget gercek istemci gibi davranir: beklenen
 * mevcut deger canli degerle ayni degilse yazmaz (stale), yazinca canli
 * deger degisir.
 */
function setup(
  campaigns: any[],
  opts: { updateOk?: boolean; statusOk?: boolean; live?: Record<string, Partial<Live>> } = {},
) {
  const rows = new Map(campaigns.map((c) => [c.id, { ...c }]));
  const kv = new Map<string, string>();
  const platform = new Map<string, Live>();
  for (const c of campaigns) {
    if (!c.externalId || platform.has(c.externalId)) continue;
    platform.set(c.externalId, {
      status: 'ACTIVE',
      platformStatus: 'ENABLED',
      budgetType: c.budgetType === 'lifetime' ? 'lifetime' : 'daily',
      amount: c.budgetAmount === null || c.budgetAmount === undefined ? 100 : Number(c.budgetAmount),
      ...(opts.live?.[c.externalId] ?? {}),
    });
  }
  const prisma: any = {
    site: { findMany: vi.fn(async () => [{ id: 's1', name: 'Site' }]) },
    adCampaign: {
      findMany: vi.fn(async ({ where }: any) => [...rows.values()].filter((c) => c.siteId === where.siteId && c.status === where.status).map((c) => ({ ...c }))),
      update: vi.fn(async ({ where, data }: any) => { const next = { ...rows.get(where.id), ...data }; rows.set(where.id, next); return next; }),
    },
    kvStore: {
      findUnique: vi.fn(async ({ where }: any) => (kv.has(where.key) ? { key: where.key, value: kv.get(where.key) } : null)),
      upsert: vi.fn(async ({ where, create }: any) => { kv.set(where.key, create.value); return {}; }),
      deleteMany: vi.fn(async ({ where }: any) => { kv.delete(where.key); return { count: 1 }; }),
    },
  };
  const adsClient: any = {
    getLiveBudget: vi.fn(async (_s: string, _p: string, ext: string) => (platform.has(ext) ? { ok: true, live: { ...platform.get(ext)! } } : { ok: false })),
    updateBudget: vi.fn(async (_s: string, _p: string, ext: string, daily: number, expected: number) => {
      if (!(opts.updateOk ?? true)) return { ok: false };
      const live = platform.get(ext);
      if (!live || live.amount === null || Math.abs(live.amount - expected) > 0.01) return { ok: false, stale: true, live: live?.amount ?? undefined };
      live.amount = daily;
      return { ok: true, applied: daily };
    }),
    setStatus: vi.fn(async () => ({ ok: opts.statusOk ?? true })),
  };
  const webhook: any = { notify: vi.fn(async () => ({ ok: true })) };
  const guard = new AdsBudgetGuardService(prisma);
  const svc = new CampaignOrchestratorService(prisma, adsClient, {} as any, {} as any, webhook, guard);
  return { svc, prisma, adsClient, webhook, rows, kv, platform };
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe('optimizeAutopilotCampaigns — butce artisi emniyeti', () => {
  it('ilk artis platforma gider, kayit ve gecmis once/sonra ile yazilir', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(T0);
    const { svc, adsClient, rows, kv, webhook, platform } = setup([campaign()]);
    await expect(svc.optimizeAutopilotCampaigns()).resolves.toEqual({ scanned: 1, actions: 1 });
    // Beklenen mevcut deger (100) canli okumadan gelir
    expect(adsClient.updateBudget).toHaveBeenCalledWith('s1', 'google_ads', '111', 120, 100);
    expect(platform.get('111')!.amount).toBe(120);
    const row = rows.get('c1');
    expect(row.budgetAmount).toBe(120);
    expect(row.autopilotActions).toEqual([
      expect.objectContaining({ action: 'budget-up', budgetBefore: 100, budgetAfter: 120, ceiling: 200, clamped: false }),
    ]);
    expect(JSON.parse(kv.get(budgetGuardKey('s1', 'c1'))!)).toMatchObject({ baseline: 100 });
    const msg = webhook.notify.mock.calls[0][0];
    expect(msg.message).toContain('100 → 120');
    expect(msg.message).not.toMatch(/\bTL\b/);
    expect(msg.title).toBe('Kampanya bütçesi artırıldı');
  });

  it('6 saat sonraki tur artirmaz (24 saatte en fazla 1)', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(T0);
    const { svc, adsClient, rows } = setup([campaign()]);
    await svc.optimizeAutopilotCampaigns();
    vi.setSystemTime(new Date(T0.getTime() + 6 * 3_600_000));
    await expect(svc.optimizeAutopilotCampaigns()).resolves.toEqual({ scanned: 1, actions: 0 });
    expect(adsClient.updateBudget).toHaveBeenCalledTimes(1);
    expect(rows.get('c1').budgetAmount).toBe(120);
  });

  it('kosul bir hafta boyunca 6 saatte bir sursa bile 2 artis: 100 → 144 (eski kod ~x165)', async () => {
    vi.useFakeTimers();
    const { svc, adsClient, rows, platform } = setup([campaign()]);
    for (let hour = 0; hour < 7 * 24; hour += 6) {
      vi.setSystemTime(new Date(T0.getTime() + hour * 3_600_000));
      await svc.optimizeAutopilotCampaigns();
    }
    expect(adsClient.updateBudget).toHaveBeenCalledTimes(2);
    expect(rows.get('c1').budgetAmount).toBe(144);
    expect(platform.get('111')!.amount).toBe(144);
  });

  it('haftalar sonra bile tavan (ilk degisiklikteki butcenin 2 kati) asilmaz', async () => {
    vi.useFakeTimers();
    const { svc, rows, platform } = setup([campaign()]);
    for (let day = 0; day < 60; day++) {
      vi.setSystemTime(new Date(T0.getTime() + day * 24 * 3_600_000));
      await svc.optimizeAutopilotCampaigns();
    }
    expect(rows.get('c1').budgetAmount).toBe(200);
    expect(platform.get('111')!.amount).toBe(200);
    const last = rows.get('c1').autopilotActions.at(-1);
    expect(last).toMatchObject({ budgetBefore: 172.8, budgetAfter: 200, clamped: true });
  });

  it('env ile gevsetilebilir (sahip karari): 12 saat bekleme', async () => {
    vi.stubEnv('ADS_BUDGET_INCREASE_COOLDOWN_HOURS', '12');
    vi.useFakeTimers();
    vi.setSystemTime(T0);
    const { svc, adsClient } = setup([campaign()]);
    await svc.optimizeAutopilotCampaigns();
    vi.setSystemTime(new Date(T0.getTime() + 12 * 3_600_000));
    await svc.optimizeAutopilotCampaigns();
    expect(adsClient.updateBudget).toHaveBeenCalledTimes(2);
  });

  it('platform reddederse kayit degismez, rezervasyon geri alinir (sonraki tur yeniden dener)', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(T0);
    const { svc, adsClient, rows, kv, webhook } = setup([campaign()], { updateOk: false });
    await expect(svc.optimizeAutopilotCampaigns()).resolves.toEqual({ scanned: 1, actions: 0 });
    expect(rows.get('c1').budgetAmount).toBe(100);
    expect(rows.get('c1').autopilotActions).toBeNull();
    expect(kv.has(budgetGuardKey('s1', 'c1'))).toBe(false);
    expect(webhook.notify).not.toHaveBeenCalled();
    // Platform duzelince 6 saat sonra deneyebilir: bekleme basarisiz denemeyle baslamaz
    adsClient.updateBudget.mockResolvedValue({ ok: true, applied: 120 });
    vi.setSystemTime(new Date(T0.getTime() + 6 * 3_600_000));
    await svc.optimizeAutopilotCampaigns();
    expect(rows.get('c1').budgetAmount).toBe(120);
  });

  it('toplam (omur boyu) butceli, butcesiz ya da platform kimligi olmayan kampanyaya dokunulmaz', async () => {
    const { svc, adsClient } = setup([
      campaign({ id: 'life', budgetType: 'lifetime', externalId: '101' }),
      campaign({ id: 'nobudget', budgetAmount: null, externalId: '102' }),
      campaign({ id: 'noext', externalId: null }),
    ]);
    await expect(svc.optimizeAutopilotCampaigns()).resolves.toEqual({ scanned: 3, actions: 0 });
    expect(adsClient.updateBudget).not.toHaveBeenCalled();
  });

  it('bir kampanyadaki hata digerlerini durdurmaz', async () => {
    const { svc, prisma, adsClient, rows } = setup([campaign({ id: 'bozuk' }), campaign({ id: 'saglam', externalId: '222' })]);
    prisma.kvStore.findUnique.mockImplementation(async ({ where }: any) => {
      if (where.key.endsWith(':bozuk')) throw new Error('kv hatasi');
      return null;
    });
    await expect(svc.optimizeAutopilotCampaigns()).resolves.toEqual({ scanned: 2, actions: 1 });
    expect(adsClient.updateBudget).toHaveBeenCalledTimes(1);
    expect(rows.get('saglam').budgetAmount).toBe(120);
    expect(rows.get('bozuk').budgetAmount).toBe(100);
  });
});

describe('optimizeAutopilotCampaigns — canli butce (bayat RanksUp kaydi yazima donusmez)', () => {
  it('canli 50, kayit 500: platforma HICBIR yazim yok, kayit 50\'ye esitlenir; sonraki tur 50 → 60 (eskiden 50 → 600)', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(T0);
    const { svc, adsClient, rows, kv, webhook, platform } = setup([campaign({ budgetAmount: 500 })], { live: { '111': { amount: 50 } } });
    await expect(svc.optimizeAutopilotCampaigns()).resolves.toEqual({ scanned: 1, actions: 0 });
    expect(adsClient.updateBudget).not.toHaveBeenCalled();
    expect(platform.get('111')!.amount).toBe(50);
    expect(rows.get('c1').budgetAmount).toBe(50);
    expect(rows.get('c1').autopilotActions).toBeNull();
    expect(kv.has(budgetGuardKey('s1', 'c1'))).toBe(false);
    expect(webhook.notify).not.toHaveBeenCalled();

    vi.setSystemTime(new Date(T0.getTime() + 6 * 3_600_000));
    await expect(svc.optimizeAutopilotCampaigns()).resolves.toEqual({ scanned: 1, actions: 1 });
    expect(adsClient.updateBudget).toHaveBeenCalledWith('s1', 'google_ads', '111', 60, 50);
    expect(platform.get('111')!.amount).toBe(60);
    // Taban ve tavan canli butceden: 50 x 2 = 100 (eskiden 500 x 2 = 1000)
    expect(rows.get('c1').autopilotActions).toEqual([expect.objectContaining({ budgetBefore: 50, budgetAfter: 60, ceiling: 100 })]);
    expect(JSON.parse(kv.get(budgetGuardKey('s1', 'c1'))!)).toMatchObject({ baseline: 50 });
    expect(webhook.notify.mock.calls[0][0].message).toContain('50 → 60');
  });

  it('canli 1000, kayit 100: "artis" butceyi 120\'ye KESMEZ; kayit 1000\'e esitlenir', async () => {
    const { svc, adsClient, rows, platform } = setup([campaign({ budgetAmount: 100 })], { live: { '111': { amount: 1000 } } });
    await svc.optimizeAutopilotCampaigns();
    expect(adsClient.updateBudget).not.toHaveBeenCalled();
    expect(platform.get('111')!.amount).toBe(1000);
    expect(rows.get('c1').budgetAmount).toBe(1000);
  });

  it('kurus farki (Google mikro birim) bayatlik sayilmaz: artis canli degerden yapilir', async () => {
    const { svc, adsClient, rows } = setup([campaign({ budgetAmount: 33.33 })], { live: { '111': { amount: 33.333333 } } });
    await expect(svc.optimizeAutopilotCampaigns()).resolves.toEqual({ scanned: 1, actions: 1 });
    expect(adsClient.updateBudget).toHaveBeenCalledWith('s1', 'google_ads', '111', 40, 33.333333);
    expect(rows.get('c1').budgetAmount).toBe(40);
  });

  it('platformda duraklatilmis, kaldirilmis, paylasilan ya da toplam butceli kampanyanin butcesine dokunulmaz', async () => {
    const { svc, adsClient, rows } = setup([
      campaign({ id: 'paused', externalId: '201' }),
      campaign({ id: 'removed', externalId: '202' }),
      campaign({ id: 'shared', externalId: '203' }),
      campaign({ id: 'life', externalId: '204' }),
    ], {
      live: {
        '201': { status: 'PAUSED', platformStatus: 'PAUSED' },
        '202': { status: 'ENDED', platformStatus: 'REMOVED' },
        '203': { budgetType: 'shared' },
        '204': { budgetType: 'lifetime', amount: 3000 },
      },
    });
    await expect(svc.optimizeAutopilotCampaigns()).resolves.toEqual({ scanned: 4, actions: 0 });
    expect(adsClient.updateBudget).not.toHaveBeenCalled();
    // Kalici son kayda islenir; duraklatilmis kampanya ETKIN kalir (yeniden acilinca kayit dogru olsun)
    expect(rows.get('removed').status).toBe('ENDED');
    expect(rows.get('paused').status).toBe('ACTIVE');
    expect(rows.get('life')).toMatchObject({ budgetType: 'lifetime', budgetAmount: 3000 });
  });

  it('canli butce okunamazsa hicbir sey yazilmaz', async () => {
    const { svc, adsClient, rows } = setup([campaign()]);
    adsClient.getLiveBudget.mockResolvedValue({ ok: false });
    await expect(svc.optimizeAutopilotCampaigns()).resolves.toEqual({ scanned: 1, actions: 0 });
    expect(adsClient.updateBudget).not.toHaveBeenCalled();
    expect(rows.get('c1').budgetAmount).toBe(100);
  });

  it('butce okuma ile yazma arasinda degisirse (stale) yazim yok, rezervasyon geri alinir', async () => {
    const { svc, adsClient, rows, kv, webhook } = setup([campaign()]);
    adsClient.updateBudget.mockResolvedValueOnce({ ok: false, stale: true, live: 70 });
    await expect(svc.optimizeAutopilotCampaigns()).resolves.toEqual({ scanned: 1, actions: 0 });
    expect(kv.has(budgetGuardKey('s1', 'c1'))).toBe(false);
    expect(rows.get('c1').budgetAmount).toBe(100);
    expect(webhook.notify).not.toHaveBeenCalled();
  });

  it('sonuc belirsizse (platformda artis kalmis olabilir) rezervasyon KORUNUR, kayit ve bildirim yok', async () => {
    const { svc, adsClient, rows, kv, webhook } = setup([campaign()]);
    adsClient.updateBudget.mockResolvedValueOnce({ ok: false, uncertain: true });
    await expect(svc.optimizeAutopilotCampaigns()).resolves.toEqual({ scanned: 1, actions: 0 });
    expect(kv.has(budgetGuardKey('s1', 'c1'))).toBe(true);
    expect(rows.get('c1').budgetAmount).toBe(100);
    expect(rows.get('c1').autopilotActions).toBeNull();
    expect(webhook.notify).not.toHaveBeenCalled();
  });

  it('kayda ve gecmise platformun uyguladigi tutar yazilir (Meta en kucuk birime yuvarlar)', async () => {
    const { svc, adsClient, rows } = setup([campaign({ platform: 'meta_ads' })]);
    adsClient.updateBudget.mockResolvedValueOnce({ ok: true, applied: 120.4 });
    await svc.optimizeAutopilotCampaigns();
    expect(rows.get('c1').budgetAmount).toBe(120.4);
    expect(rows.get('c1').autopilotActions).toEqual([expect.objectContaining({ budgetBefore: 100, budgetAfter: 120.4 })]);
  });
});

describe('optimizeAutopilotCampaigns — duraklatma', () => {
  const lowRoas = { roas: 1.2, ctr: 0.01, spend: 300 };

  it('platform onaylarsa DURAKLATILDI yazilir ve bildirim gider', async () => {
    const { svc, adsClient, rows, webhook } = setup([campaign(lowRoas)]);
    await expect(svc.optimizeAutopilotCampaigns()).resolves.toEqual({ scanned: 1, actions: 1 });
    expect(adsClient.setStatus).toHaveBeenCalledWith('s1', 'google_ads', '111', true);
    expect(rows.get('c1').status).toBe('PAUSED');
    expect(rows.get('c1').autopilotActions).toEqual([expect.objectContaining({ actions: ['pause-low-roas'] })]);
    const msg = webhook.notify.mock.calls[0][0];
    expect(msg.title).toBe('Kampanya duraklatıldı');
    expect(msg.message).not.toMatch(/\bTL\b/);
  });

  it('platform onaylamazsa kayit ETKIN kalir, bildirim gitmez (eskiden panel yanlis "Duraklatıldı" diyordu)', async () => {
    const { svc, rows, webhook } = setup([campaign(lowRoas)], { statusOk: false });
    await expect(svc.optimizeAutopilotCampaigns()).resolves.toEqual({ scanned: 1, actions: 0 });
    expect(rows.get('c1').status).toBe('ACTIVE');
    expect(webhook.notify).not.toHaveBeenCalled();
  });
});
