import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { BrainGeneratorService } from './brain-generator.service.js';
import { CreateSiteDto, UpdateSiteDto } from './sites.dto.js';

@Injectable()
export class SitesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly brainGen: BrainGeneratorService,
  ) {}

  async create(dto: CreateSiteDto) {
    const site = await this.prisma.site.create({ data: dto });
    // Onboarding tetikleyicisi: brain generation + audit + topic engine + ilk makale
    await this.brainGen.queueGeneration(site.id);
    return site;
  }

  list() {
    return this.prisma.site.findMany({ orderBy: { createdAt: 'desc' } });
  }

  async findOne(id: string) {
    const site = await this.prisma.site.findUnique({ where: { id }, include: { brain: true } });
    if (!site) throw new NotFoundException();
    return site;
  }

  update(id: string, dto: UpdateSiteDto) {
    return this.prisma.site.update({ where: { id }, data: dto });
  }

  remove(id: string) {
    return this.prisma.site.delete({ where: { id } });
  }

  regenerateBrain(siteId: string) {
    return this.brainGen.queueGeneration(siteId, { forceRegenerate: true });
  }
}
