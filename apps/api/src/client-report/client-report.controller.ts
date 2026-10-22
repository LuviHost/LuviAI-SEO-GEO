import { Body, Controller, Delete, Get, Header, HttpCode, NotFoundException, Param, Post, Req } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { Public } from '../auth/public.decorator.js';
import { SessionOnly } from '../auth/session-only.decorator.js';
import { TrialReadOnlyExempt } from '../billing/trial-read-only.decorator.js';
import { ClientReportService, RAPOR_BULUNAMADI } from './client-report.service.js';
import { gecerliToken } from './client-report-share.js';

/**
 * Musteri raporu (Site Raporu) — sahibin uclari.
 *
 * ERISIM: global SiteAccessGuard `:siteId` sahipligini dogrular (baskasinin
 * sitesi 403, olmayan site 404). PLAN KAPISI YOK: rapor yalniz kayitli
 * olcumleri okur, yapay zeka ya da tarama maliyeti yok — deneme dahil tum
 * planlarda acik.
 *
 * DENEME SALT OKUNUR: GET zaten acik. Paylasim olusturma bir POST oldugu icin
 * @TrialReadOnlyExempt ile acildi: AI cagirmaz, yalniz sahibin kendi verisinin
 * dondurulmus kopyasini kv_store'a yazar (suresi dolan deneme hesabi da
 * musterisine son raporu gonderebilmeli). DELETE (geri alma) zaten aciktir.
 *
 * @SessionOnly: paylasim veriyi HERKESE ACIK yapar; bu karar panelde insan
 * tarafindan verilmeli — herhangi bir ':write' API anahtari link uretemesin.
 */
@Controller('sites/:siteId/client-report')
export class ClientReportController {
  constructor(private readonly reports: ClientReportService) {}

  /** GET /sites/:siteId/client-report — kayitli son olcumlerden rapor (yeni olcum KOSMAZ) */
  @Get()
  @Header('Cache-Control', 'no-store')
  report(@Param('siteId') siteId: string) {
    return this.reports.build(siteId);
  }

  @Get('shares')
  @Header('Cache-Control', 'no-store')
  shares(@Param('siteId') siteId: string) {
    return this.reports.listShares(siteId);
  }

  @SessionOnly()
  @TrialReadOnlyExempt()
  @Post('shares')
  createShare(@Param('siteId') siteId: string, @Body() body: { gun?: unknown } | undefined, @Req() req: Request) {
    const userId = (req as Request & { user?: { id?: string } }).user?.id ?? null;
    return this.reports.createShare(siteId, userId, body?.gun);
  }

  @SessionOnly()
  @Delete('shares/:token')
  revokeShare(@Param('siteId') siteId: string, @Param('token') token: string) {
    return this.reports.revokeShare(siteId, token);
  }
}

/**
 * Paylasilan raporun HERKESE ACIK okuma ucu: GET /api/public/rapor/:token.
 *
 * Koruma tokenin kendisidir (24 rastgele bayt); liste ucu yok. Yanit
 * arama motorlarina kapali (X-Robots-Tag) ve onbelleklenmez (geri alininca
 * hemen dusmeli). Hiz siniri: IP basina dakikada 30 — token tahmini zaten
 * imkansiz; sinir tarama/yuk icin. Web sayfasi bu ucu TARAYICIDAN cagirir
 * (Next sunucusundan degil) ki sinir gercek ziyaretci IP'sine uygulansin.
 */
@Controller('public/rapor')
export class PublicClientReportController {
  constructor(private readonly reports: ClientReportService) {}

  @Public()
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Get(':token')
  @HttpCode(200)
  @Header('X-Robots-Tag', 'noindex, nofollow')
  @Header('Cache-Control', 'no-store')
  @Header('Referrer-Policy', 'no-referrer')
  async goster(@Param('token') token: string) {
    if (!gecerliToken(token)) throw new NotFoundException(RAPOR_BULUNAMADI);
    return this.reports.getPublic(token);
  }
}
