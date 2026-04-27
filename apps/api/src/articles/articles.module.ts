import { Module } from '@nestjs/common';
import { ArticlesController } from './articles.controller.js';
import { ArticlesService } from './articles.service.js';
import { AgentRunnerService } from './agent-runner.service.js';
import { PipelineService } from './pipeline.service.js';

/**
 * Article Pipeline:
 *  - 6 ajan zinciri (anahtar kelime → outline → yazar → editor → görsel → yayıncı)
 *  - AgentRunner: tek ajan çağrısı (Anthropic SDK + prompt caching)
 *  - PipelineService: zincir orchestration
 *
 * Worker'da çalışan job: GENERATE_ARTICLE.
 * Bu modül CRUD + manuel trigger sunar.
 */
@Module({
  controllers: [ArticlesController],
  providers: [ArticlesService, AgentRunnerService, PipelineService],
  exports: [ArticlesService, AgentRunnerService, PipelineService],
})
export class ArticlesModule {}
