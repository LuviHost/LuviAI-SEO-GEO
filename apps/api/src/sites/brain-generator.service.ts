import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';

/**
 * Brain Generator: kullanıcı sitesinin AI bağlamını otomatik üretir.
 *
 * Akış (worker job içinde çalışır):
 *  1. Site URL'ini fetch et + sitemap.xml veya 30 sayfa crawl et
 *  2. Marka tonu çıkar (LLM analizi: mevcut kopyaya bak)
 *  3. Niche'i tespit et / kullanıcının söylediğine güven
 *  4. Persona şablonu seç (5 hazır):
 *     - "ecommerce-buyer-decision-maker"
 *     - "saas-developer"
 *     - "agency-marketer"
 *     - "blog-reader-curious"
 *     - "kobi-decision-maker"
 *  5. Rakip listesi üret (Google search "best <niche> türkiye 2026" + AI extract)
 *  6. SEO stratejisi (mevcut sayfalardan pillar/cluster çıkar)
 *  7. Glossary (niş özelinde terim sözlüğü)
 *  8. Brain kaydı yarat
 */
@Injectable()
export class BrainGeneratorService {
  constructor(private readonly prisma: PrismaService) {}

  /** Onboarding job'unu queue'ya at — gerçek üretim worker'da */
  async queueGeneration(siteId: string, opts: { forceRegenerate?: boolean } = {}) {
    return this.prisma.job.create({
      data: {
        userId: (await this.prisma.site.findUniqueOrThrow({ where: { id: siteId } })).userId,
        siteId,
        type: 'BRAIN_GENERATE',
        payload: { forceRegenerate: opts.forceRegenerate ?? false },
      },
    });
  }

  // Worker tarafında çağrılan asıl üretim — şimdilik stub
  async runGeneration(siteId: string) {
    // TODO Faz 1 hafta 1: implement
    // - Site crawl (Cheerio)
    // - Brand voice analysis (Claude Sonnet)
    // - Persona match
    // - Competitor scan (WebSearch)
    // - SEO strategy extract
    // - Glossary build
    // - prisma.brain.create()
  }
}
