import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';
import { buildBrainContext } from '@luviai/shared';
import type { AgentContext } from '@luviai/shared';
import { SettingsService } from '../settings/settings.service.js';

export interface RunAgentParams {
  agentName: '01-keyword' | '02-outline' | '03-writer' | '04-editor' | '05-visuals' | 'topic-ranker';
  agentSystemSuffix: string;
  brainContext: AgentContext;
  input: string;
  maxTokens?: number;
  preferredModel?: 'opus' | 'sonnet' | 'haiku' | string;
}

export interface AgentResult {
  agent: string;
  model: string;
  output: string;
  usage: {
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    cacheWriteTokens: number;
  };
  costUsd: number;
}

const MODEL_MAP: Record<string, string> = {
  opus: 'claude-opus-4-7',
  sonnet: 'claude-sonnet-4-6',
  haiku: 'claude-haiku-4-5-20251001',
};

// USD per 1M tokens (Anthropic pricing — Nisan 2026)
const PRICING: Record<string, { input: number; output: number; cacheRead: number; cacheWrite: number }> = {
  'claude-opus-4-7': { input: 15, output: 75, cacheRead: 1.5, cacheWrite: 18.75 },
  'claude-sonnet-4-6': { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
  'claude-haiku-4-5-20251001': { input: 1, output: 5, cacheRead: 0.1, cacheWrite: 1.25 },
};

/**
 * Tek ajan çağrısı.
 *
 * Her tenant için DİNAMİK system prompt:
 *   [BRAIN_CONTEXT]  ← cache_control: ephemeral (cache hit %90 indirim)
 *   [AGENT_SUFFIX]   ← ajan rolü
 *   user message: [PREVIOUS_AGENT_OUTPUT]
 *
 * Brain context cache'lenir; aynı tenant'ın 6 ajanı tek brain ile çalışınca
 * sadece ilk ajan brain token'larını ödeyip sonraki 5'i cache'den okur.
 */
@Injectable()
export class AgentRunnerService {
  private readonly log = new Logger(AgentRunnerService.name);

  constructor(private readonly settings: SettingsService) {}

  async run(params: RunAgentParams): Promise<AgentResult> {
    // AI_GLOBAL_DISABLED guard — admin panelden test modu açıldıysa Anthropic çağrısı yapma.
    if (await this.settings.getBoolean('AI_GLOBAL_DISABLED')) {
      this.log.warn(`AI_GLOBAL_DISABLED=1 — agent çağrısı atlandı (${params.agentName})`);
      throw new ServiceUnavailableException(
        'AI test modu aktif (admin panelden AI_GLOBAL_DISABLED kapalı). Gerçek üretim için admin panelden kapatmalısın.',
      );
    }

    const model = this.resolveModel(params.preferredModel, params.agentName);
    const brainSystem = buildBrainContext(params.brainContext);

    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

    const t0 = Date.now();

    let response;
    try {
      response = await client.messages.create({
        model,
        max_tokens: params.maxTokens ?? 16384,
        system: [
          {
            type: 'text',
            text: brainSystem,
            cache_control: { type: 'ephemeral' },
          },
          {
            type: 'text',
            text: params.agentSystemSuffix,
          },
        ],
        messages: [{ role: 'user', content: params.input }],
      });
    } catch (err: any) {
      // Anthropic API hatalarını user-friendly mesajla 503 ServiceUnavailable'a çevir.
      const msg = String(err?.message ?? '');
      if (/credit balance is too low/i.test(msg) || /insufficient_quota/i.test(msg)) {
        this.log.error(`Anthropic kredisi tükendi: ${msg}`);
        throw new ServiceUnavailableException(
          'AI sağlayıcı kredisi tükendi. Yöneticinin Anthropic hesabına kredi yüklemesi gerek (console.anthropic.com → Plans & Billing).',
        );
      }
      if (/rate.?limit/i.test(msg) || err?.status === 429) {
        throw new ServiceUnavailableException(
          'AI sağlayıcı rate limit\'e takıldı. Birkaç saniye bekleyip tekrar dene.',
        );
      }
      if (err?.status === 401 || /api.?key/i.test(msg)) {
        throw new ServiceUnavailableException(
          'AI sağlayıcı kimlik doğrulaması başarısız (API key geçersiz). Yöneticiye haber ver.',
        );
      }
      // Diğer hataları olduğu gibi geçir (NestJS 500 yapar)
      throw err;
    }

    const text = response.content
      .filter((b: any) => b.type === 'text')
      .map((b: any) => b.text)
      .join('\n');

    const usage = {
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
      cacheReadTokens: (response.usage as any).cache_read_input_tokens ?? 0,
      cacheWriteTokens: (response.usage as any).cache_creation_input_tokens ?? 0,
    };

    const costUsd = this.estimateCost(model, usage);

    this.log.log(`[${params.agentName}] ${model} — ${((Date.now() - t0) / 1000).toFixed(1)}s, $${costUsd.toFixed(4)} (in:${usage.inputTokens}+${usage.cacheReadTokens}/cache, out:${usage.outputTokens})`);

    return {
      agent: params.agentName,
      model,
      output: text,
      usage,
      costUsd,
    };
  }

  private resolveModel(preferred: string | undefined, agentName: string): string {
    if (agentName === '03-writer' && process.env.WRITER_MODEL) return process.env.WRITER_MODEL;
    if (agentName === '04-editor' && process.env.EDITOR_MODEL) return process.env.EDITOR_MODEL;
    if (preferred && MODEL_MAP[preferred]) return MODEL_MAP[preferred];
    if (preferred) return preferred;
    return process.env.ROUTING_MODEL ?? 'claude-sonnet-4-6';
  }

  private estimateCost(model: string, usage: AgentResult['usage']): number {
    const p = PRICING[model] ?? PRICING['claude-sonnet-4-6'];
    return (
      (usage.inputTokens * p.input +
        usage.outputTokens * p.output +
        usage.cacheReadTokens * p.cacheRead +
        usage.cacheWriteTokens * p.cacheWrite) /
      1_000_000
    );
  }
}
