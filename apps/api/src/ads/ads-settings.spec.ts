import { describe, it, expect, vi } from 'vitest';
import { ValidationPipe, BadRequestException } from '@nestjs/common';
import { AdsLaunchDto, AdsSettingsDto, GoogleAdsManualDto, MetaAdsManualDto } from './ads-settings.dto.js';
import { AdsController } from './ads.controller.js';

/**
 * Yetki yukseltme acigi (canlida 2026-04-29'dan beri): PATCH ads/settings
 * govdeyi dogrudan prisma.site.update'e veriyordu; { user: { update: { role:
 * 'ADMIN' } } } ile site sahibi kendini yonetici yapabiliyordu.
 */
// main.ts ile ayni ayarlar
const pipe = new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true });
const asBody = (metatype: any) => ({ type: 'body' as const, metatype, data: '' });

describe('ads ayarlari — toplu atama korumasi', () => {
  it('ic ice user guncellemesi ve bilinmeyen alanlar 400 ile reddedilir', async () => {
    await expect(pipe.transform({ adsAutopilot: true, user: { update: { role: 'ADMIN', plan: 'ENTERPRISE' } } }, asBody(AdsSettingsDto)))
      .rejects.toBeInstanceOf(BadRequestException);
    await expect(pipe.transform({ userId: 'baskasi' }, asBody(AdsSettingsDto))).rejects.toBeInstanceOf(BadRequestException);
    await expect(pipe.transform({ adsAutopilot: 'evet' }, asBody(AdsSettingsDto))).rejects.toBeInstanceOf(BadRequestException);
    await expect(pipe.transform({ customerId: { not: 'string' } }, asBody(GoogleAdsManualDto))).rejects.toBeInstanceOf(BadRequestException);
  });

  it('gecerli govde gecer; controller yalniz izinli alani yazar ve gizli alanlari dondurmez', async () => {
    const body = await pipe.transform({ adsAutopilot: true }, asBody(AdsSettingsDto));
    const update = vi.fn(async (args: any) => ({ id: 's1', adsAutopilot: true, ...args }));
    const ctrl = new AdsController({ site: { update } } as any, {} as any, {} as any);
    await ctrl.updateSettings('s1', body);
    const args = update.mock.calls[0][0];
    expect(args.where).toEqual({ id: 's1' });
    expect(args.data).toEqual({ adsAutopilot: true });
    expect(args.select).toBeDefined();
    expect(args.select.metaAdsAccessToken).toBeUndefined();
    expect(args.select.googleAdsRefreshToken).toBeUndefined();
    expect(args.select.ingestSecret).toBeUndefined();
  });

  it('controller dogrudan cagrilsa bile (pipe atlanmis) govdedeki ek alanlar Prisma`ya gitmez', async () => {
    const update = vi.fn(async () => ({}));
    const ctrl = new AdsController({ site: { update } } as any, {} as any, {} as any);
    await ctrl.updateSettings('s1', { adsAutopilot: false, user: { update: { role: 'ADMIN' } } } as any);
    expect((update.mock.calls[0] as any)[0].data).toEqual({ adsAutopilot: false });
  });
});

describe('kampanya baslatma govdesi (externalId)', () => {
  it('yalniz rakam kabul; yola sizan kimlik ve bilinmeyen alan 400, bas/son bosluk kirpilir', async () => {
    await expect(pipe.transform({ externalId: '123/../act_9/adimages' }, asBody(AdsLaunchDto))).rejects.toBeInstanceOf(BadRequestException);
    await expect(pipe.transform({ externalId: { set: '1' } }, asBody(AdsLaunchDto))).rejects.toBeInstanceOf(BadRequestException);
    await expect(pipe.transform({ externalId: '1', status: 'ACTIVE' }, asBody(AdsLaunchDto))).rejects.toBeInstanceOf(BadRequestException);
    await expect(pipe.transform({ externalId: ' 120200000000 ' }, asBody(AdsLaunchDto))).resolves.toMatchObject({ externalId: '120200000000' });
    // panel govdesiz POST atar
    await expect(pipe.transform({}, asBody(AdsLaunchDto))).resolves.toBeDefined();
  });

  it('pipe atlansa da dize olmayan externalId kullanilmaz, kayittaki kimlige dusulur', async () => {
    const setStatus = vi.fn(async () => ({ ok: true }));
    const update = vi.fn(async () => ({}));
    const prisma = {
      adCampaign: { findFirstOrThrow: vi.fn(async () => ({ id: 'c1', platform: 'meta_ads', externalId: '555' })), update },
    };
    const ctrl = new AdsController(prisma as any, { setStatus } as any, {} as any);
    await ctrl.launch('s1', 'c1', { externalId: { not: '' } } as any);
    expect(setStatus).toHaveBeenCalledWith('s1', 'meta_ads', '555', false);
    expect((update.mock.calls[0] as any)[0].data).toEqual({ status: 'ACTIVE', externalId: '555' });
  });
});

