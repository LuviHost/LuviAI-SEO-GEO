import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { GscService } from './gsc.service.js';
import { GeoService } from './geo.service.js';
import { CompetitorService } from './competitor.service.js';
import { ScorerService } from './scorer.service.js';
import type { AgentContext } from '@luviai/shared';

@Injectable()
export class TopicsService {
  private readonly log = new Logger(TopicsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly gsc: GscService,
    private readonly geo: GeoService,
    private readonly competitor: CompetitorService,
    private readonly scorer: ScorerService,
  ) {}

  getLatestQueue(siteId: string) {
    return this.prisma.topicQueue.findFirst({
      where: { siteId },
      orderBy: { generatedAt: 'desc' },
    });
  }

  async queueGeneration(siteId: string) {
    const site = await this.prisma.site.findUniqueOrThrow({ where: { id: siteId } });
    return this.prisma.job.create({
      data: { userId: site.userId, siteId, type: 'TOPIC_ENGINE', payload: {} },
    });
  }

  /**
   * 4 katman + AI sıralama orkestrasyonu.
   */
  async runEngine(siteId: string) {
    const t0 = Date.now();

    const site = await this.prisma.site.findUniqueOrThrow({
      where: { id: siteId },
      include: { brain: true, articles: { select: { slug: true } } },
    });

    if (!site.brain) {
      throw new Error(`Site ${siteId}: brain yok, önce brain üret`);
    }

    this.log.log(`[${siteId}] Topic engine başlıyor`);

    const planTopics = this.extractPlanTopics(site.brain.seoStrategy as any);
    this.log.log(`[${siteId}] [1/4] Plan: ${planTopics.length} konu`);

    const gscOpportunities = await this.gsc.fetchOpportunities(siteId);
    this.log.log(`[${siteId}] [2/4] GSC: ${gscOpportunities.length} fırsat`);

    const geoResult = await this.geo.fetchGaps(siteId);
    this.log.log(`[${siteId}] [3/4] GEO: ${geoResult.gaps.length} gap (skor ${geoResult.score})`);

    const competitorMoves = await this.competitor.scanCompetitors(siteId);
    this.log.log(`[${siteId}] [4/4] Rakip: ${competitorMoves.length} hamle`);

    const existingPages = site.articles.map(a => a.slug);

    const brainContext: AgentContext = {
      brain: {
        brandVoice: site.brain.brandVoice as any,
        personas: site.brain.personas as any,
        competitors: site.brain.competitors as any,
        seoStrategy: site.brain.seoStrategy as any,
        glossary: site.brain.glossary as any,
      },
      siteUrl: site.url,
      siteName: site.name,
      niche: site.niche ?? 'web',
      language: (site.language as any) ?? 'tr',
      today: new Date().toISOString().slice(0, 10),
    };

    this.log.log(`[${siteId}] AI sıralayıcı (Sonnet)`);
    const { ranked, costUsd } = await this.scorer.rank({
      brainContext,
      planTopics,
      gscOpportunities,
      geoGaps: geoResult.gaps,
      competitorMoves,
      existingPages,
    });

    if (!ranked) {
      this.log.error(`[${siteId}] Ranker JSON parse başarısız`);
      throw new Error('Topic ranker JSON parse hatası');
    }

    const expiresAt = new Date(Date.now() + 7 * 86400000);

    const queue = await this.prisma.topicQueue.create({
      data: {
        siteId,
        planTopics: planTopics as any,
        gscOpportunities: gscOpportunities as any,
        geoGaps: geoResult.gaps as any,
        competitorMoves: competitorMoves as any,
        tier1Topics: ranked.tier_1_immediate ?? [],
        tier2Topics: ranked.tier_2_this_week ?? [],
        tier3Topics: ranked.tier_3_planned ?? [],
        improvements: ranked.improvements ?? [],
        totalEvaluated: ranked.summary?.total_evaluated ?? planTopics.length,
        expiresAt,
      },
    });

    this.log.log(`[${siteId}] ✅ Topic engine bitti — ${((Date.now() - t0) / 1000).toFixed(0)}s, $${costUsd.toFixed(4)}, T1:${ranked.tier_1_immediate?.length ?? 0} T2:${ranked.tier_2_this_week?.length ?? 0} T3:${ranked.tier_3_planned?.length ?? 0}`);

    return queue;
  }

  private extractPlanTopics(seoStrategy: any): any[] {
    const topics: any[] = [];
    for (const pillar of seoStrategy?.pillars ?? []) {
      for (const cluster of pillar.clusters ?? []) {
        const slug = typeof cluster === 'string' ? cluster : cluster.slug;
        if (!slug) continue;
        const topicTitle = slug.replace(/-/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase());
        topics.push({
          topic: topicTitle,
          slug,
          pillar: pillar.url,
          pillar_name: pillar.name,
          source: 'plan',
        });
      }
    }
    return topics;
  }
}
