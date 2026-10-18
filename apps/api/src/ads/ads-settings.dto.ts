import { IsBoolean, IsOptional, IsString, Matches, MaxLength } from 'class-validator';
import { Transform } from 'class-transformer';

/*
 * NEDEN SINIF DTO: govde satir ici bir tiple ({ adsAutopilot?: boolean })
 * yazildiginda emit edilen tasarim tipi Object olur ve global ValidationPipe
 * (whitelist + forbidNonWhitelisted) govdeyi HIC denetlemeden gecirir.
 * updateSettings bu govdeyi dogrudan prisma.site.update'e veriyordu; iliskili
 * kullanici kaydina ic ice yazma ({ user: { update: { role: 'ADMIN' } } })
 * yoluyla herhangi bir site sahibi kendini yonetici yapabiliyordu.
 * Sinif DTO ile bilinmeyen alanlar 400 ile reddedilir.
 */

export class AdsSettingsDto {
  @IsOptional()
  @IsBoolean()
  adsAutopilot?: boolean;
}

// Kimlikler platform API yoluna yazilir (customers/<id>/..., /act_<id>/...):
// yalniz platformun kimlik bicimi kabul — oauth.dto.ts secim DTO'lariyla ayni kural.
export class GoogleAdsManualDto {
  @IsOptional()
  @IsString()
  @MaxLength(64)
  @Matches(/^\d[\d-]{0,19}$/, { message: 'customerId yalnızca rakam ve tire içerebilir' })
  customerId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2048)
  refreshToken?: string;
}

export class MetaAdsManualDto {
  @IsOptional()
  @IsString()
  @MaxLength(64)
  @Matches(/^(act_)?\d{0,32}$/, { message: 'accountId geçersiz' })
  accountId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(4096)
  accessToken?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  @Matches(/^\d{0,32}$/, { message: 'pageId geçersiz' })
  pageId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  @Matches(/^\d{0,32}$/, { message: 'instagramActorId geçersiz' })
  instagramActorId?: string;
}

/**
 * POST /sites/:siteId/ads/:campaignId/launch { externalId? }
 * Google Ads ve Meta kampanya kimlikleri sayisal; kimlik platform API yoluna
 * yazilir (customers/<musteri>/campaigns/<id>, graph.facebook.com/<id>) —
 * '/', '?' gibi karakterler istegi baska bir uca yonlendirebilirdi.
 * Ads Manager'dan kopyalanan kimligin bas/son boslugu kirpilir.
 */
export class AdsLaunchDto {
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @Matches(/^\d{1,32}$/, { message: 'externalId yalnızca rakamlardan oluşmalı' })
  externalId?: string;
}
