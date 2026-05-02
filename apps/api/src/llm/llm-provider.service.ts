import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { SettingsService } from '../settings/settings.service.js';
import { AnthropicProvider } from './anthropic.provider.js';
import { OpenAIProvider } from './openai.provider.js';
import { GeminiProvider } from './gemini.provider.js';
import type { ChatRequest, ChatResponse, ILLMProvider, ProviderName } from './llm.types.js';

/**
 * LLMProviderService — multi-provider router + token usage recorder.
 *
 * Tüm LuviAI servisleri (article writer, snippet optimizer, ads audit judge,
 * citation tracker vb.) bu service'in `chat()` metodunu çağırır. Service:
 *   1. AI_GLOBAL_DISABLED guard kontrolü yapar (admin panel toggle)
 *   2. Model adına göre doğru provider'ı seçer
 *   3. Provider çağrısını yapar
 *   4. Token usage + cost'u TokenUsageRecord tablosuna asenkron yazar
 *   5. ChatResponse'u döndürür
 *
 * Bu sayede:
 *   - Provider değişimi tek noktadan
 *   - Tüm spend tek tabloda — admin spend dashboard
 *   - Site/user bazında quota enforcement mümkün
 *   - LibreChat'in `Transaction + spendTokens` 2-aşamalı yapısının
 *     Prisma karşılığı.
 */
@Injectable()
export class LLMProviderService {
  private readonly log = new Logger(LLMProviderService.name);
  private readonly providers: ILLMProvider[];

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    anthropic: AnthropicProvider,
    openai: OpenAIProvider,
    gemini: GeminiProvider,
  ) {
    this.providers = [anthropic, openai, gemini];
  }

  /** Model adına göre provider seç */
  private resolveProvider(model: string): ILLMProvider {
    const found = this.providers.find(p => p.supportsModel(model));
    if (!found) throw new Error(`No provider for model "${model}"`);
    return found;
  }

  /** Ana çağrı noktası — kullanıcı/servis bunu çağırır */
  async chat(req: ChatRequest): Promise<ChatResponse> {
    // Global AI guard
    const disabled = await this.settings.getBoolean('AI_GLOBAL_DISABLED').catch(() => false);
    if (disabled) {
      throw new ServiceUnavailableException('AI_GLOBAL_DISABLED — admin panelinden test modu aktif');
    }

    const provider = this.resolveProvider(req.model);
    const response = await provider.chat(req);

    // Token usage kaydı (asenkron — başarısızlık ana akışı kırmasın)
    this.recordUsage(req, response).catch(err => {
      this.log.warn(`Token usage kayıt hatası: ${err.message}`);
    });

    return response;
  }

  private async recordUsage(req: ChatRequest, res: ChatResponse): Promise<void> {
    const pricing = this.providers.find(p => p.name === res.provider)?.getPricing(req.model);
    if (!pricing) return;

    const records: any[] = [];

    if (res.usage.inputTokens > 0) {
      records.push({
        siteId: req.siteId,
        userId: req.userId,
        provider: res.provider,
        model: res.model,
        tokenType: 'prompt',
        context: req.context,
        inputTokens: res.usage.inputTokens,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        rate: pricing.input,
        costUsd: (res.usage.inputTokens / 1_000_000) * pricing.input,
        conversationId: req.conversationId,
      });
    }
    if (res.usage.outputTokens > 0) {
      records.push({
        siteId: req.siteId,
        userId: req.userId,
        provider: res.provider,
        model: res.model,
        tokenType: 'completion',
        context: req.context,
        inputTokens: 0,
        outputTokens: res.usage.outputTokens,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        rate: pricing.output,
        costUsd: (res.usage.outputTokens / 1_000_000) * pricing.output,
        conversationId: req.conversationId,
      });
    }
    if (res.usage.cacheReadTokens > 0 && pricing.cacheRead) {
      records.push({
        siteId: req.siteId,
        userId: req.userId,
        provider: res.provider,
        model: res.model,
        tokenType: 'cache_read',
        context: req.context,
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: res.usage.cacheReadTokens,
        cacheWriteTokens: 0,
        rate: pricing.cacheRead,
        costUsd: (res.usage.cacheReadTokens / 1_000_000) * pricing.cacheRead,
        conversationId: req.conversationId,
      });
    }
    if (res.usage.cacheWriteTokens > 0 && pricing.cacheWrite) {
      records.push({
        siteId: req.siteId,
        userId: req.userId,
        provider: res.provider,
        model: res.model,
        tokenType: 'cache_write',
        context: req.context,
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: res.usage.cacheWriteTokens,
        rate: pricing.cacheWrite,
        costUsd: (res.usage.cacheWriteTokens / 1_000_000) * pricing.cacheWrite,
        conversationId: req.conversationId,
      });
    }

    if (records.length === 0) return;
    await this.prisma.tokenUsageRecord.createMany({ data: records });
  }

  /** Site / user / global için aggregated spend bilgisi */
  async getSpendSummary(filter: { siteId?: string; userId?: string; days?: number }): Promise<{
    totalUsd: number;
    byProvider: Record<string, number>;
    byContext: Record<string, number>;
    byDate: Record<string, number>;
    requestCount: number;
  }> {
    const days = filter.days ?? 30;
    const since = new Date(Date.now() - days * 86400000);

    const records = await this.prisma.tokenUsageRecord.findMany({
      where: {
        ...(filter.siteId ? { siteId: filter.siteId } : {}),
        ...(filter.userId ? { userId: filter.userId } : {}),
        createdAt: { gte: since },
      },
      orderBy: { createdAt: 'asc' },
    });

    const byProvider: Record<string, number> = {};
    const byContext: Record<string, number> = {};
    const byDate: Record<string, number> = {};
    let totalUsd = 0;

    for (const r of records) {
      const cost = Number(r.costUsd);
      totalUsd += cost;
      byProvider[r.provider] = (byProvider[r.provider] ?? 0) + cost;
      if (r.context) byContext[r.context] = (byContext[r.context] ?? 0) + cost;
      const d = r.createdAt.toISOString().slice(0, 10);
      byDate[d] = (byDate[d] ?? 0) + cost;
    }

    return { totalUsd, byProvider, byContext, byDate, requestCount: records.length };
  }
}
