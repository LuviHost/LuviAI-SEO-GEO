import { describe, it, expect } from 'vitest';
import { ForbiddenException } from '@nestjs/common';
import { QuotaService } from './quota.service.js';
import {
  BASE_PLANS, FEATURE_MIN_PLAN, PLAN_FEATURE_LABELS, PLAN_RANK, PURCHASABLE_PLAN_IDS,
  featureOfferPlan, findPlan, planHasFeature, publicPlans, type PlanFeature, type PlanId,
} from './plans.js';

/**
 * Plan ozellik kapilarinin davranis testi.
 *
 * NEDEN VAR: fiyat karti ASO'nun para harcayan katmanini Profesyonel'e,
 * portfoy ozelliklerini Ajans'a, platform erisimini Kurumsal'a veriyor.
 * Bu kapilar eklenene kadar kodda HICBIR plan kontrolu yoktu ve Buyume
 * musterisi hepsini kullanabiliyordu. Kartta yazan her kilidin burada bir
 * testi olmali; test dusserse kart bos vaat vermeye baslamis demektir.
 *
 * 11.11.2026 (uc paket): Ajans satistan kalkti (plans.ts `legacy`). Kapi yerinde durur
 * (FEATURE_MIN_PLAN hala 'agency': o plandaki hesaplar hakkini korur) ama musteriye
 * SOYLENEN plan, ozelligi iceren en dusuk SATISTAKI plandir (featureOfferPlan): Product
 * Radar, GEO Heatmap, Live Crawler icin artik "Kurumsal".
 */

/** Sadece user.findUniqueOrThrow ve trackedApp.count kullanan sahte Prisma. */
function fakePrisma(plan: string, trackedApps = 0, role: 'USER' | 'ADMIN' = 'USER') {
  return {
    user: { findUniqueOrThrow: async () => ({ plan, role }) },
    trackedApp: { count: async () => trackedApps },
  } as never;
}

const gate = (plan: string) => new QuotaService(fakePrisma(plan));
const ALL_PLANS: PlanId[] = ['trial', 'starter', 'pro', 'agency', 'enterprise'];
const ALL_FEATURES = Object.keys(FEATURE_MIN_PLAN) as PlanFeature[];

describe('planHasFeature — merdiven', () => {
  it('her ozellik tam olarak gereken plandan itibaren aciliyor', () => {
    for (const f of ALL_FEATURES) {
      const min = FEATURE_MIN_PLAN[f];
      for (const p of ALL_PLANS) {
        const beklenen = PLAN_RANK[p] >= PLAN_RANK[min];
        expect(planHasFeature(p, f), `${p} / ${f} (min: ${min})`).toBe(beklenen);
      }
    }
  });

  it('merdiven geri gitmiyor — ust plan asla ozellik kaybetmez', () => {
    for (let i = 1; i < ALL_PLANS.length; i++) {
      for (const f of ALL_FEATURES) {
        if (planHasFeature(ALL_PLANS[i - 1], f)) {
          expect(planHasFeature(ALL_PLANS[i], f), `${ALL_PLANS[i]} ${f} kaybetmis`).toBe(true);
        }
      }
    }
  });

  it('hicbir ozellik trial/starter seviyesinde degil — kapinin anlami olmali', () => {
    for (const f of ALL_FEATURES) {
      expect(['pro', 'agency', 'enterprise'], `${f} ust plan farki degil`).toContain(FEATURE_MIN_PLAN[f]);
    }
  });
});

