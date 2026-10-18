import { describe, it, expect } from 'vitest';
import { ForbiddenException } from '@nestjs/common';
import { QuotaService } from './quota.service.js';
import { FEATURE_MIN_PLAN, findPlan } from './plans.js';

/**
 * Kota hata mesajlari = kod.
 *
 * NEDEN VAR: enforceCitationQuota "BYOK ile sinirsiz kullanabilirsin" diyordu;
 * BYOK yalniz Kurumsal planda ve kendi anahtarla olcum de haftalik olcum
 * hakkina tabi. enforceAiCostBudget "yeni ayi bekle" diyordu; deneme hesabinin
 * butcesi hic sifirlanmiyor (maybeResetMonthlyQuota TRIAL'da donmeden cikar).
 * Mesaj kullaniciya oldugu gibi gider (403); yanlis vaat burada yakalanir.
 */

/** Ayni ay icinde sifirlanmis sayac — maybeReset* update cagirmaz */
function fakePrisma(user: Record<string, unknown>) {
  const row = { id: 'u1', aiCitationQuotaResetAt: new Date(), articlesQuotaResetAt: new Date(), ...user };
  return {
    user: {
      findUniqueOrThrow: async () => row,
      update: async () => row,
    },
  } as never;
}

async function forbiddenMessage(run: () => Promise<unknown>): Promise<string> {
  try {
    await run();
  } catch (err) {
    expect(err).toBeInstanceOf(ForbiddenException);
    return (err as ForbiddenException).message;
  }
  throw new Error('ForbiddenException bekleniyordu');
}

describe('enforceCitationQuota mesaji', () => {
  const byokPlan = findPlan(FEATURE_MIN_PLAN.byok)!.name_tr;

  it('kota dolunca BYOK icin dogru plani ve haftalik hakki soyler, "sinirsiz" vaat etmez', async () => {
    const quota = new QuotaService(fakePrisma({ plan: 'STARTER', aiCitationTestsThisMonth: 20 }));
    const msg = await forbiddenMessage(() => quota.enforceCitationQuota('u1'));
    expect(msg).toContain('(20/20)');
    expect(msg).toContain(`${byokPlan} planda`);
    expect(msg).toContain('haftalık ölçüm hakkı');
    expect(msg).toContain('yeni ayda yenilenir');
    expect(msg).not.toMatch(/sınırsız|sinirsiz|unlimited/i);
  });

  it('kota dolmadan hata yok, kalan hak doner', async () => {
    const quota = new QuotaService(fakePrisma({ plan: 'PRO', aiCitationTestsThisMonth: 10 }));
    await expect(quota.enforceCitationQuota('u1')).resolves.toEqual({ remaining: 65, limit: 75 });
  });
});

describe('enforceAiCostBudget mesaji', () => {
  it('denemede "yeni ayi bekle" demez: butce yalniz ucretli planlarda sifirlanir', async () => {
    const quota = new QuotaService(fakePrisma({ plan: 'TRIAL', aiCostThisMonthUsd: 3 }));
    const msg = await forbiddenMessage(() => quota.enforceAiCostBudget('u1'));
    expect(msg).toContain('$3.00 / $3');
    expect(msg).toContain('Ücretli planlarda bütçe yeni ayda sıfırlanır');
    expect(msg).not.toContain('Yeni ay başlangıcını bekleyebilir');
  });

  it('butce altindaysa gecer', async () => {
    const quota = new QuotaService(fakePrisma({ plan: 'PRO', aiCostThisMonthUsd: 10 }));
    await expect(quota.enforceAiCostBudget('u1')).resolves.toBeUndefined();
  });
});
