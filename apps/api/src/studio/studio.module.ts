import { Module, forwardRef } from '@nestjs/common';
import { StudioController } from './studio.controller.js';
import { ArticlesModule } from '../articles/articles.module.js';
import { LLMModule } from '../llm/llm.module.js';

/**
 * Studio — multi-modal content generation (image / video / text).
 *
 * Image: gemini-flash | gpt-image-1 | flux-pro | ideogram-v3
 * Video: registry'den (videos module)
 * Text:  LLM provider (Claude/OpenAI/Gemini)
 *
 * ImageGeneratorService articles modülünde tanımlı, forwardRef ile alıyoruz.
 */
@Module({
  imports: [forwardRef(() => ArticlesModule), LLMModule],
  controllers: [StudioController],
})
export class StudioModule {}
