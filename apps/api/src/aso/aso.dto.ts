import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { KeywordSource } from '@prisma/client';

/*
 * NEDEN SINIF DTO: satir ici tipli govdede ({ store: AppStore }) emit edilen
 * tasarim tipi Object olur ve global ValidationPipe (whitelist +
 * forbidNonWhitelisted) govdeyi HIC denetlemez. Bu govdeler Prisma
 * sorgularina (where/data), magaza kaziyicilarina, LLM/Gemini cagrilarina ve
 * sharp boyutlandirmasina gidiyordu: ornegin { appStoreId: { not: null } }
 * Prisma'da filtre operatoru olarak calisir, { limit: 100000 } binlerce
 * yorum cekip her biri icin duygu analizi yaptirir, { width: 100000 } sharp'a
 * devasa bir tuval actirir. Sinif DTO ile tip/aralik/uzunluk denetlenir,
 * bilinmeyen alan 400 ile reddedilir.
 *
 * Yoldan gelen guvenilir kimlik (siteId / trackedAppId) DTO'da YOK: controller
 * onu govde yayilimindan SONRA yazar (bkz. aso.controller.ts GUVENLIK KURALI).
 */

export const ASO_STORES = ['IOS', 'ANDROID'] as const;
export const ASO_LOCALES = ['tr', 'en'] as const;

/** App Store kimligi: sayisal (ör. 6444904356) */
const APP_STORE_ID = /^\d{1,20}$/;
/**
 * Play paket adi: en az iki parca, her parca harfle baslar, yalniz harf/rakam/
 * alt cizgi. https://developer.android.com/build/configure-app-module ve
 * https://developer.android.com/guide/topics/manifest/manifest-element
 */
const PLAY_PACKAGE = /^[A-Za-z][A-Za-z0-9_]*(?:\.[A-Za-z][A-Za-z0-9_]*)+$/;
const COUNTRY = /^[A-Za-z]{2}$/;
/** Hex renk: prompta serbest metin olarak gitmesin */
const HEX_COLOR = /^#(?:[0-9A-Fa-f]{3}|[0-9A-Fa-f]{4}|[0-9A-Fa-f]{6}|[0-9A-Fa-f]{8})$/;

const M = {
  appStoreId: 'App Store kimliği yalnız rakamlardan oluşmalı (ör. 6444904356).',
  playStoreId: 'Play Store kimliği paket adı biçiminde olmalı (ör. com.example.app).',
  country: 'Ülke iki harfli ISO kodu olmalı (ör. tr).',
  store: 'Mağaza IOS ya da ANDROID olmalı.',
  locale: 'Dil tr ya da en olmalı.',
  keyword: 'Anahtar kelime en fazla 100 karakterlik metin olmalı.',
  keywords: 'En fazla 100 anahtar kelime gönderilebilir; her biri en fazla 100 karakter.',
};

export class AddAppPromptDto {
  @IsString({ message: 'Soru 5-500 karakter olmalı.' })
  @MaxLength(500, { message: 'Soru 5-500 karakter olmalı.' })
  text!: string;
}

export class ConnectAppBodyDto {
  @IsOptional()
  @IsString({ message: M.appStoreId })
  @Matches(APP_STORE_ID, { message: M.appStoreId })
  appStoreId?: string;

  @IsOptional()
  @IsString({ message: M.playStoreId })
  @MaxLength(255, { message: M.playStoreId })
  @Matches(PLAY_PACKAGE, { message: M.playStoreId })
  playStoreId?: string;

  @IsOptional()
  @IsString({ message: M.country })
  @Matches(COUNTRY, { message: M.country })
  country?: string;
}

export class LinkStoreDto {
  @IsOptional()
  @IsString({ message: M.appStoreId })
  @Matches(APP_STORE_ID, { message: M.appStoreId })
  appStoreId?: string;

  @IsOptional()
  @IsString({ message: M.playStoreId })
  @MaxLength(255, { message: M.playStoreId })
  @Matches(PLAY_PACKAGE, { message: M.playStoreId })
  playStoreId?: string;
}

export class MirrorKeywordsDto {
  @IsOptional()
  @IsIn(ASO_STORES, { message: M.store })
  from?: 'IOS' | 'ANDROID';

  @IsOptional()
  @IsIn(ASO_STORES, { message: M.store })
  to?: 'IOS' | 'ANDROID';
}

