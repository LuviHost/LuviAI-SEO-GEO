import { Module } from '@nestjs/common';
import { TopicsController } from './topics.controller.js';
import { TopicsService } from './topics.service.js';
import { GscService } from './gsc.service.js';
import { GeoService } from './geo.service.js';
import { CompetitorService } from './competitor.service.js';
import { ScorerService } from './scorer.service.js';
import { AuthModule } from '../auth/auth.module.js';
import { AuditModule } from '../audit/audit.module.js';
import { ArticlesModule } from '../articles/articles.module.js';

/**
 * Topic Engine — 4 katmanlı konu motoru:
 *  - PlanService: brain.seoStrategy.pillars
 *  - GscService: 4 fırsat tipi (per-tenant)
 *  - GeoService: Auriti CLI gap analizi (Audit module reuse)
 *  - CompetitorService: rakip blog tarama
 *  - ScorerService: Sonnet AI sıralama (Tier 1/2/3)
 */
@Module({
  imports: [AuthModule, AuditModule, ArticlesModule],
  controllers: [TopicsController],
  providers: [TopicsService, GscService, GeoService, CompetitorService, ScorerService],
  exports: [TopicsService],
})
export class TopicsModule {}
