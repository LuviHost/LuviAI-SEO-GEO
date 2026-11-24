import { Body, Controller, Headers, HttpCode, HttpException, HttpStatus, Logger, Post, UnauthorizedException, BadRequestException } from '@nestjs/common';
import { Public } from '../auth/public.decorator.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { GscOAuthService } from '../auth/gsc-oauth.service.js';
import { KANCA_ARALIK_MS, bearerAnahtar, kancaHash, kancaSitemapAdresi } from './sitemap-kanca.js';

/**
 * POST /api/hooks/sitemap — yayin sonrasi site haritasini Search Console'a gonder.
 * Kimlik: "Authorization: Bearer <site anahtari>" (scripts/sitemap-kancasi-anahtar.ts uretir).
 * Govde (istege bagli): { "sitemap": "https://www.ornek.com/sitemap.xml" } — sitenin kendi alan adinda olmali.
 * Gerekce ve sinirlar: sitemap-kanca.ts.
 */
@Controller('hooks')
export class SitemapKancaController {
  private readonly log = new Logger(SitemapKancaController.name);
  /** siteId → son tetik zamani (sunucu yeniden baslayinca sifirlanir; Google tarafinda zarar yok) */
  private readonly sonTetik = new Map<string, number>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly gsc: GscOAuthService,
  ) {}

  @Public()
  @Post('sitemap')
  @HttpCode(200)
  async gonder(@Headers('authorization') auth: unknown, @Body() body: unknown) {
    const anahtar = bearerAnahtar(auth);
    if (!anahtar) throw new UnauthorizedException('Geçersiz anahtar');
    const site = await this.prisma.site.findUnique({
      where: { sitemapKancaHash: kancaHash(anahtar) },
      select: { id: true, url: true },
    });
    if (!site) throw new UnauthorizedException('Geçersiz anahtar');

    const istenen = body && typeof body === 'object' ? (body as { sitemap?: unknown }).sitemap : undefined;
    const sitemap = kancaSitemapAdresi(site.url, istenen);
    if (!sitemap) throw new BadRequestException('Site haritası adresi sitenin kendi alan adında ve https olmalı');

    const simdi = Date.now();
    const son = this.sonTetik.get(site.id);
    if (son && simdi - son < KANCA_ARALIK_MS) {
      throw new HttpException(`Çok sık: ${Math.ceil((KANCA_ARALIK_MS - (simdi - son)) / 1000)} sn sonra tekrar dene`, HttpStatus.TOO_MANY_REQUESTS);
    }
    this.sonTetik.set(site.id, simdi);

    const r = await this.gsc.submitSitemap(site.id, sitemap);
    if (!r.ok) {
      this.log.warn(`[${site.id}] sitemap kancasi: ${r.skipped ?? r.error}`);
      throw new HttpException(`Gönderilemedi: ${r.skipped ?? r.error ?? 'bilinmeyen'}`, HttpStatus.BAD_GATEWAY);
    }
    this.log.log(`[${site.id}] sitemap kancasi: ${sitemap} gönderildi`);
    return { ok: true, sitemap };
  }
}
