import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';

@Injectable()
export class TopicsService {
  constructor(private readonly prisma: PrismaService) {}

  getLatestQueue(siteId: string) {
    return this.prisma.topicQueue.findFirst({
      where: { siteId },
      orderBy: { generatedAt: 'desc' },
    });
  }

  async queueGeneration(siteId: string) {
    const site = await this.prisma.site.findUniqueOrThrow({ where: { id: siteId } });
    return this.prisma.job.create({
      data: { userId: site.userId, siteId, type: 'TOPIC_ENGINE', payload: {} },
    });
  }
}
