import 'dotenv/config';

import { Worker, Queue, UnrecoverableError, type Job } from 'bullmq';
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
import { ArticleSchedulerService, GENERATION_CLAIM_SKIP_REASON, isScheduledGenerationJobId } from '../../api/dist/articles/article-scheduler.service.js';
import { runGeneratingSweep, bullmqQueueInspector } from '../../api/dist/articles/generating-sweeper.js';
import { failGenerationWithRefund, refundJobAllowanceCharge } from '../../api/dist/articles/allowance-refund.js';
import { PrismaService } from '../../api/dist/prisma/prisma.service.js';
import { PlatformDetectorService } from '../../api/dist/sites/platform-detector.service.js';
import { LlmsFullBuilderService } from '../../api/dist/audit/llms-full-builder.service.js';
import { AiCitationTrackerService } from '../../api/dist/audit/ai-citation-tracker.service.js';
import { AiIndexingPingerService } from '../../api/dist/audit/ai-indexing-pinger.service.js';
import { ContentPivotService } from '../../api/dist/articles/content-pivot.service.js';
import { AiMentionAlarmService } from '../../api/dist/audit/ai-mention-alarm.service.js';
import { CrawlerErrorAlarmService } from '../../api/dist/audit/crawler-error-alarm.service.js';
import { CampaignOrchestratorService } from '../../api/dist/ads/campaign-orchestrator.service.js';
import { PerformanceSyncService } from '../../api/dist/ads/performance-sync.service.js';
import { AbTestManagerService } from '../../api/dist/ads/ab-test-manager.service.js';
import { KeywordOptimizerService } from '../../api/dist/ads/keyword-optimizer.service.js';
import { BudgetShifterService } from '../../api/dist/ads/budget-shifter.service.js';
import { AutoBoostService } from '../../api/dist/ads/auto-boost.service.js';
import { SettingsService } from '../../api/dist/settings/settings.service.js';
import { StuckPageDetectorService } from '../../api/dist/audit/stuck-page-detector.service.js';
import { StuckPageRecoveryService } from '../../api/dist/audit/stuck-page-recovery.service.js';
import { StuckPagePerformanceCheckService } from '../../api/dist/audit/stuck-page-performance-check.service.js';
import { StuckPageExternalRecoveryService } from '../../api/dist/audit/stuck-page-external-recovery.service.js';
import { JobQueueService } from '../../api/dist/jobs/job-queue.service.js';
import { LinkedinOutreachService } from '../../api/dist/intel/linkedin-outreach.service.js';
import { EpostaKampanyaService } from '../../api/dist/eposta-kampanya/eposta-kampanya.service.js';
import { ImageAltSuggestService } from '../../api/dist/audit/image-alt/image-alt-suggest.service.js';
import { ImageAltApplyService } from '../../api/dist/audit/image-alt/image-alt-apply.service.js';
import { decideGeneratedArticlePublish, PUBLISH_SKIP_TEXT, scheduledGenerationPaused } from '../../api/dist/articles/publish-approval.js';
import { autoPublishFollowUp } from '../../api/dist/articles/republish-policy.js';
import { isStuckRepublishJob, runStuckPageSweep, stuckRecoverSkip, stuckRecoveryRoute } from '../../api/dist/audit/stuck-page-autopilot.js';
import { pinProcessToIpv4 } from '../../api/dist/ipv4-pin.js';
import { VideoRenderService } from '../../api/dist/videos/video-render.service.js';
import { VIDEO_RENDER_JOB_CONCURRENCY, VIDEO_RENDER_QUEUE } from '../../api/dist/videos/article-video.config.js';

// IPv4'e sabitle: uretimde calisan IPv6 yolu yok, happy-eyeballs IPv6'ya
// gecince istekler ETIMEDOUT ile duser (gerekce ve kaynaklar: api ipv4-pin.ts).
// Eskiden burada require('undici') ile genel dagitici kuruluyordu; paket ESM
// ("type": "module") oldugu icin require tanimsizdi, hata sessizce yutuluyor ve
// sabitleme HIC uygulanmiyordu (undici worker'in bagimliligi da degil).
// ESM'de importlar bu satirdan once degerlendirilir; hicbiri import aninda soket
// acmaz — Redis/Prisma/HTTP baglantilari asagida bootstrap()'ta kurulur.
// ALLOW_IPV6=1 sabitlemeyi kapatir.
const log = new Logger('Worker');
if (!pinProcessToIpv4()) log.warn('IPv4 sabitlemesi kapali (ALLOW_IPV6)');

/**
 * Gunluk otomatik AI olcumu kapali mi (musteri tetikli mod). ACIKCA ACILMALI:
 * yalniz AI_CITATION_DAILY_CRON === 'true' iken kosar. Eskiden yalniz 'false'
 * kapatiyordu; degisken unutulan bir ortamda tum siteler her gun olculur ve
 * havuz anahtarlarindan odenirdi. Uretimde 'false' oldugu icin davranis ayni.
 */
const isCitationDailyDisabled = () => process.env.AI_CITATION_DAILY_CRON !== 'true';
/** LinkedIn outreach botu (Faz 8) — varsayilan KAPALI; yalniz bayrak 1 iken tekrar isi kurulur */
/** Env varsayilani — gercek karar serviste (panel ayari KvStore'da env'i ezer) */
const isLinkedinOutreachEnvDefault = () => process.env.OPENCLAW_LINKEDIN_OUTREACH_ENABLED === '1';

/**
 * Kalici erisim engeli turleri: site sahibi RanksUpBot'a izin vermeden tekrar
 * denemek ayni engele carpar (api/src/sites/crawl-access.ts CrawlAccessIssue,
 * common/block-detect.ts BlockKind). rate_limited (429), unavailable (503) ve
 * ulasilamama (timeout/dns/network/http_error) gecici olabilir; onlar normal
 * yeniden deneme hakkini kullanir.
 */
const PERMANENT_BLOCK_KINDS = new Set(['waf', 'challenge', 'auth', 'forbidden', 'robots']);

/**
 * Anasayfa okunamadi diye denetim/brain'in attigi CrawlAccessError (HttpException
 * 422, `issue` alani) kalici bir engel mi. Sinif api/dist'ten import edilmez:
 * worker derlemesi dist'e bagli, alan kontrolu yeterli ve kirilgan degil.
 */
function isPermanentCrawlBlock(err: unknown): boolean {
  const issue = (err as { issue?: { state?: unknown; kind?: unknown } } | null | undefined)?.issue;
  return issue?.state === 'blocked' && typeof issue.kind === 'string' && PERMANENT_BLOCK_KINDS.has(issue.kind);
}

type AccountSkip = { skipped: true; reason: 'account_deletion' | 'job_canceled' };

