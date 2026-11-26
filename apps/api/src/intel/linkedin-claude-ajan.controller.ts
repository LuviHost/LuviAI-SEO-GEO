import { Body, Controller, Headers, HttpCode, Post } from '@nestjs/common';
import { Public } from '../auth/public.decorator.js';
import { LinkedinClaudeService } from './linkedin-claude.service.js';

/**
 * /api/internal/linkedin-claude/* — kurucunun Mac'indeki ajan (scripts/linkedin-claude-ajan.mjs).
 * Oturum yok; `x-ajan-key` panelde uretilen anahtar (sunucuda yalniz SHA-256 ozeti).
 * NEDEN /api/internal: nginx /api/auth/* yolunu NextAuth'a gonderir; /api/* geri kalani API'ye gider.
 * Ajan dakikada bir `al` cagirir — bu ayni zamanda "Mac servisi acik" sinyalidir.
 */
@Controller('internal/linkedin-claude')
export class LinkedinClaudeAjanController {
  constructor(private readonly svc: LinkedinClaudeService) {}

  @Public()
  @Post('al')
  @HttpCode(200)
  async al(@Headers('x-ajan-key') key: string | undefined) {
    await this.svc.ajanDogrula(key);
    return this.svc.isAl();
  }

  @Public()
  @Post('sonuc')
  @HttpCode(200)
  async sonuc(
    @Headers('x-ajan-key') key: string | undefined,
    @Body() body: { isId?: string; kisiId?: string; durum?: string; aciklama?: string },
  ) {
    await this.svc.ajanDogrula(key);
    return this.svc.sonucYaz(String(body?.isId ?? ''), String(body?.kisiId ?? ''), body?.durum, body?.aciklama);
  }

  @Public()
  @Post('bitti')
  @HttpCode(200)
  async bitti(@Headers('x-ajan-key') key: string | undefined, @Body() body: { isId?: string; hata?: string }) {
    await this.svc.ajanDogrula(key);
    return this.svc.bitir(String(body?.isId ?? ''), body?.hata);
  }
}
