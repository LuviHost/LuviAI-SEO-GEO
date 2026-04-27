import { Module } from '@nestjs/common';
import { ArticlesController } from './articles.controller.js';
import { ArticlesService } from './articles.service.js';
import { AgentRunnerService } from './agent-runner.service.js';
import { PipelineService } from './pipeline.service.js';
import { ImageGeneratorService } from './image-generator.service.js';
import { PublisherService } from './publisher.service.js';

/**
 * Article Pipeline:
 *  - 6 ajan zinciri (anahtar kelime → outline → yazar → editor → görsel → yayıncı)
 *  - AgentRunner: tek ajan çağrısı (Anthropic SDK + prompt caching)
 *  - PipelineService: zincir orchestration
 *  - ImageGenerator: Gemini 2.5 Flash Image
 *  - Publisher: adapter framework (WP/FTP/SFTP/Markdown)
 */
@Module({
  controllers: [ArticlesController],
  providers: [
    ArticlesService,
    AgentRunnerService,
    PipelineService,
    ImageGeneratorService,
    PublisherService,
  ],
  exports: [
    ArticlesService,
    AgentRunnerService,
    PipelineService,
    ImageGeneratorService,
    PublisherService,
  ],
})
export class ArticlesModule {}
