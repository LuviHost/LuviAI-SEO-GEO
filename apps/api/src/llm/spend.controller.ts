import { Body, Controller, ForbiddenException, Get, HttpCode, Param, Post, Query, Req } from '@nestjs/common';
import type { Request } from 'express';
import { LLMProviderService } from './llm-provider.service.js';
import { SaglayiciKrediService } from './saglayici-kredi.service.js';
import { RequiresPlan } from '../billing/plan-feature.decorator.js';

function assertAdmin(req: Request) {
  const user = (req as any).user;
  if (!user) throw new ForbiddenException('Auth required');
  if (user.role !== 'ADMIN') throw new ForbiddenException('Admin only');
  return user;
}

@Controller()
export class SpendController {
  constructor(
    private readonly llm: LLMProviderService,
    private readonly kredi: SaglayiciKrediService,
  ) {}

  /** GET /admin/saglayici-kredi?tazele=1 — havuz anahtarli AI saglayicilarinin kredi durumu + yukleme linki */
  @Get('admin/saglayici-kredi')
  async saglayiciKredi(@Req() req: Request, @Query('tazele') tazele?: string) {
    assertAdmin(req);
    return this.kredi.tablo({ tazele: tazele === '1' });
  }

  /** POST /admin/saglayici-kredi/bakiye {id, tutar, paraBirimi} — tahmini bakiye icin admin girisi (tutar null = sil) */
  @Post('admin/saglayici-kredi/bakiye')
  @HttpCode(200)
  async saglayiciBakiyeGir(@Req() req: Request, @Body() body: { id?: unknown; tutar?: unknown; paraBirimi?: unknown; otomatikYukleme?: unknown }) {
    assertAdmin(req);
    return this.kredi.bakiyeGir(body?.id, body?.tutar, body?.paraBirimi, body?.otomatikYukleme);
  }

  /** POST /admin/saglayici-kredi/kontrol — her saglayiciya en kucuk istek (toplam < 0,01 USD) */
  @Post('admin/saglayici-kredi/kontrol')
  @HttpCode(200)
  async saglayiciKrediKontrol(@Req() req: Request) {
    assertAdmin(req);
    return this.kredi.kontrolEt();
  }

  /** GET /admin/spend?days=30 — global spend dashboard */
  @Get('admin/spend')
  async adminSpend(@Req() req: Request, @Query('days') days?: string) {
    assertAdmin(req);
    return this.llm.getSpendSummary({ days: days ? parseInt(days, 10) : 30 });
  }

  /**
   * GET /sites/:siteId/spend?days=30 — site bazlı spend (site sahibi görür)
   *
   * PLAN KAPISI VAR: burada "gecmis listeleme acik kalsin" istisnasi gecerli
   * degil, cunku maliyet/token muhasebesinin KENDISI satilan ozellik
   * (costAnalytics = Kurumsal). Ucun donduruyor oldugu sey baska bir ozelligin
   * gecmisi degil, ozelligin ta kendisi.
   *
   * 'admin/spend' ayri: assertAdmin ile korunuyor, plan kapisi ORAYA konmaz —
   * admin zaten guard'da muaf ve global panel plana bagli degil.
   */
  @RequiresPlan('costAnalytics')
  @Get('sites/:siteId/spend')
  async siteSpend(
    @Param('siteId') siteId: string,
    @Query('days') days?: string,
  ) {
    return this.llm.getSpendSummary({ siteId, days: days ? parseInt(days, 10) : 30 });
  }
}
