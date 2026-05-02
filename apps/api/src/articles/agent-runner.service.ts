import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { buildBrainContext } from '@luviai/shared';
import type { AgentContext } from '@luviai/shared';
import { SettingsService } from '../settings/settings.service.js';
import { LLMProviderService } from '../llm/llm-provider.service.js';

export interface RunAgentParams {
  agentName: '01-keyword' | '02-outline' | '03-writer' | '04-editor' | '05-visuals' | 'topic-ranker';
  agentSystemSuffix: string;
  brainContext: AgentContext;
  input: string;
  maxTokens?: number;
  preferredModel?: 'opus' | 'sonnet' | 'haiku' | string;
  /** Token usage kaydında kullanılır */
  siteId?: string;
  conversationId?: string;
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

// Pricing artık LLMProviderService/AnthropicProvider içinde merkezi.

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

  constructor(
    private readonly settings: SettingsService,
    private readonly llm: LLMProviderService,
  ) {}

  async run(params: RunAgentParams): Promise<AgentResult> {
    // AI_GLOBAL_DISABLED guard burada da var (LLMProviderService içinde de var; defansif)
    if (await this.settings.getBoolean('AI_GLOBAL_DISABLED')) {
      this.log.warn(`AI_GLOBAL_DISABLED=1 — agent çağrısı atlandı (${params.agentName})`);
      throw new ServiceUnavailableException(
        'AI test modu aktif (admin panelden AI_GLOBAL_DISABLED kapalı). Gerçek üretim için admin panelden kapatmalısın.',
      );
    }

    const model = this.resolveModel(params.preferredModel, params.agentName);
    const brainSystem = buildBrainContext(params.brainContext);
    const t0 = Date.now();

    try {
      const response = await this.llm.chat({
        context: `agent-${params.agentName}`,
        siteId: params.siteId,
        conversationId: params.conversationId,
        model,
        systemPrompt: `${brainSystem}\n\n${params.agentSystemSuffix}`,
        cacheSystemPrompt: true,
        messages: [{ role: 'user', content: params.input }],
        maxTokens: params.maxTokens ?? 16384,
      });

      this.log.log(`[${params.agentName}] ${model} — ${((Date.now() - t0) / 1000).toFixed(1)}s, $${response.costUsd.toFixed(4)} (in:${response.usage.inputTokens}+${response.usage.cacheReadTokens}/cache, out:${response.usage.outputTokens})`);

      return {
        agent: params.agentName,
        model: response.model,
        output: response.output,
        usage: response.usage,
        costUsd: response.costUsd,
      };
    } catch (err: any) {
      const msg = String(err?.message ?? '');
      if (/credit balance is too low/i.test(msg) || /insufficient_quota/i.test(msg)) {
        this.log.error(`AI kredisi tükendi: ${msg}`);
        throw new ServiceUnavailableException(
          'AI sağlayıcı kredisi tükendi. Yönetici hesabına kredi yüklemeli (console.anthropic.com → Plans & Billing).',
        );
      }
      if (/rate.?limit/i.test(msg) || err?.status === 429) {
        throw new ServiceUnavailableException('AI sağlayıcı rate limit\'e takıldı. Birkaç saniye bekleyip tekrar dene.');
      }
      if (err?.status === 401 || /api.?key/i.test(msg)) {
        throw new ServiceUnavailableException('AI sağlayıcı kimlik doğrulaması başarısız (API key geçersiz).');
      }
      throw err;
    }
  }

  private resolveModel(preferred: string | undefined, agentName: string): string {
    if (agentName === '03-writer' && process.env.WRITER_MODEL) return process.env.WRITER_MODEL;
    if (agentName === '04-editor' && process.env.EDITOR_MODEL) return process.env.EDITOR_MODEL;
    if (preferred && MODEL_MAP[preferred]) return MODEL_MAP[preferred];
    if (preferred) return preferred;
    return process.env.ROUTING_MODEL ?? 'claude-sonnet-4-6';
  }

}
