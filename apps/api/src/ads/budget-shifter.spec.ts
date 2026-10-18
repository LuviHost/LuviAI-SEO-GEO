import { describe, it, expect, vi, afterEach } from 'vitest';
import { BudgetShifterService } from './budget-shifter.service.js';
import { AdsBudgetGuardService } from './budget-guard.service.js';
import { budgetGuardKey } from './budget-guard.js';

/**
 * Google ↔ Meta butce kaydirma: toplam sabit kalir, kazanana eklenen budget-guard'dan
 * gecer, iki hesap ayni para biriminde degilse tutar tasinmaz, platform onaylamayan
 * degisiklik kayda yazilmaz. Tutarlar RanksUp kopyasindan DEGIL iki kampanyanin
 * canli butcesinden hesaplanir; kopya bayatsa o tur kaydirma yapilmaz.
 */

const T0 = new Date('2026-10-01T00:00:00.000Z');

const google = (over: Record<string, unknown> = {}) => ({
  id: 'g1', siteId: 's1', platform: 'google_ads', externalId: '111', name: 'G', objective: 'sales', status: 'ACTIVE',
  budgetType: 'daily', budgetAmount: 100, spend: 400, roas: 6, ctr: 0.02, autopilotActions: null, ...over,
});
const meta = (over: Record<string, unknown> = {}) => ({
  id: 'm1', siteId: 's1', platform: 'meta_ads', externalId: '222', name: 'M', objective: 'sales', status: 'ACTIVE',
  budgetType: 'daily', budgetAmount: 200, spend: 400, roas: 2, ctr: 0.02, autopilotActions: null, ...over,
});

type Live = { status: string; platformStatus: string; budgetType: string | null; amount: number | null };

/**
 * Sahte platform: canli butce externalId basina (varsayilan kayittaki butce).
 * updateBudget gercek istemci gibi: beklenen mevcut deger canli degilse yazmaz.
 * Testler mockResolvedValueOnce ile tek cagrinin sonucunu degistirebilir.
 */
