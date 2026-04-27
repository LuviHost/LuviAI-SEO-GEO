import { Module } from '@nestjs/common';
import { AuditController } from './audit.controller.js';
import { AuditService } from './audit.service.js';
import { AutoFixService } from './auto-fix.service.js';

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
 *  10. HTTPS + HTTP/2
 *  11. Core Web Vitals (PageSpeed Insights API)
 *  12. Internal link graph (orphan sayfalar)
 *  13. AI search citation (Auriti GEO CLI)
 *  14. Hreflang
 *
 * Auto-fix:
 *  - sitemap.xml otomatik üret + publish target'a yükle
 *  - robots.txt + llms.txt aynı şekilde
 */
@Module({
  controllers: [AuditController],
  providers: [AuditService, AutoFixService],
  exports: [AuditService, AutoFixService],
})
export class AuditModule {}
