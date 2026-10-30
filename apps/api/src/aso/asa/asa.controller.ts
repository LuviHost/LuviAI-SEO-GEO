import { Body, Controller, Delete, Get, Param, Post, Put, Query, Req, UnauthorizedException } from '@nestjs/common';
import type { Request } from 'express';
import { AsaService } from './asa.service.js';
import { QuotaService } from '../../billing/quota.service.js';
import { SessionOnly } from '../../auth/session-only.decorator.js';
import { RequiresPlan } from '../../billing/plan-feature.decorator.js';
import { ConnectAsaDto, CreateAsaCampaignDto, SetAsaAutoPilotDto, UpdateAsaBidDto } from './asa.dto.js';

function ensureUser(req: Request) {
  const user = (req as any).user;
  if (!user) throw new UnauthorizedException();
  return user as { id: string; role: 'USER' | 'ADMIN' | 'AGENCY_OWNER'; plan?: string };
}

/**
 * PARA HAREKETI YALNIZ PANELDEN: Apple Search Ads baglama/kesme, kampanya
 * olusturma, kelime teklifi ve otopilot uclari @SessionOnly — API anahtari 403
 * alir. NEDEN: /aso yolu anahtar kapsam haritasinda yok (api-keys.service
 * ROUTE_RESOURCE); AuthGuard bilinmeyen kaynakta HERHANGI bir ':write'
 * anahtarini (orn. yalniz 'social:write') yeterli sayiyordu. Bu uclar
 * musterinin Apple reklam butcesini harcar ya da kimlik bilgisini degistirir;
 * insan onayi panelde verilir. Okuma uclari ve kampanya senkronu (Apple'dan
 * okur, harcama yapmaz) anahtarla calismaya devam eder. Web paneli ve mobil
 * oturumla cagirir; SDK ve MCP bu uclari kullanmiyor.
 *
 * PLAN KAPISI (asaEnabled) — PLAN DUSUNCE DE TUTMALI, yalniz baglarken degil.
 * Eskiden kapi yalniz connect'teydi: Profesyonel'de baglayip sonra denemeye
 * (TRIAL) dusen kullanici kampanya acmaya, teklif degistirmeye, otopilotu
 * calistirmaya devam ediyordu; gunluk cron'lar da plana bakmiyordu. Simdi:
 *   - KAPALI (plan ister): Apple'a yazan ya da Apple'dan canli okuyan her uc —
 *     connect, sync, kampanya olusturma, teklif, otopilotu ACMA, otopilot
 *     calistirma, Apple Ads icgoru uclari (search-term-popularity,
 *     impression-share: musterinin kimligiyle canli Apple istegi).
 *   - ACIK: DB'de zaten duran verinin okunmasi (hesaplar, kampanyalar,
 *     performans gecmisi, kural tabanli oneri), baglantiyi kesme ve otopilotu
 *     KAPATMA. Plani dusen kullanici gecmis harcamasini gorebilmeli ve
 *     reklam hesabina dokunan otomasyonu kendisi durdurabilmeli.
 * Cron tarafi: asa.cron.ts + asa.service runAllAutoPilots (sahip plani).
 */
@Controller()
export class AsaController {
  constructor(
    private readonly asa: AsaService,
    private readonly quota: QuotaService,
  ) {}

  // ─── Account management ──────────────────────────────

  /**
   * POST /api/sites/:siteId/aso/asa/connect — Apple Search Ads API key bağla
   *
   * Fiyat karti ASA'yi Profesyonel'e veriyor. Listeleme/silme acik kalir ki
   * plani dusen kullanici mevcut hesabini gorup baglantisini kesebilsin.
   */
  @SessionOnly()
  @RequiresPlan('asaEnabled')
  @Post('sites/:siteId/aso/asa/connect')
  async connect(
    @Req() req: Request,
    @Param('siteId') siteId: string,
    @Body() body: ConnectAsaDto,
  ) {
    const user = ensureUser(req);
    return this.asa.connectAccount({ ...body, siteId }, user);
  }

  /** GET /api/sites/:siteId/aso/asa/accounts */
  @Get('sites/:siteId/aso/asa/accounts')
  listAccounts(@Req() req: Request, @Param('siteId') siteId: string) {
    return this.asa.listAccounts(siteId, ensureUser(req));
  }

  /** DELETE /api/aso/asa/accounts/:accountId */
  @SessionOnly()
  @Delete('aso/asa/accounts/:accountId')
  disconnect(@Req() req: Request, @Param('accountId') accountId: string) {
    return this.asa.disconnectAccount(accountId, ensureUser(req));
  }

  // ─── Campaigns ───────────────────────────────────────

  /** POST /api/aso/asa/accounts/:accountId/sync — Apple'dan kampanyaları sync et */
  @RequiresPlan('asaEnabled')
  @Post('aso/asa/accounts/:accountId/sync')
  syncCampaigns(@Req() req: Request, @Param('accountId') accountId: string) {
    return this.asa.syncCampaigns(accountId, ensureUser(req));
  }

