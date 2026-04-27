import { Controller, Get, Param, Post } from '@nestjs/common';
import { TopicsService } from './topics.service.js';

@Controller('sites/:siteId/topics')
export class TopicsController {
  constructor(private readonly topics: TopicsService) {}

  @Get('queue')
  getQueue(@Param('siteId') siteId: string) {
    return this.topics.getLatestQueue(siteId);
  }

  /** POST /sites/:siteId/topics/regenerate — queue'ya at */
  @Post('regenerate')
  regenerate(@Param('siteId') siteId: string) {
    return this.topics.queueGeneration(siteId);
  }

  /** POST /sites/:siteId/topics/run-now — senkron çalıştır (dev/test) */
  @Post('run-now')
  runNow(@Param('siteId') siteId: string) {
    return this.topics.runEngine(siteId);
  }
}
