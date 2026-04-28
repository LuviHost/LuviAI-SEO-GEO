import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { formatSlotLabel, getPlanSocialConfig } from './plan-tiers.js';

type RequestingUser = { id: string; role: 'USER' | 'ADMIN' | 'AGENCY_OWNER' };

/**
 * Sosyal medya takvim ozeti.
 * UI calendar bileseni icin tek noktadan veri sunar:
 *  - plan + haftalik kota
 *  - slot'lar (week view)
 *  - belirli aralikta scheduled / published post'lar
 */
@Injectable()
export class SocialCalendarService {
  constructor(private readonly prisma: PrismaService) {}

  async getOverview(siteId: string, range: { from?: Date; to?: Date }, user: RequestingUser) {
    const site = await this.prisma.site.findUnique({
      where: { id: siteId },
      include: { user: { select: { plan: true } } },
    });
    if (!site) throw new NotFoundException('Site bulunamadi');
    if (user.role !== 'ADMIN' && site.userId !== user.id) {
      throw new ForbiddenException('Bu site sana ait degil');
    }

    const config = getPlanSocialConfig(site.user.plan);

    const channels = await this.prisma.socialChannel.findMany({
      where: { siteId, isActive: true },
      select: {
        id: true,
        type: true,
        name: true,
        externalName: true,
        externalAvatar: true,
        isDefault: true,
        isActive: true,
      },
    });

    const slots = await this.prisma.socialRecurringSlot.findMany({
      where: { channel: { siteId } },
      orderBy: [{ dayOfWeek: 'asc' }, { hour: 'asc' }, { minute: 'asc' }],
    });

    const from = range.from ?? new Date(Date.now() - 7 * 86400_000);
    const to = range.to ?? new Date(Date.now() + 30 * 86400_000);

    const posts = await this.prisma.socialPost.findMany({
      where: {
        channel: { siteId },
        OR: [
          { scheduledFor: { gte: from, lte: to } },
          { publishedAt: { gte: from, lte: to } },
          { status: 'DRAFT' as any },
        ],
      },
      orderBy: [{ scheduledFor: 'asc' }, { createdAt: 'desc' }],
      include: {
        channel: { select: { id: true, type: true, externalName: true, externalAvatar: true } },
        article: { select: { id: true, title: true, slug: true } },
      },
      take: 200,
    });

    const draftCount = posts.filter((p) => p.status === 'DRAFT').length;
    const queuedCount = posts.filter((p) => p.status === 'QUEUED').length;
    const publishedCount = posts.filter((p) => p.status === 'PUBLISHED').length;

    return {
      plan: site.user.plan,
      postsPerWeek: config.postsPerWeek,
      timezone: config.timezone,
      channels,
      slots: slots.map((s) => ({
        id: s.id,
        channelId: s.channelId,
        dayOfWeek: s.dayOfWeek,
        hour: s.hour,
        minute: s.minute,
        timezone: s.timezone,
        source: s.source,
        isActive: s.isActive,
        label: formatSlotLabel({ dayOfWeek: s.dayOfWeek, hour: s.hour, minute: s.minute }),
      })),
      defaultSlots: config.slots.map((s) => ({
        ...s,
        label: formatSlotLabel(s),
      })),
      stats: {
        draftCount,
        queuedCount,
        publishedCount,
        total: posts.length,
      },
      posts: posts.map((p) => ({
        id: p.id,
        channelId: p.channelId,
        channel: p.channel,
        articleId: p.articleId,
        article: p.article,
        text: p.text,
        status: p.status,
        scheduledFor: p.scheduledFor,
        publishedAt: p.publishedAt,
        externalUrl: p.externalUrl,
        createdAt: p.createdAt,
      })),
    };
  }
}