describe('elle Meta token kaydi — izin denetimi (K26)', () => {
  const json = (status: number, body: any) =>
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  const granted = (...names: string[]) => ({ data: names.map((permission) => ({ permission, status: 'granted' })) });

  it('reklam izinleri olmayan token kaydedilmez (400 scope_not_granted)', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(json(200, granted('public_profile', 'pages_show_list')));
    const update = vi.fn(async () => ({}));
    const ctrl = new AdsController({ site: { update } } as any, {} as any, {} as any);
    const err: any = await ctrl.setMetaAds('s1', { accessToken: 'EAAB-token', accountId: 'act_1' }).catch((e) => e);
    expect(err).toBeInstanceOf(BadRequestException);
    expect(err.getResponse()).toMatchObject({ code: 'scope_not_granted' });
    expect(update).not.toHaveBeenCalled();
    vi.restoreAllMocks();
  });

  it('izin listesi okunamazsa da kaydedilmez; izinler tamsa kaydedilir', async () => {
    const update = vi.fn(async () => ({}));
    const ctrl = new AdsController({ site: { update } } as any, {} as any, {} as any);
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(json(500, { error: { type: 'OAuthException', code: 2 } }));
    await expect(ctrl.setMetaAds('s1', { accessToken: 'EAAB-token' })).rejects.toBeInstanceOf(BadRequestException);
    expect(update).not.toHaveBeenCalled();
    vi.restoreAllMocks();

    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(json(200, granted('ads_read', 'ads_management', 'pages_show_list')));
    await ctrl.setMetaAds('s1', { accessToken: 'EAAB-token', accountId: 'act_1' });
    expect(new URL(String(spy.mock.calls[0][0])).pathname).toMatch(/\/me\/permissions$/);
    expect((update.mock.calls[0] as any)[0].data.metaAdsAccountId).toBe('act_1');
    vi.restoreAllMocks();
  });

  it('token\'siz govde (Kaldir) Graph\'a sormadan baglantiyi temizler', async () => {
    const spy = vi.spyOn(globalThis, 'fetch');
    const update = vi.fn(async () => ({}));
    const ctrl = new AdsController({ site: { update } } as any, {} as any, {} as any);
    await ctrl.setMetaAds('s1', {});
    expect(spy).not.toHaveBeenCalled();
    expect((update.mock.calls[0] as any)[0].data).toMatchObject({ metaAdsAccessToken: null, metaAdsAccountId: null });
    vi.restoreAllMocks();
  });
});

describe('elle girilen reklam kimlikleri — yol enjeksiyonu', () => {
  it('platform kimlik bicimi disi 400; panelin "Kaldir" govdesi gecer', async () => {
    await expect(pipe.transform({ accountId: 'act_1/../me' }, asBody(MetaAdsManualDto))).rejects.toBeInstanceOf(BadRequestException);
    await expect(pipe.transform({ pageId: '12?fields=access_token' }, asBody(MetaAdsManualDto))).rejects.toBeInstanceOf(BadRequestException);
    await expect(pipe.transform({ customerId: '123/campaigns' }, asBody(GoogleAdsManualDto))).rejects.toBeInstanceOf(BadRequestException);
    await expect(pipe.transform({}, asBody(MetaAdsManualDto))).resolves.toBeDefined();
    await expect(pipe.transform({ accountId: 'act_123', pageId: '456' }, asBody(MetaAdsManualDto))).resolves.toBeDefined();
    await expect(pipe.transform({ customerId: '123-456-7890' }, asBody(GoogleAdsManualDto))).resolves.toBeDefined();
  });
});

describe('kampanya listesi — suzgec', () => {
  it('nesne status Prisma where\'ine gitmez', async () => {
    const findMany = vi.fn(async () => []);
    const ctrl = new AdsController({ adCampaign: { findMany } } as any, {} as any, {} as any);
    await ctrl.list('s1', { not: 'x' } as any);
    expect((findMany.mock.calls[0] as any)[0].where).toEqual({ siteId: 's1' });
  });
});
