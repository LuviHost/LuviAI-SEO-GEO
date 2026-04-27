import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';

/**
 * Auto-fix engine — en kritik 3 düzeltmeyi otomatik yapar:
 *
 *  1. sitemap.xml — Site URL'inden tüm sayfaları crawl et, sitemap üret
 *  2. robots.txt — AI crawler izinleri (GPTBot, Claude-Web, PerplexityBot, ...)
 *  3. llms.txt — Auriti formatında AI içerik özeti
 *
 * Diğer fix'ler Faz 2'de:
 *  - Meta title/description optimize
 *  - Schema markup ekleme (her sayfa için JSON-LD)
 *  - OG image üretimi
 *  - Canonical URL düzeltme
 */
@Injectable()
export class AutoFixService {
  constructor(private readonly prisma: PrismaService) {}

  async applyFixes(siteId: string, fixes: string[]) {
    const site = await this.prisma.site.findUniqueOrThrow({ where: { id: siteId } });
    return this.prisma.job.create({
      data: {
        userId: site.userId,
        siteId,
        type: 'AUTO_FIX',
        payload: { fixes },
      },
    });
  }

  // Worker tarafında çağrılır
  async generateSitemap(siteId: string) {
    // TODO: site crawl + sitemap.xml üret
    //  - Cheerio ile <a href> ları topla
    //  - Recursive 2-3 seviye derinlik
    //  - <url><loc><lastmod><priority> formatı
    //  - Publish target'a yükle (FTP/SSH/REST)
  }

  async generateRobotsTxt(siteId: string) {
    // AI crawler whitelist + sitemap referansı
  }

  async generateLlmsTxt(siteId: string) {
    // Auriti format
  }
}
