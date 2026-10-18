import { Body, Controller, Delete, Get, Param, Post, Req, UnauthorizedException } from '@nestjs/common';
import type { Request } from 'express';
import { ApiKeysService } from './api-keys.service.js';
import { QuotaService } from '../billing/quota.service.js';
import { SessionOnly } from '../auth/session-only.decorator.js';
import { CreateApiKeyDto } from './api-keys.dto.js';

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

  // Anahtar uretme/iptal yalniz panel oturumuyla. NEDEN: /api-keys scope
  // haritasinda yok; bilinmeyen kaynakta HERHANGI bir ':write' anahtari
  // mutasyon yapabiliyor (auth.guard). Dar yetkili (or. 'social:write') ya da
  // suresi dolmak uzere olan bir anahtar, tum scope'lari tasiyan SURESIZ yeni
  // bir anahtar uretip yetkisini kalici olarak buyutebiliyordu; ayni anahtar
  // kullanicinin diger anahtarlarini da iptal edebiliyordu.
  @SessionOnly()
  @Post()
  async create(@Req() req: Request, @Body() body: CreateApiKeyDto) {
    const userId = ensureUser(req).id;
    await this.quota.enforcePlanFeature(userId, 'apiAccess');
    // Alanlar tek tek — govde servise yayilmaz
    return this.keys.create(userId, {
      name: body.name,
      scopes: body.scopes,
      expiresInDays: body.expiresInDays,
      rateLimit: body.rateLimit,
    });
  }

  @SessionOnly()
  @Delete(':id')
  revoke(@Req() req: Request, @Param('id') id: string) {
    return this.keys.revoke(ensureUser(req).id, id);
  }
}
