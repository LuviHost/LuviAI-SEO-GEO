import { IsBoolean, IsObject, IsOptional, IsString, MaxLength } from 'class-validator';

/*
 * NEDEN SINIF DTO: satir ici tipli govde global ValidationPipe'tan denetimsiz
 * geciyordu. credentials dize gelince Object.keys karakter indekslerini
 * donduruyor ve adres denetimi bos nesneyle calisiyordu; name dize degilse
 * `.trim()` 500 veriyordu. Hedef tipi (TARGET_TYPES) ve adres guvenligi
 * (publish-target-url.ts) serviste denetlenir — burada tip ve kaba sinir.
 * credentials/config icindeki anahtarlar hedef tipine gore degisir (katalog
 * alanlari), o yuzden nesne icerigi burada beyaz listelenmez.
 * name kolonu VARCHAR(191): daha uzunu Prisma'da 500 verirdi.
 */
export class CreatePublishTargetDto {
  @IsString()
  @MaxLength(40)
  type!: string;

  @IsString()
  @MaxLength(191)
  name!: string;

  @IsOptional()
  @IsObject()
  credentials?: Record<string, unknown>;

  @IsOptional()
  @IsObject()
  config?: Record<string, unknown>;

  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class UpdatePublishTargetDto {
  @IsOptional()
  @IsString()
  @MaxLength(191)
  name?: string;

  @IsOptional()
  @IsObject()
  credentials?: Record<string, unknown>;

  @IsOptional()
  @IsObject()
  config?: Record<string, unknown>;

  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
