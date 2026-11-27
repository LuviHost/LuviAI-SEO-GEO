import { Module } from '@nestjs/common';
import { LLMProviderService } from './llm-provider.service.js';
import { AnthropicProvider } from './anthropic.provider.js';
import { OpenAIProvider } from './openai.provider.js';
import { GeminiProvider } from './gemini.provider.js';
import { SpendController } from './spend.controller.js';
import { SaglayiciKrediService } from './saglayici-kredi.service.js';
import { SaglayiciKrediCron } from './saglayici-kredi.cron.js';
import { NotificationsModule } from '../notifications/notifications.module.js';
import { ModelRouterService } from './model-router.service.js';
import { SettingsModule } from '../settings/settings.module.js';

@Module({
  imports: [SettingsModule, NotificationsModule],
  controllers: [SpendController],
  providers: [LLMProviderService, AnthropicProvider, OpenAIProvider, GeminiProvider, ModelRouterService, SaglayiciKrediService, SaglayiciKrediCron],
  exports: [LLMProviderService, ModelRouterService],
})
export class LLMModule {}
