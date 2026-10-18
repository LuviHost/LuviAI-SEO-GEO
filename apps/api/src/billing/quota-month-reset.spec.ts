import { describe, it, expect, vi } from 'vitest';
import { QuotaService } from './quota.service.js';

/**
 * Ay basi sifirlamasi sonrasi satir yeniden okunmali; aksi halde yeni ayin
 * ilk cagrisi gecen ayin sayacini donup hakki dolan ucretli musteriyi bir kez
 * yanlislikla reddediyordu. AI butcesi kontrolu de sifirlamayi calistirmali.
 */
function prismaWith(user: any) {
  const row = { ...user };
  return {
    row,
    user: {
      findUniqueOrThrow: vi.fn(async () => ({ ...row })),
      update: vi.fn(async ({ data }: any) => { Object.assign(row, data); return { ...row }; }),
    },
  };
}

const lastMonth = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000);

describe('QuotaService ay basi', () => {
  it('yeni ayin ilk makale kontrolu sifirlanmis sayaci gorur', async () => {
    const prisma: any = prismaWith({ id: 'u1', plan: 'PRO', articlesUsedThisMonth: 30, articlesQuotaResetAt: lastMonth, aiCostThisMonthUsd: 5 });
    const q = new QuotaService(prisma);
    const r = await q.checkArticleQuota('u1');
    expect(r.allowed).toBe(true);
    expect(prisma.row.articlesUsedThisMonth).toBe(0);
  });

  it('AI butcesi kontrolu de ay basi sifirlamasini calistirir', async () => {
    const prisma: any = prismaWith({ id: 'u1', plan: 'STARTER', articlesUsedThisMonth: 3, articlesQuotaResetAt: lastMonth, aiCostThisMonthUsd: 999 });
    const q = new QuotaService(prisma);
    const r = await q.checkAiCostBudget('u1');
    expect(r.hardBlock).toBe(false);
    expect(r.used).toBe(0);
  });

  it('deneme hesabi sifirlanmaz ve mesaj gercek hak sayisini soyler', async () => {
    const prisma: any = prismaWith({ id: 'u1', plan: 'TRIAL', articlesUsedThisMonth: 99, articlesQuotaResetAt: lastMonth, aiCostThisMonthUsd: 0 });
    const q = new QuotaService(prisma);
    await expect(q.enforceArticleQuota('u1')).rejects.toThrow(/Deneme hesabındaki \d+ ücretsiz makale hakkını kullandın/);
    expect(prisma.row.articlesUsedThisMonth).toBe(99);
  });
});
