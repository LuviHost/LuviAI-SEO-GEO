import { Module } from '@nestjs/common';
import { AsaController } from './asa.controller.js';
import { AsaService } from './asa.service.js';
import { AsaCronService } from './asa.cron.js';
import { PrismaModule } from '../../prisma/prisma.module.js';
import { AuthModule } from '../../auth/auth.module.js';

/**
 * ASO Faz 1 — Apple Search Ads modülü
 *
 * Endpoint'ler:
 *   POST /api/sites/:siteId/aso/asa/connect       (account bağla)
 *   GET  /api/sites/:siteId/aso/asa/accounts      (account listesi)
 *   DELETE /api/aso/asa/accounts/:accountId       (account sil)
 *   POST /api/aso/asa/accounts/:accountId/sync    (Apple'dan kampanyaları sync)
 *   GET  /api/sites/:siteId/aso/asa/campaigns     (DB'deki kampanyalar)
 *   POST /api/aso/asa/campaigns                   (yeni kampanya)
 *   PUT  /api/aso/asa/keyword-bids/:id            (bid güncelle)
 *   GET  /api/sites/:siteId/aso/asa/performance   (son N gün metrik)
 */
@Module({
  imports: [PrismaModule, AuthModule],
  controllers: [AsaController],
  providers: [AsaService, AsaCronService],
  exports: [AsaService],
})
export class AsaModule {}
