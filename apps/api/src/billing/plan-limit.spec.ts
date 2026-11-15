import { describe, it, expect } from 'vitest';
import { ForbiddenException } from '@nestjs/common';
import { QuotaService, siteLimitMessage, trackedAppLimitMessage } from './quota.service.js';
import { PLAN_LIMIT_CODE, upgradeOfferFor, upgradePathSentence, withUpgradePath, type UpgradeOffer } from './plan-limit.js';
import { BASE_PLANS, FEATURE_MIN_PLAN, PLAN_RANK, PURCHASABLE_PLAN_IDS, findPlan, planHasFeature, publicPlans, type BasePlan, type PlanFeature } from './plans.js';
import { entitlementsFor } from './entitlements.js';

/**
 * Plan siniri hatasi = "bu duvari hangi plan kaldirir".
 *
 * NEDEN VAR (15.11.2026): panel, plan siniri 403'unu kirmizi hata bildirimi yerine plan
 * penceresiyle karsiliyor ve dugmeyi `upgrade.kind`'a gore yaziyor ("X'e geç" / "Teklif al").
 * Yanlis karar yanlis vaat demek: musteri satin alir, duvar yerinde kalir. Bu dosya
 * kurali sabitler: satis yalniz duvari GERCEKTEN kaldiran plan icin onerilir; kartla
 * alinamayan plan icin "satin al" denmez; satistan kalkan plan hic onerilmez.
 */

const pro = findPlan('pro')!;
const starter = findPlan('starter')!;
const enterprise = findPlan('enterprise')!;

describe('upgradeOfferFor', () => {
  it('siniri kaldiran EN DUSUK plan onerilir (deneme → Baslangic, Baslangic → Profesyonel)', () => {
    expect(upgradeOfferFor('TRIAL', (p) => p.sites > 1)).toEqual({ kind: 'buy', planId: 'starter', planName: starter.name_tr });
    expect(upgradeOfferFor('STARTER', (p) => p.sites > 2)).toEqual({ kind: 'buy', planId: 'pro', planName: pro.name_tr });
  });

  it('ara plan siniri kaldirmiyorsa atlanir: denemede makale icin Baslangic degil Profesyonel', () => {
    expect(starter.articlesPerMonth).toBe(0);
    expect(upgradeOfferFor('TRIAL', (p) => p.articlesPerMonth > 2)).toMatchObject({ kind: 'buy', planId: 'pro' });
  });

  it('yalniz teklifle satilan plan "satin al" diye onerilmez', () => {
    expect(enterprise.contactSales).toBe(true);
    expect(upgradeOfferFor('PRO', (p) => p.sites > pro.sites)).toEqual({ kind: 'quote', planId: 'enterprise', planName: enterprise.name_tr });
  });

  it('satistan kalkan plan (Ajans) hic onerilmez', () => {
    const agency = findPlan('agency')!;
    expect(agency.legacy).toBe(true);
    expect(agency.sites).toBeGreaterThan(pro.sites);
    expect(upgradeOfferFor('PRO', (p) => p.sites > pro.sites).planId).not.toBe('agency');
    // Ajans'taki hesap icin de bir ust satistaki plan: Kurumsal
    expect(upgradeOfferFor('AGENCY', (p) => p.sites > agency.sites)).toMatchObject({ kind: 'quote', planId: 'enterprise' });
  });

  it('hicbir satistaki plan kaldirmiyorsa beklemek kalir', () => {
    const wait: UpgradeOffer = { kind: 'wait', planId: null, planName: null };
    expect(upgradeOfferFor('ENTERPRISE', (p) => p.sites > enterprise.sites)).toEqual(wait);
    expect(upgradeOfferFor('TRIAL', () => false)).toEqual(wait);
  });

  it('purchasableOnly: teklifle satilan plan aday olmaz (AI butcesi / Asistan mesaji metinleriyle ayni kural)', () => {
    expect(upgradeOfferFor('PRO', (p) => p.chatMessagesPerMonth > pro.chatMessagesPerMonth, { purchasableOnly: true }).kind).toBe('wait');
    expect(upgradeOfferFor('STARTER', (p) => p.chatMessagesPerMonth > starter.chatMessagesPerMonth, { purchasableOnly: true }))
      .toMatchObject({ kind: 'buy', planId: 'pro' });
  });

  it('taninmayan / bos plan deneme sayilir', () => {
    expect(upgradeOfferFor(undefined, (p) => p.sites > 1)).toMatchObject({ kind: 'buy', planId: 'starter' });
    expect(upgradeOfferFor('yok-boyle-plan', (p) => p.sites > 1)).toMatchObject({ kind: 'buy', planId: 'starter' });
  });

  it('"buy" yalniz kartla alinabilen plan icin doner — her plan x her esik', () => {
    for (const from of BASE_PLANS) {
      for (const esik of [0, 1, 2, 5, 15, 50]) {
        const o = upgradeOfferFor(from.id, (p) => p.sites > esik);
        if (o.kind === 'buy') expect(PURCHASABLE_PLAN_IDS).toContain(o.planId);
        if (o.kind === 'quote') expect(findPlan(o.planId!)?.contactSales).toBe(true);
      }
    }
  });
});

