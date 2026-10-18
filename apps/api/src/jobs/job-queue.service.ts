import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { Queue, type JobType } from 'bullmq';
import IORedis from 'ioredis';
import { PrismaService } from '../prisma/prisma.service.js';

/**
 * BullMQ kuyruğa iş gönderen ortak service.
 * Tüm modüller (sites, audit, topics, articles) bunu kullanarak job ekler.
 *
 * Akış:
 *  1. DB'ye Job kaydı (audit log için)
 *  2. BullMQ'ya gönder (worker dinliyor)
 *  3. bullJobId DB'ye yaz (event eşleşsin)
 */
@Injectable()
export class JobQueueService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger(JobQueueService.name);
  private queue!: Queue;
  private connection!: IORedis;

  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit() {
    this.connection = new IORedis(process.env.REDIS_URL ?? 'redis://localhost:6379', {
      maxRetriesPerRequest: null,
    });
    this.queue = new Queue('luviai-jobs', { connection: this.connection });
    this.log.log('JobQueue bağlandı (luviai-jobs)');
  }

  async onModuleDestroy() {
    await this.queue?.close();
    await this.connection?.quit();
  }

  async enqueue(opts: {
    type: string;
    userId: string;
    siteId?: string;
    payload: Record<string, any>;
    priority?: number;
    delay?: number;
    /** Custom BullMQ jobId — idempotent reschedule için. Aynı jobId ile add'lerse mevcut silinir. */
    jobId?: string;
  }) {
    // 1) DB Job kaydı
    const dbJob = await this.prisma.job.create({
      data: {
        userId: opts.userId,
        siteId: opts.siteId,
        type: opts.type as any,
        payload: opts.payload as any,
        status: 'QUEUED',
        priority: opts.priority ?? 0,
      },
    });

    // 2) BullMQ — custom jobId verilmişse önce eskisini sil (reschedule)
    // Kuyruga eklenemezse (Redis yok / baglanti koptu) DB kaydi FAILED olur ve hata
    // aynen firlatilir. NEDEN (inceleme S24'un yan etkisi): kayit QUEUED ve
    // bullJobId'siz kaliyor, hic kosmayacak bir is "bekliyor" gorunuyordu; takili
    // sayfa toplu onarimi onu canli sayip yeniden denemeye "zaten sırada" diyordu.
    let bullJob: Awaited<ReturnType<Queue['add']>>;
    try {
      if (opts.jobId) {
        const existing = await this.queue.getJob(opts.jobId);
        if (existing) {
          try { await existing.remove(); }
          catch (err: any) { this.log.warn(`Eski delayed job silinemedi (${opts.jobId}): ${err.message}`); }
        }
      }

      bullJob = await this.queue.add(opts.type, opts.payload, {
        jobId: opts.jobId,
        priority: opts.priority,
        delay: opts.delay,
        attempts: 3,
        backoff: { type: 'exponential', delay: 5000 },
        removeOnComplete: { age: 3600, count: 100 }, // 1 saat veya 100 son completed
        removeOnFail: { age: 86400, count: 500 },    // 1 gün veya 500 son failed
      });
    } catch (err: any) {
      const reason = String(err?.message ?? err).slice(0, 500);
      await this.prisma.job.update({
        where: { id: dbJob.id },
        data: { status: 'FAILED', error: `İş kuyruğa eklenemedi: ${reason}`, finishedAt: new Date() },
      }).catch((e: any) => this.log.warn(`Kuyruga eklenemeyen is kaydi FAILED yapilamadi (${dbJob.id}): ${e?.message ?? e}`));
      throw err;
    }

    // 3) bullJobId'yi DB'ye yaz
    await this.prisma.job.update({
      where: { id: dbJob.id },
      data: { bullJobId: String(bullJob.id) },
    });

    return { dbJobId: dbJob.id, bullJobId: bullJob.id };
  }

  /** Bekleyen delayed job'ı sil (article unschedule veya reschedule). */
  async removeJob(jobId: string): Promise<boolean> {
    const job = await this.queue.getJob(jobId);
    if (!job) return false;
    try { await job.remove(); return true; }
    catch (err: any) { this.log.warn(`Job silinemedi (${jobId}): ${err.message}`); return false; }
  }

  async getJobStatus(dbJobId: string) {
    return this.prisma.job.findUnique({ where: { id: dbJobId } });
  }

  /**
   * BullMQ isinin su anki durumu (salt okuma; ek): 'waiting' | 'active' |
   * 'delayed' | 'prioritized' | 'waiting-children' | 'completed' | 'failed', is
   * kuyrukta yoksa 'unknown' (kurulu bullmq 5.76.2 queue-getters getJobState).
   * Takili sayfa kurtarmasinda "sayfa basina tek bekleyen is" ve sahipsiz
   * sahiplenme denetimi icin (audit/stuck-page-autopilot.ts liveStuckRecoverJobs);
   * sabit bir jobId ile ekleme yerine acik denetim kullanilir: enqueue ayni
   * jobId'li eski isi siler ve DB'deki bullJobId tekil oldugu icin yeniden
   * kullanilan kimlik ikinci is kaydinda yazilamazdi.
   */
  async getJobState(jobId: string): Promise<string> {
    return this.queue.getJobState(jobId);
  }

  // ──────────────────────────────────────────────────────────────────────
  // Admin queue monitoring — BullMQ introspection
  // ──────────────────────────────────────────────────────────────────────

  /**
   * Kuyruk sayaclari. 'waiting' oncelikli bekleyen isleri de ICERIR; ayrica
   * 'prioritized' (waiting'in alt kirilimi) doner.
   *
   * NEDEN (inceleme S15'in yan etkisi): oncelik verilen is (priority > 0;
   * takili sayfa toplu onarimi ve otopilotu 50, site denetimi 5, kurulum 10)
   * BullMQ 5'te 'wait' listesine degil 'prioritized' kumesine girer (kurulu
   * bullmq 5.76.2 types/job-type.d.ts JobState 'prioritized'; queue-getters
   * sanitizeJobTypes 'waiting'i yalniz wait + paused'a cevirir). Sayac onu hic
   * istemedigi icin 50 sayfalik bekleyen toplu onarim yonetici panelinde 0
   * gorunuyordu. Panel (admin/queue) yalniz 'waiting' kartini gosterir.
   */
  async getQueueCounts() {
    const counts = await this.queue.getJobCounts('waiting', 'active', 'delayed', 'completed', 'failed', 'paused', 'prioritized');
    return { ...counts, waiting: (counts.waiting ?? 0) + (counts.prioritized ?? 0) };
  }

  async getQueueIsPaused() {
    return this.queue.isPaused();
  }

  async pauseQueue() { return this.queue.pause(); }
  async resumeQueue() { return this.queue.resume(); }

  /**
   * Belirli bir state'teki job'ları listele.
   * BullMQ states: waiting | active | delayed | completed | failed | paused
   * 'waiting' oncelikli bekleyenleri de listeler (getQueueCounts ile ayni
   * gerekce, S15): once wait listesi, sonra oncelik kumesi; worker'in alma
   * sirasi (moveToActive once wait'ten, sonra prioritized'dan ceker). Her tur
   * kendi araligini dondugu icin sonuc limit'e kirpilir.
   */
  async listJobs(state: 'waiting' | 'active' | 'delayed' | 'completed' | 'failed' | 'paused', limit = 50) {
    const types: JobType[] = state === 'waiting' ? ['waiting', 'prioritized'] : [state];
    const jobs = (await this.queue.getJobs(types, 0, limit - 1, false)).slice(0, limit);
    return Promise.all(jobs.map(async (j) => {
      const fullState = await j.getState().catch(() => state);
      return {
        id: j.id,
        name: j.name,
        data: j.data,
        opts: { delay: j.opts.delay, priority: j.opts.priority, attempts: j.opts.attempts },
        attemptsMade: j.attemptsMade,
        timestamp: j.timestamp,
        processedOn: j.processedOn,
        finishedOn: j.finishedOn,
        delay: j.delay,
        // delayedAt = timestamp + delay (ne zaman tetiklenir)
        fireAt: j.delay ? j.timestamp + j.delay : null,
        failedReason: (j as any).failedReason ?? null,
        returnvalue: (j as any).returnvalue ?? null,
        state: fullState,
      };
    }));
  }

  async retryJob(jobId: string): Promise<boolean> {
    const job = await this.queue.getJob(jobId);
    if (!job) return false;
    try { await job.retry(); return true; }
    catch (err: any) { this.log.warn(`Retry fail ${jobId}: ${err.message}`); return false; }
  }

  async promoteJob(jobId: string): Promise<boolean> {
    // Delayed job'ı hemen waiting'e al (bekleme süresini atla)
    const job = await this.queue.getJob(jobId);
    if (!job) return false;
    try { await job.promote(); return true; }
    catch (err: any) { this.log.warn(`Promote fail ${jobId}: ${err.message}`); return false; }
  }
}
