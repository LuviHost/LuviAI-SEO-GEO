import { describe, it, expect, vi, beforeAll } from 'vitest';
import { AnthropicProvider } from './anthropic.provider.js';
import { LLMProviderService } from './llm-provider.service.js';

/**
 * Yapisal cikti (output_config.format) ve Claude Haiku 5.5 — RanksUp Video metni bunu kullanir.
 * Gercek API cagrisi YOK — istemci sahte.
 */
beforeAll(() => { process.env.ANTHROPIC_API_KEY ??= 'test-key'; });

const schema = { type: 'object', additionalProperties: false, required: ['hook'], properties: { hook: { type: 'string' } } };

function fakeClient() {
  const reply = { content: [{ type: 'text', text: '{"hook":"x"}' }], usage: { input_tokens: 3000, output_tokens: 400 }, stop_reason: 'end_turn' };
  return { messages: { create: vi.fn(async () => reply) }, beta: { messages: { create: vi.fn(async () => reply) } } };
}

describe('AnthropicProvider — Haiku 5.5 + yapisal cikti', () => {
  it('format ve effort ayni output_config nesnesinde; temperature gonderilmez; fiyat 0.10/0.50', async () => {
    const p = new AnthropicProvider();
    const client = fakeClient();
    (p as any).client = client;
    const res = await p.chat({ context: 't', model: 'claude-haiku-5-5', effort: 'low', temperature: 0.3, outputSchema: schema, messages: [{ role: 'user', content: 'm' }] });
    const body: any = (client.messages.create.mock.calls[0] as any)[0];
    expect(body.output_config).toEqual({ effort: 'low', format: { type: 'json_schema', schema } });
    expect(body.temperature).toBeUndefined();
    expect(res.costUsd).toBeCloseTo((3000 / 1e6) * 0.1 + (400 / 1e6) * 0.5, 10);
  });

  it('Haiku 4.5: effort gonderilmez (400 olurdu) ama format gider', async () => {
    const p = new AnthropicProvider();
    const client = fakeClient();
    (p as any).client = client;
    await p.chat({ context: 't', model: 'claude-haiku-4-5', effort: 'low', outputSchema: schema, messages: [{ role: 'user', content: 'm' }] });
    expect((client.messages.create.mock.calls[0] as any)[0].output_config).toEqual({ format: { type: 'json_schema', schema } });
  });

  it('sema ve effort yoksa output_config hic yok (eski cagrilar degismez)', async () => {
    const p = new AnthropicProvider();
    const client = fakeClient();
    (p as any).client = client;
    await p.chat({ context: 't', model: 'claude-haiku-4-5', messages: [{ role: 'user', content: 'm' }] });
    expect((client.messages.create.mock.calls[0] as any)[0].output_config).toBeUndefined();
  });
});

describe('LLMProviderService — yapisal cikti yalniz Anthropic', () => {
  const make = () => {
    const settings = { getBoolean: vi.fn(async () => false) };
    const openai = { name: 'openai', supportsModel: (m: string) => m.startsWith('gpt'), getPricing: () => null, chat: vi.fn() };
    const anthropic = { name: 'anthropic', supportsModel: (m: string) => m.startsWith('claude'), getPricing: () => null, chat: vi.fn(async (r: any) => ({ output: '{}', model: r.model, provider: 'anthropic', usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 }, costUsd: 0 })) };
    const gemini = { name: 'gemini', supportsModel: () => false, getPricing: () => null, chat: vi.fn() };
    return { svc: new LLMProviderService({} as any, settings as any, anthropic as any, openai as any, gemini as any), openai, anthropic };
  };

  it('OpenAI modeline sema verilirse acik hata (serbest metin sessizce donmez)', async () => {
    const { svc, openai } = make();
    await expect(svc.chat({ context: 't', model: 'gpt-5', outputSchema: schema, messages: [{ role: 'user', content: 'x' }] })).rejects.toThrow(/yapisal cikti/);
    expect(openai.chat).not.toHaveBeenCalled();
  });

  it('Haiku 5.5 thinking-varsayilan: max_tokens tabani 4000 (cevap thinking yuzunden bos kalmasin)', async () => {
    const { svc, anthropic } = make();
    await svc.chat({ context: 't', model: 'claude-haiku-5-5', maxTokens: 2048, outputSchema: schema, messages: [{ role: 'user', content: 'x' }] });
    expect((anthropic.chat.mock.calls[0] as any)[0].maxTokens).toBe(4000);
  });
});