export class AddKeywordDto {
  @IsOptional()
  @IsString({ message: M.keyword })
  @MaxLength(100, { message: M.keyword })
  keyword?: string;

  // Her kelime icin magaza skor istegi atiliyor: sinirsiz liste dakikalarca
  // dis istek ve istegin acik kalmasi demekti
  @IsOptional()
  @IsArray({ message: M.keywords })
  @ArrayMaxSize(100, { message: M.keywords })
  @IsString({ each: true, message: M.keywords })
  @MaxLength(100, { each: true, message: M.keywords })
  keywords?: string[];

  @IsIn(ASO_STORES, { message: M.store })
  store!: 'IOS' | 'ANDROID';

  @IsOptional()
  @IsEnum(KeywordSource, { message: 'Geçersiz kaynak.' })
  source?: KeywordSource;
}

export class FetchReviewsDto {
  // Android'de kaziyiciya "num" olarak gider; her yeni yorum icin duygu analizi yapilir
  @IsOptional()
  @IsInt({ message: 'Yorum sayısı 1-200 arası tam sayı olmalı.' })
  @Min(1, { message: 'Yorum sayısı 1-200 arası tam sayı olmalı.' })
  @Max(200, { message: 'Yorum sayısı 1-200 arası tam sayı olmalı.' })
  limit?: number;

  @IsOptional()
  @IsBoolean({ message: 'analyzeSentiment true ya da false olmalı.' })
  analyzeSentiment?: boolean;
}

export class CompetitorAppRefDto {
  @IsString({ message: 'Rakip uygulama kimliği metin olmalı.' })
  @MaxLength(255, { message: 'Rakip uygulama kimliği en fazla 255 karakter olmalı.' })
  @Matches(/^[A-Za-z0-9_.]+$/, { message: 'Rakip uygulama kimliği yalnız harf, rakam, nokta ve alt çizgi içerebilir.' })
  appId!: string;

  @IsIn(ASO_STORES, { message: M.store })
  store!: 'IOS' | 'ANDROID';
}

export class AiKeywordResearchDto {
  // Servis en fazla 5 rakibin metadata'sini ceker; fazlasi isteksiz kalabalik
  @IsOptional()
  @IsArray({ message: 'Rakip listesi dizi olmalı.' })
  @ArrayMaxSize(10, { message: 'En fazla 10 rakip gönderilebilir.' })
  @ValidateNested({ each: true })
  @Type(() => CompetitorAppRefDto)
  competitorAppIds?: CompetitorAppRefDto[];

  @IsOptional()
  @IsIn(ASO_LOCALES, { message: M.locale })
  locale?: 'tr' | 'en';
}

export class OptimizeMetadataDto {
  @IsArray({ message: 'Hedef anahtar kelimeler dizi olmalı.' })
  @ArrayMaxSize(50, { message: 'En fazla 50 hedef anahtar kelime gönderilebilir.' })
  @IsString({ each: true, message: M.keyword })
  @MaxLength(100, { each: true, message: M.keyword })
  targetKeywords!: string[];

  @IsIn(ASO_STORES, { message: M.store })
  store!: 'IOS' | 'ANDROID';

  @IsOptional()
  @IsIn(ASO_LOCALES, { message: M.locale })
  locale?: 'tr' | 'en';
}

export class KeywordAuditDto {
  // Mesajlar servisle ayni (aso.service.ts auditKeywordField)
  @IsString({ message: 'keywords metin olmalı' })
  @MaxLength(1000, { message: 'keywords en fazla 1000 karakter' })
  keywords!: string;

  @IsOptional()
  @IsString({ message: 'Uygulama adı metin olmalı.' })
  @MaxLength(200, { message: 'Uygulama adı en fazla 200 karakter olmalı.' })
  appName?: string;

  @IsOptional()
  @IsString({ message: 'Alt başlık metin olmalı.' })
  @MaxLength(200, { message: 'Alt başlık en fazla 200 karakter olmalı.' })
  subtitle?: string;

  @IsOptional()
  @IsArray({ message: 'Rakip adları dizi olmalı.' })
  @ArrayMaxSize(50, { message: 'En fazla 50 rakip adı gönderilebilir.' })
  @IsString({ each: true, message: 'Rakip adları metin olmalı.' })
  @MaxLength(200, { each: true, message: 'Rakip adı en fazla 200 karakter olmalı.' })
  competitorNames?: string[];

