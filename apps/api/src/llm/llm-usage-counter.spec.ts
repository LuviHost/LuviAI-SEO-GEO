import { describe, it, expect, vi } from 'vitest';
import { Logger } from '@nestjs/common';
import { LLMProviderService } from './llm-provider.service.js';
import { AnthropicProvider, anthropicCostUsd, anthropicPricing, anthropicUsage } from './anthropic.provider.js';

/**
 * AI harcamasi → defter (TokenUsageRecord) + aylik butce sayaci (User.aiCostThisMonthUsd).
 *
 * NEDEN VAR (sahip karari 11.11.2026: butce olcum disindaki her AI harcamasini kapsar):
 * sayac yalniz chat() userId ile cagrilinca artiyordu; SDK'yi dogrudan cagiran panel sohbeti
 * ve ceviri sayaca hic yazmiyordu. recordDirectUsage onlara ayni defteri ve ayni sayaci
 * verir. Bu dosya: sayac dogru kullaniciya, dogru tutarla ve TEK kez artar.
 */

vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
vi.spyOn(Logger.prototype, 'debug').mockImplementation(() => undefined);

function build(opts: { ledgerFails?: boolean } = {}) {
  const ledger: any[] = [];
  const counter: Record<string, number> = {};
  const prisma: any = {
    tokenUsageRecord: {
      createMany: vi.fn(async ({ data }: any) => {
        if (opts.ledgerFails) throw new Error('defter yazilamadi');
        ledger.push(...data);
        return { count: data.length };
      }),
    },
    user: {
      update: vi.fn(async ({ where, data }: any) => {
        counter[where.id] = (counter[where.id] ?? 0) + data.aiCostThisMonthUsd.increment;
        return {};
      }),
    },
  };
  const settings = { getBoolean: vi.fn(async () => false) };
  const anthropic = new AnthropicProvider();
  const chat = vi.spyOn(anthropic, 'chat');
  const other = (name: string) => ({ name, supportsModel: () => false, getPricing: () => null, chat: vi.fn() });
  const svc = new LLMProviderService(prisma, settings as any, anthropic, other('openai') as any, other('gemini') as any);
  return { svc, prisma, ledger, counter, chat };
}

const USAGE = { inputTokens: 2_500, outputTokens: 1_000, cacheReadTokens: 6_000, cacheWriteTokens: 6_000 };
const flush = () => new Promise((r) => setTimeout(r, 0));

describe('fiyat tablosu tek kaynak (anthropic.provider)', () => {
  it('anthropicCostUsd: girdi + cikti + cache okuma + cache yazma, her biri kendi oraniyla', () => {
    const f = anthropicPricing('claude-sonnet-5')!;
    const beklenen = (2_500 / 1e6) * f.input + (1_000 / 1e6) * f.output + (6_000 / 1e6) * f.cacheRead! + (6_000 / 1e6) * f.cacheWrite!;
    expect(anthropicCostUsd('claude-sonnet-5', USAGE)).toBeCloseTo(beklenen, 12);
    expect(anthropicCostUsd('bilinmeyen-model', USAGE)).toBe(0);
  });

  it('anthropicUsage: Messages API alan adlari; eksik / bozuk alan 0', () => {
    expect(anthropicUsage({ input_tokens: 10, output_tokens: 20, cache_read_input_tokens: 30, cache_creation_input_tokens: 40 }))
      .toEqual({ inputTokens: 10, outputTokens: 20, cacheReadTokens: 30, cacheWriteTokens: 40 });
    expect(anthropicUsage({ input_tokens: 10 })).toEqual({ inputTokens: 10, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 });
    expect(anthropicUsage(undefined)).toEqual({ inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 });
  });

  it('saglayici sinifi ayni tabloyu okur (onek eslesmesi dahil)', () => {
    const p = new AnthropicProvider();
    expect(p.getPricing('claude-sonnet-5')).toBe(anthropicPricing('claude-sonnet-5'));
    expect(p.getPricing('claude-opus-5-5-20260901')).toBe(anthropicPricing('claude-opus-5-5'));
    expect(p.getPricing('gpt-x')).toBeNull();
  });
});

