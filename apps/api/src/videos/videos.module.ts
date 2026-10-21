import { Module } from '@nestjs/common';
import { LLMModule } from '../llm/llm.module.js';
import { NotificationsModule } from '../notifications/notifications.module.js';
import { VideosController } from './videos.controller.js';
import { VideosService } from './videos.service.js';
import { VideoRenderService } from './video-render.service.js';
import { VideoRenderQueue } from './video-render.queue.js';

/**
 * RanksUp Video (makaleden 15 sn dikey video). API: istek/liste/silme; worker: render
 * (apps/worker 'video-render' kuyrugu VideoRenderService.process'i cagirir).
 */
@Module({
  // QuotaService global BillingModule'den gelir
  imports: [LLMModule, NotificationsModule],
  controllers: [VideosController],
  providers: [VideosService, VideoRenderService, VideoRenderQueue],
  exports: [VideosService, VideoRenderService],
})
export class VideosModule {}