  @IsOptional()
  @IsBoolean({ message: 'checkCompetitors true ya da false olmalı.' })
  checkCompetitors?: boolean;
}

export const BACKGROUND_STYLES = ['minimalist', 'bold', 'illustrative', 'gradient', 'mesh'] as const;

/** Uretilen gorsel sharp ile bu boyuta getirilir; Google Play ekran goruntusu kenari en fazla 3840 px */
const DIM_MSG = 'Genişlik ve yükseklik 100-4096 piksel arası tam sayı olmalı.';

export class GenerateBackgroundDto {
  @IsOptional()
  @IsIn(BACKGROUND_STYLES, { message: 'Geçersiz arka plan stili.' })
  style?: (typeof BACKGROUND_STYLES)[number];

  @IsOptional()
  @IsString({ message: 'Marka rengi hex biçiminde olmalı (ör. #FF6A00).' })
  @Matches(HEX_COLOR, { message: 'Marka rengi hex biçiminde olmalı (ör. #FF6A00).' })
  brandColor?: string;

  @IsOptional()
  @IsString({ message: 'Özel istem metin olmalı.' })
  @MaxLength(1000, { message: 'Özel istem en fazla 1000 karakter olmalı.' })
  customPrompt?: string;

  @IsOptional()
  @IsInt({ message: DIM_MSG })
  @Min(100, { message: DIM_MSG })
  @Max(4096, { message: DIM_MSG })
  width?: number;

  @IsOptional()
  @IsInt({ message: DIM_MSG })
  @Min(100, { message: DIM_MSG })
  @Max(4096, { message: DIM_MSG })
  height?: number;
}

export class GenerateCaptionsDto {
  @IsOptional()
  @IsArray({ message: 'Hedef anahtar kelimeler dizi olmalı.' })
  @ArrayMaxSize(25, { message: 'En fazla 25 hedef anahtar kelime gönderilebilir.' })
  @IsString({ each: true, message: M.keyword })
  @MaxLength(100, { each: true, message: M.keyword })
  targetKeywords?: string[];

  @IsOptional()
  @IsIn(ASO_LOCALES, { message: M.locale })
  locale?: 'tr' | 'en';

  @IsOptional()
  @IsInt({ message: 'Slot sayısı 1-10 arası tam sayı olmalı.' })
  @Min(1, { message: 'Slot sayısı 1-10 arası tam sayı olmalı.' })
  @Max(10, { message: 'Slot sayısı 1-10 arası tam sayı olmalı.' })
  slotCount?: number;
}

/**
 * screenshotBase64 tavani (karakter). NEDEN 2.000.000: JSON govde siniri
 * 2 MiB (request-body.ts JSON_BODY_LIMIT_BYTES = 2.097.152 bayt) ve bu sinirin
 * ustundeki govde DTO'ya varmadan 413 alir. Eski 20.000.000 tavani hic
 * calismiyordu: 2 MiB ile 20 MB arasi her govde 413 ile donuyor, DTO'nun
 * mesaji ve sinir belgesi yaniltici kaliyordu. base64 alfabesi (A-Z a-z 0-9
 * + / =, RFC 4648 s.4) JSON'da kacislanmak ZORUNDA degil: zorunlu olanlar
 * yalniz ", \ ve U+0000-U+001F (RFC 8259 s.7); JSON.stringify de kacislamaz
 * (hand-photo-dto-limit.spec.ts olcer). En uzun degerle govde ~2.000.073 bayt
 * (marka rengi ve olculer dahil) olur. '/' istege bagli kacislanabilir (RFC
 * 8259 s.7) ve PHP json_encode varsayilan olarak '\/' yazar (php.net
 * JSON_UNESCAPED_SLASHES: "Don't escape /"); kalan ~97 KB pay, rastgele
 * veride karakterlerin ~1/64'u olan '/' kacislarini da karsilar. 2.000.000
 * base64 karakter ~1.500.000 bayt gorsel eder. Istemci yok (web/mobil/SDK/MCP
 * bu ucu cagirmiyor); daha buyuk gorsel gerekirse uc multipart'a tasinmali.
 */
export const HAND_PHOTO_MAX_BASE64_CHARS = 2_000_000;

