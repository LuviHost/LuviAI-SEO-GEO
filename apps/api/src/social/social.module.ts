import { Module } from '@nestjs/common';
import { SocialController } from './social.controller.js';
import { SocialChannelsService } from './social-channels.service.js';
import { SocialPostsService } from './social-posts.service.js';

/**
 * Sosyal medya — kanal yonetimi + post yayini.
 * Sprint 1: LinkedIn (personal + company).
 * Sprint 2'de X / Facebook / Instagram eklenecek.
 * Sprint 4'te SocialSchedulerCron eklenecek.
 */
@Module({
  controllers: [SocialController],
  providers: [SocialChannelsService, SocialPostsService],
  exports: [SocialChannelsService, SocialPostsService],
})
export class SocialModule {}
