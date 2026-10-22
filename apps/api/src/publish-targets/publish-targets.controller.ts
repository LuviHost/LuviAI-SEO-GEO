import { Body, Controller, Delete, Get, Param, Post, Put, Req, UnauthorizedException } from '@nestjs/common';
import type { Request } from 'express';
import { SessionOnly } from '../auth/session-only.decorator.js';
import { PublishTargetsService } from './publish-targets.service.js';
import { CreatePublishTargetDto, UpdatePublishTargetDto } from './publish-targets.dto.js';

function ensureUser(req: Request) {
  const user = (req as any).user;
  if (!user) throw new UnauthorizedException();
  return user as { id: string; role: 'USER' | 'ADMIN' | 'AGENCY_OWNER' };
}

@Controller()
export class PublishTargetsController {
  constructor(private readonly service: PublishTargetsService) {}

  /**
   * GET /api/publish-targets/catalog — desteklenen hedef tipleri (form alanları ile).
   * Auth required: session/user role'üne göre admin-only hedefler (KOBIPRATIK) filtrelenir.
   */
  @Get('publish-targets/catalog')
  catalog(@Req() req: Request) {
    const user = ensureUser(req);
    return PublishTargetsService.getTypeCatalog({ isAdmin: user.role === 'ADMIN' });
  }

  /**
   * GET /api/sites/:siteId/generation-readiness — bu sitede "Uret" icin kaynak sarti
   * saglaniyor mu (denemede en az bir aktif yayin hedefi; trial-policy.ts). Panel
   * dugmeyi buna gore kilitler; asil kapi QuotaService.consumeArticleAllowance.
   * Hak SITENIN SAHIBININ planina gore: yonetici baskasinin sitesine bakinca da sahibe gore.
   */
  @Get('sites/:siteId/generation-readiness')
  generationReadiness(@Req() req: Request, @Param('siteId') siteId: string) {
    return this.service.generationReadiness(siteId, ensureUser(req));
  }

  /** GET /api/sites/:siteId/publish-targets */
  @Get('sites/:siteId/publish-targets')
  list(@Req() req: Request, @Param('siteId') siteId: string) {
    return this.service.list(siteId, ensureUser(req));
  }

  // ─── Hedef olusturma/duzenleme/silme/test yalniz panel oturumuyla ───
  // 'publish-targets' api-keys.service ROUTE_RESOURCE eslesmesinde yok:
  // AuthGuard bilinmeyen kaynakta HERHANGI bir ':write' anahtarini yeterli
  // sayiyordu. Hedefe yazilan kimlik (FTP/WordPress/GitHub...) musterinin
  // makalelerinin nereye yayinlanacagini belirler; sizmis bir anahtarla
  // hedef degistirilirse icerik baskasina akar, test ucu da sunucudan disari
  // istek attirir. Anahtar 403 alir; liste ve katalog okunabilir.
  // SDK ve MCP bu uclari cagirmiyor (yayin articles:write ile ayri uctan).

  /** POST /api/sites/:siteId/publish-targets */
  @SessionOnly()
  @Post('sites/:siteId/publish-targets')
  create(
    @Req() req: Request,
    @Param('siteId') siteId: string,
    @Body() body: CreatePublishTargetDto,
  ) {
    // Alanlar tek tek — siteId yalniz yoldan
    return this.service.create(siteId, {
      type: body.type as any,
      name: body.name,
      credentials: body.credentials ?? {},
      config: body.config,
      isDefault: body.isDefault,
      isActive: body.isActive,
    }, ensureUser(req));
  }

  /** PUT /api/publish-targets/:id */
  @SessionOnly()
  @Put('publish-targets/:id')
  update(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() body: UpdatePublishTargetDto,
  ) {
    return this.service.update(id, {
      name: body.name,
      credentials: body.credentials,
      config: body.config,
      isDefault: body.isDefault,
      isActive: body.isActive,
    }, ensureUser(req));
  }

  /** DELETE /api/publish-targets/:id */
  @SessionOnly()
  @Delete('publish-targets/:id')
  remove(@Req() req: Request, @Param('id') id: string) {
    return this.service.remove(id, ensureUser(req));
  }

  /** POST /api/publish-targets/:id/test */
  @SessionOnly()
  @Post('publish-targets/:id/test')
  test(@Req() req: Request, @Param('id') id: string) {
    return this.service.testConnection(id, ensureUser(req));
  }
}
