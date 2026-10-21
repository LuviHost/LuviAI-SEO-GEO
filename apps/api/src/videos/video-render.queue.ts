import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { Queue } from 'bullmq';
import IORedis from 'ioredis';
import { VIDEO_QUEUE_OP_TIMEOUT_MS, VIDEO_RENDER_QUEUE } from './article-video.config.js';

/** Redis islemi zamaninda bitmedi (baglanti yok / asili) */
export class QueueTimeoutError extends Error {}

/**
 * Sure sinirli bekleme. NEDEN: baglanti maxRetriesPerRequest:null ile acilir (BullMQ bunu
 * ister); Redis yokken komutlar cevrimdisi kuyrukta SONSUZA DEK bekler. Sinir olmadan
 * VideosService.request'teki "kuyruga eklenemedi -> FAILED + iade" dali hic calismaz, istek
 * asili kalir ve kullanicinin hakki dusmus olur.
 */
export function withTimeout<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const t = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new QueueTimeoutError(`${what} ${ms} ms'de yanit vermedi (Redis?)`)), ms);
  });
  return Promise.race([p, t]).finally(() => clearTimeout(timer));
}

/**
 * 'video-render' kuyrugunun ureticisi (API tarafi). Tuketici: apps/worker (eszamanlilik 1).
 *
 * NEDEN luviai-jobs DEGIL: render dakikalar suren, CPU agir bir is; ortak kuyrukta makale
 * uretimi ve yayin islerinin onunu tikardi. Job tablosuna (JobType enum) da yazilmaz: durum
 * Video satirinda tutulur (PENDING -> GENERATING -> READY/FAILED), yeni enum degeri icin
 * migration gerekmez.
 *
 * Baglanti ilk kullanimda acilir: API'nin acilisi Redis'e bagli kalmasin (JobQueueService
 * onModuleInit'te zaten baglaniyor; burada ikinci kalici baglanti yalniz video istendiginde).
 */
@Injectable()
export class VideoRenderQueue implements OnModuleDestroy {
  private readonly log = new Logger(VideoRenderQueue.name);
  private queue: Queue | null = null;
  private connection: IORedis | null = null;
  /** Her Redis islemi icin ust sinir (testte kisaltilir) */
  opTimeoutMs = VIDEO_QUEUE_OP_TIMEOUT_MS;

  private get q(): Queue {
    if (!this.queue) {
      this.connection = new IORedis(process.env.REDIS_URL ?? 'redis://localhost:6379', { maxRetriesPerRequest: null });
      this.queue = new Queue(VIDEO_RENDER_QUEUE, { connection: this.connection });
      this.log.log(`Kuyruk baglandi (${VIDEO_RENDER_QUEUE})`);
    }
    return this.queue;
  }

  async onModuleDestroy() {
    await this.queue?.close().catch(() => undefined);
    await this.connection?.quit().catch(() => undefined);
  }

  /**
   * Is kimligi = video kimligi (ayni video iki kez kuyruga girmez). Tek deneme: render
   * deterministik, ayni girdiyle tekrar denemek ayni hatayi verir; hata hakki iade eder.
   */
  async add(videoId: string): Promise<string> {
    const job = await withTimeout(this.q.add('ARTICLE_SHORT', { videoId }, {
      jobId: videoId,
      attempts: 1,
      removeOnComplete: { age: 24 * 3600, count: 200 },
      removeOnFail: { age: 7 * 24 * 3600, count: 500 },
    }), this.opTimeoutMs, 'kuyruga ekleme');
    return String(job.id);
  }

  /** Bekleyen isi sil (kuyruktaki video silindi). Calisan is silinemez -> false */
  async remove(videoId: string): Promise<boolean> {
    const job = await withTimeout(this.q.getJob(videoId), this.opTimeoutMs, 'is okuma');
    if (!job) return false;
    try {
      await withTimeout(job.remove(), this.opTimeoutMs, 'is silme');
      return true;
    } catch (err: any) {
      this.log.warn(`Video isi silinemedi (${videoId}): ${err?.message ?? err}`);
      return false;
    }
  }

  /** 'waiting' | 'active' | 'delayed' | 'prioritized' | 'completed' | 'failed' | 'unknown' */
  async state(videoId: string): Promise<string> {
    return withTimeout(this.q.getJobState(videoId), this.opTimeoutMs, 'is durumu');
  }
}
