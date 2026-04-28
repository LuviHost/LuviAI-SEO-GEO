import { Module } from '@nestjs/common';
import { PublishTargetsController } from './publish-targets.controller.js';
import { PublishTargetsService } from './publish-targets.service.js';

@Module({
  controllers: [PublishTargetsController],
  providers: [PublishTargetsService],
  exports: [PublishTargetsService],
})
export class PublishTargetsModule {}
