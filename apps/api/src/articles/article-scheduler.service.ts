import { Injectable, Logger, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { JobQueueService } from '../jobs/job-queue.service.js';
import { QuotaService } from '../billing/quota.service.js';

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

  // BullMQ jobId şeması — article başına unique, reschedule sırasında override için
  private static genJobId(articleId: string) {
    return `gen:article:${articleId}`;
  }

  // scheduledAt'ten 15dk önce trigger et — yayın saatine kadar pipeline tamamlansın
  private static readonly LEAD_TIME_MS = 15 * 60 * 1000;

  constructor(
    private readonly prisma: PrismaService,
    private readonly jobQueue: JobQueueService,
    private readonly quota: QuotaService,
  ) {}

  /**
   * SCHEDULED bir article için BullMQ delayed job ayarla.
   * scheduledAt - 15dk anında çalışacak şekilde delay hesaplanır.
   * Aynı article için tekrar çağrılırsa eski job override edilir (reschedule).
   * scheduledAt geçmişteyse hemen kuyruğa atar.
   */
  private async scheduleArticleJob(article: { id: string; siteId: string; topic: string; scheduledAt: Date | null }) {
    if (!article.scheduledAt) return;
    const site = await this.prisma.site.findUniqueOrThrow({
      where: { id: article.siteId },
      include: { publishTargets: { where: { isActive: true, isDefault: true }, select: { id: true } } },
    });
    const triggerAt = article.scheduledAt.getTime() - ArticleSchedulerService.LEAD_TIME_MS;
    const delay = Math.max(0, triggerAt - Date.now());
    const targetIds = site.publishTargets.map((t) => t.id);

    await this.jobQueue.enqueue({
      type: 'GENERATE_ARTICLE',
      userId: site.userId,
      siteId: article.siteId,
      jobId: ArticleSchedulerService.genJobId(article.id),
      delay,
      payload: {
        siteId: article.siteId,
        topic: article.topic,
        articleId: article.id,
        skipImages: false,
        autoPublish: targetIds.length > 0,
        targetIds,
      },
    });

    const fireTime = new Date(Date.now() + delay).toISOString();
    this.log.log(
      `[${article.siteId}] Article ${article.id} delayed job — fires at ${fireTime} (${Math.round(delay / 60000)}dk sonra, scheduledAt - 15dk)`,
    );
  }

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
   * Cron tarafindan cagrilir. scheduledAt - 15dk <= now olan SCHEDULED makaleleri
   * yakalar, kotasi yetenler icin uretime alir. autoPublish=true ile uretim
   * bitince varsayilan publish target uzerinden direkt yayinlanir.
   */
  async processDueArticles(): Promise<{ processed: number; skippedQuota: number }> {
    const now = new Date();
    // 15 dk onceden uret ki tam saat geldiginde yayina hazir olsun
    const threshold = new Date(now.getTime() + 15 * 60 * 1000);
    const due = await this.prisma.article.findMany({
      where: {
        status: 'SCHEDULED' as any,
        scheduledAt: { lte: threshold },
      },
      include: {
        site: {
          include: {
            user: { select: { id: true, plan: true, articlesUsedThisMonth: true } },
            publishTargets: { where: { isActive: true, isDefault: true }, select: { id: true } },
          },
        },
      },
      take: 50,
    });

    if (due.length === 0) return { processed: 0, skippedQuota: 0 };

    const PLAN_LIMITS: Record<string, number> = {
      TRIAL: 1, STARTER: 10, PRO: 40, AGENCY: 100, ENTERPRISE: 9999,
    };

    let processed = 0;
    let skippedQuota = 0;

    for (const a of due) {
      const u = a.site.user;
      const limit = PLAN_LIMITS[u.plan] ?? 0;
      if (u.articlesUsedThisMonth >= limit) {
        skippedQuota++;
        continue;
      }
      await this.prisma.article.update({
        where: { id: a.id },
        data: { status: 'GENERATING' as any },
      });
      const defaultTargetIds = (a.site as any).publishTargets?.map((t: any) => t.id) ?? [];
      await this.jobQueue.enqueue({
        type: 'GENERATE_ARTICLE',
        userId: u.id,
        siteId: a.siteId,
        payload: {
          siteId: a.siteId,
          topic: a.topic,
          articleId: a.id,
          skipImages: false,
          autoPublish: defaultTargetIds.length > 0,
          targetIds: defaultTargetIds,
        },
      });
      processed++;
    }

    if (processed > 0 || skippedQuota > 0) {
      this.log.log(`[scheduler] ${processed} makale uretime alindi (15dk pre-publish), ${skippedQuota} kota dolu`);
    }
    return { processed, skippedQuota };
  }

  /**
   * Tek bir Tier-1 konuyu manuel olarak takvime ekler (drag-drop).
   * Frontend'den scheduledAt + topic + slug + pillar gelir.
   */
  async scheduleTopic(siteId: string, args: { topic: string; scheduledAt: string; slug?: string; pillar?: string }) {
    const site = await this.prisma.site.findUniqueOrThrow({ where: { id: siteId } });
    const at = new Date(args.scheduledAt);
    if (isNaN(at.getTime())) throw new Error('Gecersiz scheduledAt');

    // Kota check: SCHEDULED + GENERATING + EDITING + READY_TO_PUBLISH + PUBLISHED toplami
    // articlesUsedThisMonth icindedir; ayrica zaten takvimde bekleyen var mi diye sayalim
    const { allowed, remaining, limit } = await this.quota.checkArticleQuota(site.userId);
    const pendingCount = await this.prisma.article.count({
      where: {
        siteId,
        status: { in: ['SCHEDULED', 'GENERATING', 'EDITING', 'READY_TO_PUBLISH'] as any },
      },
    });
    // Hem aylik kota hem takvimde bekleyenler kotaya dahil
    if (!allowed || pendingCount >= remaining) {
      throw new ForbiddenException(
        `Plan kotan dolu (${limit} makale/ay). ${pendingCount} yazi zaten takvimde. Yeni yazi takvime almak icin plani yukselt.`,
      );
    }

    const slug = `scheduled-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    const article = await this.prisma.article.create({
      data: {
        siteId,
        topic: args.topic,
        slug,
        title: args.topic,
        pillar: args.pillar,
        language: site.language ?? 'tr',
        status: 'SCHEDULED' as any,
        scheduledAt: at,
      },
    });
    this.log.log(`[${siteId}] Konu takvime eklendi: '${args.topic}' @ ${at.toISOString()}`);

    // Delayed BullMQ job ayarla — saat geldiğinde otomatik tetiklenir (polling beklemez)
    await this.scheduleArticleJob({ id: article.id, siteId, topic: args.topic, scheduledAt: at });

    return article;
  }

  /**
   * Mevcut bir SCHEDULED makaleyi yeni saate tasi (drag-drop ile yer degistirme).
   */
  async rescheduleArticle(articleId: string, newScheduledAt: string) {
    const at = new Date(newScheduledAt);
    if (isNaN(at.getTime())) throw new Error('Gecersiz scheduledAt');
    const a = await this.prisma.article.findUniqueOrThrow({ where: { id: articleId } });
    if (a.status !== 'SCHEDULED' && a.status !== 'DRAFT') {
      throw new Error(`Bu makale tasinamaz (status=${a.status})`);
    }
    const updated = await this.prisma.article.update({
      where: { id: articleId },
      data: { scheduledAt: at, status: 'SCHEDULED' as any },
    });

    // Delayed BullMQ job'ı yeni saate göre yeniden kur (eskisi otomatik silinir)
    await this.scheduleArticleJob({ id: updated.id, siteId: updated.siteId, topic: updated.topic, scheduledAt: at });

    return updated;
  }

  /**
   * Takvimden kaldir (article'i siler).
   */
  async unscheduleArticle(articleId: string) {
    const a = await this.prisma.article.findUniqueOrThrow({ where: { id: articleId } });
    if (a.status !== 'SCHEDULED') {
      throw new Error(`Sadece SCHEDULED makaleler kaldirilabilir (status=${a.status})`);
    }

    // Bekleyen BullMQ job'ını sil (silmezsek delayed job yine ateşler ama article yok → fail)
    await this.jobQueue.removeJob(ArticleSchedulerService.genJobId(articleId));

    await this.prisma.article.delete({ where: { id: articleId } });
    return { ok: true };
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
