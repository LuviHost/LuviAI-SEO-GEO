import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { JobQueueService } from '../jobs/job-queue.service.js';
import { QuotaService } from '../billing/quota.service.js';

@Injectable()
export class ArticlesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jobQueue: JobQueueService,
    private readonly quota: QuotaService,
  ) {}

  list(siteId: string, status?: string) {
    return this.prisma.article.findMany({
      where: { siteId, ...(status ? { status: status as any } : {}) },
      orderBy: { createdAt: 'desc' },
    });
  }

  findOne(id: string) {
    return this.prisma.article.findUnique({ where: { id } });
  }

  async queueGeneration(siteId: string, topic: string, targetIds?: string[]) {
    const site = await this.prisma.site.findUniqueOrThrow({ where: { id: siteId } });

    // Quota check (yetersizse 403 fırlatır)
    await this.quota.enforceArticleQuota(site.userId);

    const job = await this.jobQueue.enqueue({
      type: 'GENERATE_ARTICLE',
      userId: site.userId,
      siteId,
      payload: { siteId, topic, targetIds, autoPublish: !!targetIds?.length },
    });

    // Quota'yı artır (job kuyruğa girdi sayılır)
    await this.quota.incrementArticleUsage(site.userId);

    return job;
  }

  async queuePublish(articleId: string, targetIds: string[]) {
    const article = await this.prisma.article.findUniqueOrThrow({
      where: { id: articleId },
      include: { site: true },
    });
    return this.jobQueue.enqueue({
      type: 'PUBLISH_ARTICLE',
      userId: article.site.userId,
      siteId: article.siteId,
      payload: { articleId, targetIds },
    });
  }
}
