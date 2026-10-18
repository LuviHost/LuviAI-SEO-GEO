import { IsObject, IsOptional, IsString, MaxLength } from 'class-validator';

/*
 * NEDEN SINIF DTO: satir ici tipli govde global ValidationPipe'tan denetimsiz
 * gecer. csv dize degilse ayristirici 500 veriyordu; fileName import kaydinin
 * meta JSON'una yaziliyor.
 */
export class GscAiCsvPreviewDto {
  // Govde boyutu body-parser sinirinda; icerik dogrulamasi gsc-ai-csv.ts'te
  @IsOptional()
  @IsString()
  csv?: string;
}

export class GscAiCsvImportDto {
  @IsOptional()
  @IsString()
  csv?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  fileName?: string;
}

/*
 * POST /api/analytics/landing — herkese acik, anonim olay kaydi.
 * Analitik ucu: bir olay 400 ile kaybolmasin diye alanlar genis tutulur,
 * kesme (500/64 karakter) serviste. Tip ve kaba ust sinir burada; utm ve
 * meta controller'da tek tek / boyut sinirli okunur.
 */
export class LandingEventDto {
  @IsString()
  @MaxLength(80)
  type!: string;

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  path?: string;

  @IsString()
  @MaxLength(200)
  sessionId!: string;

  @IsOptional()
  @IsObject()
  meta?: Record<string, unknown>;

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  referrer?: string;

  @IsOptional()
  @IsObject()
  utm?: Record<string, unknown>;
}
