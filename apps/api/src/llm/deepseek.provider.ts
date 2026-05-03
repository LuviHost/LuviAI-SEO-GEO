import { Injectable, Logger } from '@nestjs/common';
import type { ChatRequest, ChatResponse, ILLMProvider, ModelPricing, ProviderName } from './llm.types.js';

// 'openai' paketi opsiyonel — DeepSeek OpenAI-compatible API kullanir.
// Eval-import ile derleme bagimliligi olusturmadan lazy yukleriz.

/**
 * DeepSeek provider — Anthropic'ten ~20x ucuz, OpenAI-compatible API.
 *
 *   chat.deepseek.com/v1 → OpenAI SDK ile aynı interface
 *   Pricing (Mart 2026): $0.14 / 1M input, $0.28 / 1M output (R1: $0.55/$2.19)
 *
 * Anthropic rate-limit/kredi hatası durumunda fallback olarak çalışır.
 * DEEPSEEK_API_KEY env'inden okur (ileride BYOK yapılabilir).
 */
const PRICING: Record<string, ModelPricing> = {
  'deepseek-chat':     { input: 0.14, output: 0.28 },
  'deepseek-reasoner': { input: 0.55, output: 2.19 },
  'deepseek-v3':       { input: 0.14, output: 0.28 },
};

@Injectable()
export class DeepSeekProvider implements ILLMProvider {
  readonly name: ProviderName = 'deepseek';
  private readonly log = new Logger(DeepSeekProvider.name);
  private client: any = null;

  private async getClient(): Promise<any> {
    if (this.client) return this.client;
    const mod: any = await (Function('m', 'return import(m)') as any)('openai').catch(() => null);
    if (!mod) throw new Error('openai paketi kurulu değil — DeepSeek için: pnpm add openai');
    const OpenAI = mod.default ?? mod.OpenAI;
    const apiKey = process.env.DEEPSEEK_API_KEY;
    if (!apiKey) throw new Error('DEEPSEEK_API_KEY env tanımlı değil');
    this.client = new OpenAI({
      apiKey,
      baseURL: 'https://api.deepseek.com/v1',
    });
    return this.client;
  }

  supportsModel(model: string): boolean {
    return model.startsWith('deepseek');
  }

  getPricing(model: string): ModelPricing | null {
    if (PRICING[model]) return PRICING[model];
    for (const [key, pricing] of Object.entries(PRICING)) {
      if (model.startsWith(key)) return pricing;
    }
    return PRICING['deepseek-chat']; // güvenli fallback
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
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
    };

    const pricing = this.getPricing(req.model)!;
    const costUsd =
      (usage.inputTokens / 1_000_000) * pricing.input +
      (usage.outputTokens / 1_000_000) * pricing.output;

    this.log.debug(`[${req.context}] DeepSeek ${req.model} ${((Date.now() - t0) / 1000).toFixed(1)}s in=${usage.inputTokens} out=${usage.outputTokens} $${costUsd.toFixed(4)}`);

    return { output: text, model: req.model, provider: this.name, usage, costUsd };
  }
}
