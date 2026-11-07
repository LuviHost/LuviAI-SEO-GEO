import { describe, it, expect } from 'vitest';
import {
  KNOWN_AI_BOTS, KNOWN_AI_BOT_NAMES, STANCE_SCORED_BOTS, USER_TRIGGERED_BOTS, ROBOTS_MERGE_BOTS,
} from './known-ai-bots.js';

/**
 * Bot listesi butunlugu — AXO taramasi ile auto-fix robots.txt'i ayni listeyi
 * kullanmali; yazim hatasi/bayat isim regresyonu burada yakalanir.
 */
describe('KNOWN_AI_BOTS', () => {
  it('27 bot, isimler benzersiz', () => {
    expect(KNOWN_AI_BOTS.length).toBe(27);
    expect(new Set(KNOWN_AI_BOT_NAMES).size).toBe(27);
  });

  it('bayat / yanlis yazilmis isimler listede yok', () => {
    // generators.service.ts eskiden bunlari yaziyordu; tarayici hic tanimiyordu
    expect(KNOWN_AI_BOT_NAMES).not.toContain('Mistral-AI-User');
    expect(KNOWN_AI_BOT_NAMES).not.toContain('Claude-Web');
    expect(KNOWN_AI_BOT_NAMES).toContain('MistralAI-User');
  });

  it('her botun gecerli kategorisi ve aciklamasi var', () => {
    for (const b of KNOWN_AI_BOTS) {
      expect(['training', 'search', 'user-triggered']).toContain(b.category);
      expect(b.description.length).toBeGreaterThan(3);
    }
  });

  it('user-triggered fetcher\'lar stance skorundan HARIC', () => {
    const scored = new Set(STANCE_SCORED_BOTS.map((b) => b.name));
    for (const name of ['ChatGPT-User', 'Perplexity-User', 'Claude-User', 'MistralAI-User']) {
      expect(scored.has(name)).toBe(false);
    }
    expect(STANCE_SCORED_BOTS.length + USER_TRIGGERED_BOTS.length).toBe(KNOWN_AI_BOTS.length);
    expect(USER_TRIGGERED_BOTS.length).toBe(6);
  });

  it('auto-fix robots.txt listesi yalniz resmi belgeli botlar; DeepSeek / xAI (Grok) yok', () => {
    const merge = ROBOTS_MERGE_BOTS.map((b) => b.name);
    expect(merge.join(' ')).not.toMatch(/deepseek|grok|xai/i);
    for (const ad of ['anthropic-ai', 'cohere-ai', 'cohere-training-data-crawler', 'Bytespider', 'Timpibot', 'Omgilibot']) {
      expect(merge, ad).not.toContain(ad);
      // Gozlem / durus olcumu icin tam listede kalir
      expect(KNOWN_AI_BOT_NAMES, ad).toContain(ad);
    }
    for (const b of KNOWN_AI_BOTS) expect(typeof b.documented, b.name).toBe('boolean');
  });
});
