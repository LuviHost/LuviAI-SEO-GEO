import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { SettingsService } from '../settings/settings.service.js';
import { AnthropicProvider } from './anthropic.provider.js';
import { OpenAIProvider } from './openai.provider.js';
import { GeminiProvider } from './gemini.provider.js';
import { DeepSeekProvider } from './deepseek.provider.js';
import type { ChatRequest, ChatResponse, ILLMProvider, ProviderName } from './llm.types.js';

/**
 * LLMProviderService — multi-provider router + token usage recorder + fallback chain.
 *
 *   1. AI_GLOBAL_DISABLED          — global kill switch (admin)
 *   2. MOCK_PIPELINE_DEFAULT       — pipeline çağrılarını mock'a çevir (cost=0)
 *   3. MONTHLY_SPEND_LIMIT_USD     — aylık limit aşıldıysa çağrıyı reddet
 *   4. PROMPT_CACHE_ENABLED        — Anthropic ephemeral cache toggle
 *   5. LLM_FALLBACK_CHAIN          — provider fallback (anthropic → deepseek → gemini)
 *   6. TokenUsageRecord            — her çağrı DB'ye kaydedilir, /admin/spend görür
 */
@Injectable()
export class LLMProviderService {
  private readonly log = new Logger(LLMProviderService.name);
  private readonly providers: ILLMProvider[];