/** Ayni ay icinde sifirlanmis sayac — maybeReset* update cagirmaz (quota-messages.spec ile ayni) */
function fakePrisma(
  user: Record<string, unknown>,
  counts: { sites?: number; apps?: number; chat?: number; everPaid?: boolean | 'hata' } = {},
) {
  const row = {
    id: 'u1', role: 'USER', aiCitationQuotaResetAt: new Date(), articlesQuotaResetAt: new Date(),
    // checkSiteQuota site sayisini kullanici satirindaki _count'tan okur
    _count: { sites: counts.sites ?? 0 },
    ...user,
  };
  return {
    user: {
      findUniqueOrThrow: async () => row,
      findUnique: async () => row,
      update: async () => row,
    },
    trackedApp: { count: async () => counts.apps ?? 0 },
    // Odenmis fatura (ever-paid.ts): plani biten eski musteri ile gercek denemeyi ayirir
    invoice: {
      findFirst: async () => {
        if (counts.everPaid === 'hata') throw new Error('db zaman asimi');
        return counts.everPaid ? { id: 'inv1' } : null;
      },
    },
    // Asistan mesaj sayaci (kv_store)
    kvStore: { findUnique: async () => ({ value: String(counts.chat ?? 0) }) },
  } as never;
}

async function limitBody(run: () => unknown): Promise<{ message: string; code?: string; upgrade?: UpgradeOffer }> {
  try {
    await run();
  } catch (err) {
    expect(err).toBeInstanceOf(ForbiddenException);
    return (err as ForbiddenException).getResponse() as never;
  }
  throw new Error('ForbiddenException bekleniyordu');
}

