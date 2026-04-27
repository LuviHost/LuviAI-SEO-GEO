import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { JobQueueService } from '../jobs/job-queue.service.js';
import { CreateSiteDto, UpdateSiteDto } from './sites.dto.js';

@Injectable()
export class SitesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jobQueue: JobQueueService,
  ) {}

  async create(dto: CreateSiteDto) {
    const site = await this.prisma.site.create({ data: dto });
    // Wow-moment: brain → audit → topics → 1.makale tek job
    await this.jobQueue.enqueue({
      type: 'ONBOARDING_CHAIN',
      userId: site.userId,
      siteId: site.id,
      payload: { siteId: site.id },
      priority: 10, // yüksek öncelik
    });
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

  async regenerateBrain(siteId: string) {
    const site = await this.prisma.site.findUniqueOrThrow({ where: { id: siteId } });
    return this.jobQueue.enqueue({
      type: 'BRAIN_GENERATE',
      userId: site.userId,
      siteId,
      payload: { siteId, forceRegenerate: true },
    });
  }
}
