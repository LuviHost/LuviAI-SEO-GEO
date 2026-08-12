import { Module } from '@nestjs/common';
import { ActionPlansController } from './action-plans.controller.js';
import { ActionPlansService } from './action-plans.service.js';

/**
 * Action Plans — capraz-modul is listesi.
 * Audit / GEO / AXO / ASO / Ads bulgulari "Aksiyon Planina Ekle" ile
 * buraya toplanir; kullanici tek listeden yurutur.
 */
@Module({
  controllers: [ActionPlansController],
  providers: [ActionPlansService],
  exports: [ActionPlansService],
})
export class ActionPlansModule {}