describe('QuotaService plan siniri hatalari kod ve yukseltme yolu tasir', () => {
  it('plan ozelligi: Profesyonel ozelligi kartla, Kurumsal ozelligi teklifle', async () => {
    const quota = new QuotaService(fakePrisma({}));
    const stuck = await limitBody(() => quota.assertPlanFeature('STARTER', 'stuckPages'));
    expect(stuck.code).toBe(PLAN_LIMIT_CODE);
    expect(stuck.upgrade).toEqual({ kind: 'buy', planId: 'pro', planName: pro.name_tr });
    expect(stuck.message).toContain(`${pro.name_tr} planına dahildir`);

    const radar = await limitBody(() => quota.assertPlanFeature('PRO', 'productRadar'));
    expect(radar.code).toBe(PLAN_LIMIT_CODE);
    expect(radar.upgrade).toEqual({ kind: 'quote', planId: 'enterprise', planName: enterprise.name_tr });
  });

  it('makale hakki: deneme ve Baslangic Profesyonel\'e, Profesyonel teklife', async () => {
    const trial = await limitBody(() => new QuotaService(fakePrisma({ plan: 'TRIAL', articlesUsedThisMonth: 2 })).enforceArticleQuota('u1'));
    expect(trial).toMatchObject({ code: PLAN_LIMIT_CODE, upgrade: { kind: 'buy', planId: 'pro' } });
    const start = await limitBody(() => new QuotaService(fakePrisma({ plan: 'STARTER', articlesUsedThisMonth: 0 })).enforceArticleQuota('u1'));
    expect(start).toMatchObject({ code: PLAN_LIMIT_CODE, upgrade: { kind: 'buy', planId: 'pro' } });
    const full = await limitBody(() => new QuotaService(fakePrisma({ plan: 'PRO', articlesUsedThisMonth: pro.articlesPerMonth })).enforceArticleQuota('u1'));
    expect(full).toMatchObject({ code: PLAN_LIMIT_CODE, upgrade: { kind: 'quote', planId: 'enterprise' } });
  });

  it('aylik AI calistirma tavani: Baslangic Profesyonel\'e, Profesyonel teklife', async () => {
    const start = await limitBody(() => new QuotaService(fakePrisma({ plan: 'STARTER', aiCitationTestsThisMonth: 20 })).enforceCitationQuota('u1'));
    expect(start).toMatchObject({ code: PLAN_LIMIT_CODE, upgrade: { kind: 'buy', planId: 'pro' } });
    const full = await limitBody(() => new QuotaService(fakePrisma({ plan: 'PRO', aiCitationTestsThisMonth: 75 })).enforceCitationQuota('u1'));
    expect(full).toMatchObject({ code: PLAN_LIMIT_CODE, upgrade: { kind: 'quote', planId: 'enterprise' } });
  });

  it('site sayisi: metin plana gore, eski "Profesyonel veya Kurumsal\'a yükseltin" kalibi yok', async () => {
    const trial = await limitBody(() => new QuotaService(fakePrisma({ plan: 'TRIAL' }, { sites: 1 })).enforceSiteQuota('u1'));
    expect(trial).toMatchObject({ code: PLAN_LIMIT_CODE, upgrade: { kind: 'buy', planId: 'starter' } });
    expect(trial.message).toBe(`Planın 1 siteye kadar izin veriyor; şu an 1 siten var. ${starter.name_tr} planında ${starter.sites} siteye kadar ekleyebilirsin.`);

    const full = await limitBody(() => new QuotaService(fakePrisma({ plan: 'PRO' }, { sites: pro.sites })).enforceSiteQuota('u1'));
    expect(full).toMatchObject({ code: PLAN_LIMIT_CODE, upgrade: { kind: 'quote', planId: 'enterprise' } });
    expect(full.message).toContain('teklifle');
    expect(full.message).not.toMatch(/yükseltin|siteniz/);
  });

  it('yonetici site sinirina takilmaz', async () => {
    await expect(new QuotaService(fakePrisma({ plan: 'TRIAL', role: 'ADMIN' }, { sites: 9 })).enforceSiteQuota('u1')).resolves.toBeUndefined();
  });

  it('AI butcesi: kod degismedi, yukseltme yolu metinle ayni (Profesyonel\'de oneri yok)', async () => {
    const start = await limitBody(() => new QuotaService(fakePrisma({ plan: 'STARTER', aiCostThisMonthUsd: 25 })).enforceAiCostBudget('u1'));
    expect(start.code).toBe('AI_BUDGET_EXHAUSTED');
    expect(start.upgrade).toMatchObject({ kind: 'buy', planId: 'pro' });
    expect(start.message).toContain(`${pro.name_tr} planda sınır daha yüksek`);

    const full = await limitBody(() => new QuotaService(fakePrisma({ plan: 'PRO', aiCostThisMonthUsd: 120 })).enforceAiCostBudget('u1'));
    expect(full.code).toBe('AI_BUDGET_EXHAUSTED');
    expect(full.upgrade).toEqual({ kind: 'wait', planId: null, planName: null });
    expect(full.message).not.toMatch(/planda sınır daha yüksek/);
  });
});

