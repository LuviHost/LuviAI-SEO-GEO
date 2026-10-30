import { Body, Controller, Delete, Get, Param, Post, Req, UnauthorizedException } from '@nestjs/common';
import type { Request } from 'express';
import { AscService } from './asc.service.js';
import { QuotaService } from '../../billing/quota.service.js';
import { RequiresPlan } from '../../billing/plan-feature.decorator.js';
import { SessionOnly } from '../../auth/session-only.decorator.js';
import { AscReviewReplyService } from './asc-review-reply.service.js';
import { ConnectAscDto, DraftReplyDto, ReplyReviewDto } from './asc.dto.js';

interface AuthedRequest extends Request { user?: { id: string; role: 'USER' | 'ADMIN' | 'AGENCY_OWNER' } }
function ensureUser(req: AuthedRequest) {
  if (!req.user) throw new UnauthorizedException('Auth gerekli');
  return req.user;
}

/**
 * PLAN KAPISI (ascEnabled) — plan dusunce de tutar, yalniz baglarken degil.
 * App Store Connect'e canli istek atan her uc kapali: connect, uygulama ve
 * surum senkronu, yorumlar (Apple'dan canli okunur), yanit taslagi ve yanit.
 * Acik kalanlar DB'deki veriyi okur ya da yalniz yerel kaydi degistirir:
 * hesap listesi, baglantiyi kesme, kayitli surum uyarilarinin listesi ve
 * "goruldu" isareti. Uyarilari ureten gunluk senkron da artik sahip planina
 * bakar (asc.service runDailySyncAll), yani plani dusen hesapta yeni uyari
 * olusmaz; eskiler okunup kapatilabilir.
 */
@Controller()
export class AscController {
  constructor(
    private readonly asc: AscService,
    private readonly quota: QuotaService,
    private readonly replies: AscReviewReplyService,
  ) {}

  /**
   * Yalniz panel oturumu: sitenin App Store Connect ozel anahtarini (.p8)
   * degistirir. /aso scope haritasinda yok; isaretsizken herhangi bir ':write'
   * anahtari (or. yalniz 'social:write') kayitli anahtari ezebiliyordu.
   */
  @SessionOnly()
  @RequiresPlan('ascEnabled')
  @Post('sites/:siteId/aso/asc/connect')
  async connect(
    @Req() req: AuthedRequest,
    @Param('siteId') siteId: string,
    @Body() body: ConnectAscDto,
  ) {
    const user = ensureUser(req);
    return this.asc.connectAccount({ ...body, siteId }, user);
  }

  @Get('sites/:siteId/aso/asc/accounts')
  listAccounts(@Req() req: AuthedRequest, @Param('siteId') siteId: string) {
    return this.asc.listAccounts(siteId, ensureUser(req));
  }

  /** Yalniz panel oturumu: baglantiyi siler, AscApp/AscRelease/alarmlar da cascade ile gider */
  @SessionOnly()
  @Delete('aso/asc/accounts/:accountId')
  disconnect(@Req() req: AuthedRequest, @Param('accountId') accountId: string) {
    return this.asc.disconnectAccount(accountId, ensureUser(req));
  }

  // Bu uclarda :siteId yok → SiteAccessGuard devreye girmez; sahiplik
  // servis tarafinda user uzerinden dogrulanir. user'i GECIRMEYI UNUTMA.
  @RequiresPlan('ascEnabled')
  @Post('aso/asc/accounts/:accountId/sync')
  syncApps(@Req() req: AuthedRequest, @Param('accountId') accountId: string) {
    return this.asc.syncApps(accountId, ensureUser(req));
  }

  @RequiresPlan('ascEnabled')
  @Post('aso/asc/apps/:appId/sync-releases')
  syncReleases(@Req() req: AuthedRequest, @Param('appId') appId: string) {
    return this.asc.syncReleases(appId, ensureUser(req));
  }

  // Kayitli veri degil: her cagri App Store Connect'e canli istek atar
  @RequiresPlan('ascEnabled')
  @Get('aso/asc/apps/:appId/reviews')
  reviews(@Req() req: AuthedRequest, @Param('appId') appId: string) {
    return this.asc.fetchReviews(appId, ensureUser(req));
  }

  /** Taslak — gonderme yok; insan duzenler. LLM maliyeti → plan + butce kapisi */
  @Post('aso/asc/apps/:appId/reviews/:reviewId/draft')
  @SessionOnly()
  @RequiresPlan('ascEnabled')
  draftReply(
    @Req() req: AuthedRequest,
    @Param('appId') appId: string,
    @Param('reviewId') reviewId: string,
    @Body() body: DraftReplyDto,
  ) {
    return this.replies.draft(appId, reviewId, ensureUser(req), body ?? {});
  }

  /** Herkese acik yanit (varsa ustune yazar) — yalniz panel oturumuyla */
  @Post('aso/asc/apps/:appId/reviews/:reviewId/reply')
  @SessionOnly()
  @RequiresPlan('ascEnabled')
  replyReview(
    @Req() req: AuthedRequest,
    @Param('appId') appId: string,
    @Param('reviewId') reviewId: string,
    @Body() body: ReplyReviewDto,
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
