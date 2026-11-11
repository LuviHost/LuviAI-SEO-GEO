import { describe, it, expect } from 'vitest';
import { COST_PER_PROBE_USD, POOL_ENV_KEY, isUnconfiguredProvider } from './citation-providers.js';

/**
 * Saglayici kurallari tek yerde: runPublicProbes (olcum oncesi), App Prompt Lab
 * (olcum sonrasi) ve karne CLI'i ayni fonksiyonu kullanir. Meta AI Kasim
 * 2026'dan beri Muse (Meta Model API); Llama/Groq'taki ek model kosulu yok —
 * tek kosul havuz anahtari.
 */
describe('isUnconfiguredProvider — olcum oncesi (saglayici adi)', () => {
  it('anahtar yoksa yapilandirilmamis; anahtar varsa yapilandirilmis', () => {
    expect(isUnconfiguredProvider('openai', {})).toBe(true);
    expect(isUnconfiguredProvider('openai', { OPENAI_API_KEY: '' })).toBe(true);
    expect(isUnconfiguredProvider('openai', { OPENAI_API_KEY: 'sk-x' })).toBe(false);
  });

  it('Meta yalniz META_MODEL_API_KEY ile yapilandirilmis; eski Groq degiskenleri ise yaramaz', () => {
    expect(isUnconfiguredProvider('meta', {})).toBe(true);
    expect(isUnconfiguredProvider('meta', { GROQ_API_KEY: 'gsk-x', GROQ_LLAMA_MODEL: 'yeni-llama' })).toBe(true);
    // Reklam entegrasyonunun META_APP_* degiskenleri olcum anahtari degildir
    expect(isUnconfiguredProvider('meta', { META_APP_ID: '1', META_APP_SECRET: 's' })).toBe(true);
    expect(isUnconfiguredProvider('meta', { META_MODEL_API_KEY: 'mm-x' })).toBe(false);
  });

  it('bilinmeyen saglayici adi yapilandirilmamis sayilir', () => {
    expect(isUnconfiguredProvider('mistral', { OPENAI_API_KEY: 'sk-x' })).toBe(true);
  });
});

describe('isUnconfiguredProvider — olcum sonrasi (sonuc satiri)', () => {
  it("'NO_KEY' listeden duser; HATA veren (cagrilmis) saglayici kalir", () => {
    expect(isUnconfiguredProvider({ provider: 'perplexity', available: false, reason: 'NO_KEY' }, {})).toBe(true);
    expect(isUnconfiguredProvider({ provider: 'meta', available: false, reason: 'NO_KEY' }, {})).toBe(true);
    // Cagrilmis (HATA) saglayici: anahtari vardi — ortam bugun anahtarsiz gorunse de listede kalir
    expect(isUnconfiguredProvider({ provider: 'openai', available: false, reason: 'HATA: timeout' }, {})).toBe(false);
    expect(isUnconfiguredProvider({ provider: 'meta', available: false, reason: 'HATA: rate_limited' }, {})).toBe(false);
    expect(isUnconfiguredProvider({ provider: 'meta', available: true }, {})).toBe(false);
  });
});

describe('tablolar', () => {
  it('her saglayicinin anahtar adi ve sifirdan buyuk maliyet tavani var', () => {
    for (const p of Object.keys(POOL_ENV_KEY)) {
      expect(COST_PER_PROBE_USD[p as keyof typeof COST_PER_PROBE_USD], p).toBeGreaterThan(0);
    }
    expect(POOL_ENV_KEY.meta).toBe('META_MODEL_API_KEY');
  });

  it('Meta Muse tavani web aramali fiyattan dusuk degil (muse-spark-1.3, 3000 cikti tokeni)', () => {
    // 25K girdi x $1.25/1M + 3000 cikti x $4.25/1M + 4 arama x $0.0025
    const alt = 25_000 * 1.25e-6 + 3000 * 4.25e-6 + 4 * 0.0025;
    expect(COST_PER_PROBE_USD.meta).toBeGreaterThanOrEqual(alt);
  });
});
