import { describe, it, expect, vi } from 'vitest';
import { ForbiddenException, Logger } from '@nestjs/common';
import { AI_BUDGET_EXHAUSTED_CODE, AI_COST_ESTIMATE_MAX_USD, QuotaService } from './quota.service.js';
import { findPlan } from './plans.js';

/**
 * Aylik AI butcesi gercek bir emniyet agi — sahip karari 11.11.2026 ("zarar etmeyelim").
 *
 * NEDEN VAR: butce sayaci (User.aiCostThisMonthUsd) yalniz userId'li LLMProviderService
 * cagrilarinda artiyor, kapi (enforceAiCostBudget) yalniz uc kucuk ozellikte calisiyordu;
 * makale ajanlari, panel sohbeti ve ceviri butceye hic ugramiyordu. Kural: butce, AI
 * gorunurluk OLCUMU disindaki her AI harcamasini kapsar; dolunca makale uretimi, ceviri ve
 * sohbet ay yenilenene kadar durur. Bu dosya QuotaService tarafini sabitler: tavanlar,
 * kullanicinin baslattigi uretimin kapisi, muafiyet, metinler ve hata yonu.
 */

vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);

function db(user: Record<string, unknown>, targets: Array<{ type: string; isActive: boolean }> = []) {
  const row: any = { id: 'u1', role: 'USER', articlesUsedThisMonth: 0, articlesQuotaResetAt: new Date(), aiCostThisMonthUsd: 0, ...user };
  const updateMany = vi.fn(async ({ where, data }: any) => {
    if (where.articlesUsedThisMonth?.lt !== undefined && !(row.articlesUsedThisMonth < where.articlesUsedThisMonth.lt)) return { count: 0 };
    if (data.articlesUsedThisMonth?.increment) row.articlesUsedThisMonth += data.articlesUsedThisMonth.increment;
    return { count: 1 };
  });
  const prisma: any = {
    user: {
      findUniqueOrThrow: vi.fn(async () => ({ ...row })),
      findUnique: vi.fn(async () => ({ ...row })),
      update: vi.fn(async ({ data }: any) => { Object.assign(row, data); return { ...row }; }),
      updateMany,
    },
    publishTarget: { findMany: vi.fn(async () => targets) },
  };
  return { prisma, row, updateMany, quota: new QuotaService(prisma) };
}

async function forbidden(run: () => Promise<unknown>): Promise<ForbiddenException> {
  try {
    await run();
  } catch (err) {
    expect(err).toBeInstanceOf(ForbiddenException);
    return err as ForbiddenException;
  }
  throw new Error('ForbiddenException bekleniyordu');
}

describe('tavanlar (USD / ay)', () => {
  it('deneme 8 (3 idi), Baslangic 25, Profesyonel 120 (80 idi), Ajans 200, Kurumsal 700', async () => {
    const beklenen: Record<string, number> = { TRIAL: 8, STARTER: 25, PRO: 120, AGENCY: 200, ENTERPRISE: 700 };
    for (const [plan, cap] of Object.entries(beklenen)) {
      expect((await db({ plan }).quota.checkAiCostBudget('u1')).cap, plan).toBe(cap);
    }
  });

  // 11.11.2026 (bagimsiz inceleme): deneme tavani omur boyu ve sayac artik makale + sohbeti sayiyor.
  // 3 USD'lik tavan denemenin vaat ettigi 2 makale + 20 Asistan mesajini karsilamiyordu: once
  // sohbet eden kullanici ikinci makalesini uretemiyordu. Tavan iki hakkin ust tahminle toplamidir.
  it('deneme tavani denemenin vaat ettigini tasir: 2 makale + Asistan mesaj hakki, ust tahminle', async () => {
    const deneme = findPlan('trial')!;
    const ihtiyac = deneme.articlesPerMonth * AI_COST_ESTIMATE_MAX_USD.article + deneme.chatMessagesPerMonth * AI_COST_ESTIMATE_MAX_USD.chatMessage;
    expect(deneme.articlesPerMonth).toBe(2);
    expect(deneme.chatMessagesPerMonth).toBe(20);
    expect(ihtiyac).toBe(8);
    const cap = (await db({ plan: 'TRIAL' }).quota.checkAiCostBudget('u1')).cap;
    expect(cap, 'deneme tavani haklarin ust tahminli toplamindan kucuk: hak ya da tahmin buyuduyse tavani da buyut').toBeGreaterThanOrEqual(ihtiyac);
    // Once 20 mesaj (en pahali), sonra iki makale: ikinci makale baslarken butce hala acik
    const ikinciMakaleOncesi = deneme.chatMessagesPerMonth * AI_COST_ESTIMATE_MAX_USD.chatMessage + AI_COST_ESTIMATE_MAX_USD.article;
    expect((await db({ plan: 'TRIAL', aiCostThisMonthUsd: ikinciMakaleOncesi }).quota.checkAiCostBudget('u1')).hardBlock).toBe(false);
    // Baslangic: makale yok, mesaj hakkinin tamami ust tahminle tavana sigar
    const baslangic = findPlan('starter')!;
    expect(baslangic.articlesPerMonth).toBe(0);
    expect((await db({ plan: 'STARTER' }).quota.checkAiCostBudget('u1')).cap).toBeGreaterThanOrEqual(baslangic.chatMessagesPerMonth * AI_COST_ESTIMATE_MAX_USD.chatMessage);
  });

  it('Profesyonel hesabin olagan kullanimi tavana takilmaz: 40 makale x $1.5 = $60 uyari esiginin (%80) de altinda', async () => {
    const r = await db({ plan: 'PRO', aiCostThisMonthUsd: 40 * 1.5 }).quota.checkAiCostBudget('u1');
    expect(r).toMatchObject({ cap: 120, pct: 50, warn: false, hardBlock: false });
  });

  it('%80 uyari, %100 engel', async () => {
    expect(await db({ plan: 'PRO', aiCostThisMonthUsd: 95 }).quota.checkAiCostBudget('u1')).toMatchObject({ pct: 79, warn: false, hardBlock: false });
    expect(await db({ plan: 'PRO', aiCostThisMonthUsd: 96 }).quota.checkAiCostBudget('u1')).toMatchObject({ pct: 80, warn: true, hardBlock: false });
    expect(await db({ plan: 'PRO', aiCostThisMonthUsd: 120 }).quota.checkAiCostBudget('u1')).toMatchObject({ pct: 100, warn: true, hardBlock: true });
  });
});

