import { Module } from '@nestjs/common';
import { SitesController } from './sites.controller.js';
import { SitesService } from './sites.service.js';
import { BrainGeneratorService } from './brain-generator.service.js';

/**
 * Site CRUD + Brain (kullanıcı sitesinin AI bağlamı).
 *
 * BrainGeneratorService = onboarding wizard sonu otomatik çalışır:
 *  - Site URL'inden marka tonunu çıkar
 *  - Persona şablonu seç (5 hazır + custom)
 *  - Rakip listesi üret (WebSearch + AI)
 *  - SEO stratejisini çıkar (mevcut sayfalardan)
 *  - DB'ye Brain kaydet
 */
@Module({
  controllers: [SitesController],
  providers: [SitesService, BrainGeneratorService],
  exports: [SitesService, BrainGeneratorService],
})
export class SitesModule {}
