import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';

@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  async getLatest(siteId: string) {
    return this.prisma.audit.findFirst({
      where: { siteId },
      orderBy: { ranAt: 'desc' },
    });
  }

  async queueAudit(siteId: string) {
    const site = await this.prisma.site.findUniqueOrThrow({ where: { id: siteId } });
    return this.prisma.job.create({
      data: {
        userId: site.userId,
        siteId,
        type: 'SITE_AUDIT',
        payload: { siteId, url: site.url },
      },
    });
  }

  /** Worker'dan çağrılır — gerçek 14 kontrol noktası burada */
  async runAudit(siteId: string) {
    // TODO Faz 1 hafta 2: 14 kontrol implement
    // - sitemap.xml fetch
    // - robots.txt fetch
    // - llms.txt fetch
    // - Site crawl (Cheerio)
    // - Schema validation (linkedom + JSON-LD parse)
    // - Meta length checks
    // - PageSpeed Insights API (free)
    // - Auriti `geo audit` subprocess
    //
    // Her kontrol → { found, valid, score, fixable } objesi
    // Sonuç: prisma.audit.create() + Site.status güncelle
  }
}
