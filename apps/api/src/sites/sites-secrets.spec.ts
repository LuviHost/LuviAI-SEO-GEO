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
  const siteDelete = vi.fn(async (args: any) => ({ id: 's1', __args: args }));
  // Silme tek transaction icinde, bagli tablolari temizleyerek yapilir
  // (sites.service siteRemovalSteps): islem nesnesindeki her model okuma/silme
  // cagrisina bos sonuc doner, yalniz site silme cagrisi kaydedilir.
  const genericModel = {
    findMany: vi.fn(async () => []),
    deleteMany: vi.fn(async () => ({ count: 0 })),
    updateMany: vi.fn(async () => ({ count: 0 })),
  };
  const tx = new Proxy({} as Record<string, unknown>, {
    get: (_t, model) => (model === 'site' ? { delete: siteDelete } : genericModel),
  });
  const prisma = {
    site: {
      findUnique: vi.fn(async () => ({ id: 's1', userId: 'u1', autoGenerationFrequency: 'weekly', autoGenerationHour: 9 })),
      update: vi.fn(async (args: any) => ({ id: 's1', __args: args })),
      delete: siteDelete,
    },
    publishTarget: { count: vi.fn(async () => 1) },
    $transaction: vi.fn(async (fn: any) => fn(tx)),
  };
  const jobQueue = { removeJob: vi.fn(async () => true) };
  return { svc: new SitesService(prisma as any, jobQueue as any, {} as any), prisma };
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