describe('enforcePlanFeature', () => {
  it('gereken planin altindaki her plan bloklaniyor, ustundekiler geciyor', async () => {
    for (const f of ALL_FEATURES) {
      for (const p of ALL_PLANS) {
        const call = gate(p.toUpperCase()).enforcePlanFeature('u1', f);
        if (planHasFeature(p, f)) {
          await expect(call, `${p} / ${f} gecmeliydi`).resolves.toBeUndefined();
        } else {
          await expect(call, `${p} / ${f} bloklanmaliydi`).rejects.toBeInstanceOf(ForbiddenException);
        }
      }
    }
  });

  it('hata mesaji ozelligi iceren EN DUSUK SATISTAKI plan adini soyluyor (Ajans satistan kalkti: Kurumsal)', async () => {
    await expect(gate('STARTER').enforcePlanFeature('u1', 'asaEnabled'))
      .rejects.toThrow(/Profesyonel/);
    await expect(gate('PRO').enforcePlanFeature('u1', 'productRadar'))
      .rejects.toThrow(/Kurumsal/);
    await expect(gate('AGENCY').enforcePlanFeature('u1', 'mcpAccess'))
      .rejects.toThrow(/Kurumsal/);
    // Her kilitli (plan, ozellik) cifti icin: mesaj featureOfferPlan'in adini soyler, satistan kalkan plani ASLA
    const kalkan = BASE_PLANS.filter((p) => p.legacy).map((p) => p.name_tr);
    expect(kalkan).toEqual(['Ajans']);
    for (const f of ALL_FEATURES) {
      for (const p of ALL_PLANS) {
        if (planHasFeature(p, f)) continue;
        const err = await gate(p.toUpperCase()).enforcePlanFeature('u1', f).catch((e) => e);
        expect(err, `${p}/${f}`).toBeInstanceOf(ForbiddenException);
        expect(err.message, `${p}/${f}`).toBe(
          `${PLAN_FEATURE_LABELS[f]} ${featureOfferPlan(f).name_tr} planına dahildir. Planını yükselterek kullanabilirsin.`,
        );
        for (const ad of kalkan) expect(err.message, `${p}/${f}`).not.toContain(ad);
      }
    }
  });

  it('hata mesaji ozelligin kullanici-yuzu adini iceriyor', async () => {
    await expect(gate('TRIAL').enforcePlanFeature('u1', 'geoHeatmap'))
      .rejects.toThrow(/GEO ısı haritası/);
  });
});

