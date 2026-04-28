import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service.js';
import { JobQueueService } from '../jobs/job-queue.service.js';

/**
 * Sosyal medya zamanlayicisi — her 5 dakikada bir calisir.
 *
 * Iki gorev:
 *   A. SLOT FIRING — Europe/Istanbul saatinde bu 5 dk pencereye denk gelen
 *      aktif slot'lar icin en eski DRAFT post'u secip QUEUED + scheduledFor=now
 *      yap. Ayni gun ayni kanal icin tekrar atilamaz.
 *   B. PUBLISH FIRING — scheduledFor <= now olan QUEUED post'lari BullMQ
 *      SOCIAL_PUBLISH job'una gonder. Worker async olarak yayinlar.
 */
@Injectable()
export class SocialSchedulerService {
  private readonly log = new Logger(SocialSchedulerService.name);

  // Tek seferde kac post yayinlayalim (DDoS olmasin)
  private static readonly MAX_PUBLISH_PER_TICK = 20;

  constructor(
    private readonly prisma: PrismaService,
    private readonly jobs: JobQueueService,
  ) {}

  @Cron(CronExpression.EVERY_5_MINUTES, { name: 'social-scheduler', timeZone: 'Europe/Istanbul' })
  async tick() {
    const now = new Date();
    try {
      const promoted = await this.fireDueSlots(now);
      const enqueued = await this.enqueueDuePosts(now);
      if (promoted + enqueued > 0) {
        this.log.log(`tick: promoted=${promoted} enqueued=${enqueued}`);
      }
    } catch (err: any) {
      this.log.error(`tick failed: ${err.message}`);
    }
  }

  /**
   * Aktif slot'lardan bu 5 dk pencereye denk gelenleri bul, her biri icin en
   * eski DRAFT post'u alip QUEUED yap.
   */
  private async fireDueSlots(now: Date): Promise<number> {
    const ist = getIstanbulNow(now);
    const minuteFrom = Math.max(0, ist.minute - 4);

    const slots = await this.prisma.socialRecurringSlot.findMany({
      where: {
        isActive: true,
        dayOfWeek: ist.dayOfWeek,
        hour: ist.hour,
        minute: { gte: minuteFrom, lte: ist.minute },
        channel: { isActive: true },
      },
      include: {
        channel: { select: { id: true, siteId: true, type: true, isActive: true } },
      },
    });

    if (slots.length === 0) return 0;

    let promoted = 0;
    // Ayni gunde ayni kanal icin tekrar atmamak icin son 23 saat penceresi
    const dayWindowAgo = new Date(now.getTime() - 23 * 3600_000);

    for (const slot of slots) {
      const recentlyPosted = await this.prisma.socialPost.findFirst({
        where: {
          channelId: slot.channelId,
          status: { in: ['QUEUED', 'PUBLISHING', 'PUBLISHED'] as any },
          OR: [
            { scheduledFor: { gte: dayWindowAgo } },
            { publishedAt: { gte: dayWindowAgo } },
          ],
        },
        select: { id: true },
      });
      if (recentlyPosted) continue;

      const draft = await this.prisma.socialPost.findFirst({
        where: { channelId: slot.channelId, status: 'DRAFT' as any },
        orderBy: { createdAt: 'asc' },
      });
      if (!draft) continue; // icerik yok, slot atlanir

      await this.prisma.socialPost.update({
        where: { id: draft.id },
        data: { status: 'QUEUED' as any, scheduledFor: now },
      });
      promoted++;
      this.log.log(
        `[slot ${slot.id}] DRAFT ${draft.id} -> QUEUED (kanal ${slot.channel.type})`,
      );
    }
    return promoted;
  }

  /**
   * scheduledFor <= now olan QUEUED post'lari BullMQ kuyruguna gonder.
   * Race kondisyonu icin status atomik QUEUED -> PUBLISHING gecisi yapilir.
   */
  private async enqueueDuePosts(now: Date): Promise<number> {
    const due = await this.prisma.socialPost.findMany({
      where: {
        status: 'QUEUED' as any,
        scheduledFor: { lte: now },
      },
      include: {
        channel: { select: { siteId: true, site: { select: { userId: true } } } },
      },
      take: SocialSchedulerService.MAX_PUBLISH_PER_TICK,
    });

    if (due.length === 0) return 0;

    let enqueued = 0;
    for (const post of due) {
      try {
        const updated = await this.prisma.socialPost.updateMany({
          where: { id: post.id, status: 'QUEUED' as any },
          data: { status: 'PUBLISHING' as any },
        });
        if (updated.count === 0) continue;

        await this.jobs.enqueue({
          type: 'SOCIAL_PUBLISH',
          userId: post.channel.site.userId,
          siteId: post.channel.siteId,
          payload: { postId: post.id },
        });
        enqueued++;
      } catch (err: any) {
        this.log.error(`Post ${post.id} enqueue hata: ${err.message}`);
        await this.prisma.socialPost
          .update({ where: { id: post.id }, data: { status: 'QUEUED' as any } })
          .catch(() => undefined);
      }
    }
    return enqueued;
  }
}

/**
 * Bir Date'i Europe/Istanbul saat dilimine cevirip dayOfWeek/hour/minute alir.
 * Intl API kullanir — DST'siz UTC+3 dilimi icin saglam.
 */
function getIstanbulNow(now: Date): { dayOfWeek: number; hour: number; minute: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Europe/Istanbul',
    weekday: 'short',
    hour: 'numeric',
    minute: 'numeric',
    hour12: false,
  }).formatToParts(now);

  const weekday = parts.find((p) => p.type === 'weekday')?.value ?? 'Sun';
  const hour = parseInt(parts.find((p) => p.type === 'hour')?.value ?? '0', 10);
  const minute = parseInt(parts.find((p) => p.type === 'minute')?.value ?? '0', 10);

  const dowMap: Record<string, number> = {
    Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
  };

  // Intl `hour: 'numeric'` 0-23 verir ama bazi Node surumlerinde "24" olabilir.
  const normalizedHour = hour === 24 ? 0 : hour;

  return {
    dayOfWeek: dowMap[weekday] ?? 0,
    hour: normalizedHour,
    minute,
  };
}
