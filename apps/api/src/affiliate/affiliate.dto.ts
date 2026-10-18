import { IsOptional, IsString, MaxLength } from 'class-validator';

/*
 * NEDEN SINIF DTO: satir ici tipli govde global ValidationPipe'tan denetimsiz
 * gecer. userId/refCode Prisma sorgusuna (findUnique where) gidiyor: dize
 * olmayan deger (nesne) filtre olarak yorumlanabilir ya da 500 verir.
 */
export class EnrollAffiliateDto {
  // Panel kendi userId'sini gonderir; oturumla eslesmeli (ADMIN haric)
  @IsOptional()
  @IsString()
  @MaxLength(64)
  userId?: string;
}

/** Ic uc (NextAuth signIn → x-internal-key). Eksik alan eskisi gibi { ok: false }. */
export class AttributeAffiliateDto {
  @IsOptional()
  @IsString()
  @MaxLength(64)
  userId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  refCode?: string;
}
