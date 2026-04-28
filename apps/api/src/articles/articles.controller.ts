import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ArticlesService } from './articles.service.js';

@Controller('sites/:siteId/articles')
export class ArticlesController {
  constructor(
    private readonly articles: ArticlesService,
  ) {}

  @Get()
  list(@Param('siteId') siteId: string, @Query('status') status?: string) {
    return this.articles.list(siteId, status);
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
