import { Module } from '@nestjs/common';
import { SitesController } from './sites.controller.js';
import { SitesService } from './sites.service.js';
import { BrainGeneratorService } from './brain-generator.service.js';
import { SiteCrawlerService } from './site-crawler.service.js';
import { PlatformDetectorService } from './platform-detector.service.js';
import { DemoSeederService } from './demo-seeder.service.js';
import { SiteAiKeysController } from './site-ai-keys.controller.js';
import { SiteAiKeysService } from './site-ai-keys.service.js';
import { AuthModule } from '../auth/auth.module.js';

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
  imports: [AuthModule],
  controllers: [SitesController, SiteAiKeysController],
  providers: [SitesService, BrainGeneratorService, SiteCrawlerService, PlatformDetectorService, DemoSeederService, SiteAiKeysService],
  exports: [SitesService, BrainGeneratorService, SiteCrawlerService, PlatformDetectorService, DemoSeederService, SiteAiKeysService],
})
export class SitesModule {}
