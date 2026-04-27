import { Controller, Get, Param, Post } from '@nestjs/common';
import { TopicsService } from './topics.service.js';

@Controller('sites/:siteId/topics')
export class TopicsController {
  constructor(private readonly topics: TopicsService) {}

  @Get('queue')
  getQueue(@Param('siteId') siteId: string) {
    return this.topics.getLatestQueue(siteId);
  }

  @Post('regenerate')
  regenerate(@Param('siteId') siteId: string) {
    return this.topics.queueGeneration(siteId);
  }
}
