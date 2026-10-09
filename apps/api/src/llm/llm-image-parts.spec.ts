import { describe, it, expect, vi, beforeAll } from 'vitest';
import { AnthropicProvider } from './anthropic.provider.js';
import { LLMProviderService } from './llm-provider.service.js';

/**
 * Vision: gorsel bloklarinin Anthropic istek bicimi + desteklemeyen saglayicida
 * acik hata. Gercek API cagrisi YOK — istemci sahte.
 */
beforeAll(() => { process.env.ANTHROPIC_API_KEY ??= 'test-key'; });

function fakeClient() {
  const reply = { content: [{ type: 'text', text: 'Kırmızı bisiklet' }], usage: { input_tokens: 10, output_tokens: 5 }, stop_reason: 'end_turn' };
  return {
    messages: { create: vi.fn(async () => reply) },
    beta: { messages: { create: vi.fn(async () => reply) } },
  };
}

describe('AnthropicProvider — gorsel bloklari', () => {
  it('gorsel once, metin sonra; base64 kaynak; Opus 5.5 te beta ret yedegi', async () => {
    const p = new AnthropicProvider();
    const client = fakeClient();
    (p as any).client = client;
    const res = await p.chat({
      context: 't', model: 'claude-opus-5-5', maxTokens: 4000,
      messages: [{ role: 'user', content: 'Alt metni yaz', images: [{ mediaType: 'image/jpeg', base64: 'QUJD' }] }],
    });
    expect(client.messages.create).not.toHaveBeenCalled();
    const body: any = (client.beta.messages.create.mock.calls[0] as any)[0];
    expect(body.messages[0].content).toEqual([
      { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: 'QUJD' } },
      { type: 'text', text: 'Alt metni yaz' },
    ]);
    expect(body.betas).toEqual(['server-side-fallback-2026-07-01']);
    expect(body.fallbacks).toBe('default');
    expect(body.temperature).toBeUndefined();
    expect(res.output).toBe('Kırmızı bisiklet');
    expect(res.stopReason).toBe('end_turn');
    // Opus 5.5 fiyati (4/20) — onek eslesmesiyle Opus 5'e (5/25) dusmuyor
    expect(res.costUsd).toBeCloseTo((10 / 1e6) * 4 + (5 / 1e6) * 20, 10);
  });

  it('beta (ret yedegi) 400 ile reddedilirse ayni istek duz uca bir kez gider', async () => {
    const p = new AnthropicProvider();
    const client = fakeClient();
    client.beta.messages.create = vi.fn(async () => { throw Object.assign(new Error('fallbacks: unsupported beta'), { status: 400 }); }) as any;
    (p as any).client = client;
    const res = await p.chat({
      context: 't', model: 'claude-opus-5-5',
      messages: [{ role: 'user', content: 'x', images: [{ mediaType: 'image/png', base64: 'QQ==' }] }],
    });
    expect(client.messages.create).toHaveBeenCalledOnce();
    expect((client.messages.create.mock.calls[0] as any)[0].fallbacks).toBeUndefined();
    expect(res.output).toBe('Kırmızı bisiklet');
  });

  it('baska 400 hatalari yutulmaz', async () => {
    const p = new AnthropicProvider();
    const client = fakeClient();
    client.beta.messages.create = vi.fn(async () => { throw Object.assign(new Error('image too large'), { status: 400 }); }) as any;
    (p as any).client = client;
    await expect(p.chat({
      context: 't', model: 'claude-opus-5-5',
      messages: [{ role: 'user', content: 'x', images: [{ mediaType: 'image/png', base64: 'QQ==' }] }],
    })).rejects.toThrow(/image too large/);
    expect(client.messages.create).not.toHaveBeenCalled();
  });

  it('gorselsiz cagri degismez: duz uc, metin icerik, ret yedegi yok', async () => {
    const p = new AnthropicProvider();
    const client = fakeClient();
    (p as any).client = client;
    await p.chat({ context: 't', model: 'claude-opus-5', messages: [{ role: 'user', content: 'merhaba' }] });
    expect(client.beta.messages.create).not.toHaveBeenCalled();
    const body: any = (client.messages.create.mock.calls[0] as any)[0];
    expect(body.messages[0].content).toBe('merhaba');
    expect(body.fallbacks).toBeUndefined();
  });
});

describe('LLMProviderService — gorsel desteklemeyen saglayici', () => {
  it('OpenAI modeline gorsel gonderilirse acik hata (sessizce yok sayilmaz)', async () => {
    const settings = { getBoolean: vi.fn(async () => false) };
    const openai = { name: 'openai', supportsModel: (m: string) => m.startsWith('gpt'), getPricing: () => null, chat: vi.fn() };
    const anthropic = { name: 'anthropic', supportsImages: true, supportsModel: (m: string) => m.startsWith('claude'), getPricing: () => null, chat: vi.fn() };
    const gemini = { name: 'gemini', supportsModel: () => false, getPricing: () => null, chat: vi.fn() };
    const svc = new LLMProviderService({} as any, settings as any, anthropic as any, openai as any, gemini as any);
    await expect(svc.chat({
      context: 't', model: 'gpt-5', messages: [{ role: 'user', content: 'x', images: [{ mediaType: 'image/png', base64: 'QQ==' }] }],
    })).rejects.toThrow(/gorsel girdi desteklemiyor/);
    expect(openai.chat).not.toHaveBeenCalled();
  });
});
