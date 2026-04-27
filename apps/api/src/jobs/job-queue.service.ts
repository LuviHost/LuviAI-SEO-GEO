import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { Queue } from 'bullmq';
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

    // 2) BullMQ
    const bullJob = await this.queue.add(opts.type, opts.payload, {
      priority: opts.priority,
      delay: opts.delay,
      attempts: 3,
      backoff: { type: 'exponential', delay: 5000 },
      removeOnComplete: { age: 3600, count: 100 }, // 1 saat veya 100 son completed
      removeOnFail: { age: 86400, count: 500 },    // 1 gün veya 500 son failed
    });

    // 3) bullJobId'yi DB'ye yaz
    await this.prisma.job.update({
      where: { id: dbJob.id },
      data: { bullJobId: String(bullJob.id) },
    });

    return { dbJobId: dbJob.id, bullJobId: bullJob.id };
  }

  async getJobStatus(dbJobId: string) {
    return this.prisma.job.findUnique({ where: { id: dbJobId } });
  }
}
