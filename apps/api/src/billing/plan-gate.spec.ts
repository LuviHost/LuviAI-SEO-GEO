import { describe, it, expect } from 'vitest';
import { ForbiddenException } from '@nestjs/common';
import { QuotaService } from './quota.service.js';
import { FEATURE_MIN_PLAN, PLAN_RANK, planHasFeature, type PlanFeature, type PlanId } from './plans.js';

/**
 * Plan ozellik kapilarinin davranis testi.
 *
 * NEDEN VAR: fiyat karti ASO'nun para harcayan katmanini Profesyonel'e,
 * portfoy ozelliklerini Ajans'a, platform erisimini Kurumsal'a veriyor.
 * Bu kapilar eklenene kadar kodda HICBIR plan kontrolu yoktu ve Buyume
 * musterisi hepsini kullanabiliyordu. Kartta yazan her kilidin burada bir
 * testi olmali; test dusserse kart bos vaat vermeye baslamis demektir.
 */

/** Sadece user.findUniqueOrThrow ve trackedApp.count kullanan sahte Prisma. */
function fakePrisma(plan: string, trackedApps = 0) {
  return {
    user: { findUniqueOrThrow: async () => ({ plan }) },
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

  it('hata mesaji gereken EN DUSUK plan adini soyluyor', async () => {
    await expect(gate('STARTER').enforcePlanFeature('u1', 'asaEnabled'))
      .rejects.toThrow(/Profesyonel/);
    await expect(gate('PRO').enforcePlanFeature('u1', 'productRadar'))
      .rejects.toThrow(/Ajans/);
    await expect(gate('AGENCY').enforcePlanFeature('u1', 'mcpAccess'))
      .rejects.toThrow(/Kurumsal/);
  });

  it('hata mesaji ozelligin kullanici-yuzu adini iceriyor', async () => {
    await expect(gate('TRIAL').enforcePlanFeature('u1', 'geoHeatmap'))
      .rejects.toThrow(/GEO Heatmap/);
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
