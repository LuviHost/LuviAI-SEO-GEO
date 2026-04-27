import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';

@Injectable()
export class ArticlesService {
  constructor(private readonly prisma: PrismaService) {}

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
    return this.prisma.job.create({
      data: {
        userId: site.userId,
        siteId,
        type: 'GENERATE_ARTICLE',
        payload: { topic, targetIds },
      },
    });
  }

  async queuePublish(articleId: string, targetIds: string[]) {
    const article = await this.prisma.article.findUniqueOrThrow({
      where: { id: articleId },
      include: { site: true },
    });
    return this.prisma.job.create({
      data: {
        userId: article.site.userId,
        siteId: article.siteId,
        type: 'PUBLISH_ARTICLE',
        payload: { articleId, targetIds },
      },
    });
  }
}
