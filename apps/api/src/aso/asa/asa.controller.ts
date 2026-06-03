import { Body, Controller, Delete, Get, Param, Post, Put, Query, Req, UnauthorizedException } from '@nestjs/common';
import type { Request } from 'express';
import { AsaService } from './asa.service.js';

function ensureUser(req: Request) {
  const user = (req as any).user;
  if (!user) throw new UnauthorizedException();
  return user as { id: string; role: 'USER' | 'ADMIN' | 'AGENCY_OWNER' };
}

@Controller()
export class AsaController {
  constructor(private readonly asa: AsaService) {}

  // ─── Account management ──────────────────────────────

  /** POST /api/sites/:siteId/aso/asa/connect — Apple Search Ads API key bağla */
  @Post('sites/:siteId/aso/asa/connect')
  connect(
    @Req() req: Request,
    @Param('siteId') siteId: string,
    @Body() body: { orgId: string; keyId: string; privateKeyPem: string; teamId?: string },
  ) {
    return this.asa.connectAccount({ siteId, ...body }, ensureUser(req));
  }

  /** GET /api/sites/:siteId/aso/asa/accounts */
  @Get('sites/:siteId/aso/asa/accounts')
  listAccounts(@Req() req: Request, @Param('siteId') siteId: string) {
    return this.asa.listAccounts(siteId, ensureUser(req));
  }

  /** DELETE /api/aso/asa/accounts/:accountId */
  @Delete('aso/asa/accounts/:accountId')
  disconnect(@Req() req: Request, @Param('accountId') accountId: string) {
    return this.asa.disconnectAccount(accountId, ensureUser(req));
  }

  // ─── Campaigns ───────────────────────────────────────

  /** POST /api/aso/asa/accounts/:accountId/sync — Apple'dan kampanyaları sync et */
  @Post('aso/asa/accounts/:accountId/sync')
  syncCampaigns(@Req() req: Request, @Param('accountId') accountId: string) {
    return this.asa.syncCampaigns(accountId, ensureUser(req));
  }

  /** GET /api/sites/:siteId/aso/asa/campaigns */
  @Get('sites/:siteId/aso/asa/campaigns')
  listCampaigns(@Req() req: Request, @Param('siteId') siteId: string) {
    return this.asa.listCampaigns(siteId, ensureUser(req));
  }

  /** GET /api/sites/:siteId/aso/asa/suggest — AI kampanya önerisi */
  @Get('sites/:siteId/aso/asa/suggest')
  suggestCampaign(@Req() req: Request, @Param('siteId') siteId: string) {
    return this.asa.suggestCampaign(siteId, ensureUser(req));
  }

  /** POST /api/aso/asa/campaigns — yeni kampanya oluştur */
  @Post('aso/asa/campaigns')
  createCampaign(
    @Req() req: Request,
    @Body() body: {
      accountId: string;
      name: string;
      dailyBudgetUsd: number;
      countries: string[];
      appleAppId: number;
      keywords?: Array<{ text: string; bidUsd: number; matchType?: 'EXACT' | 'BROAD' }>;
    },
  ) {
    return this.asa.createCampaign(body, ensureUser(req));
  }

  // ─── Keyword bid management ──────────────────────────

  /** PUT /api/aso/asa/keyword-bids/:id { bidUsd } */
  @Put('aso/asa/keyword-bids/:id')
  updateBid(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() body: { bidUsd: number },
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

  // ─── Auto-Pilot (Seviye 2) ──────────────────────────

  /** PUT /api/aso/asa/accounts/:accountId/autopilot — toggle + budget cap */
  @Put('aso/asa/accounts/:accountId/autopilot')
  setAutoPilot(
    @Req() req: Request,
    @Param('accountId') accountId: string,
    @Body() body: { enabled: boolean; budgetCapUsd?: number | null },
  ) {
    return this.asa.setAutoPilot(accountId, body, ensureUser(req));
  }

  /** POST /api/aso/asa/accounts/:accountId/autopilot/run — manuel tetik */
  @Post('aso/asa/accounts/:accountId/autopilot/run')
  runAutoPilotNow(@Req() req: Request, @Param('accountId') accountId: string) {
    return this.asa.runAutoPilot(accountId, ensureUser(req));
  }
}
