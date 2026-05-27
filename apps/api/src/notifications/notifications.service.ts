import { Injectable, NotFoundException, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';

type RequestingUser = { id: string; role: 'USER' | 'ADMIN' | 'AGENCY_OWNER' };

/**
 * In-app notification merkezi. Email worker'ı `emailSentAt` null kayıtları okuyup
 * `channels` JSON'unda 'email' varsa SMTP/SES ile gönderir.
 *
 * SocialPostsService, AuditService, AiCitationService bunu kullanır.
 */
@Injectable()
export class NotificationsService {
  private readonly log = new Logger(NotificationsService.name);

  constructor(private readonly prisma: PrismaService) {}

  async list(user: RequestingUser, opts: { unreadOnly?: boolean; type?: string; limit?: number; cursor?: string } = {}) {
    const limit = Math.min(100, Math.max(1, opts.limit ?? 30));
    return this.prisma.notification.findMany({
      where: {
        userId: user.id,
        ...(opts.unreadOnly ? { readAt: null } : {}),
        ...(opts.type ? { type: opts.type as any } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
      ...(opts.cursor ? { skip: 1, cursor: { id: opts.cursor } } : {}),
    });
  }

  async unreadCount(user: RequestingUser): Promise<number> {
    return this.prisma.notification.count({ where: { userId: user.id, readAt: null } });
  }

  async markAsRead(notificationId: string, user: RequestingUser) {
    const n = await this.prisma.notification.findUnique({ where: { id: notificationId } });
    if (!n || n.userId !== user.id) throw new NotFoundException('Bildirim bulunamadı');
    if (n.readAt) return n;
    return this.prisma.notification.update({
      where: { id: notificationId },
      data: { readAt: new Date() },
    });
  }

  async markAllAsRead(user: RequestingUser): Promise<number> {
    const res = await this.prisma.notification.updateMany({
      where: { userId: user.id, readAt: null },
      data: { readAt: new Date() },
    });
    return res.count;
  }

  /** Service-side bildirim oluştur (post needs approval, audit done, vs.) */
  async create(opts: {
    userId: string;
    type:
      | 'SOCIAL_POST_NEEDS_APPROVAL' | 'SOCIAL_POST_PUBLISHED' | 'SOCIAL_POST_FAILED'
      | 'SOCIAL_INBOX_NEW_DM' | 'SOCIAL_INBOX_NEW_MENTION' | 'SOCIAL_INBOX_NEW_COMMENT'
      | 'SOCIAL_IDEA_ASSIGNED' | 'AUDIT_COMPLETE' | 'AI_CITATION_DROP' | 'SYSTEM';
    title: string;
    body?: string;
    link?: string;
    refKind?: string;
    refId?: string;
    channels?: ('inapp' | 'email')[];
  }) {
    return this.prisma.notification.create({
      data: {
        userId: opts.userId,
        type: opts.type as any,
        title: opts.title,
        body: opts.body,
        link: opts.link,
        refKind: opts.refKind,
        refId: opts.refId,
        channels: (opts.channels ?? ['inapp']) as any,
      },
    });
  }

  async delete(notificationId: string, user: RequestingUser) {
    const n = await this.prisma.notification.findUnique({ where: { id: notificationId } });
    if (!n || n.userId !== user.id) throw new NotFoundException('Bildirim bulunamadı');
    return this.prisma.notification.delete({ where: { id: notificationId } });
  }
}
