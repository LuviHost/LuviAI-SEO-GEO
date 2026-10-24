import {
  ArrayMaxSize, ArrayMinSize, ArrayUnique, IsArray, IsBoolean, IsIn, IsInt, IsISO8601, IsOptional, IsString,
  Max, MaxLength, Min, MinLength, ValidateBy, type ValidationOptions,
} from 'class-validator';
import { isCanonicalSiteId } from '../common/site-id.js';
import { CONTENT_TYPES, type ContentType } from '@luviai/shared';

const CONTENT_TYPE_MESSAGE = `contentType şunlardan biri olmalı: ${CONTENT_TYPES.join(', ')}`;

/*
 * NEDEN SINIF DTO: bu controller'daki govdelerin hepsi satir ici tipliydi;
 * global ValidationPipe (whitelist + forbidNonWhitelisted) tasarim tipi Object
 * olan govdeyi HIC denetlemez. Dize beklenen yere nesne/dizi giriyor (Prisma
 * hatasi → 500, ya da Prisma'da filtre/islem olarak yorumlanma), sayilar
 * sinirsiz geciyordu — or. run-now'da maxRevize: 1000 tek makale kotasiyla
 * yuzlerce yazar/editor LLM turu demekti.
 */

export class ScheduleTopicDto {
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  topic!: string;

  // Panel new Date(...).toISOString() gonderir
  @IsISO8601({}, { message: 'scheduledAt ISO 8601 tarih olmalı' })
  scheduledAt!: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  slug?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  pillar?: string;

  /** Acik icerik tipi (karsilastirma, fiyat...); verilmezse siralayici / baslik siniflandiricisi karar verir */
  @IsOptional()
  @IsIn([...CONTENT_TYPES], { message: CONTENT_TYPE_MESSAGE })
  contentType?: ContentType;
}

export class RescheduleArticleDto {
  @IsISO8601({}, { message: 'scheduledAt ISO 8601 tarih olmalı' })
  scheduledAt!: string;
}

/** null/undefined → tum aktif kanallar; [] → hicbiri */
export class SocialPrePlanDto {
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  @MaxLength(64, { each: true })
  channelIds?: string[] | null;
}

export class GenerateArticleDto {
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  topic!: string;

  // Hedefler yayin aninda makalenin sitesine gore suzulur (publisher.service)
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @MaxLength(64, { each: true })
  targetIds?: string[];

  /** Acik icerik tipi; verilmezse siralayici / baslik siniflandiricisi karar verir */
  @IsOptional()
  @IsIn([...CONTENT_TYPES], { message: CONTENT_TYPE_MESSAGE })
  contentType?: ContentType;
}

export class RunPipelineNowDto {
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  topic!: string;

  @IsOptional()
  @IsBoolean()
  skipImages?: boolean;

  // Pipeline'in kendi varsayilani 2 (pipeline.service) — ustune cikilamaz
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(2)
  maxRevize?: number;
}

export class PublishArticleDto {
  // Paylasilan sozlesme D1 (republish-policy.ts selectPublishTargets): dolu liste AYNEN
  // uygulanir — yazinin yayinda oldugu ama listede olmayan hedefe yazilmaz, sonucta
  // 'live_target_not_selected' doner. Bos/verilmemis: yazi sitede yayindaysa yayinda
  // oldugu aktif hedefler, degilse varsayilan + aktif hedefler.
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @MaxLength(64, { each: true })
  targetIds?: string[];

  @IsOptional()
  @IsBoolean()
  overrideQa?: boolean;

  /**
   * Paylasilan sozlesme C1: kullanici ACIKCA onayladi — WordPress yazisi
   * RanksUp'in son yaziminden sonra WordPress'te degismis olsa da ustune yaz.
   * Verilmezse (varsayilan) degismis yazi yazilmaz; sonuc skipped
   * 'live_entry_edited' ve kopya "elle guncelleme bekliyor" diye isaretlenir.
   * Otomasyon bu alani hic gondermez. Kimlik denetimi (baska bir yazinin
   * uzerine yazmama) ve cop kutusu kurali bu onayla da gecerlidir.
   */
  @IsOptional()
  @IsBoolean({ message: 'overwriteRemoteEdits true ya da false olmalı.' })
  overwriteRemoteEdits?: boolean;
}

/**
 * Kimlik KANONIK bicimde mi (common/site-id.ts kurali: kucuk harf ASCII
 * alfabesi). Site, makale ve yayin hedefi kimlikleri Prisma cuid() ile uretilir
 * (kucuk harf). NEDEN: tablolarin harmanlamasi (utf8mb4_unicode_ci) harf / bosluk
 * farkini yok sayar; 'CMXX…' ya da sonu bosluklu yazim ayni satiri bulurdu.
 * Kurala uymayan deger DB'ye hic gitmez (400).
 */
export function IsCanonicalId(validationOptions?: ValidationOptions): PropertyDecorator {
  return ValidateBy({ name: 'isCanonicalId', validator: { validate: (value: unknown) => isCanonicalSiteId(value) } }, validationOptions);
}

/**
 * POST sites/:siteId/articles/:articleId/published-to/:targetId/{mark-updated|forget}
 * Uc parametrenin hepsi (global ValidationPipe forbidNonWhitelisted: rotada
 * olan her parametre burada tanimli olmali). Site sahipligi global
 * SiteAccessGuard'da; makalenin bu siteye ait oldugu serviste denetlenir.
 */
export class PublishedEntryParamsDto {
  @IsCanonicalId({ message: 'Geçersiz site kimliği.' })
  siteId!: string;

  @IsCanonicalId({ message: 'Geçersiz makale kimliği.' })
  articleId!: string;

  @IsCanonicalId({ message: 'Geçersiz yayın hedefi kimliği.' })
  targetId!: string;
}

/** translator.service'in tanidigi diller — disindaki deger dogrudan istem metnine giriyordu */
export const TRANSLATION_LANGUAGES = ['en', 'de', 'fr', 'ar', 'es', 'ru', 'tr'] as const;

export class TranslateArticleDto {
  @IsIn(TRANSLATION_LANGUAGES, { message: `toLanguage şunlardan biri olmalı: ${TRANSLATION_LANGUAGES.join(', ')}` })
  toLanguage!: (typeof TRANSLATION_LANGUAGES)[number];
}

export class TranslateBulkDto {
  // Her dil x en fazla 20 makale = ayri bir LLM cagrisi; liste sinirli ve tekil
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(TRANSLATION_LANGUAGES.length)
  @ArrayUnique()
  @IsIn(TRANSLATION_LANGUAGES, { each: true, message: `languages yalnızca şunları içerebilir: ${TRANSLATION_LANGUAGES.join(', ')}` })
  languages?: (typeof TRANSLATION_LANGUAGES)[number][];
}

export class ProgrammaticCitiesDto {
  @IsString()
  @MinLength(1)
  @MaxLength(300)
  template!: string;

  // Verilmezse 81 il (programmatic-seo.service)
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(81)
  @IsString({ each: true })
  @MaxLength(60, { each: true })
  cities?: string[];

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(3650)
  spreadDays?: number;

  // Servis zaten plan kotasi ve sehir sayisiyla kirpar
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(1000)
  maxQuota?: number;
}
