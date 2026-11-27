import { describe, expect, it } from 'vitest';
import {
  anthropicKullanim, dataforseoKullanim, geminiKullanim, gercekMaliyetAnahtari, gercekMaliyetUsd, OLCUM_FIYATLARI,
  perplexityKullanim, responsesKullanim,
} from './olcum-gercek-maliyet.js';

describe('olcum gercek maliyeti', () => {
  it('Opus 5.5: 24K girdi + 800 cikti + 2 arama (11.11 canli olcumle ayni buyukluk)', () => {
    const k = anthropicKullanim({ usage: { input_tokens: 20_000, cache_read_input_tokens: 4_000, output_tokens: 800, server_tool_use: { web_search_requests: 2 } } });
    expect(k).toEqual({ girdi: 24_000, cikti: 800, arama: 2 });
    // 24K x 4/1M = 0.096 + 800 x 20/1M = 0.016 + 2 x 0.01 = 0.132
    expect(gercekMaliyetUsd('claude-opus-5-5', k)).toBeCloseTo(0.132, 6);
  });

  it('Haiku 5.5 ve Grok: esigi asan istem pahali karttan', () => {
    expect(gercekMaliyetUsd('claude-haiku-5-5', { girdi: 50_000, cikti: 1000, arama: 1 })).toBeCloseTo(0.005 + 0.0005 + 0.01, 6);
    expect(gercekMaliyetUsd('claude-haiku-5-5', { girdi: 150_000, cikti: 1000, arama: 0 })).toBeCloseTo(0.075 + 0.0025, 6);
    expect(gercekMaliyetUsd('grok-4.7', { girdi: 250_000, cikti: 2000, arama: 8 })).toBeCloseTo(1.0 + 0.024 + 0.04, 6);
  });

  it('Gemini: dusunme ciktiya, arama araci girdiye; arama sorgusu basina ucret', () => {
    const k = geminiKullanim({
      usageMetadata: { promptTokenCount: 300, toolUsePromptTokenCount: 4_000, candidatesTokenCount: 500, thoughtsTokenCount: 200 },
      candidates: [{ groundingMetadata: { webSearchQueries: ['a', 'b'] } }],
    });
    expect(k).toEqual({ girdi: 4_300, cikti: 700, arama: 2 });
    expect(gercekMaliyetUsd('gemini-3.5-flash-lite', k)).toBeCloseTo(4_300 * 0.3 / 1e6 + 700 * 2.5 / 1e6 + 0.028, 6);
  });

  it('Responses API (ChatGPT, Grok, Muse): arama = web_search_call ogeleri', () => {
    const k = responsesKullanim({ usage: { input_tokens: 12_700, output_tokens: 368 }, output: [{ type: 'web_search_call' }, { type: 'message' }] });
    expect(k).toEqual({ girdi: 12_700, cikti: 368, arama: 1 });
    // 11.11 canli deneme: gpt-6-astra 0.156 USD
    expect(gercekMaliyetUsd('gpt-6-astra', k)).toBeCloseTo(0.127 + 0.0184 + 0.01, 4);
  });

  it('saglayicinin bildirdigi tutar hesaptan once gelir (Perplexity, DataForSEO)', () => {
    expect(gercekMaliyetUsd('sonar', perplexityKullanim({ usage: { prompt_tokens: 100, completion_tokens: 300, cost: { total_cost: 0.0048 } } }))).toBe(0.0048);
    expect(gercekMaliyetUsd('sonar', perplexityKullanim({ usage: { prompt_tokens: 1000, completion_tokens: 1000 } }))).toBeCloseTo(0.002 + 0.005, 6);
    expect(gercekMaliyetUsd('google_ai_mode', dataforseoKullanim({ cost: 0.004 }))).toBe(0.004);
    expect(gercekMaliyetUsd('google_ai_overview', dataforseoKullanim({}))).toBe(0.004);
  });

  it('tabloda olmayan model null; bos kullanim 0 token', () => {
    expect(gercekMaliyetUsd('bilinmeyen-model', { girdi: 1, cikti: 1, arama: 0 })).toBeNull();
    expect(anthropicKullanim({})).toEqual({ girdi: 0, cikti: 0, arama: 0 });
    expect(responsesKullanim(null)).toEqual({ girdi: 0, cikti: 0, arama: 0 });
    expect(gercekMaliyetAnahtari('gemini', '2026-11-27')).toBe('ai-gercek:gemini:2026-11-27');
  });

  it('olcumde kullanilan varsayilan modellerin hepsi tabloda', async () => {
    for (const m of ['claude-opus-5-5', 'claude-haiku-5-5', 'gemini-3.5-flash-lite', 'gpt-6-astra', 'gpt-6-luna', 'sonar', 'grok-4.7', 'deepseek-v4-pro', 'muse-spark-1.3']) {
      expect(OLCUM_FIYATLARI[m], m).toBeDefined();
    }
  });
});
