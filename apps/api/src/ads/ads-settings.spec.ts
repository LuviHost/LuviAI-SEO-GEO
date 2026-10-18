import { describe, it, expect, vi } from 'vitest';
import { ValidationPipe, BadRequestException } from '@nestjs/common';
import { AdsSettingsDto, GoogleAdsManualDto } from './ads-settings.dto.js';
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
