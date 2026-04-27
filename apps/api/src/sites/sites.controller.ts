import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { SitesService } from './sites.service.js';
import { CreateSiteDto, UpdateSiteDto } from './sites.dto.js';

@Controller('sites')
export class SitesController {
  constructor(private readonly sites: SitesService) {}

  @Post()
  create(@Body() dto: CreateSiteDto) {
    return this.sites.create(dto);
  }

  @Get()
  list() {
    return this.sites.list();
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.sites.findOne(id);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateSiteDto) {
    return this.sites.update(id, dto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.sites.remove(id);
  }

  /** POST /sites/:id/brain/regenerate */
  @Post(':id/brain/regenerate')
  regenerateBrain(@Param('id') id: string) {
    return this.sites.regenerateBrain(id);
  }
}
