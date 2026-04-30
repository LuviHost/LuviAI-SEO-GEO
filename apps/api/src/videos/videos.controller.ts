import { Body, Controller, Delete, Get, Param, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { VideosService } from './videos.service.js';
import { CreateVideoDto } from './videos.dto.js';

function ensureUserId(req: Request): string {
  const u = (req as any).user;
  if (!u?.id) throw new Error('User yok');
  return u.id;
}

@Controller()
export class VideosController {
  constructor(private readonly videos: VideosService) {}

  /** GET /api/videos/providers — provider listesi (info + ready) */
  @Get('videos/providers')
  listProviders() {
    return this.videos.listProviders();
  }

  /** GET /api/sites/:siteId/videos — site'a ait videolar */
  @Get('sites/:siteId/videos')
  listForSite(@Req() req: Request, @Param('siteId') siteId: string) {
    return this.videos.listForSite(siteId, ensureUserId(req));
  }

  /** POST /api/sites/:siteId/videos — yeni video üret */
  @Post('sites/:siteId/videos')
  create(@Req() req: Request, @Param('siteId') siteId: string, @Body() dto: CreateVideoDto) {
    return this.videos.create(siteId, ensureUserId(req), dto);
  }

  /** GET /api/videos/:id — tek video durumu */
  @Get('videos/:id')
  getOne(@Req() req: Request, @Param('id') id: string) {
    return this.videos.getOne(id, ensureUserId(req));
  }

  /** DELETE /api/videos/:id */
  @Delete('videos/:id')
  deleteOne(@Req() req: Request, @Param('id') id: string) {
    return this.videos.deleteOne(id, ensureUserId(req));
  }
}
