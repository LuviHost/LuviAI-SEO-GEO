import 'dotenv/config';

// IPv4'e zorla (sunucularda public IPv6 yoksa Node fetch ETIMEDOUT verir)
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const undici = require('undici') as { setGlobalDispatcher: (d: unknown) => void; Agent: new (opts: unknown) => unknown };
  undici.setGlobalDispatcher(new undici.Agent({ connect: { family: 4 } }));
} catch {
  // older Node — sessizce geç
}

import { Worker, Queue } from 'bullmq';
import IORedis from 'ioredis';
import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';

// API'nın AppModule'ünü reuse et (tüm service'ler DI ile gelir)
import { AppModule } from '../../api/dist/app.module.js';

import { BrainGeneratorService } from '../../api/dist/sites/brain-generator.service.js';
import { AuditService } from '../../api/dist/audit/audit.service.js';
import { AutoFixService } from '../../api/dist/audit/auto-fix.service.js';
import { TopicsService } from '../../api/dist/topics/topics.service.js';
import { PipelineService } from '../../api/dist/articles/pipeline.service.js';
import { PublisherService } from '../../api/dist/articles/publisher.service.js';
import { ArticleSchedulerService } from '../../api/dist/articles/article-scheduler.service.js';
import { SocialPostsService } from '../../api/dist/social/social-posts.service.js';
import { PrismaService } from '../../api/dist/prisma/prisma.service.js';
import { PlatformDetectorService } from '../../api/dist/sites/platform-detector.service.js';
import { LlmsFullBuilderService } from '../../api/dist/audit/llms-full-builder.service.js';
import { AiCitationTrackerService } from '../../api/dist/audit/ai-citation-tracker.service.js';
import { AiIndexingPingerService } from '../../api/dist/audit/ai-indexing-pinger.service.js';
import { ContentPivotService } from '../../api/dist/articles/content-pivot.service.js';
import { AiMentionAlarmService } from '../../api/dist/audit/ai-mention-alarm.service.js';

const log = new Logger('Worker');

