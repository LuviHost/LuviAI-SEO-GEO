import { Body, Controller, Delete, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { RequiresPlan } from '../billing/plan-feature.decorator.js';
import { SiteUserThrottlerGuard, SITE_USER_THROTTLE } from '../audit/site-user-throttler.guard.js';
import { RequestVideoDto, VideoParamsDto } from './videos.dto.js';
import { VideosService } from './videos.service.js';

/**
 * RanksUp Video — sites/:siteId/videos
 *
 * Sahiplik: global SiteAccessGuard (:siteId). Plan: eylem uclari @RequiresPlan('articleVideo')
 * (Profesyonel ve ustu); duz listeleme / kota uclari acik — plani dusen kullanici eski
 * videolarini gorup indirebilmeli ve silebilmeli (plan-feature.decorator kurali).
 * Marka onizlemesi ve istek uclari dis istek yaptigi icin site + kullanici basina saatlik tavanli.
 */
@Controller('sites/:siteId/videos')
export class VideosController {
  constructor(private readonly videos: VideosService) {}

  /** GET — sitenin videolari (yeni -> eski, en fazla 100) */
  @Get()
  list(@Param('siteId') siteId: string) {
    return this.videos.list(siteId);
  }

  /** GET quota — sahibin bu ayki video hakki; allowed=false -> panel kilitli onizleme gosterir */
  @Get('quota')
  quota(@Param('siteId') siteId: string) {
    return this.videos.quotaFor(siteId);
  }

  /** GET brand — diyalog icin ad / renk / logo onizlemesi (model cagrisi yok) */
  @RequiresPlan('articleVideo')
  @UseGuards(SiteUserThrottlerGuard)
  @Throttle({ [SITE_USER_THROTTLE]: { limit: 30, ttl: 60 * 60_000 } })
  @Get('brand')
  brand(@Param('siteId') siteId: string) {
    return this.videos.brandPreview(siteId);
  }

  /** POST — yayindaki makaleden video iste: { articleId, primaryColor?, useLogo?, brandName? } */
  @RequiresPlan('articleVideo')
  @UseGuards(SiteUserThrottlerGuard)
  @Throttle({ [SITE_USER_THROTTLE]: { limit: 30, ttl: 60 * 60_000 } })
  @Post()
  request(@Param('siteId') siteId: string, @Body() body: RequestVideoDto, @Req() req: Request & { user?: { id: string; role?: string } }) {
    return this.videos.request(siteId, { id: req.user!.id, role: req.user?.role }, body);
  }

  @Get(':id')
  get(@Param() p: VideoParamsDto) {
    return this.videos.get(p.siteId, p.id);
  }

  /** DELETE — kuyruktaki video: is iptal + hak iadesi; hazir/basarisiz: dosyalar + kayit */
  @Delete(':id')
  remove(@Param() p: VideoParamsDto) {
    return this.videos.remove(p.siteId, p.id);
  }
}
