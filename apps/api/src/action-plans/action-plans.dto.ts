import { IsISO8601, IsObject, IsOptional, IsString, MaxLength, ValidateIf } from 'class-validator';

/*
 * NEDEN SINIF DTO: govde `any` idi — global ValidationPipe tipsiz govdeyi
 * denetlemez. sourceRef dogrudan Prisma `where`'ine giriyordu: dize yerine
 * nesne ({ not: null }) gonderilince filtre olarak yorumlaniyordu; dize
 * olmayan description/sourceRef `.slice` ile 500 veriyordu.
 * dueAt: '' / null eskisi gibi "tarih yok" demektir, dogrulanmaz.
 *
 * source/impact/effort icin enum burada DAYATILMAZ: servis bilinmeyen degeri
 * eskisi gibi varsayilana dusurur (mevcut istemciler 400 almasin).
 */
const hasValue = (_o: unknown, v: unknown) => v !== '' && v !== null && v !== undefined;

export class CreateActionPlanDto {
  // Uzunluk kurali (3-300) serviste Turkce mesajla
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  title?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20000)
  description?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  source?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  sourceRef?: string;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  impact?: string;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  effort?: string;

  @ValidateIf(hasValue)
  @IsISO8601({}, { message: 'dueAt ISO 8601 tarih olmalı' })
  dueAt?: string;

  @IsOptional()
  @IsObject()
  meta?: Record<string, unknown>;
}

export class UpdateActionPlanDto {
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  title?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20000)
  description?: string;

  // Gecerli degerler serviste (todo/in_progress/done/dismissed) Turkce mesajla
  @IsOptional()
  @IsString()
  @MaxLength(32)
  status?: string;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  impact?: string;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  effort?: string;

  // null / '' → son tarihi kaldir
  @ValidateIf(hasValue)
  @IsISO8601({}, { message: 'dueAt ISO 8601 tarih olmalı' })
  dueAt?: string | null;
}