describe('durustluk kurali: onerilen plan duvari GERCEKTEN kaldirir', () => {
  /**
   * Her duvar x her plan x her kullanim: onerilen planin siniri kullanimin USTUNDE olmali
   * (satin alinca ayni kontrol gecmeli), plan hesabin planinin ustunde olmali ve duvari
   * kaldiran daha dusuk bir satistaki plan atlanmis olmamali.
   */
  const walls: Array<{ ad: string; of: (p: BasePlan) => number }> = [
    { ad: 'site', of: (p) => p.sites },
    { ad: 'uygulama', of: (p) => p.trackedApps },
    { ad: 'makale', of: (p) => p.articlesPerMonth },
    { ad: 'video', of: (p) => p.videosPerMonth },
    { ad: 'AI calistirma', of: (p) => p.aiRunsPerMonth },
    { ad: 'Asistan mesaji', of: (p) => p.chatMessagesPerMonth },
  ];

  it('her duvar x plan x kullanim icin', () => {
    for (const wall of walls) {
      const sinirlar = [...new Set(BASE_PLANS.map(wall.of))];
      const kullanimlar = [...new Set([0, ...sinirlar, ...sinirlar.map((n) => n + 1), ...sinirlar.map((n) => Math.max(0, n - 1))])];
      for (const from of BASE_PLANS) {
        for (const kullanim of kullanimlar) {
          const o = upgradeOfferFor(from.id, (p) => wall.of(p) > kullanim);
          const ipucu = `${wall.ad} / ${from.id} / kullanim ${kullanim}`;
          const adaylar = publicPlans().filter((p) => PLAN_RANK[p.id] > PLAN_RANK[from.id] && wall.of(p) > kullanim);
          if (o.kind === 'wait') {
            expect(adaylar, ipucu).toEqual([]);
            continue;
          }
          const plan = findPlan(o.planId!)!;
          expect(wall.of(plan), ipucu).toBeGreaterThan(kullanim);
          expect(PLAN_RANK[plan.id], ipucu).toBeGreaterThan(PLAN_RANK[from.id]);
          expect(plan.legacy, ipucu).not.toBe(true);
          // En dusuk kaldiran plan: altinda kaldiran baska satistaki plan yok
          expect(adaylar.every((p) => PLAN_RANK[p.id] >= PLAN_RANK[plan.id]), ipucu).toBe(true);
          expect(o.kind, ipucu).toBe(PURCHASABLE_PLAN_IDS.includes(plan.id) ? 'buy' : 'quote');
        }
      }
    }
  });

  it('plan ozelligi: onerilen plan ozelligi icerir', () => {
    for (const feature of Object.keys(FEATURE_MIN_PLAN) as PlanFeature[]) {
      for (const from of BASE_PLANS) {
        if (planHasFeature(from.id, feature)) continue;
        const o = upgradeOfferFor(from.id, (p) => planHasFeature(p.id, feature));
        expect(o.kind, `${feature} / ${from.id}`).not.toBe('wait');
        expect(planHasFeature(o.planId!, feature), `${feature} / ${from.id}`).toBe(true);
      }
    }
  });

  it('limitin USTUNDEKI hesap (plani biten musteri sitelerini korur): alinca duvar kalkmayan plan onerilmez', async () => {
    // Deneme duzeyine dusmus, 5 sitesi olan hesap: Baslangic (2) da Profesyonel (5) de yeni site actirmaz
    const dusen = await limitBody(() => new QuotaService(fakePrisma({ plan: 'TRIAL' }, { sites: 5 })).enforceSiteQuota('u1'));
    expect(dusen.upgrade).toEqual({ kind: 'quote', planId: 'enterprise', planName: enterprise.name_tr });
    expect(dusen.message).not.toContain(starter.name_tr);
    expect(dusen.message).toContain('şu an 5 siten var');
    // 3 sitesi olan dusen hesap: Baslangic (2) atlanir, Profesyonel (5) onerilir
    const uc = await limitBody(() => new QuotaService(fakePrisma({ plan: 'TRIAL' }, { sites: 3 })).enforceSiteQuota('u1'));
    expect(uc.upgrade).toEqual({ kind: 'buy', planId: 'pro', planName: pro.name_tr });
    expect(uc.message).toContain(`${pro.name_tr} planında ${pro.sites} siteye kadar`);
  });

  it('uygulama siniri da kullanima gore', async () => {
    // Deneme (1 uygulama) duzeyine dusmus, 3 uygulamasi olan hesap: Profesyonel (3) dorduncuyu actirmaz
    const dusen = await limitBody(() => new QuotaService(fakePrisma({ plan: 'TRIAL' }, { apps: 3 })).enforceTrackedAppQuota('u1'));
    expect(dusen).toMatchObject({ code: PLAN_LIMIT_CODE, upgrade: { kind: 'quote', planId: 'enterprise' } });
    const bir = await limitBody(() => new QuotaService(fakePrisma({ plan: 'TRIAL' }, { apps: 1 })).enforceTrackedAppQuota('u1'));
    expect(bir).toMatchObject({ code: PLAN_LIMIT_CODE, upgrade: { kind: 'buy', planId: 'pro' } });
  });

  it('deneme hesabina "yeni ayda yenilenir" denmez: denemenin calistirma hakki toplamdir', async () => {
    const trial = await limitBody(() => new QuotaService(fakePrisma({ plan: 'TRIAL', aiCitationTestsThisMonth: 3 })).enforceCitationQuota('u1'));
    expect(trial.upgrade).toMatchObject({ kind: 'buy', planId: 'starter' });
    expect(trial.message).toContain('deneme hakkı yenilenmez');
    expect(trial.message).not.toMatch(/yeni ayda yenilenir/);
  });

  it('AI butcesi: 403 atmayan okuma da yolu tasir (panel sohbeti bunu kullanir)', async () => {
    const start = await new QuotaService(fakePrisma({ plan: 'STARTER', aiCostThisMonthUsd: 25 })).aiBudgetBlockDetail('u1');
    expect(start?.upgrade).toMatchObject({ kind: 'buy', planId: 'pro' });
    expect(start?.message).toContain('sınır daha yüksek');
    const full = await new QuotaService(fakePrisma({ plan: 'PRO', aiCostThisMonthUsd: 120 })).aiBudgetBlockDetail('u1');
    expect(full?.upgrade.kind).toBe('wait');
    expect(await new QuotaService(fakePrisma({ plan: 'PRO', aiCostThisMonthUsd: 1 })).aiBudgetBlockDetail('u1')).toBeNull();
  });

  it('/me haklari: `offer` plan adiyla AYNI plandan — celisen ikili yok', () => {
    for (const plan of ['trial', 'starter', 'pro', 'agency', 'enterprise']) {
      const e = entitlementsFor(plan, 'USER');
      for (const feature of Object.keys(e.required) as PlanFeature[]) {
        const r = e.required[feature];
        expect(r.offer, `${plan} / ${feature}`).toBe(PURCHASABLE_PLAN_IDS.includes(r.plan) ? 'buy' : 'quote');
        expect(r.planName).toBe(findPlan(r.plan)!.name_tr);
      }
    }
  });
});

