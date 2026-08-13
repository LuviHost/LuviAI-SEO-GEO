import { Body, Controller, Delete, Get, Param, Post, Req, UnauthorizedException } from '@nestjs/common';
import type { Request } from 'express';
import { ApiKeysService } from './api-keys.service.js';
import { QuotaService } from '../billing/quota.service.js';

function ensureUser(req: Request) {
  const user = (req as any).user;
  if (!user) throw new UnauthorizedException();
  return user as { id: string };
}

@Controller('api-keys')
export class ApiKeysController {
  constructor(
    private readonly keys: ApiKeysService,
    private readonly quota: QuotaService,
  ) {}

  // Listeleme ve iptal plan kapisi ICERMEZ: plani dusen kullanici mevcut
  // anahtarlarini gorebilmeli ve iptal edebilmeli. Kapi yalnizca YENI anahtar
  // uretiminde — fiyat kartinda REST API Kurumsal'a ait.
  @Get()
  list(@Req() req: Request) {
    return this.keys.list(ensureUser(req).id);
  }

  @Post()
  async create(@Req() req: Request, @Body() body: { name: string; scopes?: string[]; expiresInDays?: number; rateLimit?: number }) {
    const userId = ensureUser(req).id;
    await this.quota.enforcePlanFeature(userId, 'apiAccess');
    return this.keys.create(userId, body);
  }

  @Delete(':id')
  revoke(@Req() req: Request, @Param('id') id: string) {
    return this.keys.revoke(ensureUser(req).id, id);
  }
}
