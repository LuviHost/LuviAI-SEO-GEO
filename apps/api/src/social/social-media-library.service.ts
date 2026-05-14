import { Injectable, BadRequestException, NotFoundException, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';

type RequestingUser = { id: string; role: 'USER' | 'ADMIN' | 'AGENCY_OWNER' };

/**
 * Sosyal Media Library — postlarda yeniden kullanılabilir görsel/video varlıkları.
 * Yüklenen dosyalar /public/social-media altında saklanır (S3 entegrasyonu opsiyonel).
 * Aynı asset farklı kanal preset boyutlarına (variants) otomatik resize edilebilir.
 */
@Injectable()
export class SocialMediaLibraryService {
  private readonly log = new Logger(SocialMediaLibraryService.name);

  constructor(private readonly prisma: PrismaService) {}

  async list(user: RequestingUser, opts: { siteId?: string; folder?: string; source?: string; limit?: number; cursor?: string } = {}) {
    const limit = Math.min(100, Math.max(1, opts.limit ?? 50));
    return this.prisma.socialMediaAsset.findMany({
      where: {
        userId: user.id,
        ...(opts.siteId ? { siteId: opts.siteId } : {}),
        ...(opts.folder ? { folder: opts.folder } : {}),
        ...(opts.source ? { source: opts.source as any } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
      ...(opts.cursor ? { skip: 1, cursor: { id: opts.cursor } } : {}),
    });
  }

  async create(user: RequestingUser, dto: {
    url: string;
    filename: string;
    mimeType: string;
    sizeBytes: number;
    siteId?: string;
    folder?: string;
    altText?: string;
    width?: number;
    height?: number;
    durationMs?: number;
    thumbnail?: string;
    source?: 'UPLOAD' | 'UNSPLASH' | 'AI_GENERATED' | 'URL_IMPORT';
    externalRef?: string;
    tags?: string[];
  }) {
    if (!dto.url || !dto.filename) throw new BadRequestException('url ve filename zorunlu');
    if (dto.siteId) {
      const site = await this.prisma.site.findUnique({ where: { id: dto.siteId } });
      if (!site || site.userId !== user.id) throw new NotFoundException('Site bulunamadı');
    }
    return this.prisma.socialMediaAsset.create({
      data: {
        userId: user.id,
        siteId: dto.siteId,
        url: dto.url,
        thumbnail: dto.thumbnail,
        filename: dto.filename,
        mimeType: dto.mimeType,
        sizeBytes: dto.sizeBytes,
        width: dto.width,
        height: dto.height,
        durationMs: dto.durationMs,
        folder: dto.folder,
        altText: dto.altText,
        tags: dto.tags ?? null,
        source: (dto.source ?? 'UPLOAD') as any,
        externalRef: dto.externalRef,
      },
    });
  }

  async update(assetId: string, user: RequestingUser, dto: { altText?: string; tags?: string[]; folder?: string }) {
    await this.assertAssetOwner(assetId, user);
    return this.prisma.socialMediaAsset.update({
      where: { id: assetId },
      data: {
        ...(dto.altText !== undefined ? { altText: dto.altText } : {}),
        ...(dto.tags !== undefined ? { tags: dto.tags } : {}),
        ...(dto.folder !== undefined ? { folder: dto.folder } : {}),
      },
    });
  }

  async delete(assetId: string, user: RequestingUser) {
    await this.assertAssetOwner(assetId, user);
    return this.prisma.socialMediaAsset.delete({ where: { id: assetId } });
  }

  async markUsed(assetId: string) {
    return this.prisma.socialMediaAsset.update({
      where: { id: assetId },
      data: { usageCount: { increment: 1 }, lastUsedAt: new Date() },
    });
  }

  async addVariant(assetId: string, user: RequestingUser, variant: { label: string; url: string; w: number; h: number }) {
    const asset = await this.assertAssetOwner(assetId, user);
    const existing = Array.isArray(asset.variants) ? (asset.variants as any[]) : [];
    return this.prisma.socialMediaAsset.update({
      where: { id: assetId },
      data: { variants: [...existing, variant] as any },
    });
  }

  async folders(user: RequestingUser, siteId?: string): Promise<string[]> {
    const rows = await this.prisma.socialMediaAsset.findMany({
      where: { userId: user.id, ...(siteId ? { siteId } : {}), folder: { not: null } },
      select: { folder: true },
      distinct: ['folder'],
    });
    return rows.map(r => r.folder).filter((x): x is string => !!x);
  }

  private async assertAssetOwner(assetId: string, user: RequestingUser) {
    const asset = await this.prisma.socialMediaAsset.findUnique({ where: { id: assetId } });
    if (!asset || asset.userId !== user.id) throw new NotFoundException('Asset bulunamadı');
    return asset;
  }
}
