import { ArrayMaxSize, IsArray, IsInt, IsOptional, IsString, Max, MaxLength, Min, MinLength } from 'class-validator';

/*
 * NEDEN SINIF DTO: satir ici tipli govde global ValidationPipe'tan denetimsiz
 * geciyordu; rateLimit ve expiresInDays istemcinin yazdigi gibi kaydediliyordu
 * (negatif gun → gecmis tarih, dev sayi → gecersiz tarih ve 500).
 * Scope adlari serviste ALL_SCOPES ile Turkce mesajla denetlenir.
 */
export class CreateApiKeyDto {
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name!: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  scopes?: string[];

  // En fazla ~10 yil; 0/negatif sure anahtari dogar dogmaz gecersiz kilardi
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(3650)
  expiresInDays?: number;

  // Dakikadaki istek tavani. Varsayilan (60) ustune cikarilamaz: istemci
  // kendi sinirini gevsetemez, yalniz daraltabilir.
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(60)
  rateLimit?: number;
}
