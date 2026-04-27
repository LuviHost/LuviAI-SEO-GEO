import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { decrypt, mdToHtml } from '@luviai/shared';
import { getAdapter } from '@luviai/adapters';

export interface PublishResult {
  targetId: string;
  targetType: string;
  ok: boolean;
  externalUrl?: string;
  externalId?: string;
  error?: string;
}

/**
 * Article publish — bir veya daha fazla publish target'a aynı makaleyi yayınla.
 * Adapter framework üzerinden çalışır (WordPress, FTP, SFTP, Markdown ZIP, ...)
 *
 * Worker'dan PUBLISH_ARTICLE job'unda çağrılır.
 */
@Injectable()
export class PublisherService {
  private readonly log = new Logger(PublisherService.name);

  constructor(private readonly prisma: PrismaService) {}

  async publishArticle(articleId: string, targetIds: string[]): Promise<PublishResult[]> {
    const article = await this.prisma.article.findUniqueOrThrow({
      where: { id: articleId },
      include: {
        site: {
          include: {
            publishTargets: {
              where: targetIds.length > 0 ? { id: { in: targetIds } } : { isDefault: true, isActive: true },
            },
          },
        },
      },
    });

    if (article.site.publishTargets.length === 0) {
      this.log.warn(`[${articleId}] Hiç publish target yok`);
      return [];
    }

    // Markdown → HTML
    const bodyHtml = article.bodyHtml ?? mdToHtml(article.bodyMd ?? '');

    const results: PublishResult[] = [];

    for (const target of article.site.publishTargets) {
      const Adapter = getAdapter(target.type) as any;
      if (!Adapter) {
        results.push({
          targetId: target.id,
          targetType: target.type,
          ok: false,
          error: `Adapter yok: ${target.type}`,
        });
        continue;
      }

      const credentials = this.decryptCredentials(target.credentials as Record<string, any>);
      const adapter = new Adapter(credentials, target.config ?? {});

      try {
        const result = await adapter.publish({
          slug: article.slug,
          title: article.title,
          bodyHtml,
          bodyMd: article.bodyMd ?? '',
          metaTitle: article.metaTitle ?? undefined,
          metaDescription: article.metaDescription ?? undefined,
          category: article.category ?? undefined,
          heroImageUrl: article.heroImageUrl ?? undefined,
        });

        // Last used timestamp güncelle
        await this.prisma.publishTarget.update({
          where: { id: target.id },
          data: { lastUsedAt: new Date() },
        });

        results.push({
          targetId: target.id,
          targetType: target.type,
          ok: result.ok,
          externalUrl: result.externalUrl,
          externalId: result.externalId,
          error: result.error,
        });

        this.log.log(`[${articleId}] ${target.type} → ${result.ok ? '✓' : '✗'} ${result.externalUrl ?? result.error ?? ''}`);
      } catch (err: any) {
        results.push({
          targetId: target.id,
          targetType: target.type,
          ok: false,
          error: err.message,
        });
        this.log.error(`[${articleId}] ${target.type} hata: ${err.message}`);
      }
    }

    // Article status + publishedTo güncelle
    const successful = results.filter(r => r.ok);
    if (successful.length > 0) {
      await this.prisma.article.update({
        where: { id: articleId },
        data: {
          status: 'PUBLISHED',
          publishedAt: new Date(),
          bodyHtml,
          publishedTo: successful as any,
        },
      });
    }

    return results;
  }

  private decryptCredentials(creds: Record<string, any>): Record<string, any> {
    const out: Record<string, any> = {};
    for (const [k, v] of Object.entries(creds)) {
      if (typeof v === 'string' && v.includes(':')) {
        try { out[k] = decrypt(v); } catch { out[k] = v; }
      } else {
        out[k] = v;
      }
    }
    return out;
  }
}
