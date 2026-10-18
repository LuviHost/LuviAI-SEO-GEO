import { IsOptional, IsString, Matches, MaxLength } from 'class-validator';

/*
 * NEDEN SINIF DTO: satir ici tipli govdede ({ customerId: string }) emit edilen
 * tasarim tipi Object olur ve global ValidationPipe (whitelist +
 * forbidNonWhitelisted) govdeyi HIC denetlemez — her alan, her tip gecer.
 * Sinif DTO ile bilinmeyen alan 400, yanlis tip 400.
 */

/** POST /oauth/<provider>/finish { key } — anahtarin bicimi resolveParkedFinish'te de denetlenir */
export class OAuthFinishDto {
  @IsOptional()
  @IsString()
  @MaxLength(64)
  key?: string;
}

/**
 * POST /oauth/google-ads/select { customerId }
 * Google Ads musteri kimligi 10 haneli sayi (panel listesi customers/<id>
 * kaynak adindan gelir); elle girilen 123-456-7890 bicimi de kabul.
 * Kimlik API yoluna (customers/<id>/...) yazildigi icin '/', '?' gibi
 * karakterler yol enjeksiyonu olurdu.
 */
export class GoogleAdsSelectDto {
  @IsString()
  @Matches(/^\d[\d-]{0,19}$/, { message: 'customerId yalnızca rakam ve tire içerebilir' })
  customerId!: string;
}

/**
 * POST /oauth/meta-ads/select — bos dize secimi temizler.
 * Graph kimlikleri sayisal; reklam hesabi 'act_<sayi>'. Kimlikler Graph
 * yoluna (/{id}, /act_{id}/...) yazilir — yalniz bu bicim kabul.
 */
export class MetaAdsSelectDto {
  @IsOptional()
  @IsString()
  @Matches(/^(act_)?\d{0,32}$/, { message: 'adAccountId geçersiz' })
  adAccountId?: string;

  @IsOptional()
  @IsString()
  @Matches(/^\d{0,32}$/, { message: 'pageId geçersiz' })
  pageId?: string;

  @IsOptional()
  @IsString()
  @Matches(/^\d{0,32}$/, { message: 'instagramActorId geçersiz' })
  instagramActorId?: string;
}