  /** GET /api/sites/:siteId/aso/asa/campaigns */
  @Get('sites/:siteId/aso/asa/campaigns')
  listCampaigns(@Req() req: Request, @Param('siteId') siteId: string) {
    return this.asa.listCampaigns(siteId, ensureUser(req));
  }

  /** GET /api/sites/:siteId/aso/asa/suggest — kampanya önerisi */
  // @AiAction() YOK: oneri kural tabanli (anahtar kelime sirasi + trafik skoru,
  // asa.service suggestCampaign), LLM cagirmaz; salt okunur hesapta da acik okuma
  @Get('sites/:siteId/aso/asa/suggest')
  suggestCampaign(@Req() req: Request, @Param('siteId') siteId: string) {
    return this.asa.suggestCampaign(siteId, ensureUser(req));
  }

  /** POST /api/aso/asa/campaigns — yeni kampanya oluştur */
  @SessionOnly()
  @RequiresPlan('asaEnabled')
  @Post('aso/asa/campaigns')
  createCampaign(
    @Req() req: Request,
    @Body() body: CreateAsaCampaignDto,
  ) {
    return this.asa.createCampaign(body, ensureUser(req));
  }

  // ─── Keyword bid management ──────────────────────────

  /** PUT /api/aso/asa/keyword-bids/:id { bidUsd } */
  @SessionOnly()
  @RequiresPlan('asaEnabled')
  @Put('aso/asa/keyword-bids/:id')
  updateBid(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() body: UpdateAsaBidDto,
  ) {
    return this.asa.updateKeywordBid(id, body.bidUsd, ensureUser(req));
  }

  // ─── Performance ─────────────────────────────────────

  /** GET /api/sites/:siteId/aso/asa/performance?daysBack=30 */
  @Get('sites/:siteId/aso/asa/performance')
  performance(
    @Req() req: Request,
    @Param('siteId') siteId: string,
    @Query('daysBack') daysBack?: string,
  ) {
    return this.asa.getPerformanceSummary(siteId, ensureUser(req), parseInt(daysBack ?? '30', 10));
  }

  // ─── Insights (Apple Ads Platform API) ───────────────
  // Iki uc da Apple'in GORELI puanlarini doner ve her cevap
  // "göreli skor (Apple Ads)" etiketini tasir; arama hacmi olarak sunulmaz.
  // v5 modunda { available: false } doner.

  /** GET /api/sites/:siteId/aso/asa/search-term-popularity?terms=a,b&country=TR&genre=GAMES */
  @RequiresPlan('asaEnabled')
  @Get('sites/:siteId/aso/asa/search-term-popularity')
  searchTermPopularity(
    @Req() req: Request,
    @Param('siteId') siteId: string,
    @Query('terms') terms?: string,
    @Query('country') country?: string,
    @Query('genre') genre?: string,
  ) {
    return this.asa.getSearchTermPopularity(siteId, ensureUser(req), {
      terms: terms ? terms.split(',') : undefined,
      country,
      genre,
    });
  }

  /** GET /api/sites/:siteId/aso/asa/impression-share?days=7&country=TR */
  @RequiresPlan('asaEnabled')
  @Get('sites/:siteId/aso/asa/impression-share')
  impressionShare(
    @Req() req: Request,
    @Param('siteId') siteId: string,
    @Query('days') days?: string,
    @Query('country') country?: string,
  ) {
    return this.asa.getImpressionShare(siteId, ensureUser(req), {
      days: days ? parseInt(days, 10) : undefined,
      country,
    });
  }

  // ─── Auto-Pilot (Seviye 2) ──────────────────────────

  /**
   * PUT /api/aso/asa/accounts/:accountId/autopilot — toggle + budget cap
   *
   * Kapi yalniz ACMADA (enabled:true): plani dusen kullanici otopilotu
   * kapatabilmeli. Dekorator yerine govdede cunku karar istek govdesine bagli;
   * ADMIN muafiyeti PlanFeatureGuard ile ayni.
   */
  @SessionOnly()
  @Put('aso/asa/accounts/:accountId/autopilot')
  setAutoPilot(
    @Req() req: Request,
    @Param('accountId') accountId: string,
    @Body() body: SetAsaAutoPilotDto,
  ) {
    const user = ensureUser(req);
    if (body?.enabled === true && user.role !== 'ADMIN') {
      this.quota.assertPlanFeature(user.plan ?? '', 'asaEnabled');
    }
    return this.asa.setAutoPilot(accountId, body, user);
  }

  /** POST /api/aso/asa/accounts/:accountId/autopilot/run — manuel tetik */
  @SessionOnly()
  @RequiresPlan('asaEnabled')
  @Post('aso/asa/accounts/:accountId/autopilot/run')
  runAutoPilotNow(@Req() req: Request, @Param('accountId') accountId: string) {
    return this.asa.runAutoPilot(accountId, ensureUser(req));
  }
}
