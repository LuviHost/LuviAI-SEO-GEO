import { describe, it, expect } from 'vitest';
import { ForbiddenException } from '@nestjs/common';
import { QuotaService } from './quota.service.js';

/**
 * Plan ozellik kapilarinin davranis testi.
 *
 * NEDEN VAR: fiyat karti ASA'yi Profesyonel'e, MCP/REST API/BYOK'u Kurumsal'a
 * veriyor. Bu kapilar eklenene kadar kodda HICBIR plan kontrolu yoktu ve
 * Buyume musterisi hepsini kullanabiliyordu. Kartta yazan her kilidin burada
 * bir testi olmali; test dusarse kart bos vaat vermeye baslamis demektir.
 */

/** Sadece user.findUniqueOrThrow ve trackedApp.count kullanan sahte Prisma. */
function fakePrisma(plan: string, trackedApps = 0) {
  return {
    user: { findUniqueOrThrow: async () => ({ plan }) },
    trackedApp: { count: async () => trackedApps },
  } as never;
}

const gate = (plan: string) => new QuotaService(fakePrisma(plan));

describe('enforcePlanFeature', () => {
  const cases = [
    { feature: 'asaEnabled', label: 'Apple Search Ads', allowed: ['PRO', 'AGENCY', 'ENTERPRISE'] },
    { feature: 'ascEnabled', label: 'App Store Connect', allowed: ['PRO', 'AGENCY', 'ENTERPRISE'] },
    { feature: 'mcpAccess', label: 'MCP sunucusu', allowed: ['ENTERPRISE'] },
    { feature: 'apiAccess', label: 'REST API', allowed: ['ENTERPRISE'] },
    { feature: 'byok', label: 'BYOK', allowed: ['ENTERPRISE'] },
  ] as const;

  const ALL = ['TRIAL', 'STARTER', 'PRO', 'AGENCY', 'ENTERPRISE'];

  for (const c of cases) {
    it(`${c.feature}: yalnizca ${c.allowed.join('/')} gecer`, async () => {
      for (const plan of ALL) {
        const call = gate(plan).enforcePlanFeature('u1', c.feature, c.label);
        if ((c.allowed as readonly string[]).includes(plan)) {
          await expect(call, `${plan} gecmeliydi`).resolves.toBeUndefined();
        } else {
          await expect(call, `${plan} bloklanmaliydi`).rejects.toBeInstanceOf(ForbiddenException);
        }
      }
    });
  }

  it('hata mesaji gereken EN DUSUK plani soyluyor', async () => {
    await expect(gate('STARTER').enforcePlanFeature('u1', 'asaEnabled', 'Apple Search Ads'))
      .rejects.toThrow(/Profesyonel/);
    await expect(gate('AGENCY').enforcePlanFeature('u1', 'mcpAccess', 'MCP sunucusu'))
      .rejects.toThrow(/Kurumsal/);
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
