import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { AdminController } from './admin.controller.js';
import { QuotaService } from '../billing/quota.service.js';

/**
 * Harcama tavani paneli (GET /admin/users-spend-status) dayatmanin hesabini
 * gosterir.
 *
 * NEDEN VAR: admin.controller kendi SPEND_CAP_USD kopyasini tutuyordu;
 * QuotaService'teki tablo degisince panel engellenmemis kullaniciyi
 * "engelli", engellenmis olani "normal" gosterebilirdi. Artik tavan, kullanim
 * ve yuzde QuotaService.checkAiCostBudget'tan gelir (vitest dekorator
 * metadatasi uretmez: denetleyici elle kurulur).
 */

const admin = { role: 'ADMIN' };

function build(users: Array<{ id: string; plan: string; aiCostThisMonthUsd: number }>) {
  const prisma = {
    user: {
      findMany: vi.fn(async () => users.map((u) => ({ email: `${u.id}@ornek.com`, name: u.id, subscriptionStatus: 'ACTIVE', articlesUsedThisMonth: 0, grandfatheredUntil: null, createdAt: new Date(), ...u }))),
      // Gercek satirlarda articlesQuotaResetAt hep dolu (sema varsayilani now());
      // checkAiCostBudget artik ay basi sifirlamasini da calistiriyor.
      findUniqueOrThrow: vi.fn(async ({ where }: any) => {
        const u = users.find((x) => x.id === where.id);
        if (!u) throw new Error('No User found');
        return { articlesQuotaResetAt: new Date(), ...u };
      }),
      update: vi.fn(async () => ({})),
    },
  };
  const quota = new QuotaService(prisma as any);
  const ctl = new AdminController({} as any, {} as any, {} as any, {} as any, prisma as any, quota);
  return { ctl, quota };
}

describe('usersSpendStatus — tavan QuotaService\'ten', () => {
  it('tavan ve yuzde dayatmayla ayni; risk siniflari %100 engel, %80 uyari, %50 normal', async () => {
    const { ctl, quota } = build([
      { id: 'u1', plan: 'TRIAL', aiCostThisMonthUsd: 3 },      // 3/3 = %100
      { id: 'u2', plan: 'PRO', aiCostThisMonthUsd: 64 },       // 64/80 = %80
      { id: 'u3', plan: 'AGENCY', aiCostThisMonthUsd: 100 },   // 100/200 = %50
      { id: 'u4', plan: 'ENTERPRISE', aiCostThisMonthUsd: 7 }, // 7/700 = %1
    ]);
    const spy = vi.spyOn(quota, 'checkAiCostBudget');
    const r = await ctl.usersSpendStatus({ user: admin } as any);
    expect(r.users.map((u: any) => [u.id, u.capUsd, u.capPct, u.risk])).toEqual([
      ['u1', 3, 100, 'blocked'],
      ['u2', 80, 80, 'warn'],
      ['u3', 200, 50, 'normal'],
      ['u4', 700, 1, 'low'],
    ]);
    // Her satir dayatmanin kendi hesabindan
    for (const u of r.users) {
      const b = await quota.checkAiCostBudget(u.id);
      expect([u.capUsd, u.aiCostUsd, u.capPct]).toEqual([b.cap, b.used, b.pct]);
    }
    expect(spy).toHaveBeenCalled();
    expect(r.summary).toMatchObject({ totalUsers: 4, blockedCount: 1, warnCount: 1, totalMonthlyCapUsd: 3 + 80 + 200 + 700 });
  });

  it('liste ile okuma arasinda silinen kullanici listeden duser (sayfa 500 vermez)', async () => {
    const { ctl, quota } = build([{ id: 'u1', plan: 'PRO', aiCostThisMonthUsd: 10 }]);
    vi.spyOn(quota, 'checkAiCostBudget').mockRejectedValueOnce(new Error('No User found'));
    const r = await ctl.usersSpendStatus({ user: admin } as any);
    expect(r.users).toEqual([]);
    expect(r.summary.totalUsers).toBe(0);
  });

  it('denetleyicide elle yazilmis tavan tablosu kalmadi', () => {
    const src = readFileSync(new URL('./admin.controller.ts', import.meta.url), 'utf8');
    expect(src).not.toMatch(/SPEND_CAP_USD\s*:/);
    expect(src).not.toMatch(/TRIAL:\s*3,\s*STARTER:\s*25/);
  });
});
