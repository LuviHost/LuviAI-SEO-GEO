import { IsOptional, IsString, IsUrl, MaxLength } from 'class-validator';

export class CreateSiteDto {
  @IsUrl()
  url!: string;

  @IsString()
  @MaxLength(120)
  name!: string;

  @IsOptional()
  @IsString()
  niche?: string;

  @IsOptional()
  @IsString()
  language?: string;

  @IsOptional()
  autopilot?: boolean;
}

export class UpdateSiteDto {
  @IsOptional() @IsString() name?: string;
  @IsOptional() @IsString() niche?: string;
  @IsOptional() @IsString() language?: string;
  @IsOptional() autoGenerationEnabled?: boolean;
  @IsOptional() autoGenerationCron?: string;
  @IsOptional() autoGenerationCount?: number;
}
