import { Module } from '@nestjs/common';
import { LLMProviderService } from './llm-provider.service.js';
import { AnthropicProvider } from './anthropic.provider.js';
import { OpenAIProvider } from './openai.provider.js';
import { GeminiProvider } from './gemini.provider.js';
import { DeepSeekProvider } from './deepseek.provider.js';
import { SpendController } from './spend.controller.js';
import { SettingsModule } from '../settings/settings.module.js';

@Module({
  imports: [SettingsModule],
  controllers: [SpendController],
  providers: [LLMProviderService, AnthropicProvider, OpenAIProvider, GeminiProvider, DeepSeekProvider],
  exports: [LLMProviderService],
})
export class LLMModule {}
