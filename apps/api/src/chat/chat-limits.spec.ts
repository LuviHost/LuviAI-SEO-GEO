import { describe, it, expect, vi } from 'vitest';
import { ForbiddenException, Logger } from '@nestjs/common';
import { ChatService } from './chat.service.js';
import { AI_BUDGET_EXHAUSTED_CODE, CHAT_MESSAGE_LIMIT_CODE, QuotaService } from '../billing/quota.service.js';
import { anthropicPricing } from '../llm/anthropic.provider.js';
import { readFileSync } from 'node:fs';

/**
 * Panel sohbeti: mesaj hakki + aylik AI butcesi + gercek maliyet (sahip karari 11.11.2026).
 *
 * NEDEN VAR: sohbette sinir yoktu (mesaj basina 7 tura kadar Sonnet cagrisi), harcama sabit
 * 3/15 fiyatla ve cache token'lari sayilmadan yalniz deftere yaziliyor, butce sayacina hic
 * islemiyordu. Bu dosya ChatService'i GERCEK QuotaService ile (bellek ici veritabani)
 * calistirir: kapilar ilk model cagrisindan once, model cagrilmadan basarisiz olan mesaj
 * sayilmaz, harcama site sahibinin sayacina yazilir.
 */

vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);

const OWNER = 'sahip-1';
const now = new Date();
const monthKey = (userId: string) => `sohbet-mesaj:${userId}:${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

type Usage = { input_tokens: number; output_tokens: number; cache_read_input_tokens?: number; cache_creation_input_tokens?: number };
const textReply = (text: string, usage: Usage) => ({ content: [{ type: 'text', text }], usage });
const toolReply = (usage: Usage) => ({ content: [{ type: 'tool_use', id: 'tu1', name: 'get_ai_kpis', input: {} }], usage });

function build(opts: {
  /** Site sahibinin (butce) satiri */
  owner?: Record<string, unknown>;
  /** kv_store baslangici */
  kv?: Record<string, string>;
  /** Model yanitlari sirayla; Error ise o cagri hata verir */
  replies?: Array<ReturnType<typeof textReply> | ReturnType<typeof toolReply> | Error>;
} = {}) {
  const users: Record<string, any> = {
    [OWNER]: { id: OWNER, plan: 'PRO', role: 'USER', aiCostThisMonthUsd: 0, articlesQuotaResetAt: new Date(), ...opts.owner },
  };
  const kv = new Map<string, string>(Object.entries(opts.kv ?? {}));
  const conversations = new Map<string, any>();
  const messages: any[] = [];
  let seq = 0;
  const prisma: any = {
    site: { findUniqueOrThrow: vi.fn(async () => ({ id: 's1', name: 'Site', url: 'https://ornek.com', niche: null, userId: OWNER })) },
    user: {
      findUniqueOrThrow: vi.fn(async ({ where }: any) => {
        const u = users[where.id];
        if (!u) throw new Error('No User found');
        return { ...u };
      }),
      update: vi.fn(async ({ where, data }: any) => { Object.assign(users[where.id], data); return users[where.id]; }),
    },
    kvStore: {
      findUnique: vi.fn(async ({ where }: any) => (kv.has(where.key) ? { value: kv.get(where.key) } : null)),
      create: vi.fn(async ({ data }: any) => {
        if (kv.has(data.key)) throw Object.assign(new Error('Unique constraint failed'), { code: 'P2002' });
        kv.set(data.key, data.value);
        return data;
      }),
      updateMany: vi.fn(async ({ where, data }: any) => {
        if (kv.get(where.key) !== where.value) return { count: 0 };
        kv.set(where.key, data.value);
        return { count: 1 };
      }),
    },
    chatConversation: {
      findFirst: vi.fn(async ({ where }: any) => {
        const c = conversations.get(where.id);
        return c && c.siteId === where.siteId && c.userId === where.userId ? c : null;
      }),
      create: vi.fn(async ({ data }: any) => { const c = { id: `c${++seq}`, ...data }; conversations.set(c.id, c); return c; }),
      update: vi.fn(async () => ({})),
      delete: vi.fn(async ({ where }: any) => {
        conversations.delete(where.id);
        for (let i = messages.length - 1; i >= 0; i--) if (messages[i].conversationId === where.id) messages.splice(i, 1);
        return {};
      }),
    },
    chatMessage: {
      findMany: vi.fn(async ({ where }: any) => messages.filter((m) => m.conversationId === where.conversationId).reverse()),
      create: vi.fn(async ({ data }: any) => { const m = { id: `m${++seq}`, createdAt: new Date(), ...data }; messages.push(m); return m; }),
      delete: vi.fn(async ({ where }: any) => {
        const i = messages.findIndex((m) => m.id === where.id);
        if (i >= 0) messages.splice(i, 1);
        return {};
      }),
    },
  };
  const quota = new QuotaService(prisma);
  const settings = { getBoolean: vi.fn(async () => false) };
  const tools = {
    listForUser: vi.fn(() => []),
    listForAnthropic: vi.fn(() => []),
    call: vi.fn(async () => ({ ok: true })),
  };
  const llm = { recordDirectUsage: vi.fn(async (_args: any) => undefined) };
  const svc = new ChatService(prisma, settings as any, tools as any, quota, llm as any);
  const replies = [...(opts.replies ?? [textReply('Cevap', { input_tokens: 1_000, output_tokens: 500 })])];
  const create = vi.fn(async (_body: any) => {
    const next = replies.length > 1 ? replies.shift()! : replies[0];
    if (next instanceof Error) throw next;
    return next;
  });
  (svc as any).anthropic = { messages: { create } };
  return { svc, prisma, quota, llm, create, kv, conversations, messages, users };
}

const user = (over: Record<string, unknown> = {}) => ({ id: OWNER, role: 'USER', plan: 'PRO', ...over });

async function forbidden(run: () => Promise<unknown>): Promise<ForbiddenException> {
  try {
    await run();
  } catch (err) {
    expect(err).toBeInstanceOf(ForbiddenException);
    return err as ForbiddenException;
  }
  throw new Error('ForbiddenException bekleniyordu');
}

describe('mesaj hakki — ilk model cagrisindan once', () => {
  it('hak dolmadan: mesaj cevaplanir, sayac bir artar', async () => {
    const c = build({ kv: { [monthKey(OWNER)]: '41' } });
    const r = await c.svc.sendMessage('s1', user(), { message: 'Görünürlüğüm neden düştü?' });
    expect(r.message.content).toBe('Cevap');
    expect(c.create).toHaveBeenCalledTimes(1);
    expect(c.kv.get(monthKey(OWNER))).toBe('42');
  });

  it('hak doluysa: 403 CHAT_MESSAGE_LIMIT, model CAGRILMAZ, konusma ve mesaj kaydi ACILMAZ', async () => {
    const c = build({ kv: { [monthKey(OWNER)]: '100' } });
    const err = await forbidden(() => c.svc.sendMessage('s1', user({ plan: 'STARTER' }), { message: 'Merhaba' }));
    expect((err.getResponse() as any).code).toBe(CHAT_MESSAGE_LIMIT_CODE);
    expect(err.message).toBe('Bu ayki 100 Asistan mesajı hakkını kullandın. Hak gelecek ayın başında yenilenir; Profesyonel planında ayda 500 mesaj gönderebilirsin.');
    expect(c.create).not.toHaveBeenCalled();
    expect(c.prisma.chatConversation.create).not.toHaveBeenCalled();
    expect(c.prisma.chatMessage.create).not.toHaveBeenCalled();
    expect(c.kv.get(monthKey(OWNER))).toBe('100');
  });

  it('hazir gorev (skill) de bir mesaj sayilir ve hakka takilir', async () => {
    const acik = build({ kv: { [monthKey(OWNER)]: '3' } });
    await acik.svc.sendMessage('s1', user(), { skill: 'weekly-plan' });
    expect(acik.kv.get(monthKey(OWNER))).toBe('4');
    const dolu = build({ kv: { [monthKey(OWNER)]: '500' } });
    await expect(dolu.svc.sendMessage('s1', user(), { skill: 'weekly-plan' })).rejects.toBeInstanceOf(ForbiddenException);
    expect(dolu.create).not.toHaveBeenCalled();
  });

  it('ADMIN muaf: hak doluyken de cevap alir, sayac degismez', async () => {
    const c = build({ kv: { [monthKey('admin-1')]: '500' } });
    await expect(c.svc.sendMessage('s1', user({ id: 'admin-1', role: 'ADMIN' }), { message: 'Destek kontrolü' })).resolves.toBeDefined();
    expect(c.create).toHaveBeenCalledTimes(1);
    expect(c.kv.get(monthKey('admin-1'))).toBe('500');
    expect(c.kv.has(monthKey(OWNER))).toBe(false);
  });

  it('platformun baslattigi mesaj (haftalik plan, automated): musterinin hakkindan dusmez ve hakka takilmaz', async () => {
    const c = build({ kv: { [monthKey(OWNER)]: '500' } });
    await expect(c.svc.sendMessage('s1', user(), { skill: 'weekly-plan' }, { automated: true })).resolves.toBeDefined();
    expect(c.create).toHaveBeenCalledTimes(1);
    expect(c.kv.get(monthKey(OWNER))).toBe('500');
  });

  it('haftalik plan cron\'u automated ile cagirir; denetleyici (panel) bu secenegi VEREMEZ', () => {
    const cron = readFileSync(new URL('./weekly-plan.cron.ts', import.meta.url), 'utf8');
    expect(cron).toMatch(/this\.chat\.sendMessage\([\s\S]{0,200}\{ skill: 'weekly-plan' \},\s*\{ automated: true \},\s*\)/);
    const ctl = readFileSync(new URL('./chat.controller.ts', import.meta.url), 'utf8');
    expect(ctl).not.toMatch(/automated/);
    // Denetleyici sendMessage'i uc argumanla cagirir (dorduncu arguman yok)
    expect(ctl).toMatch(/this\.chat\.sendMessage\(siteId, \{ id: user\.id, role: user\.role, plan: user\.plan \}, \{\s*conversationId: body\.conversationId,\s*message: body\.message,\s*skill: body\.skill,\s*\}\);/);
  });
});

describe('aylik AI butcesi — site sahibinin, ilk model cagrisindan once', () => {
  it('butce doluysa: 403 AI_BUDGET_EXHAUSTED, model cagrilmaz, mesaj hakki DUSMEZ, kayit acilmaz', async () => {
    const c = build({ owner: { plan: 'PRO', aiCostThisMonthUsd: 120 }, kv: { [monthKey(OWNER)]: '7' } });
    const err = await forbidden(() => c.svc.sendMessage('s1', user(), { message: 'Merhaba' }));
    expect((err.getResponse() as any).code).toBe(AI_BUDGET_EXHAUSTED_CODE);
    expect(err.message).toBe('Aylık AI kullanım bütçen doldu ($120.00 / $120). Bütçe yeni ayın başında sıfırlanır.');
    expect(c.create).not.toHaveBeenCalled();
    expect(c.kv.get(monthKey(OWNER))).toBe('7');
    expect(c.prisma.chatConversation.create).not.toHaveBeenCalled();
  });

  it('butce aciksa engellemez (sinirin hemen altinda)', async () => {
    const c = build({ owner: { plan: 'PRO', aiCostThisMonthUsd: 119.5 } });
    await expect(c.svc.sendMessage('s1', user(), { message: 'Merhaba' })).resolves.toBeDefined();
  });

  it('butce SITE SAHIBININ: yoneticinin musteri sitesindeki sohbeti musterinin dolu butcesine takilir', async () => {
    const c = build({ owner: { plan: 'STARTER', aiCostThisMonthUsd: 25 } });
    const err = await forbidden(() => c.svc.sendMessage('s1', user({ id: 'admin-1', role: 'ADMIN', plan: 'ENTERPRISE' }), { message: 'Destek' }));
    expect((err.getResponse() as any).code).toBe(AI_BUDGET_EXHAUSTED_CODE);
    expect(c.create).not.toHaveBeenCalled();
  });

  it('butce sayaci okunamazsa mesaj ENGELLENMEZ (hata yonu: acik)', async () => {
    const c = build();
    c.prisma.user.findUniqueOrThrow.mockRejectedValue(new Error('db yok'));
    await expect(c.svc.sendMessage('s1', user(), { message: 'Merhaba' })).resolves.toBeDefined();
    expect(c.create).toHaveBeenCalledTimes(1);
  });

  it('platformun baslattigi mesaj da butceye tabidir (harcama gercek)', async () => {
    const c = build({ owner: { plan: 'PRO', aiCostThisMonthUsd: 120 } });
    await expect(c.svc.sendMessage('s1', user(), { skill: 'weekly-plan' }, { automated: true })).rejects.toBeInstanceOf(ForbiddenException);
    expect(c.create).not.toHaveBeenCalled();
  });
});

describe('model cagrilmadan basarisiz olan mesaj sayilmaz', () => {
  it('ilk model cagrisi hata verirse: hak geri verilir, kullanici mesaji ve bu istekte acilan konusma silinir', async () => {
    const c = build({ kv: { [monthKey(OWNER)]: '10' }, replies: [new Error('overloaded')] });
    await expect(c.svc.sendMessage('s1', user(), { message: 'Merhaba' })).rejects.toThrow('overloaded');
    expect(c.kv.get(monthKey(OWNER))).toBe('10');
    expect(c.messages).toHaveLength(0);
    expect(c.conversations.size).toBe(0);
    expect(c.llm.recordDirectUsage).not.toHaveBeenCalled();
  });

  it('var olan konusmada: yalniz cevaplanamayan kullanici mesaji silinir, konusma ve gecmis durur', async () => {
    const c = build({ replies: [textReply('İlk cevap', { input_tokens: 100, output_tokens: 50 }), new Error('overloaded')] });
    const first = await c.svc.sendMessage('s1', user(), { message: 'İlk soru' });
    await expect(c.svc.sendMessage('s1', user(), { conversationId: first.conversationId, message: 'İkinci soru' })).rejects.toThrow('overloaded');
    expect(c.conversations.size).toBe(1);
    expect(c.messages.map((m) => m.content)).toEqual(['İlk soru', 'İlk cevap']);
    expect(c.kv.get(monthKey(OWNER))).toBe('1');
  });

  it('dogrulama hatalari (bos mesaj, bilinmeyen skill, bulunamayan konusma) hak dusurmez', async () => {
    const c = build();
    await expect(c.svc.sendMessage('s1', user(), { message: '   ' })).rejects.toThrow();
    await expect(c.svc.sendMessage('s1', user(), { skill: 'yok-boyle-skill' })).rejects.toThrow();
    await expect(c.svc.sendMessage('s1', user(), { conversationId: 'c-yok', message: 'Merhaba' })).rejects.toThrow();
    expect(c.kv.size).toBe(0);
    expect(c.create).not.toHaveBeenCalled();
  });

  it('model en az bir kez cagrildiysa (faturalandi): hak dusmus kalir ve o turlarin harcamasi yine yazilir', async () => {
    const c = build({ replies: [toolReply({ input_tokens: 2_000, output_tokens: 300 }), new Error('timeout')] });
    await expect(c.svc.sendMessage('s1', user(), { message: 'KPI ver' })).rejects.toThrow('timeout');
    expect(c.kv.get(monthKey(OWNER))).toBe('1');
    expect(c.llm.recordDirectUsage).toHaveBeenCalledTimes(1);
    expect(c.llm.recordDirectUsage.mock.calls[0][0]).toMatchObject({ userId: OWNER, usage: { inputTokens: 2_000, outputTokens: 300 } });
    // Kullanici mesaji gecmiste kalir (model onu gordu)
    expect(c.messages.map((m) => m.role)).toEqual(['user']);
  });
});

describe('harcama tek kez yazilir', () => {
  it('cevap kaydi yazilamazsa (harcama zaten yazildi) ikinci kez yazilmaz', async () => {
    const c = build();
    const create = c.prisma.chatMessage.create.getMockImplementation()!;
    c.prisma.chatMessage.create.mockImplementation(async (args: any) => {
      if (args.data.role === 'assistant') throw new Error('db yok');
      return create(args);
    });
    await expect(c.svc.sendMessage('s1', user(), { message: 'Merhaba' })).rejects.toThrow('db yok');
    expect(c.llm.recordDirectUsage).toHaveBeenCalledTimes(1);
  });
});

describe('gercek maliyet — fiyat tablosundan, cache dahil, site sahibinin sayacina', () => {
  it('tum turlarin kullanimi toplanir; cache okuma / yazma kendi oraniyla sayilir', async () => {
    const c = build({
      replies: [
        toolReply({ input_tokens: 1_000, output_tokens: 200, cache_creation_input_tokens: 6_000 }),
        textReply('Sonuç', { input_tokens: 1_500, output_tokens: 800, cache_read_input_tokens: 6_000 }),
      ],
    });
    const r = await c.svc.sendMessage('s1', user(), { message: 'KPI ver' });
    const f = anthropicPricing('claude-sonnet-5')!;
    const beklenen = (2_500 / 1e6) * f.input + (1_000 / 1e6) * f.output + (6_000 / 1e6) * f.cacheRead! + (6_000 / 1e6) * f.cacheWrite!;
    const yalnizGirdiCikti = (2_500 / 1e6) * f.input + (1_000 / 1e6) * f.output;
    expect(beklenen).toBeGreaterThan(yalnizGirdiCikti);
    expect(r.costUsd).toBeCloseTo(Math.round(beklenen * 10000) / 10000, 10);
    const asistan = c.messages.find((m) => m.role === 'assistant');
    expect(asistan.costUsd).toBeCloseTo(beklenen, 10);
    expect(c.llm.recordDirectUsage).toHaveBeenCalledTimes(1);
    expect(c.llm.recordDirectUsage.mock.calls[0][0]).toEqual({
      context: 'chat',
      siteId: 's1',
      userId: OWNER,
      conversationId: r.conversationId,
      provider: 'anthropic',
      model: 'claude-sonnet-5',
      usage: { inputTokens: 2_500, outputTokens: 1_000, cacheReadTokens: 6_000, cacheWriteTokens: 6_000 },
    });
  });

  it('yoneticinin musteri sitesindeki sohbetinin harcamasi musterinin (site sahibinin) sayacina yazilir', async () => {
    const c = build();
    await c.svc.sendMessage('s1', user({ id: 'admin-1', role: 'ADMIN', plan: 'ENTERPRISE' }), { message: 'Destek' });
    expect(c.llm.recordDirectUsage.mock.calls[0][0]).toMatchObject({ userId: OWNER });
  });

  it('serviste elle yazilmis fiyat kopyasi kalmadi', () => {
    const src = readFileSync(new URL('./chat.service.ts', import.meta.url), 'utf8');
    expect(src).not.toMatch(/PRICE_IN|PRICE_OUT/);
    expect(src).toContain('anthropicCostUsd(MODEL, usage)');
  });
});
