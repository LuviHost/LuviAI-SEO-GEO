import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module.js';
import { AuditModule } from '../audit/audit.module.js';
import { SettingsModule } from '../settings/settings.module.js';
import { KarneService } from './karne.service.js';
import { KarneController } from './karne.controller.js';

/**
 * Satis oncesi ucretsiz karne: uretim (KarneService) + paylasilabilir sayfa (KarneController).
 * AiCitationService AuditModule'den, SATIS_RANDEVU_URL SettingsModule'den gelir.
 */
@Module({
  imports: [PrismaModule, AuditModule, SettingsModule],
  controllers: [KarneController],
  providers: [KarneService],
  exports: [KarneService],
})
export class ProspectModule {}