  // Spend cache — her çağrıda DB'yi tarama, dakikada bir refresh et
  private spendCache: { value: number; ts: number } = { value: 0, ts: 0 };

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    anthropic: AnthropicProvider,
    openai: OpenAIProvider,
    gemini: GeminiProvider,
    deepseek: DeepSeekProvider,
  ) {
    this.providers = [anthropic, openai, gemini, deepseek];
  }

  /** Model adına göre provider seç */
  private resolveProvider(model: string): ILLMProvider {
    const found = this.providers.find(p => p.supportsModel(model));
    if (!found) throw new Error(`No provider for model "${model}"`);
    return found;
  }

  /** Belirli ProviderName karşılığı ILLMProvider */
  private getProviderByName(name: ProviderName): ILLMProvider | null {
    return this.providers.find(p => p.name === name) ?? null;
  }

  /**
   * Aylık spend limit guard. 0 = limit yok.
   * 60 sn cache ile DB sorgusu spam'i önlenir.
   */
  private async checkSpendLimit(): Promise<void> {
    const limit = await this.settings.getInt('MONTHLY_SPEND_LIMIT_USD').catch(() => 0);
    if (limit <= 0) return;

    const now = Date.now();
    if (now - this.spendCache.ts > 60_000) {
      const since = new Date(now - 30 * 86400_000);
      const sum = await this.prisma.tokenUsageRecord.aggregate({
        where: { createdAt: { gte: since } },
        _sum: { costUsd: true },
      });
      this.spendCache = {
        value: Number(sum._sum.costUsd ?? 0),
        ts: now,
      };
    }

    if (this.spendCache.value >= limit) {
      throw new ServiceUnavailableException(
        `Aylık AI maliyet limiti aşıldı: $${this.spendCache.value.toFixed(2)} / $${limit}. Admin panelden MONTHLY_SPEND_LIMIT_USD ayarını yükselt veya bekle (otomatik 30 günde reset).`,
      );
    }
  }

  /** Mock pipeline kontrolü — context "agent-*" ise pipeline çağrısıdır */
  private async maybeMockResponse(req: ChatRequest): Promise<ChatResponse | null> {
    const isPipeline = req.context?.startsWith('agent-') || req.context?.includes('pipeline');
    if (!isPipeline) return null;

    const mockEnabled = await this.settings.getBoolean('MOCK_PIPELINE_DEFAULT').catch(() => false);
    if (!mockEnabled) return null;

    this.log.warn(`[${req.context}] MOCK_PIPELINE_DEFAULT=1 — gerçek AI çağrısı atlandı`);
    return {
      output: `[MOCK] LuviAI test modu — gerçek üretim için admin panelden MOCK_PIPELINE_DEFAULT=0 yap.\n\nİstek özeti: ${req.context}, ${req.messages.length} mesaj.`,
      model: req.model,
      provider: this.resolveProvider(req.model).name,
      usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
      costUsd: 0,
    };
  }

  /** Provider çağrısını dener; rate-limit/credit/auth hatasında fallback chain'e bakar */
  private async callWithFallback(req: ChatRequest, primaryProvider: ILLMProvider): Promise<ChatResponse> {
    try {
      // PROMPT_CACHE_ENABLED toggle — req.cacheSystemPrompt'u override etmez, sadece anthropic provider için sinyal
      const cacheEnabled = await this.settings.getBoolean('PROMPT_CACHE_ENABLED').catch(() => true);
      const reqWithCache: ChatRequest = {
        ...req,
        cacheSystemPrompt: req.cacheSystemPrompt && cacheEnabled,
      };
      return await primaryProvider.chat(reqWithCache);
    } catch (err: any) {
      const isRetryable = this.isRetryableError(err);
      if (!isRetryable) throw err;

      const chain = await this.settings.getString('LLM_FALLBACK_CHAIN').catch(() => 'anthropic-only');
      const fallbacks = this.resolveFallbackChain(chain, primaryProvider.name);

      if (fallbacks.length === 0) {
        this.log.warn(`[${req.context}] ${primaryProvider.name} hata: ${err.message} — fallback chain devre dışı (LLM_FALLBACK_CHAIN=${chain})`);
        throw err;
      }

      for (const fbName of fallbacks) {
        const fb = this.getProviderByName(fbName);
        if (!fb) continue;
        const fallbackModel = this.pickDefaultModel(fbName);
        if (!fallbackModel) continue;
        this.log.warn(`[${req.context}] ${primaryProvider.name} → ${fbName} fallback (${err.message})`);
        try {
          return await fb.chat({ ...req, model: fallbackModel });
        } catch (fbErr: any) {
          this.log.warn(`[${req.context}] ${fbName} fallback de başarısız: ${fbErr.message}`);
        }
      }
      throw err;
    }
  }

  private isRetryableError(err: any): boolean {
    const msg = String(err?.message ?? '').toLowerCase();
    if (err?.status === 429 || msg.includes('rate.limit') || msg.includes('rate_limit')) return true;
    if (err?.status === 529 || msg.includes('overloaded')) return true;
    if (msg.includes('credit balance') || msg.includes('insufficient_quota')) return true;
    return false;
  }

  private resolveFallbackChain(strategy: string, current: ProviderName): ProviderName[] {
    switch (strategy) {
      case 'anthropic-then-deepseek': return current === 'anthropic' ? ['deepseek' as ProviderName] : [];
      case 'anthropic-then-gemini':   return current === 'anthropic' ? ['gemini'] : [];
      case 'all':                     return current === 'anthropic' ? ['deepseek' as ProviderName, 'gemini'] : current === 'deepseek' as ProviderName ? ['gemini'] : [];
      case 'anthropic-only':
      default:                        return [];
    }
  }

  private pickDefaultModel(provider: ProviderName): string | null {
    if (provider === 'anthropic') return 'claude-haiku-4-5-20251001';
    if (provider === ('deepseek' as ProviderName)) return 'deepseek-chat';
    if (provider === 'gemini') return 'gemini-2.5-flash';
    if (provider === 'openai') return 'gpt-4o-mini';
    return null;
  }

  /** Ana çağrı noktası — kullanıcı/servis bunu çağırır */
  async chat(req: ChatRequest): Promise<ChatResponse> {
    // 1. Global guard
    const disabled = await this.settings.getBoolean('AI_GLOBAL_DISABLED').catch(() => false);
    if (disabled) {
      throw new ServiceUnavailableException('AI_GLOBAL_DISABLED — admin panelinden test modu aktif');
    }

    // 2. Mock pipeline (sadece agent-* / pipeline çağrıları için)
    const mock = await this.maybeMockResponse(req);
    if (mock) return mock;

    // 3. Aylık spend limit
    await this.checkSpendLimit();

    // 4. Provider seç + fallback chain
    const primary = this.resolveProvider(req.model);
    const response = await this.callWithFallback(req, primary);

    // 5. Token usage kaydı (asenkron)
    this.recordUsage(req, response).catch(err => {
      this.log.warn(`Token usage kayıt hatası: ${err.message}`);
    });

    return response;
  }

  private async recordUsage(req: ChatRequest, res: ChatResponse): Promise<void> {
    const provider = this.providers.find(p => p.name === res.provider);
    const pricing = provider?.getPricing(res.model);
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

    // Spend cache invalidate
    this.spendCache.ts = 0;
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
