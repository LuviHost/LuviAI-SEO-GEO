import { Body, Controller, Delete, ForbiddenException, Get, Param, Patch, Post, Put, Req, UnauthorizedException } from '@nestjs/common';
import type { Request } from 'express';
import { SitesService } from './sites.service.js';
import { CreateSiteDto, UpdateSiteDto } from './sites.dto.js';
import { GscOAuthService } from '../auth/gsc-oauth.service.js';
import { GaOAuthService } from '../auth/ga-oauth.service.js';

function ensureUser(req: Request) {
  const user = (req as any).user;
  if (!user) throw new UnauthorizedException();
  return user as { id: string; role: 'USER' | 'ADMIN' | 'AGENCY_OWNER' };
}

@Controller('sites')
export class SitesController {
  constructor(
    private readonly sites: SitesService,
    private readonly gsc: GscOAuthService,
    private readonly ga: GaOAuthService,
  ) {}

  @Post()
  create(@Req() req: Request, @Body() dto: CreateSiteDto) {
    const user = ensureUser(req);
    return this.sites.create(user.id, dto);
  }

  @Get()
  list(@Req() req: Request) {
    const user = ensureUser(req);
    return this.sites.list(user);
  }

  @Get(':id')
  get(@Req() req: Request, @Param('id') id: string) {
    return this.sites.findOne(id, ensureUser(req));
  }

  @Patch(':id')
  update(@Req() req: Request, @Param('id') id: string, @Body() dto: UpdateSiteDto) {
    return this.sites.update(id, dto, ensureUser(req));
  }

  @Delete(':id')
  remove(@Req() req: Request, @Param('id') id: string) {
    return this.sites.remove(id, ensureUser(req));
  }

  /** POST /sites/:id/brain/regenerate */
  @Post(':id/brain/regenerate')
  regenerateBrain(@Req() req: Request, @Param('id') id: string) {
    return this.sites.regenerateBrain(id, ensureUser(req));
  }

  /** GET /sites/:id/competitors — brain'deki rakip listesi */
  @Get(':id/competitors')
  listCompetitors(@Req() req: Request, @Param('id') id: string) {
    return this.sites.listCompetitors(id, ensureUser(req));
  }

  /** PUT /sites/:id/competitors — tüm rakip listesini değiştir */
  @Put(':id/competitors')
  setCompetitors(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() body: { competitors: Array<{ name: string; url: string; strengths?: string[]; weaknesses?: string[] }> },
  ) {
    return this.sites.setCompetitors(id, body.competitors ?? [], ensureUser(req));
  }

  /** GET /sites/:id/gsc/properties — kullanicinin erisilebilir GSC property'leri */
  @Get(':id/gsc/properties')
  async listGscProperties(@Req() req: Request, @Param('id') id: string) {
    await this.sites.findOne(id, ensureUser(req));
    return this.gsc.listProperties(id);
  }

  /** PATCH /sites/:id/gsc/property body { propertyUrl } */
  @Patch(':id/gsc/property')
  async setGscProperty(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() body: { propertyUrl: string },
  ) {
    await this.sites.findOne(id, ensureUser(req));
    return this.gsc.setProperty(id, body.propertyUrl);
  }

  /** GET /sites/:id/ga/properties — kullanicinin erisilebilir GA4 property'leri */
  @Get(':id/ga/properties')
  async listGaProperties(@Req() req: Request, @Param('id') id: string) {
    await this.sites.findOne(id, ensureUser(req));
    return this.ga.listProperties(id);
  }

  /** PATCH /sites/:id/ga/property body { propertyId } */
  @Patch(':id/ga/property')
  async setGaProperty(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() body: { propertyId: string },
  ) {
    await this.sites.findOne(id, ensureUser(req));
    return this.ga.setProperty(id, body.propertyId);
  }
}
