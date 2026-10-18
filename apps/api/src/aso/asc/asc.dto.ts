import { IsBoolean, IsIn, IsNotEmpty, IsObject, IsOptional, IsString, Length, MaxLength } from 'class-validator';

/*
 * App Store Connect uclarinin govdeleri — sinif DTO. Satir ici tipli govdeyi
 * global ValidationPipe denetlemiyordu; bu govdeler Apple API'sine (anahtar
 * dogrulama, yorum yaniti, metadata/ekran goruntusu yazma), LLM'e (yanit
 * taslagi) ve Prisma'ya gidiyor. Servisler alanlari ayrica denetliyor
 * (confirm, locale, displayType, 5-5970 yanit); DTO tip ve uzunlugu kapida
 * keser, bilinmeyen alani 400 ile reddeder. Yoldan gelen siteId govdeden
 * SONRA yazilir (asc.controller.ts).
 */

/** Apple yerel ayar kodu: "tr", "en-US", "zh-Hans" */
const LOCALE_MAX = 20;
const DISPLAY_TYPE_MAX = 64;

export class ConnectAscDto {
  @IsString({ message: 'Issuer ID gerekli.' })
  @IsNotEmpty({ message: 'Issuer ID gerekli.' })
  @MaxLength(100, { message: 'Issuer ID en fazla 100 karakter olmalı.' })
  issuerId!: string;

  @IsString({ message: 'Key ID gerekli.' })
  @IsNotEmpty({ message: 'Key ID gerekli.' })
  @MaxLength(100, { message: 'Key ID en fazla 100 karakter olmalı.' })
  keyId!: string;

  @IsString({ message: '.p8 anahtarı gerekli.' })
  @IsNotEmpty({ message: '.p8 anahtarı gerekli.' })
  @MaxLength(10_000, { message: '.p8 anahtarı çok uzun.' })
  privateKeyPem!: string;
}

export class DraftReplyDto {
  @IsOptional()
  @IsString({ message: 'Not metin olmalı.' })
  @MaxLength(2000, { message: 'Not en fazla 2000 karakter olabilir.' })
  notes?: string;

  @IsOptional()
  @IsString({ message: 'Destek iletişim bilgisi metin olmalı.' })
  @MaxLength(500, { message: 'Destek iletişim bilgisi en fazla 500 karakter olabilir.' })
  supportContact?: string;
}

export class ReplyReviewDto {
  // Mesaj servisle ayni (asc.service.ts replyToReview)
  @IsString({ message: 'Yanıt 5-5970 karakter olmalı' })
  @Length(5, 5970, { message: 'Yanıt 5-5970 karakter olmalı' })
  body!: string;
}

export class PlanAscMetadataDto {
  @IsString({ message: 'locale gerekli (ör. tr, en-US)' })
  @MaxLength(LOCALE_MAX, { message: 'locale gerekli (ör. tr, en-US)' })
  locale!: string;

  // Alan adlari ve degerleri serviste ASC_FIELDS / magaza sinirlariyla denetlenir
  @IsOptional()
  @IsObject({ message: 'fields nesne olmalı.' })
  fields?: Record<string, unknown>;
}

export class ApplyAscMetadataDto {
  @IsOptional()
  @IsString({ message: 'planId metin olmalı.' })
  @MaxLength(64, { message: 'planId geçersiz.' })
  planId?: string;

  @IsOptional()
  @IsBoolean({ message: 'Uygulamak için açık onay gerekli (confirm: true)' })
  confirm?: boolean;
}

export class CheckScreenshotDto {
  @IsOptional()
  @IsString({ message: 'Geçersiz görünüm türü' })
  @MaxLength(DISPLAY_TYPE_MAX, { message: 'Geçersiz görünüm türü' })
  displayType?: string;
}

export class UploadScreenshotDto {
  @IsOptional()
  @IsString({ message: 'Geçersiz dil' })
  @MaxLength(LOCALE_MAX, { message: 'Geçersiz dil' })
  locale?: string;

  @IsOptional()
  @IsString({ message: 'Geçersiz görünüm türü' })
  @MaxLength(DISPLAY_TYPE_MAX, { message: 'Geçersiz görünüm türü' })
  displayType?: string;

  // Cok parcali formda alanlar metin gelir ("true"); JSON istemcisi true gonderebilir
  @IsOptional()
  @IsIn([true, 'true'], { message: 'Yüklemek için açık onay gerekli' })
  confirm?: boolean | 'true';
}

export class ClearScreenshotsDto {
  @IsOptional()
  @IsString({ message: 'Geçersiz dil' })
  @MaxLength(LOCALE_MAX, { message: 'Geçersiz dil' })
  locale?: string;

  @IsOptional()
  @IsString({ message: 'Geçersiz görünüm türü' })
  @MaxLength(DISPLAY_TYPE_MAX, { message: 'Geçersiz görünüm türü' })
  displayType?: string;

  @IsOptional()
  @IsBoolean({ message: 'Silmek için açık onay gerekli' })
  confirm?: boolean;
}

export class DeleteScreenshotDto {
  @IsOptional()
  @IsBoolean({ message: 'Silmek için açık onay gerekli' })
  confirm?: boolean;
}