describe('ADMIN muafiyeti — sayac artar, engel yok', () => {
  it('ADMIN sahibin butcesi dolsa da hardBlock false; kullanim ve yuzde dogru raporlanir', async () => {
    const { quota } = db({ plan: 'TRIAL', role: 'ADMIN', aiCostThisMonthUsd: 50 });
    expect(await quota.checkAiCostBudget('u1')).toMatchObject({ used: 50, cap: 8, warn: true, hardBlock: false, exempt: true });
    await expect(quota.enforceAiCostBudget('u1')).resolves.toBeUndefined();
    await expect(quota.aiBudgetBlock('u1')).resolves.toBeNull();
  });

  it('muafiyet role bakar: ayni kullanimdaki USER engellenir', async () => {
    const { quota } = db({ plan: 'TRIAL', role: 'USER', aiCostThisMonthUsd: 50 });
    expect(await quota.checkAiCostBudget('u1')).toMatchObject({ hardBlock: true, exempt: false });
  });
});

describe('musteriye giden metin — her planda dogru', () => {
  const metin = async (plan: string, used: number) => (await forbidden(() => db({ plan, aiCostThisMonthUsd: used }).quota.enforceAiCostBudget('u1'))).message;

  it('deneme: butce YENILENMEZ der, "yeni ayi bekle" demez', async () => {
    const m = await metin('TRIAL', 8);
    expect(m).toBe(
      'Deneme hesabının AI kullanım bütçesi doldu ($8.00 / $8). Deneme bütçesi yenilenmez. Ücretli planlarda bütçe yeni ayda sıfırlanır; devam etmek için ücretli bir plana geçebilirsin.',
    );
    expect(m).not.toMatch(/Aylık AI kullanım bütçen|ayın başında sıfırlanır/);
  });

  it('Baslangic: yenilenmeyi ve Profesyonel\'in daha yuksek sinirini soyler', async () => {
    expect(await metin('STARTER', 25.5)).toBe(
      'Aylık AI kullanım bütçen doldu ($25.50 / $25). Bütçe yeni ayın başında sıfırlanır; Profesyonel planda sınır daha yüksek.',
    );
  });

  it('Profesyonel, Ajans, Kurumsal: yukseltme VAAT ETMEZ (satin alinabilir ust plan yok), yalniz yenilenme', async () => {
    expect(await metin('PRO', 120)).toBe('Aylık AI kullanım bütçen doldu ($120.00 / $120). Bütçe yeni ayın başında sıfırlanır.');
    expect(await metin('AGENCY', 200)).toBe('Aylık AI kullanım bütçen doldu ($200.00 / $200). Bütçe yeni ayın başında sıfırlanır.');
    expect(await metin('ENTERPRISE', 700)).toBe('Aylık AI kullanım bütçen doldu ($700.00 / $700). Bütçe yeni ayın başında sıfırlanır.');
  });

  it('403 govdesi makine kodu tasir (panel sohbeti bunu asistan notu olarak gosterir)', async () => {
    const err = await forbidden(() => db({ plan: 'PRO', aiCostThisMonthUsd: 120 }).quota.enforceAiCostBudget('u1'));
    expect(err.getStatus()).toBe(403);
    expect((err.getResponse() as any).code).toBe(AI_BUDGET_EXHAUSTED_CODE);
  });

  it('aiBudgetBlock ayni metni 403 atmadan doner; butce aciksa null', async () => {
    expect(await db({ plan: 'PRO', aiCostThisMonthUsd: 120 }).quota.aiBudgetBlock('u1'))
      .toBe('Aylık AI kullanım bütçen doldu ($120.00 / $120). Bütçe yeni ayın başında sıfırlanır.');
    expect(await db({ plan: 'PRO', aiCostThisMonthUsd: 119 }).quota.aiBudgetBlock('u1')).toBeNull();
  });
});

