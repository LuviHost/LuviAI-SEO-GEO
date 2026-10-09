import { Body, Controller, Get, Param, Post, Req, UnauthorizedException } from '@nestjs/common';
import type { Request } from 'express';
import { RequiresPlan } from '../../billing/plan-feature.decorator.js';
import { SessionOnly } from '../../auth/session-only.decorator.js';
import { AscMetadataService } from './asc-metadata.service.js';
import type { RequestingUser } from './asc.service.js';

interface AuthedRequest extends Request { user?: RequestingUser }
function ensureUser(req: AuthedRequest) {
  if (!req.user) throw new UnauthorizedException('Auth gerekli');
  return req.user;
}

/**
 * App Store Connect metadata — cek / plan / uygula / gecmis / geri al.
 * Musterinin canli App Store kaydina yazar: hepsi @SessionOnly (API anahtari
 * 403), eylemler @RequiresPlan('ascEnabled'); sahiplik servis + SiteAccessGuard.
 * Incelemeye gonderme YOK.
 */
@Controller('sites/:siteId/aso/asc/apps/:ascAppId/metadata')
@SessionOnly()
export class AscMetadataController {
  constructor(private readonly meta: AscMetadataService) {}

  @Get()
  @RequiresPlan('ascEnabled')
  pull(@Req() req: AuthedRequest, @Param('siteId') siteId: string, @Param('ascAppId') ascAppId: string) {
    return this.meta.pull(siteId, ascAppId, ensureUser(req));
  }

  @Post('plan')
  @RequiresPlan('ascEnabled')
  plan(
    @Req() req: AuthedRequest,
    @Param('siteId') siteId: string,
    @Param('ascAppId') ascAppId: string,
    @Body() body: { locale?: unknown; fields?: Record<string, unknown> },
  ) {
    return this.meta.plan(siteId, ascAppId, ensureUser(req), body ?? {});
  }

  @Post('apply')
  @RequiresPlan('ascEnabled')
  apply(
    @Req() req: AuthedRequest,
    @Param('siteId') siteId: string,
    @Param('ascAppId') ascAppId: string,
    @Body() body: { planId?: unknown; confirm?: unknown },
  ) {
    return this.meta.apply(siteId, ascAppId, ensureUser(req), body ?? {});
  }

  /** Listeleme acik kalir (plani dusen kullanici gecmisini gorebilmeli) */
  @Get('history')
  history(@Req() req: AuthedRequest, @Param('siteId') siteId: string, @Param('ascAppId') ascAppId: string) {
    return this.meta.history(siteId, ascAppId, ensureUser(req));
  }

  @Post('revert/:fixId')
  @RequiresPlan('ascEnabled')
  revert(
    @Req() req: AuthedRequest,
    @Param('siteId') siteId: string,
    @Param('ascAppId') ascAppId: string,
    @Param('fixId') fixId: string,
  ) {
    return this.meta.planRevert(siteId, ascAppId, ensureUser(req), fixId);
  }
}
