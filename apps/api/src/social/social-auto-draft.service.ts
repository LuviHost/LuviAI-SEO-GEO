import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { buildSocialTextFor } from './social-text.js';

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

    let created = 0;
    let skipped = 0;

    for (const channel of article.site.socialChannels) {
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

      const { text, metadata } = buildSocialTextFor(channel.type, {
        title: article.title,
        metaDescription: article.metaDescription,
        slug: article.slug,
        siteUrl: liveUrl ?? article.site.url,
        siteName: article.site.name,
        pillar: article.pillar,
        fullUrl: !!liveUrl,
      });

      await this.prisma.socialPost.create({
        data: {
          channelId: channel.id,
          articleId: article.id,
          text,
          metadata: metadata as any,
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
}
