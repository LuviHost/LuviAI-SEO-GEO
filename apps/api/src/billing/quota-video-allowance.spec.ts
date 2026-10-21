import { describe, it, expect, vi } from 'vitest';
import { ForbiddenException } from '@nestjs/common';
import { QuotaService } from './quota.service.js';
import { BASE_PLANS, VIDEOS_PER_MONTH, planHasFeature, type PlanId } from './plans.js';

/**
 * RanksUp Video aylik hakki (sahip karari 21.10.2026: Profesyonel ve ustu; Pro 20, Ajans 60,
 * Kurumsal 200 — plans.ts VIDEOS_PER_MONTH). Makale hakkiyla ayni kalip: tek kosullu UPDATE,
 * ayni anda gelen iki istek son hakki iki kez alamaz; render basarisizsa hak geri verilir.
 * Sahte tablo okumalari bir tur bekletir (iki istek ayni anda okur), kosullu guncelleme atomik.
 */
function db(user: { plan: string; videosUsedThisMonth: number; role?: string; articlesQuotaResetAt?: Date }) {
  const row = { id: 'u1', role: 'USER', articlesUsedThisMonth: 0, articlesQuotaResetAt: new Date(), aiCostThisMonthUsd: 0, ...user };
  const tick = () => new Promise((r) => setTimeout(r, 0));
  return {
    row,
    user: {
      // Okuma CAGRI anindaki degeri dondurur, sonra bekler: iki istek gercekten ayni eski degeri gorur
      findUniqueOrThrow: vi.fn(async () => { const snap = { ...row }; await tick(); return snap; }),
      update: vi.fn(async ({ data }: any) => { Object.assign(row, data); return { ...row }; }),
      updateMany: vi.fn(async ({ where, data }: any) => {
        const c = where.videosUsedThisMonth ?? {};
        if (c.lt !== undefined && !(row.videosUsedThisMonth < c.lt)) return { count: 0 };
        if (c.gt !== undefined && !(row.videosUsedThisMonth > c.gt)) return { count: 0 };
        const d = data.videosUsedThisMonth;
        row.videosUsedThisMonth += typeof d?.increment === 'number' ? d.increment : -(d?.decrement ?? 0);
        return { count: 1 };
      }),
    },
  };
}

describe('VIDEOS_PER_MONTH — tek kaynak, fiyat karti ve kota ayni', () => {
  it('Deneme ve Buyume 0 (ozellik yok), Profesyonel 20, ust planlar daha fazla', () => {
    expect(VIDEOS_PER_MONTH).toEqual({ trial: 0, starter: 0, pro: 20, agency: 60, enterprise: 200 });
    for (const p of BASE_PLANS) {
      expect(p.videosPerMonth, p.id).toBe(VIDEOS_PER_MONTH[p.id]);
      // Hak > 0 olan her plan ozelligi de aliyor; hak 0 olan almiyor (kart ve kapi ayni sey der)
      expect(planHasFeature(p.id, 'articleVideo'), p.id).toBe(p.videosPerMonth > 0);
    }
    const ladder: PlanId[] = ['trial', 'starter', 'pro', 'agency', 'enterprise'];
    for (let i = 1; i < ladder.length; i++) expect(VIDEOS_PER_MONTH[ladder[i]]).toBeGreaterThanOrEqual(VIDEOS_PER_MONTH[ladder[i - 1]]);
  });

  it('kart maddesi plandaki sayiyi yazar (TR + EN), alt planlarda madde yok', () => {
    const byId = Object.fromEntries(BASE_PLANS.map((p) => [p.id, p]));
    for (const id of ['pro', 'agency', 'enterprise'] as const) {
      const n = VIDEOS_PER_MONTH[id];
      expect(byId[id].features_tr.find((m) => m.startsWith('RanksUp Video')), id).toContain(`ayda ${n} video`);
      expect(byId[id].features_en.find((m) => m.startsWith('RanksUp Video')), id).toContain(`${n} videos/mo`);
    }
    for (const id of ['trial', 'starter'] as const) {
      expect(byId[id].features_tr.some((m) => m.includes('RanksUp Video')), id).toBe(false);
    }
  });
});

