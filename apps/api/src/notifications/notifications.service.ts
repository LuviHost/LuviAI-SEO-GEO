import { Injectable, NotFoundException, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { EmailService } from '../email/email.service.js';
import { duzen, dugme, p, kacisla } from '../email/email-layout.js';

type RequestingUser = { id: string; role: 'USER' | 'ADMIN' | 'AGENCY_OWNER' };

/**
 * In-app notification merkezi.
 *
 * E-POSTA: `channels` içinde 'email' varsa bildirim OLUŞTURULUR OLUŞTURULMAZ gönderilir ve
 * `emailSentAt` damgalanır. NEDEN burada: eski yorum "email worker'ı emailSentAt null kayıtları
 * okur" diyordu ama o worker repoda hiç yazılmamıştı — yani 'email' kanalı istenen her bildirim
 * (LinkedIn'de cevap geldi, bot duraklatıldı) sessizce yalnız panele düşüyordu ve kimse görmüyordu
 * (01.09.2026 tespiti). Gönderim hatası bildirimi DÜŞÜRMEZ: kayıt her hâlükârda yazılır.
 *
 * AuditService, AiCitationService, LinkedinOutreachService bunu kullanır.
 */
@Injectable()
export class NotificationsService {
  private readonly log = new Logger(NotificationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly email: EmailService,
  ) {}

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
    const channels = opts.channels ?? ['inapp'];
    const kayit = await this.prisma.notification.create({
      data: {
        userId: opts.userId,
        type: opts.type as any,
        title: opts.title,
        body: opts.body,
        link: opts.link,
        refKind: opts.refKind,
        refId: opts.refId,
        channels: channels as any,
      },
    });
    if (channels.includes('email')) await this.epostaGonder(kayit.id, opts);
    return kayit;
  }

  /**
   * Bildirimi e-postayla ilet. Hata YUTULUR — bildirim kaydı e-posta yüzünden geri alınmaz;
   * yalnız `emailSentAt` boş kalır, böylece gönderilmediği kayıttan anlaşılır.
   */
  private async epostaGonder(
    notificationId: string,
    opts: { userId: string; title: string; body?: string; link?: string },
  ): Promise<void> {
    try {
      const user = await this.prisma.user.findUnique({
        where: { id: opts.userId },
        select: { email: true },
      });
      if (!user?.email) {
        this.log.warn(`Bildirim e-postası atlandı: kullanıcı ${opts.userId} için adres yok`);
        return;
      }
      const base = process.env.WEB_BASE_URL ?? 'https://ranksup.ai';
      const url = opts.link ? (opts.link.startsWith('http') ? opts.link : `${base}${opts.link}`) : null;
      const govde = [
        opts.body ? p(kacisla(opts.body)) : '',
        url ? dugme('Panelde aç', url) : '',
      ].join('');
      const res = await this.email.sendRaw({
        userId: opts.userId,
        to: user.email,
        subject: opts.title,
        html: duzen(opts.title, govde),
      });
      if (!res.ok) {
        this.log.warn(`Bildirim e-postası gönderilemedi: ${opts.title}`);
        return;
      }
      await this.prisma.notification
        .update({ where: { id: notificationId }, data: { emailSentAt: new Date() } })
        .catch(() => undefined);
    } catch (err: any) {
      this.log.warn(`Bildirim e-postası hatası: ${err?.message ?? err}`);
    }
  }

  async delete(notificationId: string, user: RequestingUser) {
    const n = await this.prisma.notification.findUnique({ where: { id: notificationId } });
    if (!n || n.userId !== user.id) throw new NotFoundException('Bildirim bulunamadı');
    return this.prisma.notification.delete({ where: { id: notificationId } });
  }
}
