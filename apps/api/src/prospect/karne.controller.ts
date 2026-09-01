import { Controller, Get, Header, NotFoundException, Param } from '@nestjs/common';
import { Public } from '../auth/public.decorator.js';
import { KarneService } from './karne.service.js';

/**
 * Ucretsiz karnenin PAYLASILABILIR sayfasi.
 *
 * NEDEN public: karne "olur" diyen kuruma link olarak gonderilir; alici RanksUp kullanicisi degil.
 * Koruma link'in kendisidir (24 baytlik tahmin edilemez token) + rapor HTML'inde `noindex, nofollow`.
 * Liste ucu YOK: token bilinmeden hicbir karneye ulasilamaz.
 */
@Controller('public/karne')
export class KarneController {
  constructor(private readonly karne: KarneService) {}

  @Public()
  @Get(':token')
  @Header('Content-Type', 'text/html; charset=utf-8')
  @Header('X-Robots-Tag', 'noindex, nofollow')
  @Header('Cache-Control', 'no-store')
  async goster(@Param('token') token: string): Promise<string> {
    if (!/^[A-Za-z0-9_-]{16,64}$/.test(token ?? '')) throw new NotFoundException('Karne bulunamadı');
    const k = await this.karne.getirVeSay(token);
    return k.html;
  }
}