function setup(
  campaigns: any[],
  currencies: { google_ads: string | null; meta_ads: string | null } = { google_ads: 'TRY', meta_ads: 'TRY' },
  live: Record<string, Partial<Live>> = {},
) {
  const rows = new Map(campaigns.map((c) => [c.id, { ...c }]));
  const kv = new Map<string, string>();
  const platform = new Map<string, Live>(campaigns.map((c) => [c.externalId, {
    status: 'ACTIVE', platformStatus: 'ACTIVE', budgetType: 'daily', amount: Number(c.budgetAmount), ...(live[c.externalId] ?? {}),
  }]));
  const prisma: any = {
    site: { findMany: vi.fn(async () => [{ id: 's1', name: 'Site' }]) },
    adCampaign: {
      findMany: vi.fn(async () => [...rows.values()].map((c) => ({ ...c }))),
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
      const l = platform.get(ext);
      if (!l || l.amount === null || Math.abs(l.amount - expected) > 0.01) return { ok: false, stale: true, live: l?.amount ?? undefined };
      l.amount = daily;
      return { ok: true, applied: daily };
    }),
    getAccountCurrency: vi.fn(async (_s: string, p: 'google_ads' | 'meta_ads') => currencies[p]),
  };
  const svc = new BudgetShifterService(prisma, adsClient, new AdsBudgetGuardService(prisma));
  return { svc, prisma, adsClient, rows, kv, platform };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('shiftBudgets', () => {
  it('ayni birimde: once zayif azaltilir, sonra guclu artirilir; toplam sabit; gecmise once/sonra yazilir', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(T0);
    const { svc, adsClient, rows, kv, platform } = setup([google(), meta()]);
    await expect(svc.shiftBudgets()).resolves.toEqual({ pairsAnalyzed: 1, shifts: 1 });
    // %20 x 200 = 40 → Google 100 → 140, Meta 200 → 160; her yazim canli degeri bekler
    expect(adsClient.updateBudget.mock.calls).toEqual([
      ['s1', 'meta_ads', '222', 160, 200],
      ['s1', 'google_ads', '111', 140, 100],
    ]);
    expect(Number(platform.get('111')!.amount) + Number(platform.get('222')!.amount)).toBe(300);
    expect(rows.get('g1').budgetAmount).toBe(140);
    expect(rows.get('m1').budgetAmount).toBe(160);
    expect(rows.get('g1').autopilotActions).toEqual([expect.objectContaining({ action: 'budget-shift-in', budgetBefore: 100, budgetAfter: 140, currency: 'TRY' })]);
    expect(rows.get('m1').autopilotActions).toEqual([expect.objectContaining({ action: 'budget-shift-out', budgetBefore: 200, budgetAfter: 160 })]);
    // Iki kampanyanin da tabani kaydedildi
    expect(JSON.parse(kv.get(budgetGuardKey('s1', 'g1'))!).baseline).toBe(100);
    expect(JSON.parse(kv.get(budgetGuardKey('s1', 'm1'))!).baseline).toBe(200);
  });

  it('para birimleri farkli ya da bilinmiyorsa tutar tasinmaz (USD 40 → TL hesaba 40 eklenmez)', async () => {
    for (const cur of [{ google_ads: 'TRY', meta_ads: 'USD' }, { google_ads: 'TRY', meta_ads: null }]) {
      const { svc, adsClient, rows } = setup([google(), meta()], cur);
      await expect(svc.shiftBudgets()).resolves.toEqual({ pairsAnalyzed: 1, shifts: 0 });
      expect(adsClient.updateBudget).not.toHaveBeenCalled();
      expect(rows.get('g1').budgetAmount).toBe(100);
    }
  });

  it('kazananin artisi tavana kirpilirsa zayiftan alinan da kirpilir (toplam degismez)', async () => {
    const { svc, adsClient, kv } = setup([google({ budgetAmount: 190 }), meta()]);
    kv.set(budgetGuardKey('s1', 'g1'), JSON.stringify({ v: 1, baseline: 100, baselineAt: T0.toISOString(), increases: [] }));
    await svc.shiftBudgets();
    // Tavan 200: Google 190 → 200 (+10), Meta 200 → 190
    expect(adsClient.updateBudget.mock.calls).toEqual([
      ['s1', 'meta_ads', '222', 190, 200],
      ['s1', 'google_ads', '111', 200, 190],
    ]);
  });

  it('guard izin vermezse (24 saat icinde ikinci kez) hicbir platform cagrisi yapilmaz', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(T0);
    const { svc, adsClient } = setup([google(), meta()]);
    await svc.shiftBudgets();
    adsClient.updateBudget.mockClear();
    vi.setSystemTime(new Date(T0.getTime() + 6 * 3_600_000));
    await expect(svc.shiftBudgets()).resolves.toEqual({ pairsAnalyzed: 1, shifts: 0 });
    expect(adsClient.updateBudget).not.toHaveBeenCalled();
  });

  it('azaltma reddedilirse hicbir sey degismez ve rezervasyon geri alinir', async () => {
    const { svc, adsClient, rows, kv } = setup([google(), meta()]);
    adsClient.updateBudget.mockResolvedValueOnce({ ok: false });
    await expect(svc.shiftBudgets()).resolves.toEqual({ pairsAnalyzed: 1, shifts: 0 });
    expect(adsClient.updateBudget).toHaveBeenCalledTimes(1);
    expect(rows.get('m1').budgetAmount).toBe(200);
    expect(kv.has(budgetGuardKey('s1', 'g1'))).toBe(false);
  });

  it('artis reddedilirse azaltilan butce geri alinir; kayit degismez; guard rezervasyonu geri alinir', async () => {
    const { svc, adsClient, rows, kv } = setup([google(), meta()]);
    adsClient.updateBudget
      .mockResolvedValueOnce({ ok: true, applied: 160 })   // meta azalt
      .mockResolvedValueOnce({ ok: false })                // google artir
      .mockResolvedValueOnce({ ok: true, applied: 200 });  // meta geri al
    await expect(svc.shiftBudgets()).resolves.toEqual({ pairsAnalyzed: 1, shifts: 0 });
    // Geri alma zayifin CANLI eski butcesine (200), beklenen mevcut deger az once yazilan (160)
    expect(adsClient.updateBudget.mock.calls[2]).toEqual(['s1', 'meta_ads', '222', 200, 160]);
    expect(rows.get('m1').budgetAmount).toBe(200);
    expect(rows.get('g1').budgetAmount).toBe(100);
    // Reddedilen artis guard'da hayalet artis birakmaz (24 saat bekleme + haftalik hak yanmaz)
    expect(kv.has(budgetGuardKey('s1', 'g1'))).toBe(false);
  });

  it('geri alma da basarisizsa kayit platformdaki gercegi yazar: zayif azaldi, guclu degismedi (toplam yalniz DUSER)', async () => {
    const { svc, adsClient, rows, kv } = setup([google(), meta()]);
    adsClient.updateBudget
      .mockResolvedValueOnce({ ok: true, applied: 160 })
      .mockResolvedValueOnce({ ok: false })
      .mockResolvedValueOnce({ ok: false });
    await svc.shiftBudgets();
    expect(rows.get('m1').budgetAmount).toBe(160);
    expect(rows.get('m1').autopilotActions).toEqual([expect.objectContaining({ action: 'budget-shift-out', completed: false })]);
    expect(rows.get('m1').autopilotActions[0]).not.toHaveProperty('uncertain');
    expect(rows.get('g1').budgetAmount).toBe(100);
    expect(kv.has(budgetGuardKey('s1', 'g1'))).toBe(false);
  });

  it('toplam (omur boyu) butceli kampanyada kaydirma yapilmaz', async () => {
    const { svc, adsClient } = setup([google(), meta({ budgetType: 'lifetime' })]);
    await svc.shiftBudgets();
    expect(adsClient.updateBudget).not.toHaveBeenCalled();
    expect(adsClient.getAccountCurrency).not.toHaveBeenCalled();
  });

  it('ROAS farki 1,5 katin altindaysa para birimi bile sorulmaz', async () => {
    const { svc, adsClient } = setup([google({ roas: 2.5 }), meta({ roas: 2 })]);
    await expect(svc.shiftBudgets()).resolves.toEqual({ pairsAnalyzed: 1, shifts: 0 });
    expect(adsClient.getAccountCurrency).not.toHaveBeenCalled();
  });
});

