import { IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

/*
 * NEDEN SINIF DTO: satir ici tipli govdede global ValidationPipe hicbir alani
 * denetlemiyordu; `{ ...body, userId }` yayilimiyla her alan servise gidiyordu.
 * Uzunluk/icerik kurallari (10-500 karakter, puan 1-5) serviste Turkce
 * mesajla korunur; burada tip ve kaba ust sinir.
 */
export class SubmitTestimonialDto {
  @IsOptional()
  @IsString()
  @MaxLength(64)
  siteId?: string;

  @IsInt()
  @Min(1)
  @Max(5)
  rating!: number;

  @IsString()
  @MaxLength(2000)
  body!: string;

  // Servis 80/120 karakterde keser; burada yalniz asiri buyuk girdi reddedilir
  @IsOptional()
  @IsString()
  @MaxLength(500)
  role?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  company?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  metric?: string;
}

export const TESTIMONIAL_ACTIONS = ['approve', 'reject', 'feature', 'unfeature'] as const;

export class ModerateTestimonialDto {
  @IsIn(TESTIMONIAL_ACTIONS)
  action!: (typeof TESTIMONIAL_ACTIONS)[number];
}
