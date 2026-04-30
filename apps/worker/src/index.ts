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
import { CampaignOrchestratorService } from '../../api/dist/ads/campaign-orchestrator.service.js';
import { PerformanceSyncService } from '../../api/dist/ads/performance-sync.service.js';
import { AbTestManagerService } from '../../api/dist/ads/ab-test-manager.service.js';
import { KeywordOptimizerService } from '../../api/dist/ads/keyword-optimizer.service.js';
import { BudgetShifterService } from '../../api/dist/ads/budget-shifter.service.js';
import { AutoBoostService } from '../../api/dist/ads/auto-boost.service.js';
import { SettingsService } from '../../api/dist/settings/settings.service.js';

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
    adsOrchestrator: app.get(CampaignOrchestratorService),
    adsPerformance: app.get(PerformanceSyncService),
    adsAbTest: app.get(AbTestManagerService),
    adsKeyword: app.get(KeywordOptimizerService),
    adsBudgetShift: app.get(BudgetShifterService),
    adsAutoBoost: app.get(AutoBoostService),
    prisma: app.get(PrismaService),
    settings: app.get(SettingsService),
  };

  log.log('🔧 Worker DI hazır, BullMQ bağlanıyor');

  const connection = new IORedis(process.env.REDIS_URL ?? 'redis://localhost:6379', {
    maxRetriesPerRequest: null,
  });

  const handlers: Record<string, (data: any) => Promise<any>> = {
    BRAIN_GENERATE: async ({ siteId }) => {
      if (await services.settings.getBoolean('AI_GLOBAL_DISABLED')) {
        log.warn(`[${siteId}] BRAIN_GENERATE atlandı (AI_GLOBAL_DISABLED=1)`);
        return { skipped: true, reason: 'AI_GLOBAL_DISABLED' };
      }
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
      if (await services.settings.getBoolean('AI_GLOBAL_DISABLED')) {
        log.warn(`[${siteId}] TOPIC_ENGINE atlandı (AI_GLOBAL_DISABLED=1)`);
        return { skipped: true, reason: 'AI_GLOBAL_DISABLED' };
      }
      const queue = await services.topics.runEngine(siteId);
      return { queueId: queue.id, tier1Count: (queue.tier1Topics as any[])?.length ?? 0 };
    },

    GENERATE_ARTICLE: async ({ siteId, topic, skipImages, autoPublish, targetIds, articleId }) => {
      // TEST GUARD — ARTICLE_GENERATION_DISABLED veya AI_GLOBAL_DISABLED ise LLM/imaj API'lerine hic gitme.
      // Article kaydı SCHEDULED'da kalır, kullanıcı flag'ı kapatınca tekrar işlenir.
      const aiOff = await services.settings.getBoolean('AI_GLOBAL_DISABLED');
      const articleOff = await services.settings.getBoolean('ARTICLE_GENERATION_DISABLED');
      if (aiOff || articleOff) {
        const reason = aiOff ? 'AI_GLOBAL_DISABLED' : 'ARTICLE_GENERATION_DISABLED';
        log.warn(`[${siteId}] GENERATE_ARTICLE atlandı (${reason}=1) topic=${topic}`);
        if (articleId) {
          await services.prisma.article.update({
            where: { id: articleId },
            data: { status: 'SCHEDULED' as any },
          }).catch(() => {});
        }
        return { skipped: true, reason };
      }
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

      const aiGlobalOff = await services.settings.getBoolean('AI_GLOBAL_DISABLED');

      if (aiGlobalOff) {
        // TEST modu — sahte Brain yaz ki UI "Rakipler tespit edildi" görsün ve tutorial popup
        // 3 koşulun da tamamlandığını anlasın. Gerçek AI çağrısı yok.
        log.warn(`[${siteId}] [1/5] Brain MOCK yazılıyor (AI_GLOBAL_DISABLED=1)`);
        await services.prisma.brain.upsert({
          where: { siteId },
          create: {
            siteId,
            brandVoice: { tone: 'Profesyonel ve sıcak', banned_words: [], examples: [] } as any,
            personas: [
              { name: 'KOBİ Sahibi', age: '35-50', expertise: 'orta', search_intent: 'çözüm', cta: 'iletişime geç' },
            ] as any,
            competitors: [
              { name: 'Rakip A', url: 'https://example-a.com', strengths: ['SEO', 'içerik'], weaknesses: ['fiyat'] },
              { name: 'Rakip B', url: 'https://example-b.com', strengths: ['marka'], weaknesses: ['UX'] },
              { name: 'Rakip C', url: 'https://example-c.com', strengths: ['fiyat'], weaknesses: ['içerik'] },
            ] as any,
            seoStrategy: { pillars: [] } as any,
            glossary: [] as any,
            generatedBy: 'mock',
          },
          update: {
            // Onceki gercek brain'i bozma
          },
        });
      } else {
        log.log(`[${siteId}] [1/5] Brain üretiliyor`);
        await services.brainGen.runGeneration(siteId);
      }

      let audit: any = null;
      if (aiGlobalOff) {
        log.warn(`[${siteId}] [2/5] Audit MOCK yazılıyor (AI_GLOBAL_DISABLED=1)`);
        audit = await services.prisma.audit.create({
          data: {
            siteId,
            overallScore: 70,
            geoScore: 50,
            checks: { mock: true } as any,
            issues: [] as any,
            durationMs: 100,
          },
        });
        await services.prisma.site.update({
          where: { id: siteId },
          data: { status: 'AUDIT_COMPLETE' as any },
        }).catch(() => {});
      } else {
        log.log(`[${siteId}] [2/5] Audit (AI citation otomatik)`);
        audit = await services.audit.runAudit(siteId);
      }

      let queue: any = { id: null, tier1Topics: [] };
      if (aiGlobalOff) {
        log.warn(`[${siteId}] [3/5] Topic engine MOCK yazılıyor (AI_GLOBAL_DISABLED=1)`);
        const mockTier1 = [
          { topic: 'Web Hosting Nedir? Yeni Başlayanlar İçin Rehber', score: 92, persona: 'KOBİ Sahibi', pillar: 'temel', slug: 'web-hosting-nedir', data_summary: 'Yüksek arama hacmi · KOBİ niyeti' },
          { topic: 'En İyi Shared Hosting Karşılaştırması 2026', score: 88, persona: 'Karar Verici', pillar: 'karşılaştırma', slug: 'shared-hosting-karsilastirma', data_summary: 'Karar aşaması · ticari niyet' },
          { topic: 'cPanel Kullanımı Adım Adım', score: 84, persona: 'Geliştirici', pillar: 'nasıl-yapılır', slug: 'cpanel-kullanimi', data_summary: 'How-to · evergreen' },
          { topic: 'WordPress Hosting Seçim Kriterleri', score: 81, persona: 'KOBİ Sahibi', pillar: 'rehber', slug: 'wordpress-hosting-secimi', data_summary: 'Bilgi niyeti · WP odaklı' },
          { topic: 'SSL Sertifikası Nasıl Kurulur?', score: 78, persona: 'Geliştirici', pillar: 'nasıl-yapılır', slug: 'ssl-sertifikasi-kurulum', data_summary: 'How-to · güvenlik' },
          { topic: 'Domain Transferi Yapılırken Dikkat Edilmesi Gerekenler', score: 75, persona: 'KOBİ Sahibi', pillar: 'rehber', slug: 'domain-transferi', data_summary: 'Risk azaltma · ticari' },
        ];
        queue = await services.prisma.topicQueue.create({
          data: {
            siteId,
            planTopics: [] as any,
            gscOpportunities: [] as any,
            geoGaps: [] as any,
            competitorMoves: [] as any,
            tier1Topics: mockTier1 as any,
            tier2Topics: [] as any,
            tier3Topics: [] as any,
            improvements: [] as any,
            totalEvaluated: mockTier1.length,
            expiresAt: new Date(Date.now() + 7 * 24 * 3600 * 1000),
          },
        });
      } else {
        log.log(`[${siteId}] [3/5] Topic engine`);
        queue = await services.topics.runEngine(siteId);
      }
      const tier1Count = ((queue?.tier1Topics as any[]) ?? []).length;

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

      const articleGenDisabled = aiGlobalOff || await services.settings.getBoolean('ARTICLE_GENERATION_DISABLED');
      let scheduleResult: any;
      if (articleGenDisabled) {
        log.warn(`[${siteId}] [5/5] Tier-1 takvim atlandı (ARTICLE_GENERATION_DISABLED=1)`);
        scheduleResult = { scheduled: 0, immediate: null, isTrial: false, skipped: true };
      } else {
        log.log(`[${siteId}] [5/5] Tier-1 takvim yerlesimi (${autopilot ? 8 : 3} makale)`);
        scheduleResult = await services.scheduler.scheduleInitialBatch(siteId, {
          count: autopilot ? 8 : 3,
        });
      }

      // Otopilot ON ise auto-fix (sitemap/robots/llms) tetikle + ilk citation snapshot
      if (autopilot) {
        try {
          await services.autoFix.runAutoFix(siteId, ['sitemap', 'robots', 'llms']);
          log.log(`[${siteId}] Auto-fix tetiklendi (otopilot)`);
        } catch (err: any) {
          log.warn(`[${siteId}] Auto-fix atlandi: ${err.message}`);
        }

        // Ilk AI citation snapshot — baseline gunluk takip icin (AI_GLOBAL_DISABLED ise atla)
        if (aiGlobalOff) {
          log.warn(`[${siteId}] Citation snapshot atlandi (AI_GLOBAL_DISABLED=1)`);
        } else {
          try {
            await services.citationTracker.snapshotSite(siteId);
            log.log(`[${siteId}] AI citation baseline snapshot kaydedildi`);
          } catch (err: any) {
            log.warn(`[${siteId}] Citation snapshot atlandi: ${err.message}`);
          }
        }
      }

      await services.prisma.site.update({
        where: { id: siteId },
        data: { status: 'ACTIVE' },
      });

      log.log(`[${siteId}] ✅ Onboarding tamamlandi — audit, ${tier1Count} tier-1, ${scheduleResult.scheduled} makale takvimde${scheduleResult.isTrial ? ' (TRIAL: 1.makale uretiliyor, kalanlar paket bekliyor)' : ''}${autopilot ? ' [OTOPILOT]' : ''}`);
      return {
        onboarded: true,
        audit: audit?.id ?? null,
        queue: queue?.id ?? null,
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
      if (await services.settings.getBoolean('ARTICLE_GENERATION_DISABLED')) {
        log.warn('PROCESS_SCHEDULED atlandı (ARTICLE_GENERATION_DISABLED=1)');
        return { processed: 0, skippedQuota: 0, disabled: true };
      }
      return services.scheduler.processDueArticles();
    },

    /**
     * LLMS_FULL_BUILD — haftalik cron, tum aktif sitelerin llms-full.txt'ini
     * regenerate eder. AI search engine'lerin sitenizi ezbere bilmesi icin.
     */
    LLMS_FULL_BUILD: async ({ siteId }: { siteId?: string }) => {
      if (await services.settings.getBoolean('AI_GLOBAL_DISABLED')) {
        log.warn('LLMS_FULL_BUILD atlandı (AI_GLOBAL_DISABLED=1)');
        return { skipped: true, reason: 'AI_GLOBAL_DISABLED' };
      }
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
      if (await services.settings.getBoolean('AI_GLOBAL_DISABLED')) {
        log.warn('AI_CITATION_DAILY atlandı (AI_GLOBAL_DISABLED=1)');
        return { skipped: true, reason: 'AI_GLOBAL_DISABLED' };
      }
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

    /**
     * ADS_AUTOPILOT — 6 saat'te bir aktif kampanyalari ROAS'a gore optimize.
     */
    ADS_AUTOPILOT: async () => {
      // Faz 11.1 — multi-step orchestration
      const perf = await services.adsPerformance.syncAllActive();
      const main = await services.adsOrchestrator.optimizeAutopilotCampaigns();
      const ab = await services.adsAbTest.pickWinners();
      const keyword = await services.adsKeyword.optimizeAllGoogleCampaigns();
      const budget = await services.adsBudgetShift.shiftBudgets();
      const boost = await services.adsAutoBoost.findAndBoost();
      return { perf, main, ab, keyword, budget, boost };
    },

    /**
     * VIDEO_GENERATE — Faz 12: çoklu provider video factory.
     * payload: { videoId, provider, brief: { title, scriptText, durationSec, aspectRatio, voiceId, language, style, imageUrls } }
     */
    VIDEO_GENERATE: async ({ videoId, provider, brief }) => {
      log.log(`[video:${videoId}] generate (${provider})`);
      const startedAt = new Date();
      try {
        await services.prisma.video.update({
          where: { id: videoId },
          data: { status: 'GENERATING' as any, startedAt },
        });
        const { getVideoProvider } = await import('../../api/dist/videos/providers/registry.js');
        const provider_ = getVideoProvider(provider);
        const result = await provider_.generate(brief);
        await services.prisma.video.update({
          where: { id: videoId },
          data: {
            status: 'READY' as any,
            videoUrl: result.videoUrl,
            thumbnailUrl: result.thumbnailUrl,
            durationSec: result.durationSec,
            fileSize: result.fileSize,
            providerJobId: result.providerJobId,
            providerRaw: result.raw as any,
            costUsd: result.costUsd as any,
            completedAt: new Date(),
          },
        });
        log.log(`[video:${videoId}] READY ${result.videoUrl}`);
        return { videoId, videoUrl: result.videoUrl };
      } catch (err: any) {
        log.error(`[video:${videoId}] FAILED ${err.message}`);
        await services.prisma.video.update({
          where: { id: videoId },
          data: {
            status: 'FAILED' as any,
            errorMsg: err.message?.slice(0, 4000) ?? 'Unknown error',
            completedAt: new Date(),
          },
        });
        throw err;
      }
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

    // 6) ADS_AUTOPILOT — her 6 saat
    await queue.add(
      'ADS_AUTOPILOT',
      { trigger: 'cron' },
      {
        repeat: { every: 6 * 60 * 60 * 1000 },
        jobId: 'cron:ads-autopilot',
        removeOnComplete: { count: 30 },
        removeOnFail: { count: 20 },
      },
    );

    log.log('⏰ Cron: PROCESS_SCHEDULED 30dk · LLMS_FULL_BUILD haftalik · AI_CITATION_DAILY gunluk · CONTENT_PIVOT_CHECK haftalik · AI_MENTION_ALARM gunluk · ADS_AUTOPILOT 6saat');
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
