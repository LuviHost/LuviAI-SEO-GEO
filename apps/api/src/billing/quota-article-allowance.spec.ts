import { describe, it, expect, vi } from 'vitest';
import { ForbiddenException } from '@nestjs/common';
import { QuotaService } from './quota.service.js';

/**
 * Kullanicinin baslattigi uretimin makale hakki — tek kosullu UPDATE.
 *
 * NEDEN (sahip karari 20.10.2026, deneme hesabi toplam 2 makale): eski sira "once
 * enforceArticleQuota oku, kuyruga at, sonra kosulsuz artir" idi. Ayni anda gelen
 * iki istek ikisi de "hak var" okuyup son hakki iki kez kullanabiliyordu: deneme
 * hesabi 3 makale uretebilirdi. Sahte tablo gercek bir veritabani gibi davranir:
 * okumalar bir tur bekler (iki istek ayni anda okur), kosullu guncelleme atomiktir.
 */
function db(user: { plan: string; articlesUsedThisMonth: number }) {
  const row = { id: 'u1', articlesQuotaResetAt: new Date(), aiCitationQuotaResetAt: new Date(), ...user };
  const tick = () => new Promise((r) => setTimeout(r, 0));
  return {
    row,
    // Deneme: uretim icin sitede aktif yayin hedefi sarti (trial-policy.ts); burada bagli
    publishTarget: { findMany: vi.fn(async () => [{ type: 'WORDPRESS_REST', isActive: true }]) },
    user: {
      findUniqueOrThrow: vi.fn(async () => { await tick(); return { ...row }; }),
      update: vi.fn(async ({ data }: any) => { Object.assign(row, data); return { ...row }; }),
      updateMany: vi.fn(async ({ where, data }: any) => {
        const c = where.articlesUsedThisMonth ?? {};
        if (c.lt !== undefined && !(row.articlesUsedThisMonth < c.lt)) return { count: 0 };
        if (c.gt !== undefined && !(row.articlesUsedThisMonth > c.gt)) return { count: 0 };
        const d = data.articlesUsedThisMonth;
        row.articlesUsedThisMonth += typeof d?.increment === 'number' ? d.increment : -(d?.decrement ?? 0);
        return { count: 1 };
      }),
    },
  };
}

describe('QuotaService.consumeArticleAllowance — deneme hesabi toplam 2', () => {
  it('son hak icin es zamanli iki istek: yalniz biri alir, digeri 403 (deneme metni); sayac 2', async () => {
    const prisma: any = db({ plan: 'TRIAL', articlesUsedThisMonth: 1 });
    const q = new QuotaService(prisma);
    const results = await Promise.allSettled([q.consumeArticleAllowance('u1', 's1'), q.consumeArticleAllowance('u1', 's1')]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
    expect(rejected.reason).toBeInstanceOf(ForbiddenException);
    expect(rejected.reason.message).toBe('Deneme hesabındaki 2 ücretsiz makale hakkını kullandın. Devam etmek için plan seç.');
    expect(prisma.row.articlesUsedThisMonth).toBe(2);
  });

  it('deneme hesabi ust uste: 2 kez alir, ucuncude 403 ve sayac 2de kalir', async () => {
    const prisma: any = db({ plan: 'TRIAL', articlesUsedThisMonth: 0 });
    const q = new QuotaService(prisma);
    await expect(q.consumeArticleAllowance('u1', 's1')).resolves.toEqual({ remaining: 1 });
    await expect(q.consumeArticleAllowance('u1', 's1')).resolves.toEqual({ remaining: 0 });
    await expect(q.consumeArticleAllowance('u1', 's1')).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.row.articlesUsedThisMonth).toBe(2);
  });

  it('ucretli plan hak dolunca aylik metin', async () => {
    const prisma: any = db({ plan: 'STARTER', articlesUsedThisMonth: 15 });
    const q = new QuotaService(prisma);
    await expect(q.consumeArticleAllowance('u1', 's1')).rejects.toThrow('Aylık 15 makale kotan doldu.');
  });

  it('geri verme sayaci 0in altina indirmez', async () => {
    const prisma: any = db({ plan: 'TRIAL', articlesUsedThisMonth: 1 });
    const q = new QuotaService(prisma);
    await q.refundArticleAllowance('u1');
    await q.refundArticleAllowance('u1');
    expect(prisma.row.articlesUsedThisMonth).toBe(0);
  });

  it('plan hakki tablosu: deneme 2, bilinmeyen plan 0 (sessizce sinirsiz olmaz)', () => {
    const q = new QuotaService({} as any);
    expect(q.articleLimitFor('TRIAL')).toBe(2);
    expect(q.articleLimitFor('PRO')).toBe(40);
    expect(q.articleLimitFor('BILINMEYEN')).toBe(0);
  });
});