describe('recordDirectUsage — dogrudan SDK cagiran servisler (panel sohbeti, ceviri)', () => {
  it('deftere dort satir (prompt, completion, cache_read, cache_write) ve sahibin sayacina toplam maliyet', async () => {
    const { svc, ledger, counter } = build();
    await svc.recordDirectUsage({ context: 'chat', siteId: 's1', userId: 'sahip-1', conversationId: 'c1', provider: 'anthropic', model: 'claude-sonnet-5', usage: USAGE });
    expect(ledger.map((r) => r.tokenType)).toEqual(['prompt', 'completion', 'cache_read', 'cache_write']);
    for (const r of ledger) expect(r).toMatchObject({ siteId: 's1', userId: 'sahip-1', context: 'chat', conversationId: 'c1', provider: 'anthropic', model: 'claude-sonnet-5' });
    const toplam = ledger.reduce((s, r) => s + r.costUsd, 0);
    expect(toplam).toBeCloseTo(anthropicCostUsd('claude-sonnet-5', USAGE), 12);
    expect(counter['sahip-1']).toBeCloseTo(toplam, 12);
  });

  it('userId yoksa deftere yazar, sayaca DOKUNMAZ', async () => {
    const { svc, ledger, prisma } = build();
    await svc.recordDirectUsage({ context: 'chat', provider: 'anthropic', model: 'claude-sonnet-5', usage: USAGE });
    expect(ledger).toHaveLength(4);
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('kullanim sifirsa hicbir sey yazmaz', async () => {
    const { svc, prisma } = build();
    await svc.recordDirectUsage({ context: 'chat', userId: 'sahip-1', provider: 'anthropic', model: 'claude-sonnet-5', usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 } });
    expect(prisma.tokenUsageRecord.createMany).not.toHaveBeenCalled();
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('fiyati bilinmeyen model: yazmaz ve loglar (uydurma fiyat yok)', async () => {
    const { svc, prisma } = build();
    await svc.recordDirectUsage({ context: 'chat', userId: 'sahip-1', provider: 'anthropic', model: 'bilinmeyen-model', usage: USAGE });
    expect(prisma.tokenUsageRecord.createMany).not.toHaveBeenCalled();
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('defter yazilamasa da butce sayaci artar (kapi yalniz sayaca bakar); hata cagirana bildirilir', async () => {
    const { svc, counter } = build({ ledgerFails: true });
    await expect(svc.recordDirectUsage({ context: 'chat', userId: 'sahip-1', provider: 'anthropic', model: 'claude-sonnet-5', usage: USAGE }))
      .rejects.toThrow('defter yazilamadi');
    expect(counter['sahip-1']).toBeCloseTo(anthropicCostUsd('claude-sonnet-5', USAGE), 12);
  });
});

describe('chat() — userId ile gelen cagri sayaca TEK kez yazilir', () => {
  const response = { output: 'ok', model: 'claude-sonnet-5', provider: 'anthropic' as const, usage: USAGE, costUsd: anthropicCostUsd('claude-sonnet-5', USAGE) };

  it('userId verilince sahibin sayaci cagrinin maliyeti kadar artar (cift sayim yok)', async () => {
    const { svc, counter, chat, prisma } = build();
    chat.mockResolvedValue(response);
    await svc.chat({ context: 'agent-03-writer', siteId: 's1', userId: 'sahip-1', model: 'claude-sonnet-5', messages: [{ role: 'user', content: 'x' }] });
    await flush();
    expect(prisma.user.update).toHaveBeenCalledTimes(1);
    expect(counter['sahip-1']).toBeCloseTo(response.costUsd, 12);
  });

  it('userId verilmezse sayac artmaz (eski makale ajani cagrisi boyleydi: butce onu gormuyordu)', async () => {
    const { svc, chat, prisma, ledger } = build();
    chat.mockResolvedValue(response);
    await svc.chat({ context: 'agent-03-writer', model: 'claude-sonnet-5', messages: [{ role: 'user', content: 'x' }] });
    await flush();
    expect(ledger).toHaveLength(4);
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  // 11.11.2026 (bagimsiz inceleme): fiyat tablosunda olmayan model sessizce atlaniyordu; env ile
  // tabloda olmayan bir yazar modeli secilirse butce o model icin kor kalir ve kimse fark etmez.
  it('fiyati bilinmeyen model: sayaca yazilamaz ama SESSIZ KALMAZ — model basina bir kez uyari', async () => {
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    warn.mockClear();
    const { svc, chat, prisma, ledger } = build();
    vi.spyOn(AnthropicProvider.prototype, 'supportsModel').mockReturnValue(true);
    chat.mockResolvedValue({ ...response, model: 'claude-yeni-model-9' });
    for (let i = 0; i < 3; i++) {
      await svc.chat({ context: 'agent-03-writer', siteId: 's1', userId: 'sahip-1', model: 'claude-yeni-model-9', messages: [{ role: 'user', content: 'x' }] });
    }
    await flush();
    expect(ledger).toHaveLength(0);
    expect(prisma.user.update).not.toHaveBeenCalled();
    const uyarilar = warn.mock.calls.map((c) => String(c[0])).filter((m) => m.includes('Fiyatı bilinmeyen model "claude-yeni-model-9"'));
    expect(uyarilar).toHaveLength(1);
    expect(uyarilar[0]).toContain('aylık AI bütçesine yazılmadı');
    vi.restoreAllMocks();
    vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    vi.spyOn(Logger.prototype, 'debug').mockImplementation(() => undefined);
  });
});
