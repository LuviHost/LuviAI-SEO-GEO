import { IsBoolean, IsIn, IsOptional, IsString, Matches, MaxLength, ValidateIf } from 'class-validator';
import { IsCanonicalId } from '../articles/articles.dto.js';
import {
  PROMO_PAGE_URL_MAX, VIDEO_FORMATS, VIDEO_STYLE_MESSAGE, VIDEO_STYLES, VIDEO_TEMPOS, VIDEO_TYPES,
  type VideoFormat, type VideoStyle, type VideoTempo, type VideoType,
} from './article-video.config.js';

/**
 * RanksUp Video govde / parametre DTO'lari. Global ValidationPipe (whitelist +
 * forbidNonWhitelisted): bilinmeyen alan 400, kimlikler kanonik alfabede (common/site-id.ts).
 *
 * GERIYE UYUM: eski istemciler yalniz { articleId, primaryColor?, useLogo?, brandName? } gonderir;
 * type verilmezse 'article' sayilir ve articleId zorunludur; tempo verilmezse 'normal', style verilmezse 'classic'. Site tanitiminda kaynak sitenin
 * kendisi (alan yok), urun tanitiminda pageUrl zorunlu (alan adi denetimi serviste:
 * promo-video-source.ts assertOwnSitePageUrl — sitenin adresini bilen tek yer orasi).
 */
export class RequestVideoDto {
  @IsOptional()
  @IsIn(VIDEO_TYPES as unknown as string[], { message: "type 'article', 'site' ya da 'product' olmalı." })
  type?: VideoType;

  /** type 'article' (ya da verilmemis) iken zorunlu */
  @ValidateIf((o) => (o.type ?? 'article') === 'article' || o.articleId !== undefined)
  @IsCanonicalId({ message: 'Geçersiz makale kimliği.' })
  articleId?: string;

  /** type 'product' iken zorunlu: sitenin kendi alan adindaki urun / hizmet sayfasi */
  @ValidateIf((o) => o.type === 'product' || o.pageUrl !== undefined)
  @IsString({ message: 'Ürün sayfası adresi gerekli.' })
  @MaxLength(PROMO_PAGE_URL_MAX, { message: 'Sayfa adresi çok uzun.' })
  pageUrl?: string;

  /** vertical (9:16, varsayilan) | horizontal (16:9 — site ve urun tanitiminda) */
  @IsOptional()
  @IsIn(VIDEO_FORMATS as unknown as string[], { message: "format 'vertical' ya da 'horizontal' olmalı." })
  format?: VideoFormat;

  /** fast (eski 15 sn) | normal (okunur, varsayilan) | slow — uc tur ve iki bicimde de */
  @IsOptional()
  @IsIn(VIDEO_TEMPOS as unknown as string[], { message: "tempo 'fast', 'normal' ya da 'slow' olmalı." })
  tempo?: VideoTempo;

  /** gorsel stil (article-video.config.ts VIDEO_STYLES); verilmezse 'classic' (bugunku tasarim) */
  @IsOptional()
  @IsIn(VIDEO_STYLES as unknown as string[], { message: VIDEO_STYLE_MESSAGE })
  style?: VideoStyle;

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