async function bootstrap() {
  // NestJS application context — HTTP listen yok, sadece DI
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn', 'log'],
  });

  const services = {
    brainGen: app.get(BrainGeneratorService),
    audit: app.get(AuditService),
    autoFix: app.get(AutoFixService),
    topics: app.get(TopicsService),
    pipeline: app.get(PipelineService),
    publisher: app.get(PublisherService),
    scheduler: app.get(ArticleSchedulerService),
    socialPosts: app.get(SocialPostsService),
    platformDetector: app.get(PlatformDetectorService),
    llmsBuilder: app.get(LlmsFullBuilderService),
    citationTracker: app.get(AiCitationTrackerService),
    indexingPinger: app.get(AiIndexingPingerService),
    contentPivot: app.get(ContentPivotService),
    aiAlarm: app.get(AiMentionAlarmService),
    prisma: app.get(PrismaService),
  };

  log.log('🔧 Worker DI hazır, BullMQ bağlanıyor');

  const connection = new IORedis(process.env.REDIS_URL ?? 'redis://localhost:6379', {
    maxRetriesPerRequest: null,
  });

  const handlers: Record<string, (data: any) => Promise<any>> = {
    BRAIN_GENERATE: async ({ siteId }) => {
      await services.brainGen.runGeneration(siteId);
      return { ok: true };
    },

    SITE_AUDIT: async ({ siteId }) => {
      const audit = await services.audit.runAudit(siteId);
      return { auditId: audit.id, score: audit.overallScore };
    },

    AUTO_FIX: async ({ siteId, fixes }) => {
      return services.autoFix.runAutoFix(siteId, fixes);
    },

    TOPIC_ENGINE: async ({ siteId }) => {
      const queue = await services.topics.runEngine(siteId);
      return { queueId: queue.id, tier1Count: (queue.tier1Topics as any[])?.length ?? 0 };
    },

    GENERATE_ARTICLE: async ({ siteId, topic, skipImages, autoPublish, targetIds, articleId }) => {
      try {
        const result = await services.pipeline.runPipeline({
          siteId,
          topic,
          skipImages: skipImages ?? false,
          maxRevize: 1,
          articleId,
        });
        if (autoPublish && result.editorVerdict === 'PASS') {
          const publishResults = await services.publisher.publishArticle(
            result.articleId,
            targetIds ?? [],
          );
          return { ...result, publishResults };
        }
        return result;
      } catch (err: any) {
        // Pipeline patlarsa placeholder Article'i FAILED'a cek (kullanici listede gorebilir)
        if (articleId) {
          await services.prisma.article.update({
            where: { id: articleId },
            data: { status: 'FAILED' as any },
          }).catch(() => {});
        }
        throw err;
      }
    },

    PUBLISH_ARTICLE: async ({ articleId, targetIds }) => {
      return services.publisher.publishArticle(articleId, targetIds ?? []);
    },

    /**
     * SOCIAL_PUBLISH — SocialSchedulerService cron tarafindan tetiklenir.
     * Tek bir SocialPost'u alip kanala (X / LinkedIn) yayinlar.
     */
    SOCIAL_PUBLISH: async ({ postId }) => {
      const result = await services.socialPosts.runPublish(postId);
      return { postId, externalId: result.externalId, externalUrl: result.externalUrl };
    },

    IMPROVE_PAGE: async (data) => {
      log.warn(`IMPROVE_PAGE not implemented: ${JSON.stringify(data)}`);
      return { ok: false, error: 'not implemented' };
    },

    /**
     * ONBOARDING_CHAIN — Otopilot
     * brain → audit → topics → platform detect → tier-1 takvim
     * Otopilot ON ise: 8 makale schedule + auto-fix tetikle (sitemap/robots/llms)
     * Otopilot OFF ise: sadece audit + topics, kullanici manuel surucler.
     */
    ONBOARDING_CHAIN: async ({ siteId }) => {
      log.log(`[${siteId}] Onboarding chain başlıyor`);

      const site = await services.prisma.site.findUniqueOrThrow({ where: { id: siteId } });
      const autopilot = (site as any).autopilot !== false;

      log.log(`[${siteId}] [1/5] Brain üretiliyor`);
      await services.brainGen.runGeneration(siteId);

      log.log(`[${siteId}] [2/5] Audit (AI citation otomatik)`);
      const audit = await services.audit.runAudit(siteId);

      log.log(`[${siteId}] [3/5] Topic engine`);
      const queue = await services.topics.runEngine(siteId);
      const tier1Count = ((queue.tier1Topics as any[]) ?? []).length;

      log.log(`[${siteId}] [4/5] Platform tespiti`);
      try {
        const detection = await services.platformDetector.detect(site.url);
        await services.prisma.site.update({
          where: { id: siteId },
          data: {
            platform: detection.platform,
            platformConfidence: detection.confidence,
            platformDetectedAt: new Date(),
          } as any,
        });
        log.log(`[${siteId}] Platform: ${detection.platform} (${(detection.confidence * 100).toFixed(0)}%)`);
      } catch (err: any) {
        log.warn(`[${siteId}] Platform detect fail: ${err.message}`);
      }

      log.log(`[${siteId}] [5/5] Tier-1 takvim yerlesimi (${autopilot ? 8 : 3} makale)`);
      const scheduleResult = await services.scheduler.scheduleInitialBatch(siteId, {
        count: autopilot ? 8 : 3,
      });

      // Otopilot ON ise auto-fix (sitemap/robots/llms) tetikle + ilk citation snapshot
      if (autopilot) {
        try {
          await services.autoFix.runAutoFix(siteId, ['sitemap', 'robots', 'llms']);
          log.log(`[${siteId}] Auto-fix tetiklendi (otopilot)`);
        } catch (err: any) {
          log.warn(`[${siteId}] Auto-fix atlandi: ${err.message}`);
        }

        // Ilk AI citation snapshot — baseline gunluk takip icin
        try {
          await services.citationTracker.snapshotSite(siteId);
          log.log(`[${siteId}] AI citation baseline snapshot kaydedildi`);
        } catch (err: any) {
          log.warn(`[${siteId}] Citation snapshot atlandi: ${err.message}`);
        }
      }

      await services.prisma.site.update({
        where: { id: siteId },
        data: { status: 'ACTIVE' },
      });

      log.log(`[${siteId}] ✅ Onboarding tamamlandi — audit, ${tier1Count} tier-1, ${scheduleResult.scheduled} makale takvimde${scheduleResult.isTrial ? ' (TRIAL: 1.makale uretiliyor, kalanlar paket bekliyor)' : ''}${autopilot ? ' [OTOPILOT]' : ''}`);
      return {
        onboarded: true,
        audit: audit.id,
        queue: queue.id,
        tier1Count,
        scheduledArticles: scheduleResult.scheduled,
        immediateArticleId: scheduleResult.immediate,
        isTrial: scheduleResult.isTrial,
        autopilot,
      };
    },

    /**
     * PROCESS_SCHEDULED — saatlik tetiklenir, scheduledAt <= now olan
     * SCHEDULED makaleleri kotasi yetenler icin uretime alir.
     */
    PROCESS_SCHEDULED: async () => {
      return services.scheduler.processDueArticles();
    },

    /**
     * LLMS_FULL_BUILD — haftalik cron, tum aktif sitelerin llms-full.txt'ini
     * regenerate eder. AI search engine'lerin sitenizi ezbere bilmesi icin.
     */
    LLMS_FULL_BUILD: async ({ siteId }: { siteId?: string }) => {
      if (siteId) {
        return services.llmsBuilder.build(siteId);
      }
      const sites = await services.prisma.site.findMany({
        where: { status: { in: ['ACTIVE', 'AUDIT_COMPLETE'] as any[] } },
        select: { id: true },
      });
      let total = 0;
      for (const s of sites) {
        try {
          const r = await services.llmsBuilder.build(s.id);
          total += r.bytes;
        } catch (err: any) {
          log.warn(`[${s.id}] llms-full build fail: ${err.message}`);
        }
      }
      return { sites: sites.length, totalBytes: total };
    },

    /**
     * AI_CITATION_DAILY — gunluk cron, tum aktif sitelerin AI gorunurlugunu olc.
     * Claude/Gemini/OpenAI/Perplexity'de site URL alintilanma skorunu DB'ye yaz.
     */
    AI_CITATION_DAILY: async () => {
      return services.citationTracker.snapshotAllActive();
    },

    /**
     * CONTENT_PIVOT_CHECK — haftalik cron, dusuk performansli/AI'da gorunmeyen
     * makaleleri tespit edip otopilot kullanicilari icin yeniden yazma kuyruga at.
     */
    CONTENT_PIVOT_CHECK: async () => {
      return services.contentPivot.scanAllSites();
    },

    /**
     * AI_MENTION_ALARM — gunluk citation drop tespit + email bildirim.
     */
    AI_MENTION_ALARM: async () => {
      return services.aiAlarm.scanAndAlert();
    },
  };

  const worker = new Worker(
    'luviai-jobs',
    async (job) => {
      const handler = handlers[job.name];
      if (!handler) throw new Error(`Bilinmeyen job tipi: ${job.name}`);

      const t0 = Date.now();
      try {
        const result = await handler(job.data);
        log.log(`✅ ${job.name} (${job.id}) — ${((Date.now() - t0) / 1000).toFixed(1)}s`);
        return result;
      } catch (err: any) {
        log.error(`❌ ${job.name} (${job.id}): ${err.message}`);
        throw err;
      }
    },
    {
      connection,
      concurrency: parseInt(process.env.WORKER_CONCURRENCY ?? '2', 10),
    },
  );

  worker.on('active', async (job) => {
    if (job.id) {
      await services.prisma.job.updateMany({
        where: { bullJobId: String(job.id), status: { in: ['QUEUED', 'FAILED'] } },
        data: { status: 'PROCESSING', startedAt: new Date() },
      });
    }
  });

  worker.on('completed', async (job) => {
    if (job.id) {
      await services.prisma.job.updateMany({
        where: { bullJobId: String(job.id) },
        data: { status: 'COMPLETED', finishedAt: new Date(), result: job.returnvalue ?? {} },
      });
    }
  });

  worker.on('failed', async (job, err) => {
    if (job?.id) {
      await services.prisma.job.updateMany({
        where: { bullJobId: String(job.id) },
        data: {
          status: 'FAILED',
          finishedAt: new Date(),
          error: err.message,
          attempts: { increment: 1 },
        },
      });
    }
  });

  // Cron-like repeats
  try {
    const queue = new Queue('luviai-jobs', { connection });

    // 1) PROCESS_SCHEDULED — her 30 dk
    await queue.add(
      'PROCESS_SCHEDULED',
      { trigger: 'cron' },
      {
        repeat: { every: 30 * 60 * 1000 },
        jobId: 'cron:process-scheduled',
        removeOnComplete: { count: 50 },
        removeOnFail: { count: 50 },
      },
    );

    // 2) LLMS_FULL_BUILD — haftada 1 (Pazartesi 03:00 UTC)
    await queue.add(
      'LLMS_FULL_BUILD',
      { trigger: 'cron' },
      {
        repeat: { pattern: '0 3 * * 1', tz: 'UTC' },
        jobId: 'cron:llms-full-weekly',
        removeOnComplete: { count: 20 },
        removeOnFail: { count: 20 },
      },
    );

    // 3) AI_CITATION_DAILY — her gun 04:00 UTC (Turkiye 07:00)
    await queue.add(
      'AI_CITATION_DAILY',
      { trigger: 'cron' },
      {
        repeat: { pattern: '0 4 * * *', tz: 'UTC' },
        jobId: 'cron:ai-citation-daily',
        removeOnComplete: { count: 50 },
        removeOnFail: { count: 20 },
      },
    );

    // 4) CONTENT_PIVOT_CHECK — Pazartesi 02:30 UTC haftalik
    await queue.add(
      'CONTENT_PIVOT_CHECK',
      { trigger: 'cron' },
      {
        repeat: { pattern: '30 2 * * 1', tz: 'UTC' },
        jobId: 'cron:content-pivot',
        removeOnComplete: { count: 20 },
        removeOnFail: { count: 20 },
      },
    );

    // 5) AI_MENTION_ALARM — gunluk 05:00 UTC (citation snapshot'tan 1 saat sonra)
    await queue.add(
      'AI_MENTION_ALARM',
      { trigger: 'cron' },
      {
        repeat: { pattern: '0 5 * * *', tz: 'UTC' },
        jobId: 'cron:ai-mention-alarm',
        removeOnComplete: { count: 30 },
        removeOnFail: { count: 20 },
      },
    );

    log.log('⏰ Cron: PROCESS_SCHEDULED 30dk · LLMS_FULL_BUILD haftalik · AI_CITATION_DAILY gunluk · CONTENT_PIVOT_CHECK haftalik · AI_MENTION_ALARM gunluk');
  } catch (err: any) {
    log.warn(`Cron kurulumu basarisiz: ${err.message}`);
  }

  log.log('🔧 LuviAI Worker dinliyor (queue: luviai-jobs)');

  const shutdown = async () => {
    log.log('Shutting down...');
    await worker.close();
    await app.close();
    process.exit(0);
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

bootstrap().catch((err) => {
  log.error('Worker bootstrap failed:', err);
  process.exit(1);
});
