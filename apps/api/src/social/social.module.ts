import { Module } from '@nestjs/common';
import { SocialController } from './social.controller.js';
import { SocialChannelsService } from './social-channels.service.js';
import { SocialPostsService } from './social-posts.service.js';
import { SocialSlotsService } from './social-slots.service.js';
import { SocialCalendarService } from './social-calendar.service.js';
import { SocialAutoDraftService } from './social-auto-draft.service.js';
import { SocialSchedulerService } from './social-scheduler.service.js';

/**
 * Sosyal medya — kanal yonetimi + post yayini + plan-bazli takvim/cron.
 * - Kanal: LinkedIn (personal/company), X / Twitter.
 * - Cron: SocialSchedulerService her 5 dk slot'lari isler.
 * - Auto-draft: makale PUBLISHED olunca DRAFT post olusturur.
 */
@Module({
  controllers: [SocialController],
  providers: [
    SocialChannelsService,
    SocialPostsService,
    SocialSlotsService,
    SocialCalendarService,
    SocialAutoDraftService,
    SocialSchedulerService,
  ],
  exports: [
    SocialChannelsService,
    SocialPostsService,
    SocialAutoDraftService,
  ],
})
export class SocialModule {}
