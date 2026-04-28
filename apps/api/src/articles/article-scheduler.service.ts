import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { JobQueueService } from '../jobs/job-queue.service.js';

/**
 * Article scheduler — ONBOARDING_CHAIN sonunda tier-1 konulari otomatik
 * takvime yerlestir. TRIAL kullanicisi icin ilk makale hemen uretilir,
 * kalanlar SCHEDULED durumda paket alinmasini bekler.
 *
 * Slot algoritmasi (haftalik dengeli):
 *   #1 = simdi
 *   #2 = +3 gun, Pzt 10:00
 *   #3 = +7 gun, Per 14:00
 *   #4 = +10 gun, Pzt 10:00
 *   #5 = +14 gun, Per 14:00
 *
 * GEO oncelikli — tier-1 konular zaten ranker'dan AEO/GEO skoruna gore
 * sirali geliyor; ilk 5'i siyle alip schedule ediyoruz.
 */
@Injectable()
export class ArticleSchedulerService {
  private readonly log = new Logger(ArticleSchedulerService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jobQueue: JobQueueService,
  ) {}

  /**
   * Onboarding sonrasi cagrilir. Tier-1 ilk 5 konuyu Article olarak
   * SCHEDULED status'unda yaratir, ilki hemen kuyruga atilir.
   */
  async scheduleInitialBatch(siteId: string, opts: { count?: number } = {}) {
    const count = opts.count ?? 5;
    const site = await this.prisma.site.findUniqueOrThrow({
      where: { id: siteId },
      include: { user: { select: { plan: true } } },
    });

    // Son topic queue'yu al
    const queue = await this.prisma.topicQueue.findFirst({
      where: { siteId },
      orderBy: { generatedAt: 'desc' },
    });
    if (!queue) {
      this.log.warn(`[${siteId}] Topic queue yok, scheduling atlandi`);
      return { scheduled: 0, immediate: null };
    }

    const tier1: any[] = Array.isArray(queue.tier1Topics) ? (queue.tier1Topics as any[]) : [];
    if (tier1.length === 0) {
      this.log.warn(`[${siteId}] Tier-1 konu yok, scheduling atlandi`);
      return { scheduled: 0, immediate: null };
    }

    const picks = tier1.slice(0, count);
    const slots = this.buildSlots(picks.length);
    const isTrial = site.user.plan === 'TRIAL';

    let immediateArticleId: string | null = null;
    let scheduledCount = 0;

    for (let i = 0; i < picks.length; i++) {
      const t = picks[i];
      const topic = String(t.topic ?? t.title ?? t.slug ?? `Konu ${i + 1}`);
      const slug = `scheduled-${Date.now().toString(36)}-${i}`;
      const slot = slots[i];

      try {
        const article = await this.prisma.article.create({
          data: {
            siteId,
            topic,
            slug,
            title: topic,
            language: site.language ?? 'tr',
            status: i === 0 ? ('GENERATING' as any) : ('SCHEDULED' as any),
            scheduledAt: slot,
          },
        });

        if (i === 0) {
          // Ilk makale hemen kuyruga gir — TRIAL'da bile uretilir (1 makale hakki)
          await this.jobQueue.enqueue({
            type: 'GENERATE_ARTICLE',
            userId: site.userId,
            siteId,
            payload: {
              siteId,
              topic,
              articleId: article.id,
              skipImages: false,
              autoPublish: false, // hedef secimi kullaniciya kalir
            },
          });
          immediateArticleId = article.id;
          this.log.log(`[${siteId}] [1/${picks.length}] '${topic}' — hemen uretime alindi`);
        } else {
          this.log.log(`[${siteId}] [${i + 1}/${picks.length}] '${topic}' — ${slot.toISOString()} icin planlandi${isTrial ? ' (TRIAL: paket gerekli)' : ''}`);
        }
        scheduledCount++;
      } catch (err: any) {
        this.log.warn(`[${siteId}] Schedule fail (${topic}): ${err.message}`);
      }
    }

    return { scheduled: scheduledCount, immediate: immediateArticleId, isTrial };
  }

