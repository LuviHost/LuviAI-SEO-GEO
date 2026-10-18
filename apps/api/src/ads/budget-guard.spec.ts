import { describe, it, expect, vi } from 'vitest';
import {
  BUDGET_GUARD_DEFAULTS,
  adsAutopilotRules,
  budgetGuardKey,
  decideBudgetIncrease,
  ignoredBudgetGuardEnv,
  parseBudgetGuardState,
  readBudgetGuardConfig,
  recordIncrease,
  type BudgetGuardState,
} from './budget-guard.js';
import { AdsBudgetGuardService } from './budget-guard.service.js';

/**
 * Butce emniyet rayi: eski otopilot kosul surdukce her 6 saatte x1,2 yapiyordu
 * (gunde ~x2,07). Kural: 24 saatte 1, 7 gunde 2 artis, tavan = ilk degisiklikteki
 * butcenin 2 kati.
 */

const T0 = new Date('2026-10-01T00:00:00.000Z');
const h = (n: number) => new Date(T0.getTime() + n * 3_600_000);
const cfg = { ...BUDGET_GUARD_DEFAULTS };

function stateWith(baseline: number, increaseHours: number[]): BudgetGuardState {
  return {
    v: 1,
    baseline,
    baselineAt: T0.toISOString(),
    increases: increaseHours.map((x) => ({ at: h(x).toISOString(), from: 1, to: 1 })),
  };
}

describe('decideBudgetIncrease', () => {
  it('ilk artis: taban o anki butce, tavan 2 kati, oneri aynen gecer', () => {
    const d = decideBudgetIncrease({ current: 100, proposed: 120, state: null, now: T0, config: cfg });
    expect(d).toEqual({ ok: true, newBudget: 120, baseline: 100, ceiling: 200, clamped: false, increasesThisWeek: 1 });
  });

  it('24 saat dolmadan ikinci artis yok; dolunca var', () => {
    const s = stateWith(100, [0]);
    const early = decideBudgetIncrease({ current: 120, proposed: 144, state: s, now: h(23.9), config: cfg });
    expect(early).toMatchObject({ ok: false, reason: 'cooldown' });
    expect((early as any).nextAllowedAt.toISOString()).toBe(h(24).toISOString());
    expect(decideBudgetIncrease({ current: 120, proposed: 144, state: s, now: h(24), config: cfg })).toMatchObject({ ok: true, newBudget: 144 });
  });

  it('kayan 7 gunde en fazla 2 artis; en eski artis pencereden cikinca yer acilir', () => {
    const s = stateWith(100, [0, 30]);
    const blocked = decideBudgetIncrease({ current: 144, proposed: 172.8, state: s, now: h(60), config: cfg });
    expect(blocked).toMatchObject({ ok: false, reason: 'weekly-cap' });
    expect((blocked as any).nextAllowedAt.toISOString()).toBe(h(168).toISOString());
    expect(decideBudgetIncrease({ current: 144, proposed: 172.8, state: s, now: h(168), config: cfg })).toMatchObject({ ok: true });
  });

  it('tavan: oneri tabanin 2 katina kirpilir; tavandayken artis yok', () => {
    const s = stateWith(100, []);
    expect(decideBudgetIncrease({ current: 180, proposed: 216, state: s, now: T0, config: cfg }))
      .toMatchObject({ ok: true, newBudget: 200, ceiling: 200, clamped: true });
    expect(decideBudgetIncrease({ current: 200, proposed: 240, state: s, now: T0, config: cfg }))
      .toMatchObject({ ok: false, reason: 'ceiling', ceiling: 200 });
    // Taban kaydedildikten sonra butce baska yoldan artsa bile tavan tabana gore
    expect(decideBudgetIncrease({ current: 250, proposed: 300, state: s, now: T0, config: cfg }))
      .toMatchObject({ ok: false, reason: 'ceiling' });
  });

  it('gecersiz butce ve artis olmayan oneri reddedilir; okunamayan kayit artisi engeller', () => {
    expect(decideBudgetIncrease({ current: 0, proposed: 10, state: null, now: T0, config: cfg })).toMatchObject({ reason: 'invalid-budget' });
    expect(decideBudgetIncrease({ current: Number.NaN, proposed: 10, state: null, now: T0, config: cfg })).toMatchObject({ reason: 'invalid-budget' });
    expect(decideBudgetIncrease({ current: 100, proposed: 100, state: null, now: T0, config: cfg })).toMatchObject({ reason: 'invalid-budget' });
    expect(decideBudgetIncrease({ current: 100, proposed: 120, state: 'corrupt', now: T0, config: cfg })).toMatchObject({ reason: 'state-unreadable' });
  });

  it('haftalik sinir 0 ise artis yok; carpan 1 ise ilk butcenin ustune cikilmaz', () => {
    expect(decideBudgetIncrease({ current: 100, proposed: 120, state: null, now: T0, config: { ...cfg, maxIncreasesPerWeek: 0 } }))
      .toMatchObject({ ok: false, reason: 'weekly-cap' });
    expect(decideBudgetIncrease({ current: 100, proposed: 120, state: null, now: T0, config: { ...cfg, maxMultiplier: 1 } }))
      .toMatchObject({ ok: false, reason: 'ceiling' });
    // Kaydirmayla azaltilmis kampanya (taban 200) ilk butcesine kadar donebilir
    expect(decideBudgetIncrease({ current: 160, proposed: 192, state: stateWith(200, []), now: T0, config: { ...cfg, maxMultiplier: 1 } }))
      .toMatchObject({ ok: true, newBudget: 192, ceiling: 200 });
  });

  it('6 saatte bir kosul sursa bile bir haftada en fazla x1,44 (eski kodda ~x165)', () => {
    let state: BudgetGuardState | null = null;
    let budget = 100;
    let applied = 0;
    for (let hour = 0; hour < 7 * 24; hour += 6) {
      const d = decideBudgetIncrease({ current: budget, proposed: Math.round(budget * 1.2 * 100) / 100, state, now: h(hour), config: cfg });
      if (!d.ok) continue;
      state = recordIncrease(state, budget, d.newBudget, h(hour), cfg);
      budget = d.newBudget;
      applied++;
    }
    expect(applied).toBe(2);
    expect(budget).toBe(144);
  });

  it('uzun vadede tavan asilmaz', () => {
    let state: BudgetGuardState | null = null;
    let budget = 100;
    for (let hour = 0; hour < 90 * 24; hour += 6) {
      const d = decideBudgetIncrease({ current: budget, proposed: Math.round(budget * 1.2 * 100) / 100, state, now: h(hour), config: cfg });
      if (!d.ok) continue;
      state = recordIncrease(state, budget, d.newBudget, h(hour), cfg);
      budget = d.newBudget;
    }
    expect(budget).toBe(200);
  });
});

