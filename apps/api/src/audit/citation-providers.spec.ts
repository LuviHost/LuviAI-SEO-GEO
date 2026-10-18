import { describe, it, expect } from 'vitest';
import { COST_PER_PROBE_USD, POOL_ENV_KEY, isUnconfiguredProvider, llamaModelConfigured } from './citation-providers.js';

/**
 * Saglayici kurallari tek yerde: runPublicProbes (olcum oncesi), App Prompt Lab
 * (olcum sonrasi) ve karne CLI'i ayni fonksiyonu kullanir. Llama'nin varsayilan
 * modeli Groq'tan kaldirildi; GROQ_LLAMA_MODEL tanimsizken anahtar olsa da
 * Llama yapilandirilmamis sayilir.
 */
describe('isUnconfiguredProvider — olcum oncesi (saglayici adi)', () => {
  it('anahtar yoksa yapilandirilmamis; anahtar varsa yapilandirilmis', () => {
    expect(isUnconfiguredProvider('openai', {})).toBe(true);
    expect(isUnconfiguredProvider('openai', { OPENAI_API_KEY: '' })).toBe(true);
    expect(isUnconfiguredProvider('openai', { OPENAI_API_KEY: 'sk-x' })).toBe(false);
  });

  it('GROQ_API_KEY olsa da GROQ_LLAMA_MODEL tanimsiz (ya da bos) Llama yapilandirilmamis', () => {
    expect(isUnconfiguredProvider('meta', { GROQ_API_KEY: 'gsk-x' })).toBe(true);
    expect(isUnconfiguredProvider('meta', { GROQ_API_KEY: 'gsk-x', GROQ_LLAMA_MODEL: '   ' })).toBe(true);
    expect(isUnconfiguredProvider('meta', { GROQ_API_KEY: 'gsk-x', GROQ_LLAMA_MODEL: 'yeni-llama' })).toBe(false);
    // Model var ama anahtar yok
    expect(isUnconfiguredProvider('meta', { GROQ_LLAMA_MODEL: 'yeni-llama' })).toBe(true);
  });

  it('bilinmeyen saglayici adi yapilandirilmamis sayilir', () => {
    expect(isUnconfiguredProvider('mistral', { OPENAI_API_KEY: 'sk-x' })).toBe(true);
  });
});

describe('isUnconfiguredProvider — olcum sonrasi (sonuc satiri)', () => {
  it("'NO_KEY' ve model tanimsiz Llama listeden duser; HATA veren yapilandirilmis saglayici kalir", () => {
    expect(isUnconfiguredProvider({ provider: 'perplexity', available: false, reason: 'NO_KEY' }, {})).toBe(true);
    expect(isUnconfiguredProvider({ provider: 'meta', available: false, reason: 'HATA: model_unavailable' }, {})).toBe(true);
    // Cagrilmis (HATA) saglayici: anahtari vardi — ortam bugun anahtarsiz gorunse de listede kalir
    expect(isUnconfiguredProvider({ provider: 'openai', available: false, reason: 'HATA: timeout' }, {})).toBe(false);
    expect(isUnconfiguredProvider({ provider: 'meta', available: false, reason: 'HATA: rate_limited' }, { GROQ_LLAMA_MODEL: 'x' })).toBe(false);
    expect(isUnconfiguredProvider({ provider: 'meta', available: true }, {})).toBe(false);
  });
});

describe('tablolar', () => {
  it('her saglayicinin anahtar adi ve sifirdan buyuk maliyet tavani var', () => {
    for (const p of Object.keys(POOL_ENV_KEY)) {
      expect(COST_PER_PROBE_USD[p as keyof typeof COST_PER_PROBE_USD], p).toBeGreaterThan(0);
    }
    expect(POOL_ENV_KEY.meta).toBe('GROQ_API_KEY');
  });

  it('llamaModelConfigured bosluklu degeri tanimsiz sayar', () => {
    expect(llamaModelConfigured({})).toBe(false);
    expect(llamaModelConfigured({ GROQ_LLAMA_MODEL: ' ' })).toBe(false);
    expect(llamaModelConfigured({ GROQ_LLAMA_MODEL: 'llama-4' })).toBe(true);
  });
});
