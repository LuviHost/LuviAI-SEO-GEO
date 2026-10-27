import { Module } from '@nestjs/common';
import { LLMModule } from '../llm/llm.module.js';
import { GbpController } from './gbp.controller.js';
import { GbpService } from './gbp.service.js';

/** Google Isletme Profili — denetim (Places) + yonetim (GBP API, onay sonrasi). Prisma global. */
@Module({
  imports: [LLMModule],
  controllers: [GbpController],
  providers: [GbpService],
  exports: [GbpService],
})
export class GbpModule {}
