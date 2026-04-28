import 'dotenv/config';

// IPv4'e zorla (sunucularda public IPv6 yoksa Node fetch ETIMEDOUT verir)
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const undici = require('undici') as { setGlobalDispatcher: (d: unknown) => void; Agent: new (opts: unknown) => unknown };
  undici.setGlobalDispatcher(new undici.Agent({ connect: { family: 4 } }));
} catch {
  // older Node — sessizce geç
}

import { Worker } from 'bullmq';
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
import { SocialPostsService } from '../../api/dist/social/social-posts.service.js';
import { PrismaService } from '../../api/dist/prisma/prisma.service.js';

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
    socialPosts: app.get(SocialPostsService),
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

    GENERATE_ARTICLE: async ({ siteId, topic, skipImages, autoPublish, targetIds }) => {
      const result = await services.pipeline.runPipeline({
        siteId,
        topic,
        skipImages: skipImages ?? false,
        maxRevize: 1,
      });
      if (autoPublish && result.editorVerdict === 'PASS') {
        const publishResults = await services.publisher.publishArticle(
          result.articleId,
          targetIds ?? [],
        );
        return { ...result, publishResults };
      }
      return result;
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
     * ONBOARDING_CHAIN — wow-moment
     * brain → audit → topics → tier 1 #1 makale (ücretsiz)
     */
    ONBOARDING_CHAIN: async ({ siteId }) => {
      log.log(`[${siteId}] Onboarding chain başlıyor`);

      log.log(`[${siteId}] [1/4] Brain üretiliyor`);
      await services.brainGen.runGeneration(siteId);

      log.log(`[${siteId}] [2/4] Audit`);
      const audit = await services.audit.runAudit(siteId);

      log.log(`[${siteId}] [3/4] Topic engine`);
      const queue = await services.topics.runEngine(siteId);

      const tier1 = (queue.tier1Topics as any[]) ?? [];
      if (tier1.length === 0) {
        log.warn(`[${siteId}] Tier 1 boş, ilk makale atlandı`);
        return { onboarded: true, audit: audit.id, queue: queue.id, firstArticle: null };
      }

      const firstTopic = tier1[0].topic;
      log.log(`[${siteId}] [4/4] İlk makale: "${firstTopic}"`);
      const article = await services.pipeline.runPipeline({
        siteId,
        topic: firstTopic,
        skipImages: true, // ücretsiz makale = görsel yok (cost saving)
        maxRevize: 1,
      });

      await services.prisma.site.update({
        where: { id: siteId },
        data: { status: 'ACTIVE' },
      });

      log.log(`[${siteId}] ✅ Onboarding tamamlandı`);
      return {
        onboarded: true,
        audit: audit.id,
        queue: queue.id,
        firstArticle: { id: article.articleId, slug: article.slug, verdict: article.editorVerdict },
      };
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

  worker.on('completed', async (job) => {
    if (job.id) {
      await services.prisma.job.updateMany({
        where: { bullJobId: job.id },
        data: { status: 'COMPLETED', finishedAt: new Date(), result: job.returnvalue ?? {} },
      });
    }
  });

  worker.on('failed', async (job, err) => {
    if (job?.id) {
      await services.prisma.job.updateMany({
        where: { bullJobId: job.id },
        data: {
          status: 'FAILED',
          finishedAt: new Date(),
          error: err.message,
          attempts: { increment: 1 },
        },
      });
    }
  });

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
