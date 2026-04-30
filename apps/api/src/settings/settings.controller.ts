import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  Param,
  Put,
  Query,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { SettingsService } from './settings.service.js';

function assertAdmin(req: Request) {
  const user = (req as any).user;
  if (!user) throw new ForbiddenException('Auth required');
  if (user.role !== 'ADMIN') throw new ForbiddenException('Admin only');
  return user;
}

@Controller('admin/settings')
export class SettingsController {
  constructor(private readonly settings: SettingsService) {}

  /** GET /admin/settings — tum runtime ayarlari (kategori grubuyla). */
  @Get()
  async list(@Req() req: Request, @Query('grouped') grouped?: string) {
    assertAdmin(req);
    if (grouped === '1' || grouped === 'true') {
      return this.settings.listByCategory();
    }
    return this.settings.listAll();
  }

  /** GET /admin/settings/audit — son degisikliklerin global akisi. */
  @Get('audit')
  async audits(@Req() req: Request, @Query('limit') limit?: string) {
    assertAdmin(req);
    const n = limit ? Math.min(500, Math.max(1, parseInt(limit, 10) || 100)) : 100;
    return this.settings.getRecentAudits(n);
  }

  /** GET /admin/settings/:key/audit — tek anahtarin gecmisi. */
  @Get(':key/audit')
  async keyAudit(@Req() req: Request, @Param('key') key: string) {
    assertAdmin(req);
    return this.settings.getAuditLog(key);
  }

  /** PUT /admin/settings/:key  body: { value } */
  @Put(':key')
  async update(
    @Req() req: Request,
    @Param('key') key: string,
    @Body() body: { value?: string | number | boolean },
  ) {
    const user = assertAdmin(req);
    if (body?.value === undefined || body?.value === null) {
      throw new BadRequestException('value alani zorunlu');
    }
    const ip = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() || req.ip;
    const ua = req.headers['user-agent'];
    return this.settings.set(key, String(body.value), user.id, {
      ipAddress: ip,
      userAgent: ua,
    });
  }
}
