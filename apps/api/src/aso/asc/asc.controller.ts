import { Body, Controller, Delete, Get, Param, Post, Req, UnauthorizedException } from '@nestjs/common';
import type { Request } from 'express';
import { AscService } from './asc.service.js';
import { QuotaService } from '../../billing/quota.service.js';

interface AuthedRequest extends Request { user?: { id: string; role: 'USER' | 'ADMIN' | 'AGENCY_OWNER' } }
function ensureUser(req: AuthedRequest) {
  if (!req.user) throw new UnauthorizedException('Auth gerekli');
  return req.user;
}

@Controller()
export class AscController {
  constructor(
    private readonly asc: AscService,
    private readonly quota: QuotaService,
  ) {}

  /** Plan kapisi yalnizca baglamada — bkz. AsaController.connect gerekcesi. */
  @Post('sites/:siteId/aso/asc/connect')
  async connect(
    @Req() req: AuthedRequest,
    @Param('siteId') siteId: string,
    @Body() body: { issuerId: string; keyId: string; privateKeyPem: string },
  ) {
    const user = ensureUser(req);
    await this.quota.enforcePlanFeature(user.id, 'ascEnabled');
    return this.asc.connectAccount({ siteId, ...body }, user);
  }

  @Get('sites/:siteId/aso/asc/accounts')
  listAccounts(@Req() req: AuthedRequest, @Param('siteId') siteId: string) {
    return this.asc.listAccounts(siteId, ensureUser(req));
  }

  @Delete('aso/asc/accounts/:accountId')
  disconnect(@Req() req: AuthedRequest, @Param('accountId') accountId: string) {
    return this.asc.disconnectAccount(accountId, ensureUser(req));
  }

  // Bu uclarda :siteId yok → SiteAccessGuard devreye girmez; sahiplik
  // servis tarafinda user uzerinden dogrulanir. user'i GECIRMEYI UNUTMA.
  @Post('aso/asc/accounts/:accountId/sync')
  syncApps(@Req() req: AuthedRequest, @Param('accountId') accountId: string) {
    return this.asc.syncApps(accountId, ensureUser(req));
  }

  @Post('aso/asc/apps/:appId/sync-releases')
  syncReleases(@Req() req: AuthedRequest, @Param('appId') appId: string) {
    return this.asc.syncReleases(appId, ensureUser(req));
  }

  @Get('aso/asc/apps/:appId/reviews')
  reviews(@Req() req: AuthedRequest, @Param('appId') appId: string) {
    return this.asc.fetchReviews(appId, ensureUser(req));
  }

  @Post('aso/asc/apps/:appId/reviews/:reviewId/reply')
  replyReview(
    @Req() req: AuthedRequest,
    @Param('appId') appId: string,
    @Param('reviewId') reviewId: string,
    @Body() body: { body: string },
  ) {
    return this.asc.replyToReview(appId, reviewId, body.body, ensureUser(req));
  }

  @Get('sites/:siteId/aso/asc/alerts')
  alerts(@Req() req: AuthedRequest, @Param('siteId') siteId: string) {
    return this.asc.listAlerts(siteId, ensureUser(req));
  }

  @Post('aso/asc/alerts/:alertId/acknowledge')
  ackAlert(@Req() req: AuthedRequest, @Param('alertId') alertId: string) {
    return this.asc.acknowledgeAlert(alertId, ensureUser(req));
  }
}
