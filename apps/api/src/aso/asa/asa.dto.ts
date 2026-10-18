import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

/*
 * Apple Search Ads uclarinin govdeleri — sinif DTO. Satir ici tipli govdeyi
 * global ValidationPipe denetlemiyordu: setAutoPilot govdesi dogrudan
 * prisma.asaAccount.update'e gidiyordu ({ budgetCapUsd: { increment: 1e9 } }
 * Prisma'da atomik islem olarak calisir), kampanya ve teklif govdeleri
 * Apple'a para harcatan isteklere donusuyor. Sayi/tamsayi/dizi siniri kapida
 * denetlenir; anlamsal kurallar (pozitif butce, gecerli adamId) ve Turkce
 * mesajlari asa.service.ts'te kalir. Yoldan gelen siteId govdeden SONRA
 * yazilir (asa.controller.ts).
 */

const NUM = { allowNaN: false, allowInfinity: false } as const;

export class ConnectAsaDto {
  @IsString({ message: 'Client ID gerekli.' })
  @IsNotEmpty({ message: 'Client ID gerekli.' })
  @MaxLength(200, { message: 'Client ID en fazla 200 karakter olmalı.' })
  orgId!: string;

  @IsString({ message: 'Key ID gerekli.' })
  @IsNotEmpty({ message: 'Key ID gerekli.' })
  @MaxLength(200, { message: 'Key ID en fazla 200 karakter olmalı.' })
  keyId!: string;

  @IsString({ message: '.p8 anahtarı gerekli.' })
  @IsNotEmpty({ message: '.p8 anahtarı gerekli.' })
  @MaxLength(10_000, { message: '.p8 anahtarı çok uzun.' })
  privateKeyPem!: string;

  @IsOptional()
  @IsString({ message: 'Team ID metin olmalı.' })
  @MaxLength(200, { message: 'Team ID en fazla 200 karakter olmalı.' })
  teamId?: string;
}

export class AsaKeywordDto {
  @IsString({ message: 'Anahtar kelime metin olmalı.' })
  @MaxLength(200, { message: 'Anahtar kelime en fazla 200 karakter olmalı.' })
  text!: string;

  @IsNumber(NUM, { message: 'Anahtar kelime teklifleri pozitif bir sayı olmalı.' })
  bidUsd!: number;

  @IsOptional()
  @IsIn(['EXACT', 'BROAD'], { message: 'Eşleme türü EXACT ya da BROAD olmalı.' })
  matchType?: 'EXACT' | 'BROAD';
}

export class CreateAsaCampaignDto {
  @IsString({ message: 'Hesap gerekli.' })
  @IsNotEmpty({ message: 'Hesap gerekli.' })
  @MaxLength(64, { message: 'Hesap kimliği geçersiz.' })
  accountId!: string;

  @IsString({ message: 'Kampanya adı gerekli.' })
  @IsNotEmpty({ message: 'Kampanya adı gerekli.' })
  @MaxLength(200, { message: 'Kampanya adı en fazla 200 karakter olmalı.' })
  name!: string;

  @IsNumber(NUM, { message: 'Günlük bütçe pozitif bir sayı olmalı.' })
  dailyBudgetUsd!: number;

  @IsArray({ message: 'En az bir ülke seçilmeli.' })
  @ArrayMinSize(1, { message: 'En az bir ülke seçilmeli.' })
  @ArrayMaxSize(100, { message: 'En fazla 100 ülke seçilebilir.' })
  @Matches(/^[A-Z]{2}$/, { each: true, message: 'Ülke kodları iki harfli büyük harf ISO kodu olmalı (ör. TR, US).' })
  countries!: string[];

  @IsInt({ message: 'Geçersiz Apple App ID.' })
  @Min(1, { message: 'Geçersiz Apple App ID.' })
  appleAppId!: number;

  @IsOptional()
  @IsArray({ message: 'Anahtar kelimeler dizi olmalı.' })
  @ArrayMaxSize(1000, { message: 'En fazla 1000 anahtar kelime eklenebilir.' })
  @ValidateNested({ each: true })
  @Type(() => AsaKeywordDto)
  keywords?: AsaKeywordDto[];
}

export class UpdateAsaBidDto {
  @IsNumber(NUM, { message: 'Teklif pozitif bir sayı olmalı.' })
  bidUsd!: number;
}

export class SetAsaAutoPilotDto {
  @IsBoolean({ message: 'enabled true ya da false olmalı.' })
  enabled!: boolean;

  // null: mevcut sinir korunur (asa.service.ts setAutoPilot). 0 gecerli: ay ici
  // harcama her zaman >= 0 oldugu icin otopilot HIC degisiklik yapmaz
  // (runAutoPilot null kontrolu). Panel (asa-tab.tsx AutoPilotPanel save) ayni
  // alt siniri kaydetmeden once uygular.
  @IsOptional()
  @IsNumber(NUM, { message: 'Bütçe sınırı 0 ya da pozitif bir sayı olmalı.' })
  @Min(0, { message: 'Bütçe sınırı 0 ya da pozitif bir sayı olmalı.' })
  budgetCapUsd?: number | null;
}
