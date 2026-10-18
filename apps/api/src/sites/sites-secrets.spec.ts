import { describe, it, expect, vi } from 'vitest';
import { SitesController } from './sites.controller.js';
import { SitesService, SITE_SECRET_FIELDS } from './sites.service.js';

/**
 * Site satirindaki sirlar (ingestSecret duz metin HMAC siri; GSC/GA/Ads
 * token'lari sifreli) hicbir site cevabina cikmamali. Liste ve tekil GET
 * zaten omit kullaniyordu; autopilot / webhook / guncelleme / onboarding
 * sonu / silme cevaplari tam satirdi.
 */
const SECRET_COLUMNS = ['ingestSecret', 'gscRefreshToken', 'gaRefreshToken', 'googleAdsRefreshToken', 'metaAdsAccessToken', 'notifyWebhookUrl'];
const user = { id: 'u1', role: 'USER' as const };

function expectSecretsOmitted(args: any) {
  expect(args.omit, 'omit verilmeli').toBeDefined();
  for (const col of SECRET_COLUMNS) expect(args.omit[col], col).toBe(true);
}

function service() {
  const prisma = {
    site: {
      findUnique: vi.fn(async () => ({ id: 's1', userId: 'u1', autoGenerationFrequency: 'weekly', autoGenerationHour: 9 })),
      update: vi.fn(async (args: any) => ({ id: 's1', __args: args })),
      delete: vi.fn(async (args: any) => ({ id: 's1', __args: args })),
    },
    publishTarget: { count: vi.fn(async () => 1) },
  };
  return { svc: new SitesService(prisma as any, {} as any, {} as any), prisma };
}

describe('site cevaplarinda sir yok', () => {
  it('SITE_SECRET_FIELDS tum sir kolonlarini kapsar', () => {
    for (const col of SECRET_COLUMNS) expect((SITE_SECRET_FIELDS as Record<string, boolean>)[col], col).toBe(true);
  });

  it('PATCH /sites/:id (update), complete-onboarding ve silme omit kullanir', async () => {
    const { svc, prisma } = service();
    await svc.update('s1', { name: 'Yeni ad' } as any, user);
    expectSecretsOmitted(prisma.site.update.mock.calls[0][0]);
    await svc.completeOnboarding('s1', user);
    expectSecretsOmitted(prisma.site.update.mock.calls[1][0]);
    await svc.remove('s1', user);
    expectSecretsOmitted(prisma.site.delete.mock.calls[0][0]);
  });

  it('PATCH autopilot ve webhook cevaplari omit kullanir (sahiplik once denetlenir)', async () => {
    const update = vi.fn(async (args: any) => ({ id: 's1', __args: args }));
    const sites = { findOne: vi.fn(async () => ({ id: 's1', userId: 'u1' })) };
    const ctl = new SitesController(sites as any, {} as any, {} as any, {} as any, {} as any, {} as any, { site: { update } } as any);
    const req = { user } as any;
    await ctl.setAutopilot(req, 's1', { enabled: true });
    expectSecretsOmitted(update.mock.calls[0][0]);
    await ctl.setWebhook(req, 's1', { url: 'https://hooks.slack.com/services/T/B/x', kind: 'slack' });
    expectSecretsOmitted(update.mock.calls[1][0]);
    expect(sites.findOne).toHaveBeenCalledTimes(2);
  });
});
