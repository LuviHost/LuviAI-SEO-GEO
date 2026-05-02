import { Injectable, Logger } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';
import type { ChatRequest, ChatResponse, ILLMProvider, ModelPricing, ProviderName } from './llm.types.js';

const PRICING: Record<string, ModelPricing> = {
  'claude-opus-4-7':            { input: 15, output: 75, cacheRead: 1.5,  cacheWrite: 18.75 },
  'claude-sonnet-4-6':          { input: 3,  output: 15, cacheRead: 0.3,  cacheWrite: 3.75 },
  'claude-haiku-4-5-20251001':  { input: 1,  output: 5,  cacheRead: 0.1,  cacheWrite: 1.25 },
  // Fallbacks (legacy model isimleri)
  'claude-3-5-sonnet':          { input: 3,  output: 15, cacheRead: 0.3,  cacheWrite: 3.75 },
  'claude-3-5-haiku':           { input: 1,  output: 5,  cacheRead: 0.1,  cacheWrite: 1.25 },
};

@Injectable()
export class AnthropicProvider implements ILLMProvider {
  readonly name: ProviderName = 'anthropic';
  private readonly log = new Logger(AnthropicProvider.name);
  private client: Anthropic;

  constructor() {
    this.client = new Anthropic();
  }

  supportsModel(model: string): boolean {
    return model.startsWith('claude');
  }

  getPricing(model: string): ModelPricing | null {
    if (PRICING[model]) return PRICING[model];
    // Prefix match fallback
    for (const [key, pricing] of Object.entries(PRICING)) {
      if (model.startsWith(key)) return pricing;
    }
    return null;
  }

  async chat(req: ChatRequest): Promise<ChatResponse> {
    const t0 = Date.now();
    const systemBlocks = req.systemPrompt
      ? req.cacheSystemPrompt
        ? [{ type: 'text' as const, text: req.systemPrompt, cache_control: { type: 'ephemeral' as const } }]
        : [{ type: 'text' as const, text: req.systemPrompt }]
      : undefined;

    const response = await this.client.messages.create({
      model: req.model,
      max_tokens: req.maxTokens ?? 1024,
      temperature: req.temperature,
      system: systemBlocks,
      messages: req.messages.filter(m => m.role !== 'system').map(m => ({
        role: m.role as 'user' | 'assistant',
        content: m.content,
      })),
    });

    const text = response.content
      .filter((b): b is Anthropic.Messages.TextBlock => b.type === 'text')
      .map(b => b.text)
      .join('\n');

    const usage = {
      inputTokens: response.usage.input_tokens ?? 0,
      outputTokens: response.usage.output_tokens ?? 0,
      cacheReadTokens: (response.usage as any).cache_read_input_tokens ?? 0,
      cacheWriteTokens: (response.usage as any).cache_creation_input_tokens ?? 0,
    };

    const pricing = this.getPricing(req.model);
    const costUsd = pricing ? (
      (usage.inputTokens / 1_000_000) * pricing.input +
      (usage.outputTokens / 1_000_000) * pricing.output +
      (usage.cacheReadTokens / 1_000_000) * (pricing.cacheRead ?? pricing.input) +
      (usage.cacheWriteTokens / 1_000_000) * (pricing.cacheWrite ?? pricing.input * 1.25)
    ) : 0;

    this.log.debug(`[${req.context}] ${req.model} ${((Date.now() - t0) / 1000).toFixed(1)}s in=${usage.inputTokens}+${usage.cacheReadTokens}/cache out=${usage.outputTokens} $${costUsd.toFixed(4)}`);

    return { output: text, model: req.model, provider: this.name, usage, costUsd };
  }
}
