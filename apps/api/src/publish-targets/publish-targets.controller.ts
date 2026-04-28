import { Body, Controller, Delete, Get, Param, Post, Put, Req, UnauthorizedException } from '@nestjs/common';
import type { Request } from 'express';
import { Public } from '../auth/public.decorator.js';
import { PublishTargetsService } from './publish-targets.service.js';

function ensureUser(req: Request) {
  const user = (req as any).user;
  if (!user) throw new UnauthorizedException();
  return user as { id: string; role: 'USER' | 'ADMIN' | 'AGENCY_OWNER' };
}

@Controller()
export class PublishTargetsController {
  constructor(private readonly service: PublishTargetsService) {}

  /** GET /api/publish-targets/catalog — desteklenen 14 hedef tipi (form alanları ile) */
  @Public()
  @Get('publish-targets/catalog')
  catalog() {
    return PublishTargetsService.getTypeCatalog();
  }

  /** GET /api/sites/:siteId/publish-targets */
  @Get('sites/:siteId/publish-targets')
  list(@Req() req: Request, @Param('siteId') siteId: string) {
    return this.service.list(siteId, ensureUser(req));
  }

  /** POST /api/sites/:siteId/publish-targets */
  @Post('sites/:siteId/publish-targets')
  create(
    @Req() req: Request,
    @Param('siteId') siteId: string,
    @Body() body: {
      type: any;
      name: string;
      credentials: Record<string, unknown>;
      config?: Record<string, unknown>;
      isDefault?: boolean;
      isActive?: boolean;
    },
  ) {
    return this.service.create(siteId, body, ensureUser(req));
  }

  /** PUT /api/publish-targets/:id */
  @Put('publish-targets/:id')
  update(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() body: {
      name?: string;
      credentials?: Record<string, unknown>;
      config?: Record<string, unknown>;
      isDefault?: boolean;
      isActive?: boolean;
    },
  ) {
    return this.service.update(id, body, ensureUser(req));
  }

  /** DELETE /api/publish-targets/:id */
  @Delete('publish-targets/:id')
  remove(@Req() req: Request, @Param('id') id: string) {
    return this.service.remove(id, ensureUser(req));
  }

  /** POST /api/publish-targets/:id/test */
  @Post('publish-targets/:id/test')
  test(@Req() req: Request, @Param('id') id: string) {
    return this.service.testConnection(id, ensureUser(req));
  }
}