describe('shiftBudgets — canli butce (bayat kayit tutar tasimaz)', () => {
  it('zayifin canli butcesi 50, kaydi 500: "azaltma" 400 YAZILMAZ (eskiden zayif 8 kat artiyordu); kayit esitlenir', async () => {
    const { svc, adsClient, rows, kv, platform } = setup([google(), meta({ budgetAmount: 500 })], undefined, { '222': { amount: 50 } });
    await expect(svc.shiftBudgets()).resolves.toEqual({ pairsAnalyzed: 1, shifts: 0 });
    expect(adsClient.updateBudget).not.toHaveBeenCalled();
    expect(platform.get('222')!.amount).toBe(50);
    expect(rows.get('m1').budgetAmount).toBe(50);
    expect(kv.size).toBe(0);
  });

  it('kayitlar esitlendikten sonraki tur canli degerlerle kaydirir: Meta 50 → 40, Google 100 → 110', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(T0);
    const { svc, adsClient, rows } = setup([google(), meta({ budgetAmount: 500 })], undefined, { '222': { amount: 50 } });
    await svc.shiftBudgets();
    vi.setSystemTime(new Date(T0.getTime() + 6 * 3_600_000));
    await expect(svc.shiftBudgets()).resolves.toEqual({ pairsAnalyzed: 1, shifts: 1 });
    expect(adsClient.updateBudget.mock.calls).toEqual([
      ['s1', 'meta_ads', '222', 40, 50],
      ['s1', 'google_ads', '111', 110, 100],
    ]);
    expect(rows.get('m1').autopilotActions).toEqual([expect.objectContaining({ budgetBefore: 50, budgetAfter: 40 })]);
  });

  it('kazananin kaydi bayatsa (canli 300, kayit 100) kaydirma yok, kayit esitlenir', async () => {
    const { svc, adsClient, rows } = setup([google(), meta()], undefined, { '111': { amount: 300 } });
    await svc.shiftBudgets();
    expect(adsClient.updateBudget).not.toHaveBeenCalled();
    expect(rows.get('g1').budgetAmount).toBe(300);
  });

  it('platformda etkin olmayan (arsivlenmis) kampanyayla kaydirma yok; kalici son kayda islenir', async () => {
    const { svc, adsClient, rows } = setup([google(), meta()], undefined, { '222': { status: 'ENDED', platformStatus: 'ARCHIVED', budgetType: 'daily' } });
    await svc.shiftBudgets();
    expect(adsClient.updateBudget).not.toHaveBeenCalled();
    expect(rows.get('m1').status).toBe('ENDED');
  });

  it('canli butce okunamazsa kaydirma yok', async () => {
    const { svc, adsClient } = setup([google(), meta()]);
    adsClient.getLiveBudget.mockResolvedValueOnce({ ok: false });
    await svc.shiftBudgets();
    expect(adsClient.updateBudget).not.toHaveBeenCalled();
  });

  it('azaltmanin sonucu belirsizse artis yapilmaz, rezervasyon geri alinir (toplam yalniz dusmus olabilir)', async () => {
    const { svc, adsClient, rows, kv } = setup([google(), meta()]);
    adsClient.updateBudget.mockResolvedValueOnce({ ok: false, uncertain: true });
    await expect(svc.shiftBudgets()).resolves.toEqual({ pairsAnalyzed: 1, shifts: 0 });
    expect(adsClient.updateBudget).toHaveBeenCalledTimes(1);
    expect(kv.has(budgetGuardKey('s1', 'g1'))).toBe(false);
    expect(rows.get('m1').budgetAmount).toBe(200);
  });

  it('artisin sonucu belirsizse zayif GERI YUKSELTILMEZ (toplam artmasin), rezervasyon korunur, gecmis "belirsiz" der', async () => {
    const { svc, adsClient, rows, kv } = setup([google(), meta()]);
    adsClient.updateBudget
      .mockResolvedValueOnce({ ok: true, applied: 160 })
      .mockResolvedValueOnce({ ok: false, uncertain: true });
    await expect(svc.shiftBudgets()).resolves.toEqual({ pairsAnalyzed: 1, shifts: 0 });
    expect(adsClient.updateBudget).toHaveBeenCalledTimes(2);
    expect(kv.has(budgetGuardKey('s1', 'g1'))).toBe(true);
    expect(rows.get('m1').budgetAmount).toBe(160);
    expect(rows.get('m1').autopilotActions).toEqual([expect.objectContaining({ action: 'budget-shift-out', completed: false, uncertain: true })]);
    expect(rows.get('g1').budgetAmount).toBe(100);
  });
});
