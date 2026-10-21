import { IsBoolean, IsOptional, IsString, Matches, MaxLength, ValidateIf } from 'class-validator';
import { IsCanonicalId } from '../articles/articles.dto.js';

/**
 * RanksUp Video govde / parametre DTO'lari. Global ValidationPipe (whitelist +
 * forbidNonWhitelisted): bilinmeyen alan 400, kimlikler kanonik alfabede (common/site-id.ts).
 */
export class RequestVideoDto {
  @IsCanonicalId({ message: 'Geçersiz makale kimliği.' })
  articleId!: string;

  /** #rrggbb; null = sablonun kendi rengi; verilmezse sitenin rengi */
  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsString()
  @Matches(/^#[0-9a-fA-F]{6}$/, { message: 'Renk #rrggbb biçiminde olmalı.' })
  primaryColor?: string | null;

  /** false = logo yerine baş harf */
  @IsOptional()
  @IsBoolean({ message: 'useLogo true ya da false olmalı.' })
  useLogo?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(60, { message: 'Marka adı en fazla 60 karakter olabilir.' })
  brandName?: string;
}

/** sites/:siteId/videos/:id — rotadaki her parametre burada tanimli olmali */
export class VideoParamsDto {
  @IsCanonicalId({ message: 'Geçersiz site kimliği.' })
  siteId!: string;

  @IsCanonicalId({ message: 'Geçersiz video kimliği.' })
  id!: string;
}