/**
 * Isin DB kaydina bak: hesap silme talebi varsa ya da is iptal edildiyse handler
 * HIC calismaz.
 *
 * NEDEN: silme talebi ve site silme kuyruktaki isleri DB'de CANCELED yapar ve
 * BullMQ'dan silmeyi dener — ama bu en iyi caba: silinemeyen, o an yeniden
 * denenen ya da gecikmeli is hesabi kapatmis birinin sitesine dokunmaya devam
 * ederdi. Tek sorgu (bullJobId tekil indeks); DB kaydi olmayan isler (cron
 * tekrarlari) ya da kaydi henuz yazilmamis is icin null doner, is normal calisir.
 */
async function accountSkip(prisma: any, bullJobId: string | undefined): Promise<AccountSkip | null> {
  if (!bullJobId) return null;
  const row = await prisma.job.findUnique({
    where: { bullJobId },
    select: { status: true, user: { select: { deletionRequestedAt: true } } },
  });
  if (!row) return null;
  if (row.user?.deletionRequestedAt) return { skipped: true, reason: 'account_deletion' };
  if (row.status === 'CANCELED') return { skipped: true, reason: 'job_canceled' };
  return null;
}

const isAccountSkip = (value: unknown): value is AccountSkip => {
  const v = value as Partial<AccountSkip> | null | undefined;
  return v?.skipped === true && (v.reason === 'account_deletion' || v.reason === 'job_canceled');
};

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
    platformDetector: app.get(PlatformDetectorService),
    llmsBuilder: app.get(LlmsFullBuilderService),
    citationTracker: app.get(AiCitationTrackerService),
    indexingPinger: app.get(AiIndexingPingerService),
    contentPivot: app.get(ContentPivotService),
    aiAlarm: app.get(AiMentionAlarmService),
    crawlerAlarm: app.get(CrawlerErrorAlarmService),
    adsOrchestrator: app.get(CampaignOrchestratorService),
    adsPerformance: app.get(PerformanceSyncService),
    adsAbTest: app.get(AbTestManagerService),
    adsKeyword: app.get(KeywordOptimizerService),
    adsBudgetShift: app.get(BudgetShifterService),
    adsAutoBoost: app.get(AutoBoostService),
    prisma: app.get(PrismaService),
    settings: app.get(SettingsService),
    stuckDetector: app.get(StuckPageDetectorService),
    stuckRecovery: app.get(StuckPageRecoveryService),
    stuckPerfCheck: app.get(StuckPagePerformanceCheckService),
    stuckExternal: app.get(StuckPageExternalRecoveryService),
    jobs: app.get(JobQueueService),
    linkedin: app.get(LinkedinOutreachService),
    eposta: app.get(EpostaKampanyaService),
    imageAltSuggest: app.get(ImageAltSuggestService),
    imageAltApply: app.get(ImageAltApplyService),
    videoRender: app.get(VideoRenderService),
  };

  log.log('🔧 Worker DI hazır, BullMQ bağlanıyor');

  const connection = new IORedis(process.env.REDIS_URL ?? 'redis://localhost:6379', {
    maxRetriesPerRequest: null,
  });

  // Takili uretim supurucusunun BullMQ durum sorgulari (SWEEP_STUCK_GENERATING);
  // ilk turda kurulur, worker'la ayni baglantiyi kullanir (cron Queue'su gibi)
  let sweepQueueRef: Queue | null = null;
  const sweepQueue = () => (sweepQueueRef ??= new Queue('luviai-jobs', { connection }));

  // job: GENERATE_ARTICLE takvim isini (BullMQ kimligi) ve yeniden deneme
  // hakkini okur; diger isler yalniz veriyi kullanir.
  const handlers: Record<string, (data: any, job?: Job) => Promise<any>> = {
    BRAIN_GENERATE: async ({ siteId, forceRegenerate }) => {
      if (await services.settings.getBoolean('AI_GLOBAL_DISABLED')) {
        log.warn(`[${siteId}] BRAIN_GENERATE atlandı (AI_GLOBAL_DISABLED=1)`);
        return { skipped: true, reason: 'AI_GLOBAL_DISABLED' };
      }
      await services.brainGen.runGeneration(siteId, { forceRegenerate: !!forceRegenerate });
      return { ok: true };
    },

    SITE_AUDIT: async ({ siteId, trigger }) => {
      // Zamanlanmis tarama (AuditCron) is verisinde trigger 'system' tasir:
      // kullanicinin olcum hakkindan dusmez. Bilinmeyen deger 'user' sayilir.
      const kaynak = trigger === 'system' || trigger === 'test' ? trigger : 'user';
      const audit = await services.audit.runAudit(siteId, { trigger: kaynak });
      return { auditId: audit.id, score: audit.overallScore };
    },

    AUTO_FIX: async ({ siteId, fixes }) => {
      return services.autoFix.runAutoFix(siteId, fixes);
    },

    // Gorsel alt metni onerisi (vision) — musteri sitesine YAZMAZ, yalnizca
    // SiteImage.suggestedAlt doldurur. AI kapaliysa LLMProviderService zaten reddeder.
    IMAGE_ALT_SUGGEST: async ({ siteId, imageIds, userId }) => {
      if (await services.settings.getBoolean('AI_GLOBAL_DISABLED')) {
        return { skipped: true, reason: 'AI_GLOBAL_DISABLED' };
      }
      return services.imageAltSuggest.suggestMany(siteId, Array.isArray(imageIds) ? imageIds : [], userId);
    },

    // Onaylanmis alt metinlerini musteri sitesine yaz (yalnizca APPROVED/DECORATIVE;
    // servis kendisi filtreler). AI cagrisi yok — AI_GLOBAL_DISABLED'dan etkilenmez.
    IMAGE_ALT_APPLY: async ({ siteId, imageIds, userId }) => {
      return services.imageAltApply.applyMany(siteId, Array.isArray(imageIds) ? imageIds : [], userId);
    },

    TOPIC_ENGINE: async ({ siteId }) => {
      if (await services.settings.getBoolean('AI_GLOBAL_DISABLED')) {
        log.warn(`[${siteId}] TOPIC_ENGINE atlandı (AI_GLOBAL_DISABLED=1)`);
        return { skipped: true, reason: 'AI_GLOBAL_DISABLED' };
      }
      const queue = await services.topics.runEngine(siteId);
      return { queueId: queue.id, tier1Count: (queue.tier1Topics as any[])?.length ?? 0 };
    },

    GENERATE_ARTICLE: async ({ siteId, topic, skipImages, autoPublish, targetIds, articleId, publishApproved, automatedRewrite }, job) => {
      // ARTICLE_GENERATION_DISABLED → article üretimini tamamen atla (SCHEDULED'da kalır).
      // AI_GLOBAL_DISABLED → pipeline mock moda düşer (içeride yönetilir, dosya yine WordPress/FTP'ye yüklenir).
      const articleOff = await services.settings.getBoolean('ARTICLE_GENERATION_DISABLED');
      if (articleOff) {
        log.warn(`[${siteId}] GENERATE_ARTICLE atlandı (ARTICLE_GENERATION_DISABLED=1) topic=${topic}`);
        if (articleId) {
          // Yalniz uretim sahipligi birakilir (GENERATING → SCHEDULED). Eskiden her
          // isin yazisi kosulsuz SCHEDULED yapiliyordu: yeniden yazilan YAYINDAKI
          // makale (pivot, kapali dongu) yayindan dusup takvime donuyordu.
          await services.prisma.article.updateMany({
            where: { id: articleId, status: 'GENERATING' as any },
            data: { status: 'SCHEDULED' as any },
          }).catch(() => {});
        }
        return { skipped: true, reason: 'ARTICLE_GENERATION_DISABLED' };
      }
      // Takvim isi + akis Durduruldu → uretme; yazi SCHEDULED kalir, akis
      // acilinca saatlik tarama alir (api publish-approval.ts scheduledGenerationPaused)
      if (await scheduledGenerationPaused(services.prisma, { articleId })) {
        log.log(`[${siteId}] GENERATE_ARTICLE atlandı (otomatik akış durdurulmuş) article=${articleId}`);
        return { skipped: true, reason: 'AUTOPILOT_PAUSED' };
      }
      // Takvimin gecikmeli isi (gen:article:<id>) URETMEZ: yaziyi saatlik taramayla
      // ayni atomik sahiplenmeyle (SCHEDULED → GENERATING) alip normal uretim isi
      // olarak kuyruga atar. Ikisi ayni yaziyi bulursa yalniz biri alir; eskiden
      // ikisi de uretiyordu (api article-scheduler.service claimAndQueue).
      if (isScheduledGenerationJobId(job?.id)) {
        const dispatch = await services.scheduler.dispatchScheduledArticle(articleId);
        if (dispatch.skipped) log.log(`[${siteId}] Takvim isi uretmeden dondu (${dispatch.reason}) article=${articleId}`);
        return dispatch;
      }
      // Yazi hala SCHEDULED ise (kuyruga atan sahiplenmemis) once sahiplen;
      // baskasi aldiysa ya da yazi silindiyse uretme (LLM maliyeti harcanmaz).
      // Sahiplenme makale hakkindan duser: hak doluysa yazi SCHEDULED kalir
      // (QUOTA_EXHAUSTED). Deneme hesabinin SCHEDULED yazisini otomasyon almaz
      // (TRIAL_MANUAL_ONLY; api billing/trial-policy.ts) — LLM harcanmaz.
      const claim = await services.scheduler.claimForGeneration(articleId);
      if (claim !== 'proceed') {
        log.log(`[${siteId}] GENERATE_ARTICLE atlandı (${claim}) article=${articleId}`);
        return { skipped: true, reason: GENERATION_CLAIM_SKIP_REASON[claim] };
      }
      // OTOMATIK yeniden yazim (yalniz icerik pivotu koyar): tarama ile is
      // arasinda yazi yayindan kalkmis ya da canli kopyasinin hedefi silinmis /
      // pasiflesmis olabilir. Yeni metin canliya ulasamayacaksa 5 ajanli uretim
      // (LLM butcesi) hic baslamaz (api content-pivot.service automatedRewriteBlock).
      const automated = automatedRewrite === true && typeof articleId === 'string' && articleId !== '';
      if (automated) {
        const block = await services.contentPivot.automatedRewriteBlock(articleId);
        if (block) {
          log.log(`[${siteId}] Otomatik yeniden yazım başlatılmadı (${block.block}) article=${articleId}: ${block.blockReason}`);
          return { skipped: true, reason: 'LIVE_REWRITE_BLOCKED', block: block.block, detail: block.blockReason };
        }
      }
      // Yayin karari IS KOSARKEN (api publish-approval.ts): autoPublish yalniz
      // bir istek. Site su an Tam otomatik + akis acik degilse (Yari otomatik
      // varsayilan) yazi READY_TO_PUBLISH'te onayi bekler. Takvimin gecikmeli
      // isleri ve bu duzeltmeden once kuyruga girmis autoPublish:true isler de
      // boylece musterinin GUNCEL secimine uyar.
      const jobPublish = { siteId, autoPublish, publishApproved, targetIds };
      const plan = await decideGeneratedArticlePublish(services.prisma, jobPublish);
      try {
        const result = await services.pipeline.runPipeline({
          siteId,
          topic,
          skipImages: skipImages ?? false,
          maxRevize: 1,
          articleId,
          // Hemen yayinlanacaksa QA'yi bekle — yoksa publisher ikinci kez
          // kosturuyor (cift LLM cagrisi + yaris).
          awaitQa: plan.publish,
          // "Onayini bekliyor / Henuz yayinda degil" e-postasi yalniz yazi onay
          // bekleyecekse: Tam otomatikte yazi asagida hemen yayinlaniyor ve
          // e-posta yanlis oluyordu. Yayin olmazsa e-posta asagida gonderilir.
          notifyReady: !plan.publish,
          // Editor PASS vermezse yayindaki kayit ezilmez (pipeline keepLiveRow)
          automatedRewrite: automated,
        });
        if ((result as any).liveKept) {
          log.log(`[${siteId}] ${result.articleId} otomatik yeniden yazım uygulanmadı (${result.editorVerdict}); yayındaki metin korundu`);
          return result;
        }
        // Otomatik yayin planlanmisti ama yazi yayinlanmadi → yazi gercekten onay
        // bekliyor; pipeline'in atladigi "onayini bekliyor" e-postasi simdi dogru.
        const notifyAwaitingApproval = () => {
          services.pipeline.notifyArticleReady(siteId, result.articleId).catch((err: any) => {
            log.warn(`[${siteId}] ${result.articleId} onay e-postasi gonderilemedi: ${err?.message ?? err}`);
          });
        };
        if (plan.publish && (result as any).mock) {
          // AI_GLOBAL_DISABLED (TEST modu) sahte metni ("MOCK ARTICLE ...") musterinin
          // sitesine ONAYSIZ yazilmaz; yazi READY_TO_PUBLISH'te kalir, test icin
          // panelden elle yayinlanabilir.
          log.warn(`[${siteId}] ${result.articleId} sahte (mock) icerik — otomatik yayinlanmadi`);
          return { ...result, publishSkipped: 'mock' };
        }
        if (plan.publish && result.editorVerdict === 'PASS') {
          // Uretim birkac dakika surer: bu arada Yari otomatige gecildiyse yayinlama
          const now = await decideGeneratedArticlePublish(services.prisma, jobPublish);
          if (!now.publish) {
            log.log(`[${siteId}] ${result.articleId} yayinlanmadi: ${PUBLISH_SKIP_TEXT[now.reason]}`);
            notifyAwaitingApproval();
            return { ...result, publishSkipped: now.reason };
          }
          // Otomatik yayin (paylasilan sozlesme D2): yayinciya initiator VERILMEZ,
          // varsayilani 'automation'dir — musterinin sildigi WordPress yazisi
          // yeniden olusturulmaz ('live_entry_missing', kayda missingAt) ve hicbir
          // canli kopyaya yazilamazsa sonuc agentOutputs.liveWriteBlocked'a
          // kaydedilir (icerik pivotu 30 gun yeniden yazmaz). 'user' yalniz
          // PUBLISH_ARTICLE'da (kullanicinin acik yayin istegi).
          try {
            const publishResults = await services.publisher.publishArticle(result.articleId, now.targetIds);
            // Hicbir hedef yazamadiysa (aktif varsayilan hedef yok / hepsi hata)
            // yazi READY_TO_PUBLISH'te kalir, kullanicinin onayini bekler.
            // TUM hedefler bilerek atlandiysa (yayindaki yazi: kopya acilmadi,
            // hedef pasif, cop kutusu) "onayini bekliyor / henuz yayinda degil"
            // e-postasi YANLIS: eski hali yayinda ve onay bir sey degistirmez;
            // yayinci yaziyi PUBLISHED'a dondurup kopyalari isaretler. Neden
            // loga ve is sonucuna yazilir (api republish-policy.ts autoPublishFollowUp).
            const follow = autoPublishFollowUp(publishResults);
            if (follow.notifyAwaitingApproval) notifyAwaitingApproval();
            if (!follow.written && follow.skipped.length > 0) {
              log.warn(`[${siteId}] ${result.articleId} yeniden yayınlanmadı, hiçbir hedefe yazılmadı: ${follow.skipped.map((s) => `${s.targetType}=${s.skipped}`).join(', ')}`);
              return { ...result, publishResults, publishSkipped: 'live_targets_skipped', skippedTargets: follow.skipped };
            }
            return { ...result, publishResults };
          } catch (err: any) {
            // Uretim TAMAM, yayin engellendi (QA_BLOCKED vb.). Asagidaki catch yaziyi
            // FAILED'a cekip isi yeniden denetiyordu: saglam yazi "basarisiz"
            // gorunuyor, her deneme 5 ajanli uretimi bastan kosturup LLM maliyetini
            // katliyordu. Yazi READY_TO_PUBLISH'te kullanicinin kararini bekler.
            log.warn(`[${siteId}] ${result.articleId} otomatik yayinlanamadi: ${err?.message ?? err}`);
            notifyAwaitingApproval();
            return { ...result, publishError: String(err?.message ?? err) };
          }
        }
        if (autoPublish === true && !plan.publish) {
          log.log(`[${siteId}] ${result.articleId} yayinlanmadi: ${PUBLISH_SKIP_TEXT[plan.reason]}`);
          return { ...result, publishSkipped: plan.reason };
        }
        return result;
      } catch (err: any) {
        // Pipeline patlarsa uretimdeki yaziyi FAILED'a cek (kullanici listede gorebilir).
        // Sahiplik bu iste kalir: BullMQ yeniden deneyecekse yazi GENERATING'de
        // bekler. Eskiden ilk hatada FAILED yapiliyordu; bekleme arasinda panel
        // "basarisiz" gosteriyor, "Simdi uret" (FAILED'i de alir) ayni yaziyi
        // ikinci kez uretime sokabiliyordu. Yalniz uretimdeki (GENERATING /
        // EDITING) yazi: yeniden yazilan YAYINDAKI makale (pivot, kapali dongu)
        // basarisiz yeniden yazimla FAILED olmaz, canli kalir.
        //
        // Son denemede makale hakki da iade edilir (api articles/allowance-refund.ts): yazi
        // FAILED olurken bu denemenin hak isareti AYNI islemde iade izine cevrilir ve sayac
        // bir azalir; supurucu ya da tekrarlanan olay ayni hakki ikinci kez iade edemez.
        // Kapali dongu guncellemesi (yayindaki yazi GENERATING degil) FAILED olmaz; onun
        // dusus izi is verisinde, iade is satiri uzerinden.
        const willRetry = !!job && job.attemptsMade + 1 < (job.opts?.attempts ?? 1) && !isPermanentCrawlBlock(err);
        if (!willRetry) {
          let failedNow = false;
          if (articleId) {
            const r = await failGenerationWithRefund(services.prisma, {
              articleId,
              where: { id: articleId, status: { in: ['GENERATING', 'EDITING'] as any } },
            }).catch(() => null);
            failedNow = !!r?.failed;
          }
          if (!failedNow && job?.id && (job.data as { allowanceCharge?: unknown } | undefined)?.allowanceCharge) {
            await refundJobAllowanceCharge(services.prisma, { bullJobId: String(job.id) }).catch(() => null);
          }
        }
        throw err;
      }
    },

    // overwriteRemoteEdits: kullanici panelde "WordPress'teki degisikliklerin
    // uzerine yaz" dediyse API is verisine koyar (paylasilan sozlesme C1);
    // yalniz acik true gecer. Otomasyon (pivot, takili sayfa, Tam otomatik
    // uretim) bu isi acmaz ve bu secenegi hic vermez.
    // initiator 'user' (paylasilan sozlesme D2): PUBLISH_ARTICLE'i yalniz API'nin
    // yayin ucu kuyruga atar (api articles.service queuePublish; is verisinde de
    // initiator 'user'). Alan eklenmeden once kuyruga girmis isler de oradan
    // geldi, ayni sekilde 'user' sayilir. Yayinci silinen yaziyi yalniz boyle bir
    // yayinda ve yalniz adi verilen hedefte yeniden olusturur.
    PUBLISH_ARTICLE: async ({ articleId, targetIds, overrideQa, overwriteRemoteEdits }) => {
      return services.publisher.publishArticle(articleId, targetIds ?? [], {
        overrideQa: !!overrideQa,
        overwriteRemoteEdits: overwriteRemoteEdits === true,
        initiator: 'user',
      });
    },

    IMPROVE_PAGE: async (data) => {
      log.warn(`IMPROVE_PAGE not implemented: ${JSON.stringify(data)}`);
      return { ok: false, error: 'not implemented' };
    },

    /**
     * ONBOARDING_CHAIN — brain + denetim + platform tespiti (paralel) → konu
     * motoru → tier-1 takvim (api article-scheduler.service scheduleInitialBatch).
     * Akis acikken 8, kapaliyken 3 konu takvime yazilir. Ucretli planda ilki hemen
     * ve ucretsiz uretilir, digerlerini akis acikken saatlik tarama
     * (PROCESS_SCHEDULED) zamani gelince uretir ve her biri uretime alinirken
     * makale hakkindan duser. DENEME HESABINDA HICBIR MAKALE KENDILIGINDEN URETILMEZ
     * (sahip karari 21.10.2026, api billing/trial-policy.ts): takvime yalniz konu
     * basliklari yazilir; kullanici yayin hedefi baglayip "Simdi uret" ile en fazla 2
     * makale baslatir, hakki asan konular plan yukseltilene kadar kilitli bekler
     * (api articles/plan-lock.ts).
     * Akis acikken ayrica auto-fix (sitemap + llms; robots onay ister) ve ilk AI
     * gorunurluk olcumu (sistem modu, kotadan dusmez) kosar.
     */
    ONBOARDING_CHAIN: async ({ siteId }) => {
      log.log(`[${siteId}] Onboarding chain başlıyor`);

      const site = await services.prisma.site.findUniqueOrThrow({ where: { id: siteId } });
      const autopilot = (site as any).autopilot !== false;

      const aiGlobalOff = await services.settings.getBoolean('AI_GLOBAL_DISABLED');

      if (aiGlobalOff) {
        // TEST modu — sahte Brain yaz ki UI "Rakipler tespit edildi" görsün ve tutorial popup
        // 3 koşulun da tamamlandığını anlasın. Gerçek AI çağrısı yok.
        log.warn(`[${siteId}] [1/5] Brain MOCK (sahne icin 30sn bekleniyor — AI_GLOBAL_DISABLED=1)`);
        await new Promise((r) => setTimeout(r, 30000));
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
        log.log(`[${siteId}] [1/5] Brain + Audit + Platform paralel`);
      }

      // ⚡ Paralel başlat — Brain, Audit ve Platform birbirine bağımlı değil.
      // Topics brain'i + audit'i bekler; o yüzden bunlar bittikten sonra çalışır.
      const brainPromise = aiGlobalOff
        ? Promise.resolve(null) // mock zaten yukarıda yazıldı
        : services.brainGen.runGeneration(siteId).catch((err) => {
            log.error(`[${siteId}] brain hata: ${err.message}`);
            throw err;
          });

      // SISTEM taramasi (asagidaki baseline snapshot gibi): kullanici
      // tetiklemedi. 'user' olsaydi denetimin AI adimi yeni kullanicinin
      // haftalik olcum hakkini ilk gun yiyor, "AI onerisi al" 7 gun kilitli
      // kaliyordu (audit.service runAudit → aiCitation.runForSite trigger).
      const auditPromise = services.audit.runAudit(siteId, { trigger: 'system' }).catch((err) => {
        log.error(`[${siteId}] audit hata: ${err.message}`);
        return null; // audit fail olsa bile zincir devam etsin
      });

      const platformPromise = services.platformDetector.detect(site.url)
        .then(async (detection) => {
          // Site okunamadiysa (WAF/challenge, zaman asimi) sonuc bir tahmin degil:
          // onceki tespitin uzerine 'unknown' yazilmaz (sites.controller detectPlatform ile ayni kural)
          if (detection.unreadable) {
            log.warn(`[${siteId}] Platform tespit edilemedi, site okunamadı: ${detection.unreadable.reason}`);
            return detection;
          }
          await services.prisma.site.update({
            where: { id: siteId },
            data: {
              platform: detection.platform,
              platformConfidence: detection.confidence,
              platformDetectedAt: new Date(),
            } as any,
          });
          log.log(`[${siteId}] Platform: ${detection.platform} (${(detection.confidence * 100).toFixed(0)}%)`);
          return detection;
        })
        .catch((err) => {
          log.warn(`[${siteId}] Platform detect fail: ${err.message}`);
          return null;
        });

      // Brain mutlaka bitsin (topics buna bağımlı). Audit + platform fire-and-collect.
      await brainPromise;
      const [audit] = await Promise.all([auditPromise, platformPromise]);

      let queue: any = { id: null, tier1Topics: [] };
      if (aiGlobalOff) {
        log.warn(`[${siteId}] [3/5] Topic engine MOCK (sahne icin 30sn bekleniyor — AI_GLOBAL_DISABLED=1)`);
        await new Promise((r) => setTimeout(r, 30000));
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
      // Platform tespiti yukarıda paralel başlatıldı, burada tekrar yapılmıyor.

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

      // Otopilot ON ise auto-fix (sitemap/llms) tetikle + ilk citation snapshot.
      // robots BILEREK yok: robots.txt yazimi onizleme + acik onay ister,
      // onaysiz kuyruk yolunda daima 'preview_required' doner (auto-fix.service.ts)
      // ve yalniz hata gurultusu uretirdi. Kullanici panelden onizleyip onaylar.
      if (autopilot) {
        try {
          await services.autoFix.runAutoFix(siteId, ['sitemap', 'llms']);
          log.log(`[${siteId}] Auto-fix tetiklendi (otopilot)`);
        } catch (err: any) {
          log.warn(`[${siteId}] Auto-fix atlandi: ${err.message}`);
        }

        // Ilk AI citation snapshot — baseline gunluk takip icin (AI_GLOBAL_DISABLED ise atla)
        if (aiGlobalOff) {
          log.warn(`[${siteId}] Citation snapshot atlandi (AI_GLOBAL_DISABLED=1)`);
        } else {
          try {
            // SISTEM modu — otomatik izlemenin baseline'i; kullanicinin
            // aylik citation kotasindan dusmez (bkz. ai-citation.service.ts).
            await services.citationTracker.snapshotSite(siteId, { trigger: 'system' });
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

      // Takvim yazilari uretime alinirken makale hakkindan duser; hak yetmezse
      // bekler. Deneme hesabinda otomasyon uretmez: yalniz konu basliklari, makaleyi
      // kullanici baslatir (api article-scheduler.service, billing/trial-policy.ts)
      const takvimNotu = scheduleResult.scheduled === 0
        ? ''
        : scheduleResult.isTrial
          ? ' (deneme hesabi: yalniz konu basliklari; makaleyi kullanici "Şimdi üret" ile baslatir)'
          : ` (${scheduleResult.immediate ? 'ilki hemen uretimde; ' : ''}digerleri ${autopilot ? 'zamani gelince saatlik taramayla uretilir' : 'akis acilana kadar bekler'}; her biri uretime alinirken makale hakkindan duser, hak yetmezse bekler)`;
      log.log(`[${siteId}] ✅ Onboarding tamamlandi — audit, ${tier1Count} tier-1, ${scheduleResult.scheduled} makale takvimde${takvimNotu}${autopilot ? ' [OTOPILOT]' : ''}`);
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
     * PROCESS_SCHEDULED — saatlik: yayin saatine 15 dk ya da daha az kalan,
     * akisi acik sitelerin SCHEDULED yazilarini uretime alir. Her yazi uretime
     * alinirken aylik makale hakkindan bir kez duser; hak doluysa yazi bekler.
     * Deneme hesaplarinin yazilari taranmaz (otomatik uretim yok; api
     * article-scheduler.service processDueArticles, articles/plan-lock.ts).
     * Is verisinde userId varsa yalniz o kullanicinin yazilari taranir: plan
     * yukseltme sonrasi bekleyen yazilar saatlik turu beklemesin (api
     * articles/scheduled-kick.ts). Saatlik tekrar isinin verisi bos: herkes.
     */
    PROCESS_SCHEDULED: async (data) => {
      if (await services.settings.getBoolean('ARTICLE_GENERATION_DISABLED')) {
        log.warn('PROCESS_SCHEDULED atlandı (ARTICLE_GENERATION_DISABLED=1)');
        return { processed: 0, skippedQuota: 0, disabled: true };
      }
      const userId = typeof data?.userId === 'string' && data.userId ? data.userId : undefined;
      return services.scheduler.processDueArticles(userId ? { userId } : {});
    },

    /**
     * SWEEP_STUCK_GENERATING — 30 dk'da bir: 2 saattir GENERATING'de duran ve
     * canli BullMQ isi olmayan yazilari (worker sahiplenme ile kuyruga atma
     * arasinda oldu, is maxStalledCount'u asti) takvim yazisiysa takvime geri
     * koyar (en fazla 2 kez), degilse FAILED yapar. Kural ve guvenlik kosulu:
     * api articles/generating-sweeper.ts.
     */
    SWEEP_STUCK_GENERATING: async () => {
      return runGeneratingSweep({ prisma: services.prisma, inspector: bullmqQueueInspector(sweepQueue()), log });
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
      // URUN KARARI (27.08.2026): otomatik gunluk olcum KAPALI, musteri kendi
      // tetikler ("Yeniden Test"). Kayit asamasinda da atlaniyor; bu kontrol
      // Redis'te kalmis eski bir tekrar isinin yine de kosmasina karsi.
      if (isCitationDailyDisabled()) {
        log.warn('AI_CITATION_DAILY atlandı (AI_CITATION_DAILY_CRON true degil — musteri tetikli mod)');
        return { skipped: true, reason: 'AI_CITATION_DAILY_CRON' };
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
     * CRAWLER_ERROR_ALARM — 6 saatte bir: bir bot 4xx/5xx alirken digerleri
     * basarili yanit (2xx ya da 304) aliyorsa (bot-ozel engel) bildirim.
     * IRS.gov vakasi (Ağu 2026).
     */
    CRAWLER_ERROR_ALARM: async () => {
      return services.crawlerAlarm.scanAndAlert();
    },

    /**
     * LINKEDIN_OUTREACH_TICK — 30 dk'da bir: LinkedIn botu bir tur (en fazla 3
     * islem; hafta ici 09-18 TR disinda "yapilacak yok" doner). Servis kendi
     * bayragini da kontrol eder; duraklatilmissa dokunmaz. `jitter:true`:
     * servis tick'lerin %25'ini rastgele atlar — NEDEN: cron sabit 30 dk,
     * hedef 20-40 dk rastgele ritim (kalip olusmasin).
     */
    LINKEDIN_OUTREACH_TICK: async () => {
      return services.linkedin.tick({ dryRun: false, jitter: true });
    },

    /**
     * EPOSTA_KAMPANYA_TICK — 30 dk'da bir: kurumsal e-posta turu (tur basina en fazla 40, gunluk 200 / aylik 6.000).
     * Panel anahtari kapaliyken, hafta ici 10-17 TR disinda, IYS onayli (SIRADA) adres yokken "yapilacak yok" doner.
     */
    EPOSTA_KAMPANYA_TICK: async () => {
      return services.eposta.tick();
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
     * STUCK_PAGE_DETECT — tek site icin GSC tabanli stuck page tarama.
     * Cron tarafindan haftalik tetiklenir veya manuel API'den.
     */
    STUCK_PAGE_DETECT: async ({ siteId }) => {
      return services.stuckDetector.detect(siteId);
    },

    /**
     * STUCK_PAGE_DETECT_ALL — haftalik cron. Kurallar api stuck-page-autopilot.ts:
     * tespit yalniz plani Takili Sayfalar'i kapsayan (Profesyonel+) aktif
     * sitelerde; otomatik kurtarma (yeniden yazip YAYINLAR) yalniz otopilot
     * acik + Tam otomatik sitede, yalniz RanksUp makalelerinde, yalniz yazinin
     * kayittaki metni canlidaysa (onay bekleyen yeniden yazim yok), yazi son 30
     * gunde yayinlanmadiysa, adres yakin zamanda basarisiz olmadiysa ve yalniz
     * yazinin TAKILI ADRESTEKI kopyasi yerinde guncellenebiliyorsa
     * (WordPress / FTP / SFTP / cPanel / GitHub / KobiPratik). Yari otomatikte
     * sayfalar "Tespit edildi"de kullanicinin "AI Duzelt"ini bekler.
     */
    STUCK_PAGE_DETECT_ALL: async () => {
      const summary = await runStuckPageSweep({
        prisma: services.prisma,
        detector: services.stuckDetector,
        jobs: services.jobs,
        log,
      });
      // Atlanan her sayfa kendi kovasinda (eklemeli alanlar; eski dist'te yoksa 0)
      log.log(
        `STUCK_PAGE_DETECT_ALL: ${summary.totalSites} site, ${summary.totalDetected} stuck, ${summary.autoRecoveryQueued} otomatik recovery, `
        + `${summary.awaitingApprovalSites} site onay bekliyor (Yari otomatik), `
        + `${summary.notUpdatablePages ?? 0} sayfa takili adreste yerinde guncellenemiyor (oneri bekler), `
        + `${summary.closedDuplicatePages ?? 0} sayfa ayni adreste kapali kayitli (eski cift satir), `
        + `${summary.pendingRewritePages ?? 0} sayfanin yazisinin kayittaki metni canlida degil, `
        + `${summary.recentlyPublishedPages ?? 0} sayfanin yazisi son 30 gunde yayinlandi, `
        + `${summary.recentFailurePages ?? 0} sayfa yakin zamanda basarisiz oldu (bekleme suresinde), `
        + `${summary.alreadyQueuedPages ?? 0} sayfanin bekleyen kurtarma isi zaten var, `
        + `${summary.staleClaimsReleased ?? 0} sahipsiz kalan "duzeltiliyor" satiri birakildi`,
      );
      return summary;
    },

    /**
     * STUCK_PAGE_RECOVER — tek stuck sayfa icin LLM tabanli recovery.
     * Kaynaklar: haftalik otopilot (triggeredBy 'autopilot') ve paneldeki toplu
     * onarim (POST stuck-pages/recover-batch; triggeredBy oturumdaki kullanici,
     * istek isi kuyruga alip hemen doner). Duzenleme yalniz yazinin takili
     * adresteki kopyasi YERINDE guncellenebiliyorsa uygulanir; o zaman ikinci
     * asama (phase 'republish') kuyruga girer ve sayfa ancak o yayin basarilinca
     * RECOVERED olur (stuck-page-recovery.service recover / republish). Sayfanin
     * durumu, yazinin canli metni ve otopilot kurallari servis icinde IS
     * KOSARKEN denetlenir; sayfa atomik sahiplenilir (ayni anda iki is gelirse
     * ikincisi hicbir sey yapmaz). Is kimligi (BullMQ) sahiplenme kirasina
     * yazilir: dagitimda olen is BullMQ tarafindan yeniden teslim edilince sayfayi
     * devralir (eskiden "zaten suruyor" deyip atliyor, sayfa sonsuza kadar
     * "Çalışıyor" kaliyordu). requestedAt (kuyruga alma ani): sayfa o andan sonra
     * baska bir yoldan islendiyse yapay zeka cagrilmaz. Atlanan her is sonucunda
     * { skipped: true, reason: <Turkce>, code? } doner (Job.result; panel GET
     * /jobs/:id ile okur — paylasilan sozlesme D4).
     */
    STUCK_PAGE_RECOVER: async (data, job) => {
      // Ikinci asama — LLM yok, yayin isi: AI anahtarindan once (PUBLISH_ARTICLE
      // gibi). Son denemede de yayinlanamazsa sayfa FAILED olur, metin geri alinir.
      if (isStuckRepublishJob(data)) {
        const finalAttempt = !job || job.attemptsMade + 1 >= (job.opts?.attempts ?? 1);
        return services.stuckRecovery.republish(
          data,
          // opts servisten gelir ({ recreateMissing: false, initiator: 'automation' }):
          // musterinin sildigi WordPress yazisi takili sayfa yayininda yeniden
          // acilmaz. Iki parametreli lambda derlenirdi ama secenegi sessizce dusururdu.
          (articleId: string, targetIds: string[], opts?: { recreateMissing?: boolean; initiator?: 'user' | 'automation' }) =>
            services.publisher.publishArticle(articleId, targetIds, opts),
          { finalAttempt },
        );
      }
      const { stuckPageId, triggeredBy, requestedAt } = data ?? {};
      if (await services.settings.getBoolean('AI_GLOBAL_DISABLED')) {
        log.warn(`[stuck:${stuckPageId}] atlandi (AI_GLOBAL_DISABLED=1)`);
        return stuckRecoverSkip('AI_GLOBAL_DISABLED');
      }
      const by = triggeredBy || 'autopilot';
      // Makale var mi — dogrudan kimlikle. Eskiden getDetail(stuckPageId) tek
      // argumanla cagriliyordu (imza: siteId, stuckPageId); sorgu
      // {id: undefined, siteId: <stuckPageId>} olup HER ZAMAN null donuyor,
      // her is makale sayfasinda hata atan dis-sayfa servisine gidiyordu.
      const route = await stuckRecoveryRoute(services.prisma, stuckPageId);
      if (route === 'missing') {
        // Sayfa silinmis / gozardi edilip temizlenmis: tekrar denemek ise yaramaz
        log.warn(`[stuck:${stuckPageId}] atlandi (kayit yok)`);
        return stuckRecoverSkip('STUCK_PAGE_NOT_FOUND');
      }
      const recoverOpts = {
        triggeredBy: by,
        ...(job?.id ? { jobId: String(job.id) } : {}),
        ...(typeof requestedAt === 'string' && requestedAt ? { requestedAt } : {}),
      };
      if (route === 'article') {
        return services.stuckRecovery.recover(stuckPageId, recoverOpts);
      }
      // RanksUp disi sayfa: otopilot dokunmaz, yalniz kullanici baslatir
      // (stuck-page-external-recovery.service.ts — oneri ya da dogrulanmis statik dosya)
      if (by === 'autopilot') return stuckRecoverSkip('EXTERNAL_PAGE_MANUAL_ONLY');
      return services.stuckExternal.recover(stuckPageId, recoverOpts);
    },

    /**
     * STUCK_PAGE_PERFORMANCE_CHECK — ENH#4: 30 gun sonra GSC re-check.
     * Recovery anindan 30 gun sonra delayed olarak tetiklenir.
     */
    STUCK_PAGE_PERFORMANCE_CHECK: async ({ recoveryId }) => {
      return services.stuckPerfCheck.check(recoveryId);
    },
  };

  const worker = new Worker(
    'luviai-jobs',
    async (job) => {
      const handler = handlers[job.name];
      if (!handler) throw new Error(`Bilinmeyen job tipi: ${job.name}`);

      const skip = await accountSkip(services.prisma, job.id);
      if (skip) {
        log.warn(`${job.name} (${job.id}) atlandı: ${skip.reason === 'account_deletion' ? 'hesap için silme talebi var' : 'iş iptal edilmiş'}`);
        return skip;
      }

      const t0 = Date.now();
      try {
        const result = await handler(job.data, job);
        log.log(`✅ ${job.name} (${job.id}) — ${((Date.now() - t0) / 1000).toFixed(1)}s`);
        return result;
      } catch (err: any) {
        log.error(`❌ ${job.name} (${job.id}): ${err.message}`);
        // WAF / bot dogrulamasi / giris / 403 / robots engeli: 3 deneme ayni engele
        // carpar, site sahibi izin verene kadar sonuc degismez — tek seferde FAILED
        if (isPermanentCrawlBlock(err)) throw new UnrecoverableError(err.message);
        throw err;
      }
    },
    {
      connection,
      concurrency: parseInt(process.env.WORKER_CONCURRENCY ?? '2', 10),
      // Stalled job davranışı — worker restart sırasında uzun süren job'lar (Onboarding,
      // makale pipeline, AI Citation testi) yarıda kalırsa BullMQ stalled sayar.
      // maxStalledCount default 1 → 1 kere stalled olunca direkt FAIL. Buyutuyoruz
      // ki deploy sırasında yarıda kalan job'lar otomatik retry alabilsin.
      stalledInterval: 60_000,   // her dk stalled kontrol (default 30s)
      maxStalledCount: 3,        // 3 kere stalled olabilir (default 1)
      lockDuration: 5 * 60_000,  // 5 dk lock (default 30s) — uzun pipeline'lar için
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
      // Silme talebi / iptal yuzunden atlanan is COMPLETED gorunmez: CANCELED kalir
      const status = isAccountSkip(job.returnvalue) ? 'CANCELED' : 'COMPLETED';
      await services.prisma.job.updateMany({
        where: { bullJobId: String(job.id) },
        data: { status, finishedAt: new Date(), result: job.returnvalue ?? {} },
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

    // 1) PROCESS_SCHEDULED — saatlik takvim taramasi (her 60 dk).
    //    Gecikmeli is (gen:article:<id>, yayin saatinden 15 dk once) yalniz elle
    //    takvime eklenen ya da tasinan yazilarda kurulur (scheduleTopic /
    //    rescheduleArticle). Onboarding takvimi ve programatik SEO yazilarinin
    //    TEK tetikleyicisi bu taramadir; diger yazilar icin de yedektir (Redis
    //    kaybi, akis yeniden acildi, hak yenilendi).
    await queue.add(
      'PROCESS_SCHEDULED',
      { trigger: 'cron' },
      {
        repeat: { every: 60 * 60 * 1000 },
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
    //
    // Yalniz AI_CITATION_DAILY_CRON=true iken kurulur (varsayilan kapali).
    // AI_CITATION_DAILY_CRON=false (27.08.2026 urun karari): platform kendi
    // basina olcum KOSMAZ; site basina 7 saglayici x 5 soru = 35 LLM cagrisi/gun
    // havuz anahtarlarindan odeniyordu. Musteri "Yeniden Test" ile kendisi
    // tetikler (kota sayar). Bayrak kapaliyken Redis'teki mevcut tekrar isi
    // de SILINIR — yoksa eski zamanlama worker yeniden baslasa da kosardi.
    if (isCitationDailyDisabled()) {
      await queue.removeRepeatable('AI_CITATION_DAILY', { pattern: '0 4 * * *', tz: 'UTC' }, 'cron:ai-citation-daily').catch(() => undefined);
      log.warn('AI_CITATION_DAILY kayit edilmedi ve varsa tekrar isi silindi (AI_CITATION_DAILY_CRON true degil)');
    } else {
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
    }

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

    // 7) STUCK_PAGE_DETECT_ALL — Pazartesi 06:00 UTC haftalik
    await queue.add(
      'STUCK_PAGE_DETECT_ALL',
      { trigger: 'cron' },
      {
        repeat: { pattern: '0 6 * * 1', tz: 'UTC' },
        jobId: 'cron:stuck-page-detect-weekly',
        removeOnComplete: { count: 20 },
        removeOnFail: { count: 20 },
      },
    );

    // 8) CRAWLER_ERROR_ALARM — her 6 saat (AiCrawlerHit 4xx/5xx sayaclari zaten toplaniyordu, okunmuyordu)
    await queue.add(
      'CRAWLER_ERROR_ALARM',
      { trigger: 'cron' },
      {
        repeat: { every: 6 * 60 * 60 * 1000 },
        jobId: 'cron:crawler-error-alarm',
        removeOnComplete: { count: 30 },
        removeOnFail: { count: 20 },
      },
    );

    // 9) LINKEDIN_OUTREACH_TICK — her 30 dk (gonderim anahtari panelden).
    //    Bayrak kapaliyken Redis'teki tekrar isi de SILINIR (AI_CITATION_DAILY kalibi):
    //    yoksa eski zamanlama worker yeniden baslasa da kosar, bot istemeden calisirdi.
    // NEDEN her zaman kayitli: gonderim anahtari artik PANELDEN (KvStore) yonetiliyor; cron'u env'e
    // baglamak panelden acildiginda worker restart'i gerektiriyordu. Kapaliyken tick hemen
    // "Kapalı" ile doner, tarayiciya DOKUNMAZ.
    {
      await queue.add(
        'LINKEDIN_OUTREACH_TICK',
        { trigger: 'cron' },
        {
          repeat: { every: 30 * 60 * 1000 },
          jobId: 'cron:linkedin-outreach-tick',
          removeOnComplete: { count: 50 },
          removeOnFail: { count: 20 },
        },
      );
    }

    // 9b) EPOSTA_KAMPANYA_TICK — her 30 dk. Anahtar panelden (KvStore 'eposta-kampanya:acik', varsayilan KAPALI);
    //     kapaliyken tur Mailjet'e dokunmadan doner, bu yuzden is her zaman kayitli.
    await queue.add(
      'EPOSTA_KAMPANYA_TICK',
      { trigger: 'cron' },
      {
        repeat: { every: 30 * 60 * 1000 },
        jobId: 'cron:eposta-kampanya-tick',
        removeOnComplete: { count: 50 },
        removeOnFail: { count: 20 },
      },
    );

    // 10) SWEEP_STUCK_GENERATING — her 30 dk: GENERATING'de takili kalan (canli
    //     isi olmayan) yazilari takvime geri koyar ya da FAILED yapar. Tur ayrica
    //     cift-calisma kilidiyle korunur (api articles/generating-sweeper.ts).
    await queue.add(
      'SWEEP_STUCK_GENERATING',
      { trigger: 'cron' },
      {
        repeat: { every: 30 * 60 * 1000 },
        jobId: 'cron:sweep-stuck-generating',
        removeOnComplete: { count: 20 },
        removeOnFail: { count: 20 },
      },
    );

    log.log(`⏰ Cron: PROCESS_SCHEDULED 60dk · SWEEP_STUCK_GENERATING 30dk · LLMS_FULL_BUILD haftalik · AI_CITATION_DAILY ${isCitationDailyDisabled() ? 'KAPALI (musteri tetikli)' : 'gunluk'} · CONTENT_PIVOT_CHECK haftalik · AI_MENTION_ALARM gunluk · CRAWLER_ERROR_ALARM 6saat · ADS_AUTOPILOT 6saat · STUCK_PAGE_DETECT_ALL haftalik · EPOSTA_KAMPANYA_TICK 30dk (anahtar panelden) · LINKEDIN_OUTREACH_TICK 30dk (gonderim anahtari panelden; env varsayilani: ${isLinkedinOutreachEnvDefault() ? 'acik' : 'kapali'})`);
  } catch (err: any) {
    log.warn(`Cron kurulumu basarisiz: ${err.message}`);
  }

  // RanksUp Video — ayri kuyruk, is eszamanliligi 1 (render CPU agir; bir videonun kare
  // eszamanliligi ayrica VIDEO_RENDER_CONCURRENCY ile sinirli, apps/video render/article-short.mjs).
  // VIDEO_RENDER_WORKER=0 bu surecte tuketiciyi kapatir (ayri bir makinede/surecte calistirmak icin);
  // o durumda kuyruktaki videolar bekler, supurucu 6 saat sonra FAILED + iade yapar.
  let videoWorker: Worker | null = null;
  if (process.env.VIDEO_RENDER_WORKER !== '0') {
    videoWorker = new Worker(
      VIDEO_RENDER_QUEUE,
      async (job) => {
        const videoId = String(job.data?.videoId ?? '');
        if (!videoId) throw new UnrecoverableError('videoId yok');
        const t0 = Date.now();
        const r = await services.videoRender.process(videoId);
        log.log(`🎬 video ${videoId} — ${r.status}${r.reason ? ` (${r.reason})` : ''} · ${((Date.now() - t0) / 1000).toFixed(1)}s`);
        return r;
      },
      {
        connection,
        concurrency: VIDEO_RENDER_JOB_CONCURRENCY,
        // Render 1-3 dk; kilit genis tutulur. Takilan is bir kez yeniden alinir (process
        // GENERATING'i yeniden sahiplenebilir), sonra failed -> asagidaki olay FAILED + iade yapar.
        lockDuration: 10 * 60_000,
        stalledInterval: 60_000,
        maxStalledCount: 1,
      },
    );
    // process() hatalari kendisi yakalar; buraya yalniz beklenmeyen (DB kopmasi, stalled limiti)
    // duser. markFailed kosullu oldugu icin cift iade olmaz.
    videoWorker.on('failed', async (job, err) => {
      const videoId = String(job?.data?.videoId ?? '');
      if (!videoId) return;
      await services.videoRender
        .markFailed(videoId, 'Video oluşturulurken beklenmeyen bir sorun oldu; video hakkın iade edildi. Tekrar deneyebilirsin.', `worker: ${err?.message ?? err}`)
        .catch((e: any) => log.warn(`video ${videoId} FAILED yazilamadi: ${e?.message ?? e}`));
    });
    log.log(`🎬 Video render kuyrugu dinleniyor (${VIDEO_RENDER_QUEUE}, eszamanlilik ${VIDEO_RENDER_JOB_CONCURRENCY})`);
  } else {
    log.warn(`Video render tuketicisi kapali (VIDEO_RENDER_WORKER=0) — ${VIDEO_RENDER_QUEUE} kuyrugu bu surecte islenmez`);
  }

  log.log('🔧 RanksUp Worker dinliyor (queue: luviai-jobs)');

  const shutdown = async () => {
    log.log('Shutting down...');
    await worker.close();
    await videoWorker?.close();
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