  /**
   * Cron tarafindan cagrilir. ScheduledAt <= now ve status = SCHEDULED olan
   * makaleleri yakalar, kotasi yetenler icin GENERATE_ARTICLE job kuyruga atar.
   * Kotasi yeten yoksa makale SCHEDULED kalir, kullanici upgrade ederse devam eder.
   */
  async processDueArticles(): Promise<{ processed: number; skippedQuota: number }> {
    const now = new Date();
    const due = await this.prisma.article.findMany({
      where: {
        status: 'SCHEDULED' as any,
        scheduledAt: { lte: now },
      },
      include: { site: { include: { user: { select: { id: true, plan: true, articlesUsedThisMonth: true } } } } },
      take: 50,
    });

    if (due.length === 0) return { processed: 0, skippedQuota: 0 };

    // Plan limit lookup
    const PLAN_LIMITS: Record<string, number> = {
      TRIAL: 1, STARTER: 10, PRO: 40, AGENCY: 100, ENTERPRISE: 9999,
    };

    let processed = 0;
    let skippedQuota = 0;

    for (const a of due) {
      const u = a.site.user;
      const limit = PLAN_LIMITS[u.plan] ?? 0;
      if (u.articlesUsedThisMonth >= limit) {
        // Kota dolu — makale SCHEDULED kalsin, frontend "paket gerekli" gosterir
        skippedQuota++;
        continue;
      }
      await this.prisma.article.update({
        where: { id: a.id },
        data: { status: 'GENERATING' as any },
      });
      await this.jobQueue.enqueue({
        type: 'GENERATE_ARTICLE',
        userId: u.id,
        siteId: a.siteId,
        payload: {
          siteId: a.siteId,
          topic: a.topic,
          articleId: a.id,
          skipImages: false,
          autoPublish: false,
        },
      });
      processed++;
    }

    if (processed > 0 || skippedQuota > 0) {
      this.log.log(`[scheduler] ${processed} makale uretime alindi, ${skippedQuota} kota dolu nedeniyle bekliyor`);
    }
    return { processed, skippedQuota };
  }

  /**
   * Site icin scheduled article'leri liste — frontend takvimi besler.
   */
  async listScheduledForSite(siteId: string) {
    return this.prisma.article.findMany({
      where: {
        siteId,
        status: { in: ['SCHEDULED', 'GENERATING', 'EDITING', 'READY_TO_PUBLISH'] as any },
      },
      orderBy: { scheduledAt: 'asc' },
      select: {
        id: true,
        topic: true,
        title: true,
        slug: true,
        status: true,
        scheduledAt: true,
        createdAt: true,
        wordCount: true,
        editorScore: true,
      },
      take: 30,
    });
  }

  // ────────────────────────────────────────────────────────
  //  Slot algoritmasi
  // ────────────────────────────────────────────────────────
  private buildSlots(count: number): Date[] {
    const slots: Date[] = [];
    const now = new Date();
    slots.push(now); // #1 = simdi

    // Sonraki Pazartesi 10:00
    let cursor = this.nextWeekday(now, 1, 10); // Pzt = 1, saat 10
    for (let i = 1; i < count; i++) {
      slots.push(new Date(cursor));
      // Sonraki slot: 3 gun sonra Per 14, sonra +4 gun Pzt 10, alternatif
      if (i % 2 === 1) {
        // Pzt 10 → Per 14 (3 gun + 4 saat)
        cursor = new Date(cursor.getTime() + 3 * 86400000);
        cursor.setHours(14, 0, 0, 0);
      } else {
        // Per 14 → Sonraki Pzt 10 (4 gun - 4 saat)
        cursor = new Date(cursor.getTime() + 4 * 86400000);
        cursor.setHours(10, 0, 0, 0);
      }
    }
    return slots;
  }

  /** Verilen gunden sonra ilk hafta gunu (1=Pzt, 4=Per) saat HH:00 */
  private nextWeekday(from: Date, weekday: number, hour: number): Date {
    const d = new Date(from);
    d.setHours(hour, 0, 0, 0);
    const currentDay = d.getDay() === 0 ? 7 : d.getDay(); // Pazar = 7
    let diff = weekday - currentDay;
    if (diff <= 0 || (diff === 0 && d.getTime() <= from.getTime())) diff += 7;
    d.setDate(d.getDate() + diff);
    return d;
  }
}
