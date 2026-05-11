import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { buildSocialTextFor } from './social-text.js';
import { mediaDefaultFor } from './social-media-policy.js';

/**
 * Article PUBLISHED → her aktif sosyal kanal icin DRAFT SocialPost olustur.
 * Cron daha sonra plana uygun slot zamani gelince DRAFT'i QUEUED yapar.
 *
 * Bu service idempotent'tir: ayni article + channel kombinasyonu icin ikinci
 * kez cagrilirsa yeni post olusturmaz.
 */
@Injectable()
export class SocialAutoDraftService {
  private readonly log = new Logger(SocialAutoDraftService.name);

  constructor(private readonly prisma: PrismaService) {}

  async createDraftsForArticle(articleId: string): Promise<{ created: number; skipped: number }> {
    const article = await this.prisma.article.findUnique({
      where: { id: articleId },
      include: {
        site: {
          include: {
            socialChannels: { where: { isActive: true } },
            brain: true,
          },
        },
      },
    });

    if (!article) {
      this.log.warn(`Article ${articleId} bulunamadi, draft atlandi`);
      return { created: 0, skipped: 0 };
    }
    if (article.site.socialChannels.length === 0) {
      this.log.log(`[${article.siteId}] Hic aktif sosyal kanal yok, draft atlandi`);
      return { created: 0, skipped: 0 };
    }

    // Per-article pre-plan: kullanici belirli kanallar sectiyse sadece onlari kullan.
    // null/undefined => tum aktif kanallar (default). [] => hicbir kanal.
    const prePlan = (article as any).socialPrePlanChannelIds as string[] | null | undefined;
    let candidateChannels = article.site.socialChannels;
    if (Array.isArray(prePlan)) {
      if (prePlan.length === 0) {
        this.log.log(`[${article.siteId}] Article ${articleId} pre-plan = [] (hicbir kanal), draft atlandi`);
        return { created: 0, skipped: 0 };
      }
      const allow = new Set(prePlan);
      candidateChannels = article.site.socialChannels.filter((c) => allow.has(c.id));
      if (candidateChannels.length === 0) {
        this.log.log(`[${article.siteId}] Article ${articleId} pre-plan kanallari aktif degil, draft atlandi`);
        return { created: 0, skipped: 0 };
      }
    }

    let created = 0;
    let skipped = 0;

    for (const channel of candidateChannels) {
      // Idempotent: ayni article + channel kombinasyonu varsa yeni post acma
      const existing = await this.prisma.socialPost.findFirst({
        where: { channelId: channel.id, articleId: article.id },
      });
      if (existing) {
        skipped++;
        continue;
      }

      // Eger article PUBLISHED ise gercek external URL'i kullan
      const publishedUrls = (article.publishedTo as Array<{ externalUrl?: string }> | null) ?? [];
      const liveUrl = publishedUrls.find((p) => p?.externalUrl)?.externalUrl;

      // voice-aware + hook-aware metin uretimi
      const brain = (article.site as any).brain;
      const brandVoice = brain?.brandVoice ?? null;
      const hookVariations = (article as any).hookVariations ?? null;

      const { text, metadata } = buildSocialTextFor(channel.type, {
        title: article.title,
        metaDescription: article.metaDescription,
        slug: article.slug,
        siteUrl: liveUrl ?? article.site.url,
        siteName: article.site.name,
        pillar: article.pillar,
        fullUrl: !!liveUrl,
        brandVoice,
        hookVariations,
      });

      // Kanal tipine göre varsayılan medya formatı (TikTok/YouTube → video, IG → image, X → text, vb.)
      // Kullanıcı UI'dan değiştirebilir + generate-media endpoint'i ile üretir.
      const defaultMediaType = mediaDefaultFor(channel.type);
      const mergedMetadata = {
        ...(metadata as any),
        mediaType: defaultMediaType,
        mediaGenStatus: 'pending',
      };

      await this.prisma.socialPost.create({
        data: {
          channelId: channel.id,
          articleId: article.id,
          text,
          metadata: mergedMetadata as any,
          status: 'DRAFT',
        },
      });
      created++;
    }

    this.log.log(
      `[${article.siteId}] Auto-draft: ${created} olusturuldu, ${skipped} atlandi (zaten vardi)`,
    );
    return { created, skipped };
  }

  /**
   * Site için backfill: son `daysAgo` günde yayınlanmış makaleler için eksik draft'ları üretir.
   * Kanallar sonradan bağlandığında geçmiş makaleler için draft üretmek için.
   * Idempotent — zaten draft'ı olan article+channel kombinasyonu atlanır.
   */
  async backfillForSite(siteId: string, daysAgo = 30): Promise<{ articleCount: number; created: number; skipped: number }> {
    const since = new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000);
    const articles = await this.prisma.article.findMany({
      where: {
        siteId,
        status: 'PUBLISHED',
        publishedAt: { gte: since },
      },
      select: { id: true },
      orderBy: { publishedAt: 'desc' },
      take: 50,
    });

    let totalCreated = 0;
    let totalSkipped = 0;
    for (const a of articles) {
      const r = await this.createDraftsForArticle(a.id);
      totalCreated += r.created;
      totalSkipped += r.skipped;
    }
    this.log.log(`[${siteId}] Backfill: ${articles.length} makale tarandı, ${totalCreated} yeni draft, ${totalSkipped} atlandı`);
    return { articleCount: articles.length, created: totalCreated, skipped: totalSkipped };
  }
}
