import { Global, Module } from '@nestjs/common';
import { JobsController } from './jobs.controller.js';
import { JobsService } from './jobs.service.js';
import { JobQueueService } from './job-queue.service.js';

/**
 * Job tracking + BullMQ producer.
 * Global module — tüm app modüllerinden JobQueueService inject edilebilir.
 */
@Global()
@Module({
  controllers: [JobsController],
  providers: [JobsService, JobQueueService],
  exports: [JobsService, JobQueueService],
})
export class JobsModule {}
