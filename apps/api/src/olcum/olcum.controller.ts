import { Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { SITE_USER_THROTTLE, SiteUserThrottlerGuard } from '../audit/site-user-throttler.guard.js';
import { OlcumService } from './olcum.service.js';

/** Tarama dis sitelere istek atar: kullanici + site basina saatte 6 baslatma (servis ayrica 10 dk bekletir) */
const OLCUM_THROTTLE = { limit: 6, ttl: 60 * 60_000 };

/**
 * /sites/:siteId/olcum — olcum altyapisi (analitik, reklam pikselleri, donusum olaylari) site + rakipler.
 * Sahiplik global SiteAccessGuard'da (:siteId parametresi).
 */
@Controller('sites/:siteId/olcum')
export class OlcumController {
  constructor(private readonly svc: OlcumService) {}

  /** GET /sites/:siteId/olcum — son tarama (yoksa null) */
  @Get()
  son(@Param('siteId') siteId: string) {
    return this.svc.son(siteId);
  }

  /** POST /sites/:siteId/olcum/tara — arka planda baslatir, hemen doner; panel GET ile izler */
  @UseGuards(SiteUserThrottlerGuard)
  @Throttle({ [SITE_USER_THROTTLE]: OLCUM_THROTTLE })
  @Post('tara')
  tara(@Param('siteId') siteId: string) {
    return this.svc.baslat(siteId);
  }
}
