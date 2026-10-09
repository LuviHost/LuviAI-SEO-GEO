import { Body, Controller, Get, Param, Post, Query, Req, UnauthorizedException, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Request } from 'express';
import { RequiresPlan } from '../../billing/plan-feature.decorator.js';
import { SessionOnly } from '../../auth/session-only.decorator.js';
import { AscScreenshotsService, type UploadedImage } from './asc-screenshots.service.js';
import { MAX_FILE_BYTES } from './asc-screenshots.js';
import type { RequestingUser } from './asc.service.js';

interface AuthedRequest extends Request { user?: RequestingUser }
function ensureUser(req: AuthedRequest) {
  if (!req.user) throw new UnauthorizedException('Auth gerekli');
  return req.user;
}

/** Bellek deposu, tek dosya, 15 MB (multer siniri asilirsa 413) */
const singleImage = FileInterceptor('file', { limits: { fileSize: MAX_FILE_BYTES, files: 1 } });

/**
 * Ekran goruntusu → App Store Connect. Hepsi @SessionOnly ve plan kapili;
 * her istek TEK dosya (bkz. servis). Incelemeye gonderme yok.
 */
@Controller('sites/:siteId/aso/asc/apps/:ascAppId/screenshots')
@SessionOnly()
@RequiresPlan('ascEnabled')
export class AscScreenshotsController {
  constructor(private readonly shots: AscScreenshotsService) {}

  @Get()
  state(@Req() req: AuthedRequest, @Param('siteId') siteId: string, @Param('ascAppId') ascAppId: string, @Query('locale') locale?: string) {
    return this.shots.state(siteId, ascAppId, ensureUser(req), locale);
  }

  /** Kuru kontrol: boyut/bicim/alfa — Apple'a yazma yok */
  @Post('check')
  @UseInterceptors(singleImage)
  check(
    @Req() req: AuthedRequest,
    @Param('siteId') siteId: string,
    @Param('ascAppId') ascAppId: string,
    @UploadedFile() file: UploadedImage,
    @Body() body: { displayType?: string },
  ) {
    return this.shots.check(siteId, ascAppId, ensureUser(req), file, body?.displayType);
  }

  @Post('upload')
  @UseInterceptors(singleImage)
  upload(
    @Req() req: AuthedRequest,
    @Param('siteId') siteId: string,
    @Param('ascAppId') ascAppId: string,
    @UploadedFile() file: UploadedImage,
    @Body() body: { locale?: string; displayType?: string; confirm?: string },
  ) {
    return this.shots.upload(siteId, ascAppId, ensureUser(req), file, body ?? {});
  }

  /** Degistir modu: setteki tum goruntuleri sil (geri alinamaz, onay sart) */
  @Post('clear')
  clear(
    @Req() req: AuthedRequest,
    @Param('siteId') siteId: string,
    @Param('ascAppId') ascAppId: string,
    @Body() body: { locale?: string; displayType?: string; confirm?: boolean },
  ) {
    return this.shots.clear(siteId, ascAppId, ensureUser(req), body ?? {});
  }

  @Post(':screenshotId/delete')
  remove(
    @Req() req: AuthedRequest,
    @Param('siteId') siteId: string,
    @Param('ascAppId') ascAppId: string,
    @Param('screenshotId') screenshotId: string,
    @Body() body: { confirm?: boolean },
  ) {
    return this.shots.remove(siteId, ascAppId, ensureUser(req), screenshotId, body ?? {});
  }
}
