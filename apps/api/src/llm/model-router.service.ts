import { Injectable, Logger } from '@nestjs/common';

/**
 * Model Router — task tipine göre en uygun (cost-optimal) modeli seçer.
 *
 * Tier mantığı:
 *  - 'cheap': basit sınıflandırma, kısa yanıt, JSON extract (mini modeller)
 *  - 'standard': makale draft, sosyal post, normal generation
 *  - 'premium': uzun-form araştırma içerikleri, kompleks reasoning
 *
 * Maliyet (per 1M token, Mayıs 2026):
 *  - Cheap:    gpt-4o-mini $0.15/$0.60,  Claude Haiku 4.5 $0.80/$4
 *  - Standard: gpt-4o $5/$20,            Claude Sonnet 4.6 $3/$15
 *  - Premium:  o1 $15/$60,               Claude Opus 4.7 $15/$75
 */
@Injectable()
export class ModelRouterService {
  private readonly log = new Logger(ModelRouterService.name);

  selectModel(task: ModelTask, opts: { preferAnthropic?: boolean; userPlan?: string } = {}): { provider: 'anthropic' | 'openai'; model: string; supportsCaching: boolean } {
    const tier = TIER_BY_TASK[task];
    // Premium tier sadece Pro+ planlarına
    const planAllowsPremium = opts.userPlan && ['PRO', 'AGENCY', 'ENTERPRISE'].includes(opts.userPlan);
    const effectiveTier = tier === 'premium' && !planAllowsPremium ? 'standard' : tier;

    if (opts.preferAnthropic) {
      switch (effectiveTier) {
        case 'cheap': return { provider: 'anthropic', model: 'claude-haiku-4-5-20251001', supportsCaching: true };
        case 'standard': return { provider: 'anthropic', model: 'claude-sonnet-4-6', supportsCaching: true };
        case 'premium': return { provider: 'anthropic', model: 'claude-opus-4-7', supportsCaching: true };
      }
    }
    switch (effectiveTier) {
      case 'cheap': return { provider: 'openai', model: 'gpt-4o-mini', supportsCaching: true };
      case 'standard': return { provider: 'openai', model: 'gpt-4o', supportsCaching: true };
      case 'premium': return { provider: 'openai', model: 'o1', supportsCaching: false };
    }
  }

  /** Anthropic API çağrılarında `system` veya user message'a eklenecek cache_control bloğu. */
  getCacheControl(): { type: 'ephemeral' } {
    return { type: 'ephemeral' };
  }

  /** OpenAI prompt caching otomatik (>1024 token static prefix). Sadece manuel hint için. */
  isOpenAiCacheLikely(systemPromptLength: number): boolean {
    return systemPromptLength >= 1024;
  }
}

export type ModelTier = 'cheap' | 'standard' | 'premium';

export type ModelTask =
  | 'roadmap_suggest'        // Cheap — GEO roadmap üretimi
  | 'classify_sentiment'     // Cheap — yorum sentiment sınıflama
  | 'extract_keywords'       // Cheap — site'ten keyword çıkarımı
  | 'extract_competitors'    // Cheap — rakip listesi çıkarımı
  | 'summarize'              // Cheap — özet
  | 'json_repair'            // Cheap — bozuk JSON tamir
  | 'audit_brief'            // Cheap — audit özeti
  | 'social_post_draft'      // Standard — sosyal post
  | 'article_outline'        // Standard — makale outline
  | 'article_draft'          // Standard — makale draft
  | 'article_edit'           // Standard — editing pass
  | 'brain_generation'       // Premium — kapsamlı brain üretimi
  | 'deep_research'          // Premium — long-form research
  | 'asa_optimization';      // Premium — ASA strateji

const TIER_BY_TASK: Record<ModelTask, ModelTier> = {
  roadmap_suggest: 'cheap',
  classify_sentiment: 'cheap',
  extract_keywords: 'cheap',
  extract_competitors: 'cheap',
  summarize: 'cheap',
  json_repair: 'cheap',
  audit_brief: 'cheap',
  social_post_draft: 'standard',
  article_outline: 'standard',
  article_draft: 'standard',
  article_edit: 'standard',
  brain_generation: 'premium',
  deep_research: 'premium',
  asa_optimization: 'premium',
};
