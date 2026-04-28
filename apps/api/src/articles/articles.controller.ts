import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ArticlesService } from './articles.service.js';
import { ArticleSchedulerService } from './article-scheduler.service.js';

@Controller('sites/:siteId/articles')
export class ArticlesController {
  constructor(
    private readonly articles: ArticlesService,
    private readonly scheduler: ArticleSchedulerService,
  ) {}

  @Get()
  list(@Param('siteId') siteId: string, @Query('status') status?: string) {
    return this.articles.list(siteId, status);
  }

  /** GET /sites/:siteId/articles/scheduled — takvim icin bekleyen makaleler */
  @Get('scheduled')
  scheduled(@Param('siteId') siteId: string) {
    return this.scheduler.listScheduledForSite(siteId);
  }

  /** POST /sites/:siteId/articles/schedule-batch — onboarding sonrasi tier-1'den N makale schedule et */
  @Post('schedule-batch')
  scheduleBatch(@Param('siteId') siteId: string, @Body() body: { count?: number }) {
    return this.scheduler.scheduleInitialBatch(siteId, { count: body?.count });
  }

  @Get(':id')
  get(@Param('siteId') siteId: string, @Param('id') id: string) {
    return this.articles.findOne(id, siteId);
  }

  /** POST /sites/:siteId/articles/generate — queue */
  @Post('generate')
  generate(@Param('siteId') siteId: string, @Body() body: { topic: string; targetIds?: string[] }) {
    return this.articles.queueGeneration(siteId, body.topic, body.targetIds);
  }

  /** POST /sites/:siteId/articles/run-now — senkron pipeline (quota'li) */
  @Post('run-now')
  runNow(@Param('siteId') siteId: string, @Body() body: { topic: string; skipImages?: boolean; maxRevize?: number }) {
    return this.articles.runPipelineNow({
      siteId,
      topic: body.topic,
      skipImages: body.skipImages,
      maxRevize: body.maxRevize,
    });
  }

  /** POST /sites/:siteId/articles/:id/publish */
  @Post(':id/publish')
  publish(@Param('siteId') siteId: string, @Param('id') id: string, @Body() body: { targetIds: string[] }) {
    return this.articles.queuePublish(siteId, id, body.targetIds);
  }
}
