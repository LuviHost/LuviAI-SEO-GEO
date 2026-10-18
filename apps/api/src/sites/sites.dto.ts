import {
  ArrayMaxSize, IsArray, IsBoolean, IsIn, IsInt, IsObject, IsOptional, IsString, IsUrl, Matches, Max, MaxLength, Min,
} from 'class-validator';
import { SITE_URL_MESSAGES } from './site-url-policy.js';

/*
 * TIP DOGRULAMASI NEDEN: yalniz @IsOptional() tasiyan alan whitelist'ten
 * gecer ama tipi HIC denetlenmez. UpdateSiteDto servis tarafinda
 * `{ ...dto }` ile prisma.site.update'e yayiliyor: sayi beklenen alana
 * `{ increment: 1000 }` gibi bir Prisma islem nesnesi, boolean beklenen alana
 * "false" dizesi gidebiliyordu. Her alan artik tipli ve sinirli.
 */

export class CreateSiteDto {
  // Ilk eleme. validator.js IP adresini gecerli host sayar; IP, port, ic ag
  // ve DNS denetimi SitesService.create'te (site-url-policy.ts) yapilir.
  @IsUrl({ protocols: ['http', 'https'], require_tld: true, disallow_auth: true }, { message: SITE_URL_MESSAGES.invalid })
  @MaxLength(2048, { message: SITE_URL_MESSAGES.too_long })
  url!: string;

  @IsString()
  @MaxLength(120)
  name!: string;

  @IsOptional()
  @IsString()
  niche?: string;

  @IsOptional()
  @IsString()
  customNiche?: string;

  @IsOptional()
  @IsString()
  language?: string;

  @IsOptional()
  @IsBoolean()
  autopilot?: boolean;
}

export class UpdateSiteDto {
  // Kolonlar VARCHAR(191): daha uzunu zaten yazilamaz (Prisma 500 yerine 400).
  // Guncellemede eskiden ust sinir yoktu; 120-191 arasi eski ad kaydi kilitlemesin.
  @IsOptional() @IsString() @MaxLength(191) name?: string;
  @IsOptional() @IsString() @MaxLength(191) niche?: string;
  @IsOptional() @IsString() @MaxLength(191) customNiche?: string;
  @IsOptional() @IsString() @MaxLength(10) language?: string;
  @IsOptional() @IsBoolean() autoGenerationEnabled?: boolean;
  // 5 alanli cron (dakika saat gun ay haftagunu); yalniz rakam ve * , - / bosluk
  @IsOptional() @IsString() @MaxLength(100)
  @Matches(/^[\d*,\-/]+(\s+[\d*,\-/]+){4}$/, { message: 'autoGenerationCron 5 alanlı bir cron ifadesi olmalı' })
  autoGenerationCron?: string;
  @IsOptional() @IsInt() @Min(0) @Max(50) autoGenerationCount?: number;

  // Sprint Onboarding
  @IsOptional() @IsIn(['manual_approve', 'auto_publish']) publishApprovalMode?: string;
  @IsOptional() @IsIn(['daily', 'three_per_week', 'weekly']) autoGenerationFrequency?: string;
  @IsOptional() @IsInt() @Min(0) @Max(23) autoGenerationHour?: number;
  // completeOnboarding 7 yazar
  @IsOptional() @IsInt() @Min(0) @Max(7) onboardingStep?: number;
  @IsOptional() @IsBoolean() autopilot?: boolean;
}

/** POST /sites/detect-niche { url } — adres denetimi assertSiteUrlAllowed'da */
export class DetectNicheDto {
  @IsOptional()
  @IsString()
  @MaxLength(2048)
  url?: string;
}

/**
 * PUT /sites/:id/competitors { competitors }
 * Ogeler beyaz listelenmez: liste beyin (LLM) ciktisindan gelir ve ek alan
 * tasiyabilir — panel listeyi oldugu gibi geri gonderir. Ogeler nesne olmali;
 * name/url/strengths/weaknesses controller'da tek tek okunur, servis adresi
 * site adresi kuralindan gecirir.
 */
export class SetCompetitorsDto {
  @IsArray()
  @ArrayMaxSize(50)
  @IsObject({ each: true })
  competitors!: Array<Record<string, unknown>>;
}

/** PATCH /sites/:id/gsc/property { propertyUrl } — sc-domain:ornek.com ya da https://ornek.com/ */
export class GscPropertyDto {
  @IsString()
  @MaxLength(2048)
  propertyUrl!: string;
}

/** PATCH /sites/:id/ga/property { propertyId } — GA4 property kimligi */
export class GaPropertyDto {
  @IsString()
  @MaxLength(64)
  propertyId!: string;
}

/** PATCH /sites/:id/autopilot { enabled } — "false" dizesi eskiden !! ile true oluyordu */
export class SiteAutopilotDto {
  @IsBoolean()
  enabled!: boolean;
}

/** PATCH /sites/:id/webhook { url, kind } — bos url webhook'u kaldirir */
export class SiteWebhookDto {
  @IsOptional()
  @IsString()
  @MaxLength(2048)
  url?: string;

  @IsOptional()
  @IsIn(['slack', 'discord'])
  kind?: 'slack' | 'discord';
}