describe('siteLimitMessage', () => {
  it('kaldiran plan yoksa oneri yazilmaz', () => {
    expect(siteLimitMessage(50, 50, { kind: 'wait', planId: null, planName: null })).toBe('Planın 50 siteye kadar izin veriyor; şu an 50 siten var.');
  });
});

/**
 * Sahip istegi (15.11.2026): sinir CUMLESI dugmeyle ayni seyi soylemeli.
 *  - En ust plandaki hesaba "planını yükseltebilirsin" denmez (yukseltilecek plan yok).
 *  - Ust plan yalniz teklifle satiliyorsa "teklifle sunuluyor" denir, "yükselt" degil.
 *  - Plani biten eski musteriye "Deneme hesabı" denmez (hesap deneme DUZEYINDE).
 */
describe('sinir cumlesi yola ve hesaba gore', () => {
  const WAIT: UpgradeOffer = { kind: 'wait', planId: null, planName: null };
  const BUY: UpgradeOffer = { kind: 'buy', planId: 'pro', planName: pro.name_tr };
  const QUOTE: UpgradeOffer = { kind: 'quote', planId: 'enterprise', planName: enterprise.name_tr };
  const YUKSELT = /yükselt|plana geç|teklif/i;

  it('yol cumlesi: kartla "plana geçebilirsin", teklifle "teklifle sunuluyor", yoksa bos', () => {
    expect(upgradePathSentence(BUY)).toBe(`Daha fazlası için ${pro.name_tr} plana geçebilirsin.`);
    expect(upgradePathSentence(QUOTE)).toBe(`Daha fazlası için ${enterprise.name_tr} planı teklifle sunuluyor.`);
    expect(upgradePathSentence(WAIT)).toBe('');
    expect(withUpgradePath('Hak yeni ayda yenilenir.', WAIT)).toBe('Hak yeni ayda yenilenir.');
    expect(withUpgradePath('Hak yeni ayda yenilenir.', QUOTE)).toBe(`Hak yeni ayda yenilenir. Daha fazlası için ${enterprise.name_tr} planı teklifle sunuluyor.`);
  });

  it('en ust plandaki hesaba yukseltme onerilmez: makale, video, aylik calistirma, uygulama', async () => {
    const top = { plan: 'ENTERPRISE' };
    const makale = await limitBody(() => new QuotaService(fakePrisma({ ...top, articlesUsedThisMonth: enterprise.articlesPerMonth })).enforceArticleQuota('u1'));
    expect(makale.upgrade).toEqual(WAIT);
    expect(makale.message).toBe(`Aylık ${enterprise.articlesPerMonth} makale hakkın doldu. Hak yeni ayda yenilenir.`);

    const video = await limitBody(() => new QuotaService(fakePrisma({ ...top, videosUsedThisMonth: enterprise.videosPerMonth })).consumeVideoAllowance('u1'));
    expect(video.upgrade).toEqual(WAIT);
    expect(video.message).toBe(`Bu ayki ${enterprise.videosPerMonth} video hakkını kullandın. Hak yeni ayda yenilenir.`);

    const olcum = await limitBody(() => new QuotaService(fakePrisma({ ...top, aiCitationTestsThisMonth: enterprise.aiRunsPerMonth })).enforceCitationQuota('u1'));
    expect(olcum.upgrade).toEqual(WAIT);
    expect(olcum.message).toContain('Hak yeni ayda yenilenir.');
    // Kendi anahtar (BYOK) cumlesi bir yukseltme onerisi degil: ondan onceki kisim sinanir
    expect(olcum.message.split('Hak yeni ayda yenilenir.')[0]).not.toMatch(YUKSELT);
    expect(olcum.message).not.toMatch(/planını yükselt/);

    const app = await limitBody(() => new QuotaService(fakePrisma(top, { apps: enterprise.trackedApps })).enforceTrackedAppQuota('u1'));
    expect(app.upgrade).toEqual(WAIT);
    expect(app.message).toBe(`Planın ${enterprise.trackedApps} uygulamaya kadar izin veriyor; şu an ${enterprise.trackedApps} uygulaman var.`);
    for (const m of [makale.message, video.message, app.message]) expect(m).not.toMatch(YUKSELT);
  });

  it('ust plan yalniz teklifle: "teklifle sunuluyor" denir, "planını yükselt" denmez', async () => {
    const makale = await limitBody(() => new QuotaService(fakePrisma({ plan: 'PRO', articlesUsedThisMonth: pro.articlesPerMonth })).enforceArticleQuota('u1'));
    expect(makale.message).toBe(`Aylık ${pro.articlesPerMonth} makale hakkın doldu. Hak yeni ayda yenilenir. Daha fazlası için ${enterprise.name_tr} planı teklifle sunuluyor.`);
    const video = await limitBody(() => new QuotaService(fakePrisma({ plan: 'PRO', videosUsedThisMonth: pro.videosPerMonth })).consumeVideoAllowance('u1'));
    expect(video.message).toContain(`Daha fazlası için ${enterprise.name_tr} planı teklifle sunuluyor.`);
    const olcum = await limitBody(() => new QuotaService(fakePrisma({ plan: 'PRO', aiCitationTestsThisMonth: pro.aiRunsPerMonth })).enforceCitationQuota('u1'));
    expect(olcum.message).toContain(`Daha fazlası için ${enterprise.name_tr} planı teklifle sunuluyor.`);
    const radar = await limitBody(() => new QuotaService(fakePrisma({})).assertPlanFeature('PRO', 'productRadar'));
    expect(radar.message).toMatch(new RegExp(`${enterprise.name_tr} planına dahildir\\. ${enterprise.name_tr} planı teklifle sunuluyor\\.$`));
    for (const m of [makale.message, video.message, olcum.message, radar.message]) expect(m).not.toMatch(/yükselt/i);
  });

  it('kartla alinan ust plan adiyla soylenir (Baslangic → Profesyonel)', async () => {
    const olcum = await limitBody(() => new QuotaService(fakePrisma({ plan: 'STARTER', aiCitationTestsThisMonth: starter.aiRunsPerMonth })).enforceCitationQuota('u1'));
    expect(olcum.message).toContain(`Hak yeni ayda yenilenir. Daha fazlası için ${pro.name_tr} plana geçebilirsin.`);
    const stuck = await limitBody(() => new QuotaService(fakePrisma({})).assertPlanFeature('STARTER', 'stuckPages'));
    expect(stuck.message).toMatch(new RegExp(`${pro.name_tr} planına dahildir\\. ${pro.name_tr} plana geçerek kullanabilirsin\\.$`));
    expect(trackedAppLimitMessage(1, 1, BUY)).toBe(`Planın 1 uygulamaya kadar izin veriyor; şu an 1 uygulaman var. ${pro.name_tr} planında ${pro.trackedApps} uygulamaya kadar ekleyebilirsin.`);
    expect(trackedAppLimitMessage(3, 3, QUOTE)).toBe(`Planın 3 uygulamaya kadar izin veriyor; şu an 3 uygulaman var. Daha fazla uygulama için ${enterprise.name_tr} planı teklifle sunuluyor.`);
  });

  it('plani biten eski musteriye "Deneme hesabı" denmez; gercek denemeye denir', async () => {
    const dusen = (user: Record<string, unknown>, counts = {}) => new QuotaService(fakePrisma({ plan: 'TRIAL', ...user }, { everPaid: true, ...counts }));
    const deneme = (user: Record<string, unknown>, counts = {}) => new QuotaService(fakePrisma({ plan: 'TRIAL', ...user }, { everPaid: false, ...counts }));
    const GIRIS = 'Planın sona erdi; hesabın deneme düzeyinde';

    const makale = await limitBody(() => dusen({ articlesUsedThisMonth: 12 }).enforceArticleQuota('u1'));
    expect(makale.message).toBe(`${GIRIS} ve makale hakkın kalmadı. Yeni makale üretmek için ${pro.name_tr} plana geç.`);
    expect(makale.upgrade).toMatchObject({ kind: 'buy', planId: 'pro' });
    const olcum = await limitBody(() => dusen({ aiCitationTestsThisMonth: 9 }).enforceCitationQuota('u1'));
    expect(olcum.message.startsWith(`${GIRIS} ve bu düzeydeki 3 AI görünürlük çalıştırması hakkını kullandın (9/3); bu hak yenilenmez.`)).toBe(true);
    const butce = await limitBody(() => dusen({ aiCostThisMonthUsd: 30 }).enforceAiCostBudget('u1'));
    expect(butce.message.startsWith(`${GIRIS} ve bu düzeyin AI kullanım bütçesi doldu ($30.00 / $8). Bu bütçe yenilenmez.`)).toBe(true);
    expect((await dusen({ aiCostThisMonthUsd: 30 }).aiBudgetBlockDetail('u1'))?.message).toBe(butce.message);
    const sohbet = await limitBody(() => dusen({}, { chat: 20 }).consumeChatMessageSlot({ id: 'u1', role: 'USER', plan: 'TRIAL' }));
    expect(sohbet.message.startsWith(`${GIRIS} ve bu düzeydeki 20 Asistan mesajı hakkını kullandın; bu hak yenilenmez.`)).toBe(true);
    for (const m of [makale.message, olcum.message, butce.message, sohbet.message]) expect(m).not.toMatch(/Deneme hesab|ücretsiz/i);

    // Gercek deneme hesabi (odenmis fatura yok): eski hitap aynen
    expect((await limitBody(() => deneme({ articlesUsedThisMonth: 2 }).enforceArticleQuota('u1'))).message)
      .toBe(`Deneme hesabındaki 2 ücretsiz makale hakkını kullandın. Makale üretimine devam etmek için ${pro.name_tr} plana geç.`);
    expect((await limitBody(() => deneme({ aiCitationTestsThisMonth: 3 }).enforceCitationQuota('u1'))).message).toContain('Deneme hesabındaki 3 AI görünürlük çalıştırması');
    expect((await limitBody(() => deneme({}, { chat: 20 }).consumeChatMessageSlot({ id: 'u1', role: 'USER', plan: 'TRIAL' }))).message).toContain('Deneme hesabındaki 20 Asistan mesajı');
  });

  it('isLapsed: yalniz deneme duzeyindeki hesapta sorulur; odeme gecmisi okunamazsa deneme hitabina duser, 403 yine atilir', async () => {
    expect(await new QuotaService(fakePrisma({ plan: 'TRIAL' }, { everPaid: true })).isLapsed('u1', 'TRIAL')).toBe(true);
    expect(await new QuotaService(fakePrisma({ plan: 'TRIAL' }, { everPaid: false })).isLapsed('u1', 'TRIAL')).toBe(false);
    // Ucretli planda fatura sorgusu yapilmaz ('hata' firlatirdi)
    expect(await new QuotaService(fakePrisma({ plan: 'PRO' }, { everPaid: 'hata' })).isLapsed('u1', 'PRO')).toBe(false);
    const bozuk = await limitBody(() => new QuotaService(fakePrisma({ plan: 'TRIAL', articlesUsedThisMonth: 2 }, { everPaid: 'hata' })).enforceArticleQuota('u1'));
    expect(bozuk.code).toBe(PLAN_LIMIT_CODE);
    expect(bozuk.message).toContain('Deneme hesabındaki 2 ücretsiz makale hakkını kullandın.');
  });

  it('isi haritasi / uygulama soru laboratuvari: hak bitince plan siniri, kendi anahtar (BYOK) vaadi yok', async () => {
    const err = await new QuotaService(fakePrisma({ plan: 'PRO' })).citationQuotaError('u1', { limit: 75, used: 75 }, { byokNote: false });
    const body = err.getResponse() as { message: string; code: string; upgrade: UpgradeOffer };
    expect(body.code).toBe(PLAN_LIMIT_CODE);
    expect(body.upgrade).toMatchObject({ kind: 'quote', planId: 'enterprise' });
    expect(body.message).toBe(`Aylık 75 AI görünürlük çalıştırması hakkın doldu (75/75). Hak yeni ayda yenilenir. Daha fazlası için ${enterprise.name_tr} planı teklifle sunuluyor.`);
    expect(body.message).not.toMatch(/BYOK/);
  });
});