describe('QuotaService.consumeVideoAllowance', () => {
  it('Deneme / Buyume: plan kapisi 403 (Profesyonel planina dahildir), sayac degismez', async () => {
    for (const plan of ['TRIAL', 'STARTER']) {
      const prisma: any = db({ plan, videosUsedThisMonth: 0 });
      const q = new QuotaService(prisma);
      await expect(q.consumeVideoAllowance('u1')).rejects.toThrow(/RanksUp Video Profesyonel planına dahildir/);
      expect(prisma.row.videosUsedThisMonth).toBe(0);
      expect(prisma.user.updateMany).not.toHaveBeenCalled();
    }
  });

  it('son hak icin es zamanli iki istek: yalniz biri alir, digeri 403; sayac 20', async () => {
    const prisma: any = db({ plan: 'PRO', videosUsedThisMonth: 19 });
    const q = new QuotaService(prisma);
    const results = await Promise.allSettled([q.consumeVideoAllowance('u1'), q.consumeVideoAllowance('u1')]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
    expect(rejected.reason).toBeInstanceOf(ForbiddenException);
    expect(rejected.reason.message).toBe('Bu ayki 20 video hakkını kullandın. Hak yeni ayda yenilenir; daha fazlası için planını yükseltebilirsin.');
    expect(prisma.row.videosUsedThisMonth).toBe(20);
  });

  it('ust uste: kalan hak doner, hak dolunca 403 ve sayac sinirda kalir', async () => {
    const prisma: any = db({ plan: 'AGENCY', videosUsedThisMonth: 58 });
    const q = new QuotaService(prisma);
    await expect(q.consumeVideoAllowance('u1')).resolves.toEqual({ charged: true, remaining: 1, limit: 60 });
    await expect(q.consumeVideoAllowance('u1')).resolves.toEqual({ charged: true, remaining: 0, limit: 60 });
    await expect(q.consumeVideoAllowance('u1')).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.row.videosUsedThisMonth).toBe(60);
  });

  it('ADMIN hakka takilmaz ve sayac artmaz (charged=false -> iade de yok)', async () => {
    const prisma: any = db({ plan: 'TRIAL', role: 'ADMIN', videosUsedThisMonth: 0 });
    const q = new QuotaService(prisma);
    await expect(q.consumeVideoAllowance('u1')).resolves.toMatchObject({ charged: false });
    expect(prisma.row.videosUsedThisMonth).toBe(0);
  });

  it('yeni ayin ilk istegi: gecen ayin sayaci once sifirlanir (makale sayaciyla birlikte)', async () => {
    const lastMonth = new Date();
    lastMonth.setMonth(lastMonth.getMonth() - 1);
    const prisma: any = db({ plan: 'PRO', videosUsedThisMonth: 20, articlesQuotaResetAt: lastMonth });
    const q = new QuotaService(prisma);
    await expect(q.consumeVideoAllowance('u1')).resolves.toEqual({ charged: true, remaining: 19, limit: 20 });
    expect(prisma.row.videosUsedThisMonth).toBe(1);
  });
});

describe('QuotaService.refundVideoAllowance', () => {
  it('ayni ay icinde dusulen hak geri verilir; sayac 0in altina inmez', async () => {
    const prisma: any = db({ plan: 'PRO', videosUsedThisMonth: 1 });
    const q = new QuotaService(prisma);
    await expect(q.refundVideoAllowance('u1', new Date())).resolves.toBe(true);
    await expect(q.refundVideoAllowance('u1', new Date())).resolves.toBe(false);
    expect(prisma.row.videosUsedThisMonth).toBe(0);
  });

  it('gecen ay dusulen hak yeni ayin sayacindan DUSULMEZ', async () => {
    const prisma: any = db({ plan: 'PRO', videosUsedThisMonth: 3 });
    const q = new QuotaService(prisma);
    const now = new Date(2026, 10, 1, 0, 5);
    await expect(q.refundVideoAllowance('u1', new Date(2026, 9, 31, 23, 59), now)).resolves.toBe(false);
    expect(prisma.row.videosUsedThisMonth).toBe(3);
    expect(prisma.user.updateMany).not.toHaveBeenCalled();
  });

  it('videoLimitFor: bilinmeyen plan 0 (sessizce sinirsiz olmaz)', () => {
    const q = new QuotaService({} as any);
    expect(q.videoLimitFor('PRO')).toBe(20);
    expect(q.videoLimitFor('enterprise')).toBe(200);
    expect(q.videoLimitFor('BILINMEYEN')).toBe(0);
  });
});