export class HandPhotoDto {
  @IsString({ message: 'Ekran görüntüsü base64 metin olmalı.' })
  @IsNotEmpty({ message: 'Ekran görüntüsü gerekli.' })
  @MaxLength(HAND_PHOTO_MAX_BASE64_CHARS, {
    message: 'Ekran görüntüsü çok büyük: base64 metni en fazla 2.000.000 karakter olabilir (yaklaşık 1,4 MB görsel).',
  })
  screenshotBase64!: string;

  @IsOptional()
  @IsString({ message: 'Marka rengi hex biçiminde olmalı (ör. #FF6A00).' })
  @Matches(HEX_COLOR, { message: 'Marka rengi hex biçiminde olmalı (ör. #FF6A00).' })
  brandColor?: string;

  @IsOptional()
  @IsInt({ message: DIM_MSG })
  @Min(100, { message: DIM_MSG })
  @Max(4096, { message: DIM_MSG })
  width?: number;

  @IsOptional()
  @IsInt({ message: DIM_MSG })
  @Min(100, { message: DIM_MSG })
  @Max(4096, { message: DIM_MSG })
  height?: number;
}

const COUNT_MSG = 'Anahtar kelime sayıları 0 ya da pozitif tam sayı olmalı.';

export class KeywordPerformanceDto {
  @IsOptional() @IsInt({ message: COUNT_MSG }) @Min(0, { message: COUNT_MSG }) @Max(100_000, { message: COUNT_MSG })
  top_10?: number;

  @IsOptional() @IsInt({ message: COUNT_MSG }) @Min(0, { message: COUNT_MSG }) @Max(100_000, { message: COUNT_MSG })
  top_50?: number;

  @IsOptional() @IsInt({ message: COUNT_MSG }) @Min(0, { message: COUNT_MSG }) @Max(100_000, { message: COUNT_MSG })
  top_100?: number;

  @IsOptional() @IsInt({ message: COUNT_MSG }) @Min(0, { message: COUNT_MSG }) @Max(100_000, { message: COUNT_MSG })
  improving_keywords?: number;
}

export class ConversionDto {
  @IsOptional()
  @IsNumber({ allowNaN: false, allowInfinity: false }, { message: 'Dönüşüm oranı 0-1 arası sayı olmalı.' })
  @Min(0, { message: 'Dönüşüm oranı 0-1 arası sayı olmalı.' })
  @Max(1, { message: 'Dönüşüm oranı 0-1 arası sayı olmalı.' })
  impression_to_install?: number;

  @IsOptional()
  @IsInt({ message: 'İndirme sayısı 0 ya da pozitif tam sayı olmalı.' })
  @Min(0, { message: 'İndirme sayısı 0 ya da pozitif tam sayı olmalı.' })
  downloads_last_30_days?: number;

  @IsOptional()
  @IsIn(['up', 'stable', 'down'], { message: 'İndirme eğilimi up, stable ya da down olmalı.' })
  downloads_trend?: 'up' | 'stable' | 'down';
}

export class CalculateScoreDto {
  @IsOptional()
  @IsArray({ message: 'Hedef anahtar kelimeler dizi olmalı.' })
  @ArrayMaxSize(100, { message: 'En fazla 100 hedef anahtar kelime gönderilebilir.' })
  @IsString({ each: true, message: M.keyword })
  @MaxLength(100, { each: true, message: M.keyword })
  targetKeywords?: string[];

  @IsOptional()
  @ValidateNested()
  @Type(() => KeywordPerformanceDto)
  keywordPerformance?: KeywordPerformanceDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => ConversionDto)
  conversion?: ConversionDto;
}

export class CompareCompetitorsDto {
  // Her ad icin ayri iTunes istegi atiliyor (Promise.all): liste sinirli olmali
  @IsOptional()
  @IsArray({ message: 'names dizi olmalı.' })
  @ArrayMaxSize(10, { message: 'En fazla 10 rakip adı karşılaştırılabilir.' })
  @IsString({ each: true, message: 'Rakip adları metin olmalı.' })
  @MaxLength(100, { each: true, message: 'Rakip adı en fazla 100 karakter olmalı.' })
  names?: string[];

  @IsOptional()
  @IsString({ message: M.country })
  @Matches(COUNTRY, { message: M.country })
  country?: string;
}