describe('ayarlar (env) ve durum kaydi', () => {
  it('varsayilanlar; gecerli env gevsetir, gecersiz/aralik disi env yok sayilir', () => {
    expect(readBudgetGuardConfig({})).toEqual({ cooldownHours: 24, maxIncreasesPerWeek: 2, maxMultiplier: 2 });
    expect(readBudgetGuardConfig({
      ADS_BUDGET_INCREASE_COOLDOWN_HOURS: '12',
      ADS_BUDGET_MAX_INCREASES_PER_WEEK: '4',
      ADS_BUDGET_MAX_MULTIPLIER: '3',
    })).toEqual({ cooldownHours: 12, maxIncreasesPerWeek: 4, maxMultiplier: 3 });
    const bad = { ADS_BUDGET_INCREASE_COOLDOWN_HOURS: 'abc', ADS_BUDGET_MAX_INCREASES_PER_WEEK: '2.5', ADS_BUDGET_MAX_MULTIPLIER: '50' };
    expect(readBudgetGuardConfig(bad)).toEqual(BUDGET_GUARD_DEFAULTS);
    expect(ignoredBudgetGuardEnv(bad)).toEqual(['ADS_BUDGET_INCREASE_COOLDOWN_HOURS', 'ADS_BUDGET_MAX_INCREASES_PER_WEEK', 'ADS_BUDGET_MAX_MULTIPLIER']);
  });

  it('panel kurallari env ile ayni sayilari verir', () => {
    expect(adsAutopilotRules(readBudgetGuardConfig({ ADS_BUDGET_MAX_MULTIPLIER: '1.5' })))
      .toEqual({ increasePercent: 20, shiftPercent: 20, cooldownHours: 24, maxIncreasesPerWeek: 2, maxMultiplier: 1.5 });
  });

  it('kayit okuma: yok → null, bozuk → corrupt (bozuk kayit tabani sifirlamaz)', () => {
    expect(parseBudgetGuardState(null)).toBeNull();
    expect(parseBudgetGuardState('{oops')).toBe('corrupt');
    expect(parseBudgetGuardState(JSON.stringify({ baseline: 0, increases: [] }))).toBe('corrupt');
    expect(parseBudgetGuardState(JSON.stringify({ baseline: 100, increases: [{ at: 'dun' }] }))).toBe('corrupt');
    expect(parseBudgetGuardState(JSON.stringify(stateWith(100, [0])))).toMatchObject({ baseline: 100, increases: [{ from: 1, to: 1 }] });
  });

  it('anahtar site kimligini icerir (site/hesap silme planlari kv satirini da siler)', () => {
    expect(budgetGuardKey('site_cuid_0000000000000000', 'camp1')).toBe('ads:budget-guard:site_cuid_0000000000000000:camp1');
  });
});

