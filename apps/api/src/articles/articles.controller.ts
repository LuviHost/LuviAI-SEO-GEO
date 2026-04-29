import { Body, Controller, Delete, Get, Header, Param, Post, Put, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { ArticlesService } from './articles.service.js';
import { ArticleSchedulerService } from './article-scheduler.service.js';
import { MediaGeneratorService } from './media-generator.service.js';

@Controller('sites/:siteId/articles')
export class ArticlesController {
  constructor(
    private readonly articles: ArticlesService,
    private readonly scheduler: ArticleSchedulerService,
    private readonly media: MediaGeneratorService,
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

  /** POST /sites/:siteId/articles/schedule-topic — drag-drop: bir tier-1 konuyu takvime ekle */
  @Post('schedule-topic')
  scheduleTopic(
    @Param('siteId') siteId: string,
    @Body() body: { topic: string; scheduledAt: string; slug?: string; pillar?: string },
  ) {
    return this.scheduler.scheduleTopic(siteId, body);
  }

  /** PUT /sites/:siteId/articles/:id/reschedule — drag-drop: takvimde mevcut makaleyi tasi */
  @Put(':id/reschedule')
  reschedule(
    @Param('id') id: string,
    @Body() body: { scheduledAt: string },
  ) {
    return this.scheduler.rescheduleArticle(id, body.scheduledAt);
  }

  /** DELETE /sites/:siteId/articles/scheduled/:id — takvimden kaldir */
  @Delete('scheduled/:id')
  unschedule(@Param('id') id: string) {
    return this.scheduler.unscheduleArticle(id);
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

  /** POST /sites/:siteId/articles/:id/audio — TTS audio uret (multi-modal GEO) */
  @Post(':id/audio')
  generateAudio(@Param('id') id: string) {
    return this.media.generateAudio(id);
  }

  /** GET /sites/:siteId/articles/podcast.rss — podcast feed (Spotify/Apple Podcasts ready) */
  @Get('podcast.rss')
  @Header('Content-Type', 'application/rss+xml; charset=utf-8')
  async podcastRss(@Param('siteId') siteId: string, @Res() res: Response) {
    const xml = await this.media.generatePodcastRss(siteId);
    res.setHeader('Cache-Control', 'public, max-age=1800');
    res.send(xml);
  }
}