describe('ay donumu', () => {
  const lastMonth = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000);

  it('ucretli plan: yeni ayda butce sifirlanir, engel kalkar', async () => {
    const { quota, row } = db({ plan: 'PRO', aiCostThisMonthUsd: 500, articlesQuotaResetAt: lastMonth });
    await expect(quota.enforceAiCostBudget('u1')).resolves.toBeUndefined();
    expect(row.aiCostThisMonthUsd).toBe(0);
  });

  it('deneme: butce sifirlanmaz, engel surer', async () => {
    const { quota, row } = db({ plan: 'TRIAL', aiCostThisMonthUsd: 8, articlesQuotaResetAt: lastMonth });
    await expect(quota.enforceAiCostBudget('u1')).rejects.toBeInstanceOf(ForbiddenException);
    expect(row.aiCostThisMonthUsd).toBe(8);
  });
});

describe('kullanicinin baslattigi makale uretimi butce kapisindan gecer', () => {
  it('butce doluysa consumeArticleAllowance 403 (AI_BUDGET_EXHAUSTED) verir ve makale hakki DUSMEZ', async () => {
    const { quota, row, updateMany } = db({ plan: 'PRO', articlesUsedThisMonth: 5, aiCostThisMonthUsd: 120 });
    const err = await forbidden(() => quota.consumeArticleAllowance('u1', 's1'));
    expect((err.getResponse() as any).code).toBe(AI_BUDGET_EXHAUSTED_CODE);
    expect(updateMany).not.toHaveBeenCalled();
    expect(row.articlesUsedThisMonth).toBe(5);
  });

  it('butce aciksa hak her zamanki gibi duser (kapi izin verileni engellemez)', async () => {
    const { quota, row } = db({ plan: 'PRO', articlesUsedThisMonth: 5, aiCostThisMonthUsd: 119.99 });
    await expect(quota.consumeArticleAllowance('u1', 's1')).resolves.toEqual({ remaining: 34 });
    expect(row.articlesUsedThisMonth).toBe(6);
  });

  it('makale hakki da doluysa once o soylenir (butce metni degil)', async () => {
    const { quota } = db({ plan: 'PRO', articlesUsedThisMonth: 40, aiCostThisMonthUsd: 120 });
    const err = await forbidden(() => quota.consumeArticleAllowance('u1', 's1'));
    expect(err.message).toContain('Aylık 40 makale kotan doldu');
  });

  it('hakki onceden dusulmus yazinin "Simdi uret"i (assertGenerationSource) de butceye takilir', async () => {
    const dolu = db({ plan: 'PRO', aiCostThisMonthUsd: 120 });
    const err = await forbidden(() => dolu.quota.assertGenerationSource('u1', 's1'));
    expect((err.getResponse() as any).code).toBe(AI_BUDGET_EXHAUSTED_CODE);
    await expect(db({ plan: 'PRO', aiCostThisMonthUsd: 10 }).quota.assertGenerationSource('u1', 's1')).resolves.toBeUndefined();
  });

  it('ADMIN sahibin uretimi butceye takilmaz', async () => {
    const { quota, row } = db({ plan: 'PRO', role: 'ADMIN', articlesUsedThisMonth: 0, aiCostThisMonthUsd: 999 });
    await expect(quota.consumeArticleAllowance('u1', 's1')).resolves.toEqual({ remaining: 39 });
    expect(row.articlesUsedThisMonth).toBe(1);
  });
});

describe('hata yonu', () => {
  it('aiBudgetBlock: sayac okunamazsa null (uretim / ceviri durmaz), loglanir', async () => {
    const { quota, prisma } = db({ plan: 'PRO' });
    prisma.user.findUniqueOrThrow.mockRejectedValue(new Error('db yok'));
    await expect(quota.aiBudgetBlock('u1')).resolves.toBeNull();
  });

  it('enforceAiCostBudget: sayac okunamazsa hata cagirana gider (cagiranlar ayni satiri kendileri de okur)', async () => {
    const { quota, prisma } = db({ plan: 'PRO' });
    prisma.user.findUniqueOrThrow.mockRejectedValue(new Error('db yok'));
    await expect(quota.enforceAiCostBudget('u1')).rejects.toThrow('db yok');
  });
});
