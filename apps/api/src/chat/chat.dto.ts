import { IsOptional, IsString, MaxLength } from 'class-validator';

/*
 * NEDEN SINIF DTO: satir ici tipli govde global ValidationPipe'tan denetimsiz
 * gecer. conversationId Prisma `where`'ine gidiyor: dize yerine nesne
 * ({ not: '' }) filtre olarak yorumlanirdi. Mesaj uzunlugu (4000) serviste
 * Turkce mesajla denetlenir — burada yalniz tip.
 */
export class SendChatMessageDto {
  @IsOptional()
  @IsString()
  @MaxLength(64)
  conversationId?: string;

  @IsOptional()
  @IsString()
  message?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  skill?: string;
}
