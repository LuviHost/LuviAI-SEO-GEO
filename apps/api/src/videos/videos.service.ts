import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { JobQueueService } from '../jobs/job-queue.service.js';
import { QuotaService } from '../billing/quota.service.js';
import { listVideoProviders } from './providers/registry.js';
import type { CreateVideoDto } from './videos.dto.js';

@Injectable()
export class VideosService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jobs: JobQueueService,
    private readonly quota: QuotaService,
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

    // Video kotası kontrolü — SLIDESHOW (Stok + TTS) ücretsiz, diğerleri sayar
    const isFreeProvider = dto.provider === 'SLIDESHOW';
    if (!isFreeProvider) {
      await this.quota.enforceVideoQuota(userId);
      // AI cost budget kontrolü
      const budget = await this.quota.checkAiCostBudget(userId);
      if (budget.hardBlock) {
        throw new ForbiddenException(`Aylık AI bütçen doldu (${budget.pct}%). Plan yükselterek devam edebilirsin.`);
      }
    }

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

    // Video kotasını ve cost'unu say (sadece pahalı provider'lar için)
    if (!isFreeProvider) {
      await this.quota.incrementVideoUsage(userId).catch(() => { /* noop */ });
      // Approx cost: Sora ~$0.75, Veo ~$0.50, Runway ~$0.15, Heygen ~$0.40
      const approxCostUsd = dto.provider === 'SORA' ? 0.75 :
                            dto.provider === 'VEO' ? 0.50 :
                            dto.provider === 'RUNWAY' ? 0.15 :
                            dto.provider === 'HEYGEN' ? 0.40 : 0.20;
      await this.quota.addAiCost(userId, approxCostUsd).catch(() => { /* noop */ });
    }

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
