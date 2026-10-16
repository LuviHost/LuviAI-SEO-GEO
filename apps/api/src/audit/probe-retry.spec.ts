import { describe, it, expect } from 'vitest';
import { withProbeRetry, isFatalProviderError, isTransientProviderError, ProviderConfigError } from './probe-retry.js';

const noWait = { sleep: async () => {}, delayMs: () => 0 };

describe('probe-retry siniflandirma', () => {
  it('kayitlarda gorulen gecici hatalari yakalar', () => {
    for (const msg of [
      'fetch failed',
      'Request timed out.',
      'Connection error.',
      'HTTP 503: {"error":{"message":"Service is too busy. We advise users to temporarily switch"}}',
      '{"error":{"code":503,"message":"This model is currently experiencing high demand.","status":"UNAVAILABLE"}}',
      'HTTP 429: rate limit',
    ]) expect(isTransientProviderError(new Error(msg)), msg).toBe(true);
  });

  it('kaldirilan model kalici sayilir, yeniden denenmez', () => {
    const groq = 'HTTP 404: {"error":{"message":"The model `llama-3.3-70b-versatile` does not exist or you do not have access to it."}}';
    const deepseek = 'HTTP 400: {"error":{"message":"The supported API model names are deepseek-v4-pro or deepseek-v4-flash, but you passed deepseek-chat."}}';
    expect(isFatalProviderError(new Error(groq))).toBe(true);
    expect(isFatalProviderError(new Error(deepseek))).toBe(true);
    expect(isTransientProviderError(new Error(groq))).toBe(false);
  });

  it('bos cevap gecici degildir', () => {
    expect(isTransientProviderError(new Error('bos cevap (stop_reason=max_tokens)'))).toBe(false);
  });
});

describe('withProbeRetry', () => {
  it('gecici hatadan sonra basarili denemeyi dondurur', async () => {
    let calls = 0;
    const out = await withProbeRetry(async () => {
      calls++;
      if (calls < 3) throw new Error('fetch failed');
      return 'ok';
    }, noWait);
    expect(out).toBe('ok');
    expect(calls).toBe(3);
  });

  it('deneme hakki bitince son hatayi firlatir', async () => {
    let calls = 0;
    await expect(withProbeRetry(async () => { calls++; throw new Error('HTTP 503: busy'); }, noWait))
      .rejects.toThrow('HTTP 503');
    expect(calls).toBe(3);
  });

  it('gecici olmayan hatayi tek denemede firlatir', async () => {
    let calls = 0;
    await expect(withProbeRetry(async () => { calls++; throw new Error('HTTP 400: bad request'); }, noWait))
      .rejects.toThrow('HTTP 400');
    expect(calls).toBe(1);
  });

  it('kalici hatayi ProviderConfigError olarak firlatir', async () => {
    await expect(withProbeRetry(async () => { throw new Error('HTTP 404: model `x` does not exist'); }, noWait))
      .rejects.toBeInstanceOf(ProviderConfigError);
  });
});
