import { IsEnum, IsInt, IsOptional, IsString, IsArray, IsIn, Max, Min, MaxLength } from 'class-validator';

export class CreateVideoDto {
  @IsString()
  @MaxLength(200)
  title!: string;

  @IsString()
  @MaxLength(8000)
  scriptText!: string;

  @IsEnum(['SLIDESHOW', 'VEO', 'RUNWAY', 'HEYGEN', 'SORA'])
  provider!: 'SLIDESHOW' | 'VEO' | 'RUNWAY' | 'HEYGEN' | 'SORA';

  @IsOptional()
  @IsInt()
  @Min(5)
  @Max(120)
  durationSec?: number = 30;

  @IsOptional()
  @IsIn(['9:16', '16:9', '1:1'])
  aspectRatio?: '9:16' | '16:9' | '1:1' = '9:16';

  @IsOptional()
  @IsString()
  voiceId?: string;

  @IsOptional()
  @IsString()
  language?: string = 'tr';

  @IsOptional()
  @IsString()
  @MaxLength(200)
  style?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  imageUrls?: string[];

  @IsOptional()
  @IsString()
  articleId?: string;
}
