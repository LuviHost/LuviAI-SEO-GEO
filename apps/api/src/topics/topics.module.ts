import { Module } from '@nestjs/common';
import { TopicsController } from './topics.controller.js';
import { TopicsService } from './topics.service.js';
import { GscService } from './gsc.service.js';
import { GeoService } from './geo.service.js';
import { CompetitorService } from './competitor.service.js';
import { ScorerService } from './scorer.service.js';

/**
 * Topic Engine — 4 katmanlı konu motoru:
 *  - PlanService: kullanıcı brain'inden cluster makaleleri çıkar
 *  - GscService: 4 fırsat tipi (near-miss/content-gap/low-ctr/trending)
 *  - GeoService: Auriti CLI ile AI search citation gap'leri
 *  - CompetitorService: rakip blog'larını tara, "ourGap" işaretle
 *  - ScorerService: 4 kaynaktan toplanmış veriyi Sonnet ile sırala (Tier 1/2/3)
 */
@Module({
  controllers: [TopicsController],
  providers: [TopicsService, GscService, GeoService, CompetitorService, ScorerService],
  exports: [TopicsService],
})
export class TopicsModule {}
