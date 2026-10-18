import { describe, it, expect } from 'vitest';
import {
  withProbeRetry, isFatalProviderError, isTransientProviderError, ProviderConfigError,
  probeErrorCode, probeErrorExcerpt, redactSecrets, safeErrorText, sanitizeProbeExcerpt, safeReasonToken,
} from './probe-retry.js';

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

describe('probeErrorCode — musteriye giden kod', () => {
  const cases: Array<[string, unknown, string]> = [
    ['429 govdeli', new Error('HTTP 429: {"error":{"message":"Rate limit reached for org-AbC123 on requests per min","type":"requests"}}'), 'rate_limited'],
    ['Gemini 503 JSON', new Error('{"error":{"code":503,"message":"This model is currently experiencing high demand.","status":"UNAVAILABLE"}}'), 'upstream_unavailable'],
    ['Gemini kota', new Error('{"error":{"code":429,"message":"Quota exceeded","status":"RESOURCE_EXHAUSTED"}}'), 'rate_limited'],
    ['OpenAI 401 maskeli anahtar', new Error('HTTP 401: {"error":{"message":"Incorrect API key provided: sk-proj-****abcd."}}'), 'auth_failed'],
    ['Anthropic SDK 404 model', Object.assign(new Error('404 {"type":"error","error":{"type":"not_found_error","message":"model: claude-x"}}'), { status: 404 }), 'model_unavailable'],
    ['Groq kaldirilan model', new Error('HTTP 404: {"error":{"message":"The model `llama-3.3-70b-versatile` does not exist or you do not have access to it."}}'), 'model_unavailable'],
    ['zaman asimi', Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' }), 'timeout'],
    ['SDK zaman asimi', new Error('Request timed out.'), 'timeout'],
    ['ag', new Error('fetch failed'), 'network'],
    ['SDK baglanti', new Error('Connection error.'), 'network'],
    ['400', new Error('HTTP 400: {"error":{"message":"Invalid prompt: echo of the user prompt here"}}'), 'bad_request'],
    ['bilinmeyen', new Error('beklenmeyen bir sey'), 'unknown'],
  ];
  for (const [name, err, code] of cases) {
    it(name, () => expect(probeErrorCode(err)).toBe(code));
  }

  it('HATA: oneki korunur ve saglayici govdesi satira girmez', () => {
    const err = new Error('HTTP 429: {"error":{"message":"org-AbC123 req_9f8e quota 10000 tokens; prompt: en iyi emlak sitesi"}}');
    const line = probeErrorExcerpt(err);
    expect(line).toBe('HATA: rate_limited');
    expect(line).not.toMatch(/org-|req_|prompt|quota/);
  });

  it('kod uretimi yeniden deneme kurallarini degistirmez', () => {
    const fatal = new Error('HTTP 401: invalid api key');
    const transient = new Error('HTTP 503: busy');
    expect(isFatalProviderError(fatal)).toBe(true);
    expect(isTransientProviderError(transient)).toBe(true);
    expect(probeErrorCode(fatal)).toBe('auth_failed');
    expect(probeErrorCode(transient)).toBe('upstream_unavailable');
    // ProviderConfigError mesaji da ayni koda iner (runProvider reason'i)
    expect(probeErrorExcerpt(new ProviderConfigError(fatal.message))).toBe('HATA: auth_failed');
  });
});

describe('redactSecrets / safeErrorText — sunucu logu', () => {
  it('anahtar bicimlerini maskeler', () => {
    const raw = 'key sk-proj-abcDEF123456 and sk-ant-api03-XYZxyz0987 xai-abc12345 gsk_abcdef123456 pplx-12345678 AIzaSyA1234567890abcdef Bearer abc.def.ghi https://x?key=AIzaQQQ&a=1';
    const out = redactSecrets(raw);
    for (const leak of ['sk-proj-abc', 'sk-ant-api03', 'xai-abc', 'gsk_abc', 'pplx-123', 'AIzaSyA', 'abc.def.ghi', 'AIzaQQQ']) {
      expect(out).not.toContain(leak);
    }
    expect(out).toContain('[anahtar]');
  });

  it('tek satir ve kirpilmis', () => {
    const out = safeErrorText(new Error(`satir1\nsatir2 ${'x'.repeat(500)}`), 50);
    expect(out).not.toContain('\n');
    expect(out.length).toBeLessThanOrEqual(50);
  });
});

describe('sanitizeProbeExcerpt — eski kayitlar', () => {
  it('eski ham HATA metnini koda cevirir, guvenli satirlari ve normal metni aynen birakir', () => {
    expect(sanitizeProbeExcerpt('HATA: HTTP 429: {"error":"org-1"}')).toBe('HATA: rate_limited');
    expect(sanitizeProbeExcerpt('HATA: rate_limited')).toBe('HATA: rate_limited');
    expect(sanitizeProbeExcerpt('HATA: bos cevap (finishReason=MAX_TOKENS)')).toBe('HATA: bos cevap (finishReason=MAX_TOKENS)');
    expect(sanitizeProbeExcerpt('HATA: saglayici reddi (refusal)')).toBe('HATA: saglayici reddi (refusal)');
    expect(sanitizeProbeExcerpt('Kobipratik iyi bir platformdur')).toBe('Kobipratik iyi bir platformdur');
    expect(sanitizeProbeExcerpt(undefined)).toBeUndefined();
  });

  it('bos cevap satirina saglayici metni sizmaz', () => {
    expect(safeReasonToken('MAX_TOKENS')).toBe('MAX_TOKENS');
    expect(safeReasonToken('incomplete')).toBe('incomplete');
    expect(safeReasonToken('<b>prompt echo with spaces</b>')).toBe('bilinmiyor');
    expect(safeReasonToken(undefined)).toBe('bilinmiyor');
  });
});
