import { Injectable, Logger } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';
import type { ChatRequest, ChatResponse, ILLMProvider, ModelPricing, ProviderName } from './llm.types.js';

/**
 * $ / 1M token. cacheRead = input x0.1, cacheWrite = input x1.25 (5 dk TTL).
 *
 * DIKKAT: Buradaki rakamlar kullaniciya raporlanan maliyeti belirler.
 * Onceki tabloda claude-opus-4-7 15/75 yaziyordu; gercegi 5/25 — yani her
 * Opus cagrisinin maliyeti panelde 3 KAT fazla gosteriliyordu.
 */
const PRICING: Record<string, ModelPricing> = {
  'claude-opus-5':              { input: 5,  output: 25, cacheRead: 0.5,  cacheWrite: 6.25 },
  'claude-opus-4-8':            { input: 5,  output: 25, cacheRead: 0.5,  cacheWrite: 6.25 },
  'claude-opus-4-7':            { input: 5,  output: 25, cacheRead: 0.5,  cacheWrite: 6.25 },
  // Sonnet 5: 2026-08-31'e kadar tanitim fiyati 2/10. Standart tarife
  // yaziliyor — maliyeti eksik degil fazla gostermek daha guvenli.
  'claude-sonnet-5':            { input: 3,  output: 15, cacheRead: 0.3,  cacheWrite: 3.75 },
  'claude-sonnet-4-6':          { input: 3,  output: 15, cacheRead: 0.3,  cacheWrite: 3.75 },
  'claude-haiku-4-5':           { input: 1,  output: 5,  cacheRead: 0.1,  cacheWrite: 1.25 },
  'claude-haiku-4-5-20251001':  { input: 1,  output: 5,  cacheRead: 0.1,  cacheWrite: 1.25 },
  // Fallbacks (legacy model isimleri)
  'claude-3-5-sonnet':          { input: 3,  output: 15, cacheRead: 0.3,  cacheWrite: 3.75 },
  'claude-3-5-haiku':           { input: 1,  output: 5,  cacheRead: 0.1,  cacheWrite: 1.25 },
};

/**
 * temperature / top_p / top_k bu modellerde KALDIRILDI — gonderilirse API
 * 400 doner. Saglayici bu modellerde parametreyi hic gondermez.
 * (Claude Opus 5 / 4.8 / 4.7, Sonnet 5, Fable 5)
 */
function rejectsSamplingParams(model: string): boolean {
  return /^claude-(opus-(5|4-8|4-7)|sonnet-5|fable-5|mythos-5)/.test(model);
}

/**
 * Adaptive thinking destekleyen modeller. Opus 5'te thinking VARSAYILAN
 * olarak aciktir — parametre gonderilmese de calisir; digerlerinde acikca
 * istenmesi gerekir.
 */
function supportsAdaptiveThinking(model: string): boolean {
  return /^claude-(opus-(5|4-8|4-7|4-6)|sonnet-(5|4-6)|fable-5|mythos-5)/.test(model);
}

/**
 * output_config.effort destekleyen modeller. Haiku 4.5 ve Sonnet 4.5'te
 * DESTEKLENMEZ — gonderilirse 400 doner. Kardesi olan sampling/thinking
 * gate'leri vardi ama effort gate'i atlanmisti: WRITER_MODEL=claude-haiku-4-5
 * secildiginde tum yazar/editor ajani cagrilari 400 ile duserdi.
 */
function supportsEffort(model: string): boolean {
  return /^claude-(opus-(5|4-8|4-7|4-6|4-5)|sonnet-(5|4-6)|fable-5|mythos-5)/.test(model);
}

/**
 * 'xhigh' ve 'max' her modelde yok: xhigh Opus 4.7 ile geldi, max Opus 4.6+.
 * Desteklemeyen modelde seviye 'high'a indirilir (400 yerine calisan istek).
 */
function clampEffort(model: string, effort: string): string {
  const supportsXhigh = /^claude-(opus-(5|4-8|4-7)|sonnet-5|fable-5|mythos-5)/.test(model);
  const supportsMax = /^claude-(opus-(5|4-8|4-7|4-6)|sonnet-(5|4-6)|fable-5|mythos-5)/.test(model);
  if (effort === 'xhigh' && !supportsXhigh) return 'high';
  if (effort === 'max' && !supportsMax) return 'high';
  return effort;
}

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

    // temperature yalnizca kabul eden modellere gonderilir. Opus 4.7+ ve
    // Sonnet 5'te bu parametre kaldirildi; gonderilirse istek 400 ile duser.
    const sampling =
      req.temperature !== undefined && !rejectsSamplingParams(req.model)
        ? { temperature: req.temperature }
        : {};

    // Adaptive thinking: model karar verir, sabit token butcesi yok.
    // (budget_tokens Opus 4.7+ ve Sonnet 5'te kaldirildi — 400 verir.)
    const thinking =
      req.thinking && supportsAdaptiveThinking(req.model)
        ? { thinking: { type: 'adaptive' as const } }
        : {};

    // effort thinking derinligini ve toplam token harcamasini ayarlar.
    // Model gate'i SART: Haiku 4.5 / Sonnet 4.5 effort kabul etmez (400).
    const outputConfig = req.effort && supportsEffort(req.model)
      ? { output_config: { effort: clampEffort(req.model, req.effort) } }
      : {};

    const response = await this.client.messages.create({
      model: req.model,
      max_tokens: req.maxTokens ?? 1024,
      ...sampling,
      ...thinking,
      ...outputConfig,
      system: systemBlocks,
      messages: req.messages.filter(m => m.role !== 'system').map(m => ({
        role: m.role as 'user' | 'assistant',
        content: m.content,
      })),
    } as any);

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
