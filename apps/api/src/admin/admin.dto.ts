import { IsIn, IsOptional, IsString, Matches, MaxLength } from 'class-validator';
import { ASSIGNABLE_PLANS, type AssignablePlan } from './plan-assignment.js';

/*
 * NEDEN SINIF DTO: satir ici tipli govde global ValidationPipe'tan denetimsiz
 * gecer; `to.trim()` dize olmayan girdide 500 veriyordu ve sablon adi hic
 * denetlenmiyordu. Uc yalniz ADMIN'e acik — yine de govde tipli olmali.
 */
export class EmailTestDto {
  @IsOptional()
  @IsString()
  @MaxLength(320)
  to?: string;

  // Sablon adi EmailTemplate birligindeki kimliklerle ayni bicimde (welcome_day0 ...)
  @IsOptional()
  @IsString()
  @Matches(/^[a-z0-9_]{1,64}$/, { message: 'template geçersiz' })
  template?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  name?: string;
}

/** POST /admin/users/:userId/plan — yoneticinin elle plan atamasi (plan-assignment.ts) */
export class SetUserPlanDto {
  @IsIn(ASSIGNABLE_PLANS as unknown as string[], { message: 'plan geçersiz' })
  plan!: AssignablePlan;
}
