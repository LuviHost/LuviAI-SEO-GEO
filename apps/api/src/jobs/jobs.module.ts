import { Module } from '@nestjs/common';
import { JobsController } from './jobs.controller.js';
import { JobsService } from './jobs.service.js';

/**
 * Job tracking — BullMQ kuyruğunun DB karşılığı.
 * Worker side ayrı: apps/worker/
 */
@Module({
  controllers: [JobsController],
  providers: [JobsService],
  exports: [JobsService],
})
export class JobsModule {}