function fakeKv(initial: Record<string, string> = {}) {
  const kv = new Map(Object.entries(initial));
  const prisma: any = {
    kvStore: {
      findUnique: vi.fn(async ({ where }: any) => (kv.has(where.key) ? { key: where.key, value: kv.get(where.key) } : null)),
      upsert: vi.fn(async ({ where, create }: any) => { kv.set(where.key, create.value); return {}; }),
      deleteMany: vi.fn(async ({ where }: any) => { kv.delete(where.key); return { count: 1 }; }),
    },
  };
  return { kv, prisma };
}

describe('AdsBudgetGuardService', () => {
  it('rezervasyon platformdan ONCE yazilir; geri alma onceki kaydi aynen koyar', async () => {
    const { kv, prisma } = fakeKv();
    const guard = new AdsBudgetGuardService(prisma);
    const r = await guard.reserveIncrease({ siteId: 's1', campaignId: 'c1', current: 100, proposed: 120, now: T0 });
    expect(r.ok).toBe(true);
    const key = budgetGuardKey('s1', 'c1');
    expect(JSON.parse(kv.get(key)!)).toMatchObject({ baseline: 100, increases: [{ from: 100, to: 120 }] });
    await guard.release((r as any).reservation);
    expect(kv.has(key)).toBe(false);

    // Onceki kayit varken geri alma onu geri yazar
    const before = JSON.stringify(stateWith(100, []));
    kv.set(key, before);
    const r2 = await guard.reserveIncrease({ siteId: 's1', campaignId: 'c1', current: 100, proposed: 120, now: T0 });
    await guard.release((r2 as any).reservation);
    expect(kv.get(key)).toBe(before);
  });

  it('bekleme suresindeki ikinci istek kv yazmaz', async () => {
    const { prisma } = fakeKv();
    const guard = new AdsBudgetGuardService(prisma);
    await guard.reserveIncrease({ siteId: 's1', campaignId: 'c1', current: 100, proposed: 120, now: T0 });
    prisma.kvStore.upsert.mockClear();
    const r = await guard.reserveIncrease({ siteId: 's1', campaignId: 'c1', current: 120, proposed: 144, now: h(6) });
    expect(r).toMatchObject({ ok: false, reason: 'cooldown' });
    expect(prisma.kvStore.upsert).not.toHaveBeenCalled();
  });

  it('kv okunamazsa hata yukari cikar (cagiran degisiklik yapmaz)', async () => {
    const { prisma } = fakeKv();
    prisma.kvStore.findUnique.mockRejectedValue(new Error('db down'));
    const guard = new AdsBudgetGuardService(prisma);
    await expect(guard.reserveIncrease({ siteId: 's1', campaignId: 'c1', current: 100, proposed: 120, now: T0 })).rejects.toThrow('db down');
  });

  it('taban yalniz kayit yoksa yazilir (azaltma ilk degisiklikse)', async () => {
    const { kv, prisma } = fakeKv();
    const guard = new AdsBudgetGuardService(prisma);
    await guard.noteBaseline('s1', 'c2', 80, T0);
    expect(JSON.parse(kv.get(budgetGuardKey('s1', 'c2'))!)).toMatchObject({ baseline: 80, increases: [] });
    await guard.noteBaseline('s1', 'c2', 50, h(1));
    expect(JSON.parse(kv.get(budgetGuardKey('s1', 'c2'))!).baseline).toBe(80);
  });
});