describe('enforceTrackedAppQuota', () => {
  it('limit altinda gecer, limitte bloklar', async () => {
    // PRO trackedApps = 3
    await expect(
      new QuotaService(fakePrisma('PRO', 2)).enforceTrackedAppQuota('u1'),
    ).resolves.toBeUndefined();
    await expect(
      new QuotaService(fakePrisma('PRO', 3)).enforceTrackedAppQuota('u1'),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('STARTER tek uygulamayla sinirli', async () => {
    await expect(
      new QuotaService(fakePrisma('STARTER', 1)).enforceTrackedAppQuota('u1'),
    ).rejects.toThrow(/1 uygulama/);
  });

  it('ADMIN limitte de gecer (site kotasindaki muafiyetle tutarli); gosterilen kota degismez', async () => {
    const q = new QuotaService(fakePrisma('PRO', 3, 'ADMIN'));
    await expect(q.enforceTrackedAppQuota('u1')).resolves.toBeUndefined();
    await expect(q.checkTrackedAppQuota('u1')).resolves.toEqual({ allowed: false, current: 3, limit: 3 });
  });
});

describe('canUsePublishTarget', () => {
  it('TRIAL sadece Markdown ZIP ve WordPress REST kullanabilir', async () => {
    const q = new QuotaService(fakePrisma('TRIAL'));
    await expect(q.canUsePublishTarget('u1', 'MARKDOWN_ZIP')).resolves.toBe(true);
    await expect(q.canUsePublishTarget('u1', 'WORDPRESS_REST')).resolves.toBe(true);
    await expect(q.canUsePublishTarget('u1', 'GITHUB')).resolves.toBe(false);
    await expect(q.canUsePublishTarget('u1', 'FTP')).resolves.toBe(false);
  });

  it('ucretli planlar tum hedefleri kullanabilir', async () => {
    for (const plan of ['STARTER', 'PRO', 'AGENCY', 'ENTERPRISE']) {
      const q = new QuotaService(fakePrisma(plan));
      await expect(q.canUsePublishTarget('u1', 'GITHUB'), plan).resolves.toBe(true);
    }
  });
});

describe('API anahtari scope dogrulamasi — yetki yukseltme kapali', async () => {
  const { ApiKeysService, ALL_SCOPES, DEFAULT_SCOPES } = await import('../api-keys/api-keys.service.js');

  function svc(captured: { scopes?: string[] }) {
    return new ApiKeysService({
      apiKey: {
        create: async ({ data }: any) => {
          captured.scopes = data.scopes;
          return { ...data, id: 'k1', createdAt: new Date(), expiresAt: null };
        },
      },
    } as never);
  }

  it("scopes:['*'] REDDEDILIR — dar anahtar tam yetkili anahtar uretemez", async () => {
    const cap = {};
    await expect(svc(cap).create('u1', { name: 'x', scopes: ['*'] }))
      .rejects.toThrow(/Gecersiz scope/);
  });

  it('ALL_SCOPES disindaki her deger reddedilir', async () => {
    const cap = {};
    await expect(svc(cap).create('u1', { name: 'x', scopes: ['sites:read', 'uydurma:write'] }))
      .rejects.toThrow(/uydurma:write/);
  });

  it('gecerli scope seti kabul edilir', async () => {
    const cap: { scopes?: string[] } = {};
    await svc(cap).create('u1', { name: 'x', scopes: ['sites:read', 'articles:write'] });
    expect(cap.scopes).toEqual(['sites:read', 'articles:write']);
  });

  it('varsayilan set TUM okuma scope\'larini kapsar — mevcut entegrasyonlar kirilmasin', async () => {
    const cap: { scopes?: string[] } = {};
    await svc(cap).create('u1', { name: 'x' });
    const okumalar = ALL_SCOPES.filter((s) => s.endsWith(':read'));
    expect(cap.scopes).toEqual(DEFAULT_SCOPES);
    expect(cap.scopes).toEqual(okumalar);
    expect(cap.scopes, 'ads:read varsayilanda olmali').toContain('ads:read');
    expect(cap.scopes, 'analytics:read varsayilanda olmali').toContain('analytics:read');
  });

  it('varsayilan sette hicbir yazma scope\'u yok', async () => {
    expect(DEFAULT_SCOPES.some((s) => s.endsWith(':write'))).toBe(false);
  });
});

describe('cron plan suzgeci — otomatik uretim de plana bagli', () => {
  it('ozellik icin yalnizca yeterli planlar seciliyor', async () => {
    const { siteWhereForFeature } = await import('./plan-site-filter.js');
    const planlar = (f: PlanFeature) =>
      (siteWhereForFeature(f).user.plan.in as string[]).slice().sort();

    // Profesyonel ozellikleri: pro, agency, enterprise
    expect(planlar('agentReadiness')).toEqual(['AGENCY', 'ENTERPRISE', 'PRO']);
    expect(planlar('contentOpportunities')).toEqual(['AGENCY', 'ENTERPRISE', 'PRO']);
    // Ajans ozelligi: agency, enterprise
    expect(planlar('productRadar')).toEqual(['AGENCY', 'ENTERPRISE']);
    // Kurumsal ozelligi
    expect(planlar('mcpAccess')).toEqual(['ENTERPRISE']);
  });

  it('TRIAL ve STARTER hicbir ust-plan ozelliginin cron listesinde YOK', async () => {
    const { siteWhereForFeature } = await import('./plan-site-filter.js');
    for (const f of ALL_FEATURES) {
      const planlar = siteWhereForFeature(f).user.plan.in as string[];
      expect(planlar, `${f}: TRIAL sizmis`).not.toContain('TRIAL');
      expect(planlar, `${f}: STARTER sizmis`).not.toContain('STARTER');
    }
  });

  it('suzgec planHasFeature ile tutarli', async () => {
    const { siteWhereForFeature } = await import('./plan-site-filter.js');
    for (const f of ALL_FEATURES) {
      const izinli = new Set(siteWhereForFeature(f).user.plan.in as string[]);
      for (const p of ALL_PLANS) {
        expect(izinli.has(p.toUpperCase()), `${p}/${f}`).toBe(planHasFeature(p, f));
      }
    }
  });
});

describe('entitlements — web icin ozellik haklari', () => {
  it('her plan icin planHasFeature ile birebir ayni', async () => {
    const { entitlementsFor } = await import('./entitlements.js');
    for (const p of ALL_PLANS) {
      const e = entitlementsFor(p.toUpperCase());
      expect(e.plan).toBe(p);
      for (const f of ALL_FEATURES) {
        expect(e.features[f], `${p}/${f}`).toBe(planHasFeature(p, f));
      }
    }
  });

  it('kapali ozellik icin gereken plan ADI plans.ts ten geliyor', async () => {
    const { entitlementsFor } = await import('./entitlements.js');
    const e = entitlementsFor('STARTER');
    // Plan yeniden adlandirilirsa arayuz metni kendiliginden duzelmeli —
    // 'Baslangic' -> 'Buyume' degisikliginde landing aylarca eski adi
    // gostermisti, ayni hatayi tekrarlamayalim.
    // 11.11.2026: Ajans satistan kalkti; kilitli kart musteriyi alabilecegi plana yollar (Kurumsal).
    expect(e.required.productRadar.planName).toBe('Kurumsal');
    expect(e.required.productRadar.plan).toBe('enterprise');
    expect(e.required.agentReadiness.planName).toBe('Profesyonel');
    expect(e.required.mcpAccess.planName).toBe('Kurumsal');
    expect(e.required.productRadar.label).toBe('Ürün Radarı');
    // Her ozellikte: ad ve kimlik plans.ts featureOfferPlan'dan; satistan kalkan plan hicbir kartta yok
    for (const f of ALL_FEATURES) {
      const teklif = featureOfferPlan(f);
      expect(e.required[f].plan, f).toBe(teklif.id);
      expect(e.required[f].planName, f).toBe(teklif.name_tr);
      expect(findPlan(e.required[f].plan)!.legacy, f).toBeFalsy();
    }
  });

  it('Ajans (satistan kalkan plan) hesabi haklarini korur: kapi FEATURE_MIN_PLAN\'da, kilit yok', async () => {
    const { entitlementsFor } = await import('./entitlements.js');
    const e = entitlementsFor('AGENCY');
    for (const f of ['productRadar', 'geoHeatmap', 'liveCrawler'] as const) {
      expect(FEATURE_MIN_PLAN[f], f).toBe('agency');
      expect(planHasFeature('agency', f), f).toBe(true);
      expect(e.features[f], f).toBe(true);
      await expect(gate('AGENCY').enforcePlanFeature('u1', f), f).resolves.toBeUndefined();
      // Ayni ozellik Profesyonel'de kapali ve musteriye Kurumsal soylenir
      expect(planHasFeature('pro', f), f).toBe(false);
      expect(featureOfferPlan(f).id, f).toBe('enterprise');
    }
  });

  it('ADMIN her ozelligi acik gorur (sunucu kapilariyla ayni kural), plan alani gercek plan', async () => {
    const { entitlementsFor } = await import('./entitlements.js');
    const { ownerHasPlanFeature } = await import('./plan-site-filter.js');
    for (const p of ALL_PLANS) {
      const e = entitlementsFor(p.toUpperCase(), 'ADMIN');
      expect(e.plan).toBe(p);
      for (const f of ALL_FEATURES) {
        expect(e.features[f], `${p}/${f}`).toBe(true);
        expect(ownerHasPlanFeature({ plan: p.toUpperCase(), role: 'ADMIN' }, f)).toBe(true);
      }
    }
    // ADMIN olmayan rol plana gore kalir
    expect(entitlementsFor('STARTER', 'USER').features.liveCrawler).toBe(false);
  });

  it('bilinmeyen/bos plan guvenli tarafa duser (hicbir ozellik acilmaz)', async () => {
    const { entitlementsFor } = await import('./entitlements.js');
    for (const girdi of ['', 'YOKBOYLEPLAN', undefined as any]) {
      const e = entitlementsFor(girdi);
      expect(Object.values(e.features).some(Boolean), `girdi=${girdi}`).toBe(false);
    }
  });
});

describe('satistaki planlar — publicPlans, PURCHASABLE_PLAN_IDS, featureOfferPlan (uc paket, 11.11.2026)', () => {
  it('publicPlans satistan kalkan plani icermez; kalan liste deneme + uc paket, BASE_PLANS sirasiyla', () => {
    const liste = publicPlans();
    expect(liste.map((p) => p.id)).toEqual(['trial', 'starter', 'pro', 'enterprise']);
    expect(liste.some((p) => p.legacy)).toBe(false);
    expect(liste).toEqual(BASE_PLANS.filter((p) => !p.legacy));
    // Ajans tanimi durur (mevcut hesaplar): BASE_PLANS'te var, listede yok
    expect(findPlan('agency')).toMatchObject({ id: 'agency', legacy: true });
    expect(BASE_PLANS.filter((p) => p.legacy).map((p) => p.id)).toEqual(['agency']);
  });

  it('PURCHASABLE_PLAN_IDS: satistan kalkan, teklifle satilan ya da ucretsiz plan yok; hepsi listede ve fiyatli', () => {
    expect([...PURCHASABLE_PLAN_IDS]).toEqual(['starter', 'pro']);
    const acik = new Set(publicPlans().map((p) => p.id));
    for (const id of PURCHASABLE_PLAN_IDS) {
      const p = findPlan(id)!;
      expect(p, id).toBeDefined();
      expect(p.legacy, `${id} satistan kalkmis`).toBeFalsy();
      expect(p.contactSales, `${id} teklifle satiliyor`).toBeFalsy();
      expect(acik.has(id), `${id} listede yok`).toBe(true);
      expect(p.monthly_usd, id).toBeGreaterThan(0);
      expect(p.annual_usd, id).toBeGreaterThan(0);
    }
    // Tersi: listedeki ucretli, teklifsiz her plan satin alinabilir
    const beklenen = publicPlans().filter((p) => p.monthly_usd > 0 && !p.contactSales).map((p) => p.id);
    expect([...PURCHASABLE_PLAN_IDS].sort()).toEqual(beklenen.sort());
  });

  it('featureOfferPlan: asla satistan kalkan plan; ozelligi GERCEKTEN iceren en dusuk satistaki plan', () => {
    for (const f of ALL_FEATURES) {
      const teklif = featureOfferPlan(f);
      expect(teklif.legacy, f).toBeFalsy();
      expect(publicPlans().map((p) => p.id), f).toContain(teklif.id);
      expect(planHasFeature(teklif.id, f), `${f}: ${teklif.id} ozelligi icermiyor`).toBe(true);
      // En dusuk: satistaki daha alt hicbir plan ozelligi icermez
      for (const p of publicPlans()) {
        if (PLAN_RANK[p.id] < PLAN_RANK[teklif.id]) expect(planHasFeature(p.id, f), `${f}: ${p.id} daha dusuk ve iceriyor`).toBe(false);
      }
    }
    // Kapisi satistaki bir planda olan ozellikte teklif = kapi; Ajans kapili ozellikte Kurumsal
    for (const f of ALL_FEATURES) {
      const min = FEATURE_MIN_PLAN[f];
      expect(featureOfferPlan(f).id, f).toBe(findPlan(min)!.legacy ? 'enterprise' : min);
    }
  });
});

describe('periyodik tarama — raporun veri kaynagi', () => {
  it('AUDIT_CRON varsayilan KAPALI — rapor elle tetiklenen taramalarla beslenir', async () => {
    const { AuditCron } = await import('../audit/audit.cron.js');
    const cron: any = new (AuditCron as any)(null, null);
    const eski = process.env.AUDIT_CRON;
    try {
      delete process.env.AUDIT_CRON;
      expect(cron.enabled(), 'tanimsizken KAPALI olmali — kimsenin bakmadigi taramaya token harcanmaz').toBe(false);
      process.env.AUDIT_CRON = 'true';
      expect(cron.enabled()).toBe(true);
      process.env.AUDIT_CRON = 'TRUE';
      expect(cron.enabled(), 'buyuk harf de acmali').toBe(true);
      process.env.AUDIT_CRON = 'false';
      expect(cron.enabled()).toBe(false);
    } finally {
      if (eski === undefined) delete process.env.AUDIT_CRON; else process.env.AUDIT_CRON = eski;
    }
  });

  it('site tavani gecersiz degerlerde makul varsayilana duser', async () => {
    const { AuditCron } = await import('../audit/audit.cron.js');
    const cron: any = new (AuditCron as any)(null, null);
    const eski = process.env.AUDIT_CRON_MAX_SITES;
    try {
      for (const v of [undefined, '', '0', '-5', 'abc']) {
        if (v === undefined) delete process.env.AUDIT_CRON_MAX_SITES;
        else process.env.AUDIT_CRON_MAX_SITES = v;
        expect(cron.maxSites(), `girdi=${v}`).toBe(100);
      }
      process.env.AUDIT_CRON_MAX_SITES = '25';
      expect(cron.maxSites()).toBe(25);
    } finally {
      if (eski === undefined) delete process.env.AUDIT_CRON_MAX_SITES; else process.env.AUDIT_CRON_MAX_SITES = eski;
    }
  });

  it('TRIAL periyodik taramaya girmez — maliyet freni', async () => {
    const { AuditCron } = await import('../audit/audit.cron.js');
    const paid = (AuditCron as any).PAID as string[];
    expect(paid).not.toContain('TRIAL');
    expect(paid).toEqual(['STARTER', 'PRO', 'AGENCY', 'ENTERPRISE']);
  });
});
