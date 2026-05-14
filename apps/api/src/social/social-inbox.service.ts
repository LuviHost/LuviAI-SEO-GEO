import { Injectable, BadRequestException, NotFoundException, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';

type RequestingUser = { id: string; role: 'USER' | 'ADMIN' | 'AGENCY_OWNER' };

/**
 * Sosyal Inbox — DM/mention/comment'leri tek panelde yönet.
 * Background SOCIAL_INBOX_SYNC job adapter'lardan platform mesajlarını çeker
 * ve SocialInboxMessage olarak kaydeder. Bu service kullanıcı tarafından
 * tetiklenen okuma/cevaplama/arşiv operasyonlarını yönetir.
 */
@Injectable()
export class SocialInboxService {
  private readonly log = new Logger(SocialInboxService.name);

  constructor(private readonly prisma: PrismaService) {}

  async listForSite(siteId: string, user: RequestingUser, opts: { status?: string; type?: string; channelId?: string; limit?: number; cursor?: string } = {}) {
    await this.assertSiteOwner(siteId, user);
    const limit = Math.min(100, Math.max(1, opts.limit ?? 30));
    const channels = await this.prisma.socialChannel.findMany({ where: { siteId }, select: { id: true } });
    return this.prisma.socialInboxMessage.findMany({
      where: {
        channelId: { in: channels.map(c => c.id) },
        ...(opts.status ? { status: opts.status as any } : {}),
        ...(opts.type ? { type: opts.type as any } : {}),
        ...(opts.channelId ? { channelId: opts.channelId } : {}),
      },
      orderBy: { receivedAt: 'desc' },
      take: limit,
      ...(opts.cursor ? { skip: 1, cursor: { id: opts.cursor } } : {}),
    });
  }

  async markAsRead(messageId: string, user: RequestingUser) {
    await this.assertMessageOwner(messageId, user);
    return this.prisma.socialInboxMessage.update({
      where: { id: messageId },
      data: { status: 'READ' as any },
    });
  }

  async reply(messageId: string, replyText: string, user: RequestingUser) {
    if (!replyText.trim()) throw new BadRequestException('reply text bos olamaz');
    await this.assertMessageOwner(messageId, user);
    // TODO: gercek platform adapter ile cevap gonder (channel adapter'a reply API'si lazim)
    return this.prisma.socialInboxMessage.update({
      where: { id: messageId },
      data: {
        status: 'REPLIED' as any,
        reply: replyText,
        replyAt: new Date(),
      },
    });
  }

  async archive(messageId: string, user: RequestingUser) {
    await this.assertMessageOwner(messageId, user);
    return this.prisma.socialInboxMessage.update({
      where: { id: messageId },
      data: { status: 'ARCHIVED' as any, archivedAt: new Date() },
    });
  }

  async resolve(messageId: string, user: RequestingUser) {
    await this.assertMessageOwner(messageId, user);
    return this.prisma.socialInboxMessage.update({
      where: { id: messageId },
      data: { status: 'RESOLVED' as any, resolvedBy: user.id },
    });
  }

  async unreadCountForSite(siteId: string, user: RequestingUser): Promise<number> {
    await this.assertSiteOwner(siteId, user);
    const channels = await this.prisma.socialChannel.findMany({ where: { siteId }, select: { id: true } });
    return this.prisma.socialInboxMessage.count({
      where: { channelId: { in: channels.map(c => c.id) }, status: 'UNREAD' as any },
    });
  }

  private async assertSiteOwner(siteId: string, user: RequestingUser) {
    const site = await this.prisma.site.findUnique({ where: { id: siteId } });
    if (!site || site.userId !== user.id) throw new NotFoundException('Site bulunamadı');
  }

  private async assertMessageOwner(messageId: string, user: RequestingUser) {
    const msg = await this.prisma.socialInboxMessage.findUnique({
      where: { id: messageId },
      include: { channel: { include: { site: true } } },
    });
    if (!msg || msg.channel.site.userId !== user.id) throw new NotFoundException('Mesaj bulunamadı');
    return msg;
  }
}
