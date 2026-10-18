import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';

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

export class GoogleAdsManualDto {
  @IsOptional()
  @IsString()
  @MaxLength(64)
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
  accountId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(4096)
  accessToken?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  pageId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  instagramActorId?: string;
}
