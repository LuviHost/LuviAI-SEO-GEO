import 'reflect-metadata';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { AdsController } from './ads.controller.js';
import { SiteUserThrottlerGuard, SITE_USER_THROTTLE } from '../audit/site-user-throttler.guard.js';

/**
 * Elle duraklatma yalniz platform onaylarsa kayda yazilir; panel otopilot
 * kurallarini (env ile degisebilen sayilar) baglanti cevabindan okur; Kampanya
 * Skoru calistirmasi artik gercekten ucretli model cagrisi yaptigi icin site +
 * kullanici basina saatlik tavanla korunur.
 */

afterEach(() => {
  vi.unstubAllEnvs();
});

function prismaWith(campaign: Record<string, unknown>) {
  return {
    adCampaign: {
      findFirstOrThrow: vi.fn(async () => ({ id: 'c1', platform: 'meta_ads', externalId: '555', ...campaign })),
      update: vi.fn(async () => ({})),
    },
  } as any;
}

describe('elle duraklatma', () => {
  it('platform reddederse kayit degismez ve acik hata doner', async () => {
    const prisma = prismaWith({});
    const setStatus = vi.fn(async () => ({ ok: false }));
    const ctrl = new AdsController(prisma, { setStatus } as any, {} as any);
    const res: any = await ctrl.pause('s1', 'c1');
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/onaylamadı/);
    expect(prisma.adCampaign.update).not.toHaveBeenCalled();
  });

  it('platform istegi firlatsa da kayit degismez', async () => {
    const prisma = prismaWith({});
    const ctrl = new AdsController(prisma, { setStatus: vi.fn(async () => { throw new Error('ag'); }) } as any, {} as any);
    await expect(ctrl.pause('s1', 'c1')).resolves.toMatchObject({ ok: false });
    expect(prisma.adCampaign.update).not.toHaveBeenCalled();
  });

  it('platform onaylarsa duraklatildi yazilir; platform kimligi yoksa yalniz kayit', async () => {
    const prisma = prismaWith({});
    const setStatus = vi.fn(async () => ({ ok: true }));
    const ctrl = new AdsController(prisma, { setStatus } as any, {} as any);
    await expect(ctrl.pause('s1', 'c1')).resolves.toEqual({ ok: true });
    expect(setStatus).toHaveBeenCalledWith('s1', 'meta_ads', '555', true);
    expect(prisma.adCampaign.update).toHaveBeenCalledWith({ where: { id: 'c1' }, data: { status: 'PAUSED' } });

    const draft = prismaWith({ externalId: null });
    const ctrl2 = new AdsController(draft, { setStatus } as any, {} as any);
    await expect(ctrl2.pause('s1', 'c1')).resolves.toEqual({ ok: true });
    expect(draft.adCampaign.update).toHaveBeenCalled();
  });
});

describe('baglanti cevabi otopilot kurallarini tasir', () => {
  it('varsayilan ve env ile degismis sayilar (eski alanlar korunur)', async () => {
    const adsClient: any = { getConnectedPlatforms: vi.fn(async () => ({ google: true, meta: false })) };
    const ctrl = new AdsController({} as any, adsClient, {} as any);
    await expect(ctrl.connections('s1')).resolves.toEqual({
      google: true,
      meta: false,
      autopilotRules: { increasePercent: 20, shiftPercent: 20, cooldownHours: 24, maxIncreasesPerWeek: 2, maxMultiplier: 2 },
    });
    vi.stubEnv('ADS_BUDGET_MAX_INCREASES_PER_WEEK', '3');
    await expect(ctrl.connections('s1')).resolves.toMatchObject({ autopilotRules: { maxIncreasesPerWeek: 3 } });
  });
});

describe('Kampanya Skoru calistirma hiz siniri', () => {
  it('site + kullanici basina saatte 3', () => {
    const handler = (AdsController.prototype as any).runAudit;
    expect(Reflect.getMetadata('__guards__', handler) ?? []).toContain(SiteUserThrottlerGuard);
    expect(Reflect.getMetadata(`THROTTLER:LIMIT${SITE_USER_THROTTLE}`, handler)).toBe(3);
    expect(Reflect.getMetadata(`THROTTLER:TTL${SITE_USER_THROTTLE}`, handler)).toBe(60 * 60_000);
  });
});
