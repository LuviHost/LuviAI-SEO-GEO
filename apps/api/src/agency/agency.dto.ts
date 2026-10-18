import { IsBoolean, IsEmail, IsFQDN, IsOptional, IsString, IsUrl, Matches, MaxLength, ValidateIf } from 'class-validator';

/*
 * NEDEN SINIF DTO: PATCH /agency/whitelabel govdesi `any` idi — global
 * ValidationPipe tipsiz govdeyi denetlemez. Alan adi, logo adresi ve renk
 * hic dogrulanmadan kullanici kaydina yaziliyordu (alan adi davet linkinin
 * kokunu ve herkese acik resolve-domain cevabini belirliyor).
 *
 * Panel formu bos alanlari '' gonderir; '' "temizle" demektir, dogrulanmaz.
 * whitelabel* kolonlari VARCHAR(191): ust sinir buna gore (uzunu Prisma'da 500 verirdi).
 */
const notEmpty = (_o: unknown, v: unknown) => v !== '' && v !== null && v !== undefined;

export class WhitelabelDto {
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  brandName?: string;

  @ValidateIf(notEmpty)
  @IsString()
  @MaxLength(191)
  @IsUrl({ protocols: ['https'], require_protocol: true, require_tld: true, disallow_auth: true }, { message: 'Logo adresi https:// ile başlayan geçerli bir adres olmalı' })
  logoUrl?: string;

  @ValidateIf(notEmpty)
  @IsString()
  @Matches(/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/, { message: 'Marka rengi #RRGGBB biçiminde olmalı' })
  primaryColor?: string;

  // Yalniz alan adi (CNAME hedefi): sema, yol, port yok
  @ValidateIf(notEmpty)
  @IsString()
  @MaxLength(191)
  @IsFQDN({ require_tld: true, allow_underscores: false, allow_trailing_dot: false }, { message: 'Alan adı geçerli bir alan adı olmalı (ör. ai.ajansadi.com.tr)' })
  domain?: string;

  @ValidateIf(notEmpty)
  @IsString()
  @MaxLength(191)
  @IsEmail({}, { message: 'Gönderen e-posta geçerli bir e-posta adresi olmalı' })
  emailFrom?: string;
}

export class InviteClientDto {
  // Davet kaydi verification_tokens.identifier'a 'agency-invite:<id>:<eposta>'
  // olarak yazilir (VARCHAR(191)); onek ~40 karakter
  @IsString()
  @MaxLength(150)
  @IsEmail({}, { message: 'Geçerli bir e-posta adresi girin' })
  email!: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  name?: string;
}
