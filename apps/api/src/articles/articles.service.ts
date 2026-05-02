import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { JobQueueService } from '../jobs/job-queue.service.js';
import { QuotaService } from '../billing/quota.service.js';
import { PipelineService } from './pipeline.service.js';

@Injectable()
export class ArticlesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jobQueue: JobQueueService,
    private readonly quota: QuotaService,
    private readonly pipeline: PipelineService,
  ) {}

  list(siteId: string, status?: string) {
    return this.prisma.article.findMany({
      where: { siteId, ...(status ? { status: status as any } : {}) },
      orderBy: { createdAt: 'desc' },
    });
  }

  findOne(id: string, siteId?: string) {
    return this.prisma.article.findFirst({
      where: { id, ...(siteId ? { siteId } : {}) },
    });
  }

  async queueGeneration(siteId: string, topic: string, targetIds?: string[]) {
    const site = await this.prisma.site.findUniqueOrThrow({ where: { id: siteId } });

    // Quota check (yetersizse 403 fırlatır)
    await this.quota.enforceArticleQuota(site.userId);

    // Placeholder Article (GENERATING) — pipeline tamamlandiginda bu kayit doldurulur.
    // Boylece "Uret" tiklanir tiklanmaz makale "Hazirlaniyor" rozetiyle listede gorunur.
    const placeholderSlug = `generating-${Date.now().toString(36)}`;
    const article = await this.prisma.article.create({
      data: {
        siteId,
        topic,
        slug: placeholderSlug,
        title: topic,
        status: 'GENERATING' as any,
        language: site.language ?? 'tr',
      },
    });

    const job = await this.jobQueue.enqueue({
      type: 'GENERATE_ARTICLE',
      userId: site.userId,
      siteId,
      payload: { siteId, topic, articleId: article.id, targetIds, autoPublish: !!targetIds?.length },
    });

    // Quota'yı artır (job kuyruğa girdi sayılır)
    await this.quota.incrementArticleUsage(site.userId);

    return { ...job, articleId: article.id };
  }

  /**
   * Senkron pipeline (run-now) — quota guard'li wrapper.
   * Onboarding/dashboard "Üret" akışı buraya düşer.
   */
  async runPipelineNow(args: { siteId: string; topic: string; skipImages?: boolean; maxRevize?: number }) {
    const site = await this.prisma.site.findUniqueOrThrow({ where: { id: args.siteId } });

    // 1) Quota guard — yetersizse 403
    await this.quota.enforceArticleQuota(site.userId);

    // 2) Pipeline çalıştır
    const result = await this.pipeline.runPipeline({
      siteId: args.siteId,
      topic: args.topic,
      skipImages: args.skipImages ?? true,
      maxRevize: args.maxRevize ?? 1,
    });

    // 3) Başarılı tamamlandıysa sayacı artır
    await this.quota.incrementArticleUsage(site.userId);

    return result;
  }

  /**
   * Mevcut bir SCHEDULED article'ı (veya boş gövdeli herhangi bir article'ı)
   * şimdi üretime al. Cron'u beklemeden manuel tetikler.
   */
  async triggerNow(siteId: string, articleId: string) {
    const article = await this.prisma.article.findFirst({
      where: { id: articleId, siteId },
      include: { site: { include: { user: { select: { id: true } }, publishTargets: { where: { isActive: true, isDefault: true }, select: { id: true } } } } },
    });
    if (!article) throw new NotFoundException('Makale bulunamadi');

    // Quota guard
    await this.quota.enforceArticleQuota(article.site.user.id);

    // Status'u GENERATING'e çek
    await this.prisma.article.update({
      where: { id: article.id },
      data: { status: 'GENERATING' as any },
    });

    const defaultTargetIds = (article.site as any).publishTargets?.map((t: any) => t.id) ?? [];

    const job = await this.jobQueue.enqueue({
      type: 'GENERATE_ARTICLE',
      userId: article.site.user.id,
      siteId,
      payload: {
        siteId,
        topic: article.topic,
        articleId: article.id,
        skipImages: false,
        autoPublish: defaultTargetIds.length > 0,
        targetIds: defaultTargetIds,
      },
    });

    await this.quota.incrementArticleUsage(article.site.user.id);

    return { ...job, articleId: article.id };
  }

  async queuePublish(siteId: string, articleId: string, targetIds: string[]) {
    const article = await this.prisma.article.findFirst({
      where: { id: articleId, siteId },
      include: { site: true },
    });
    if (!article) {
      throw new NotFoundException('Makale bulunamadi');
    }
    return this.jobQueue.enqueue({
      type: 'PUBLISH_ARTICLE',
      userId: article.site.userId,
      siteId: article.siteId,
      payload: { articleId, targetIds },
    });
  }


  /**
   * Article'in social pre-plan listesini set eder. Article PUBLISHED olunca
   * SocialAutoDraftService bu liste'yi kullanir.
   */
  async setSocialPrePlan(siteId: string, articleId: string, channelIds: string[] | null) {
    const article = await this.prisma.article.findFirst({
      where: { id: articleId, siteId },
      select: { id: true },
    });
    if (!article) throw new Error('Article bulunamadi');
    return this.prisma.article.update({
      where: { id: articleId },
      data: { socialPrePlanChannelIds: (channelIds ?? null) as any },
      select: { id: true, socialPrePlanChannelIds: true },
    });
  }
}
