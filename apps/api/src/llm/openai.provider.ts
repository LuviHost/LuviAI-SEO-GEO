import { Injectable, Logger } from '@nestjs/common';
import type { ChatRequest, ChatResponse, ILLMProvider, ModelPricing, ProviderName } from './llm.types.js';

// 'openai' paketi opsiyonel — kurulu değilse provider chat() çağrısında hata fırlatır
// (ama supportsModel() kontrolü tüm akışı düşürmez).

const PRICING: Record<string, ModelPricing> = {
  'gpt-4o':        { input: 2.5,  output: 10,  cacheRead: 1.25 },
  'gpt-4o-mini':   { input: 0.15, output: 0.6, cacheRead: 0.075 },
  'gpt-4.1':       { input: 2,    output: 8,   cacheRead: 0.5 },
  'gpt-4.1-mini':  { input: 0.4,  output: 1.6, cacheRead: 0.1 },
  'o1':            { input: 15,   output: 60,  cacheRead: 7.5 },
  'o1-mini':       { input: 3,    output: 12,  cacheRead: 1.5 },
};

@Injectable()
export class OpenAIProvider implements ILLMProvider {
  readonly name: ProviderName = 'openai';
  private readonly log = new Logger(OpenAIProvider.name);
  private client: any = null;

  private async getClient(): Promise<any> {
    if (this.client) return this.client;
    try {
      // Dinamik import — paket yoksa derleme kırılmaz (eval ile TS resolve'unu bypass et)
      const mod: any = await (Function('m', 'return import(m)') as any)('openai').catch(() => null);
      if (!mod) throw new Error('openai paketi kurulu değil — `pnpm add openai` ile ekle');
      const OpenAI = mod.default ?? mod.OpenAI;
      this.client = new OpenAI();
      return this.client;
    } catch (err: any) {
      throw new Error(`OpenAI provider başlatılamadı: ${err.message}`);
    }
  }

  supportsModel(model: string): boolean {
    return model.startsWith('gpt-') || model.startsWith('o1') || model.startsWith('o3');
  }

  getPricing(model: string): ModelPricing | null {
    if (PRICING[model]) return PRICING[model];
    for (const [key, pricing] of Object.entries(PRICING)) {
      if (model.startsWith(key)) return pricing;
    }
    return null;
  }

  async chat(req: ChatRequest): Promise<ChatResponse> {
    const t0 = Date.now();
    const messages: any[] = [];
    if (req.systemPrompt) messages.push({ role: 'system', content: req.systemPrompt });
    for (const m of req.messages) messages.push({ role: m.role, content: m.content });

    const client = await this.getClient();
    const response = await client.chat.completions.create({
      model: req.model,
      max_tokens: req.maxTokens ?? 1024,
      temperature: req.temperature,
      messages,
    });

    const text = response.choices[0]?.message?.content ?? '';
    const usage = {
      inputTokens: response.usage?.prompt_tokens ?? 0,
      outputTokens: response.usage?.completion_tokens ?? 0,
      cacheReadTokens: (response.usage as any)?.prompt_tokens_details?.cached_tokens ?? 0,
      cacheWriteTokens: 0,
    };

    const pricing = this.getPricing(req.model);
    const costUsd = pricing ? (
      ((usage.inputTokens - usage.cacheReadTokens) / 1_000_000) * pricing.input +
      (usage.cacheReadTokens / 1_000_000) * (pricing.cacheRead ?? pricing.input * 0.5) +
      (usage.outputTokens / 1_000_000) * pricing.output
    ) : 0;

    this.log.debug(`[${req.context}] ${req.model} ${((Date.now() - t0) / 1000).toFixed(1)}s $${costUsd.toFixed(4)}`);
    return { output: text, model: req.model, provider: this.name, usage, costUsd };
  }
}
