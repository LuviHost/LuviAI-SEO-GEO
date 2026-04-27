import { Module } from '@nestjs/common';
import { AuditController } from './audit.controller.js';
import { AuditService } from './audit.service.js';
import { AuditChecksService } from './audit-checks.service.js';
import { PageSpeedService } from './pagespeed.service.js';
import { GeoRunnerService } from './geo-runner.service.js';
import { GeneratorsService } from './generators.service.js';
import { AutoFixService } from './auto-fix.service.js';
import { SitesModule } from '../sites/sites.module.js';

/**
 * Site Sağlık Taraması (14 kontrol noktası):
 *  1. sitemap.xml
 *  2. robots.txt
 *  3. llms.txt
 *  4. Schema markup (Article, Organization, BreadcrumbList)
 *  5. Meta title (50-60 karakter)
 *  6. Meta description (140-160 karakter)
 *  7. Open Graph
 *  8. Twitter Card
 *  9. Canonical URL
 *  10. HTTPS
 *  11. H1 uniqueness
 *  12. Image alt text
 *  13. Internal linking (orphan pages)
 *  14. Hreflang
 *
 * + PageSpeed Insights API (Core Web Vitals)
 * + Auriti GEO CLI (AI search citation)
 *
 * Auto-fix:
 *  - sitemap.xml otomatik üret + publish target'a yükle
 *  - robots.txt + llms.txt aynı şekilde
 */
@Module({
  imports: [SitesModule], // SiteCrawlerService için
  controllers: [AuditController],
  providers: [
    AuditService,
    AuditChecksService,
    PageSpeedService,
    GeoRunnerService,
    GeneratorsService,
    AutoFixService,
  ],
  exports: [AuditService, AutoFixService],
})
export class AuditModule {}
