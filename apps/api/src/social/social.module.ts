import { Module } from '@nestjs/common';
import { SocialController } from './social.controller.js';
import { SocialChannelsService } from './social-channels.service.js';
import { SocialPostsService } from './social-posts.service.js';
import { SocialSlotsService } from './social-slots.service.js';
import { SocialCalendarService } from './social-calendar.service.js';
import { SocialAutoDraftService } from './social-auto-draft.service.js';
import { SocialSchedulerService } from './social-scheduler.service.js';
import { forwardRef } from '@nestjs/common';
import { SocialMediaGeneratorService } from './social-media-generator.service.js';
import { ImageGeneratorService } from '../articles/image-generator.service.js';
import { VideoGeneratorService } from '../articles/video-generator.service.js';
import { ArticlesModule } from '../articles/articles.module.js';
// Brightbean parity services
import { SocialInboxService } from './social-inbox.service.js';
import { SocialMediaLibraryService } from './social-media-library.service.js';
import { SocialIdeaService } from './social-idea.service.js';

/**
 * Sosyal medya — kanal yonetimi + post yayini + plan-bazli takvim/cron.
 * - Kanal: LinkedIn, X, FB, IG, TikTok, YouTube, Pinterest, Threads, Bluesky, GMB, Mastodon.
 * - Media: SocialMediaGeneratorService kanal tipine gore image/video uretir
 *   (ImageGenerator + VideoGenerator wrap'i).
 * - Cron: SocialSchedulerService her 5 dk slot'lari isler.
 * - Auto-draft: makale PUBLISHED olunca DRAFT post olusturur (kanal basina default mediaType).
 */
@Module({
  // ArticlesModule MediaGeneratorService + ImageGeneratorService + VideoGeneratorService export ediyor.
  // forwardRef ile circular dependency korumalı (articles → social → articles olabilir).
  imports: [forwardRef(() => ArticlesModule)],
  controllers: [SocialController],
  providers: [
    SocialChannelsService,
    SocialPostsService,
    SocialSlotsService,
    SocialCalendarService,
    SocialAutoDraftService,
    SocialSchedulerService,
    SocialMediaGeneratorService,
    SocialInboxService,
    SocialMediaLibraryService,
    SocialIdeaService,
  ],
  exports: [
    SocialChannelsService,
    SocialPostsService,
    SocialAutoDraftService,
    SocialMediaGeneratorService,
    SocialInboxService,
    SocialMediaLibraryService,
    SocialIdeaService,
  ],
})
export class SocialModule {}
