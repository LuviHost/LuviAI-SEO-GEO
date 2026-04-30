import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { JobQueueService } from '../jobs/job-queue.service.js';
import { listVideoProviders } from './providers/registry.js';
import type { CreateVideoDto } from './videos.dto.js';

@Injectable()
export class VideosService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jobs: JobQueueService,
  ) {}

  /** UI'ın gösterdiği provider listesi (info + ready durumu). */
  listProviders() {
    return listVideoProviders();
  }

  /** Yeni video oluştur — DB'ye kaydet, BullMQ'ya VIDEO_GENERATE işi at. */
  async create(siteId: string, userId: string, dto: CreateVideoDto) {
    const site = await this.prisma.site.findUnique({ where: { id: siteId } });
    if (!site) throw new NotFoundException('Site bulunamadi');
    if (site.userId !== userId) throw new ForbiddenException();

    const video = await this.prisma.video.create({
      data: {
        siteId,
        articleId: dto.articleId ?? null,
        title: dto.title,
        scriptText: dto.scriptText,
        provider: dto.provider as any,
        durationSec: dto.durationSec ?? 30,
        aspectRatio: dto.aspectRatio ?? '9:16',
        voiceId: dto.voiceId,
        language: dto.language ?? 'tr',
        status: 'PENDING' as any,
      },
    });

    await this.jobs.enqueue({
      type: 'VIDEO_GENERATE',
      userId,
      siteId,
      payload: {
        videoId: video.id,
        provider: dto.provider,
        brief: {
          title: dto.title,
          scriptText: dto.scriptText,
          durationSec: dto.durationSec ?? 30,
          aspectRatio: dto.aspectRatio ?? '9:16',
          voiceId: dto.voiceId,
          language: dto.language ?? 'tr',
          style: dto.style,
          imageUrls: dto.imageUrls,
        },
      },
      priority: 5,
    });

    return video;
  }

  async listForSite(siteId: string, userId: string) {
    const site = await this.prisma.site.findUnique({ where: { id: siteId } });
    if (!site) throw new NotFoundException();
    if (site.userId !== userId) throw new ForbiddenException();
    return this.prisma.video.findMany({
      where: { siteId },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
  }

  async getOne(id: string, userId: string) {
    const video = await this.prisma.video.findUnique({
      where: { id },
      include: { site: true },
    });
    if (!video) throw new NotFoundException();
    if (video.site.userId !== userId) throw new ForbiddenException();
    return video;
  }

  async deleteOne(id: string, userId: string) {
    const video = await this.getOne(id, userId);
    await this.prisma.video.delete({ where: { id: video.id } });
    return { id: video.id };
  }
}
