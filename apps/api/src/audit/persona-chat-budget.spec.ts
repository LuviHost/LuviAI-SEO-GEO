import { describe, it, expect, vi, afterEach } from 'vitest';
import { NotFoundException } from '@nestjs/common';
import { PERSONA_BUDGET_REPLY, PersonaChatService } from './persona-chat.service.js';

/**
 * Herkese acik persona sohbeti: bellekteki hiz siniri (persona-chat-throttler)
 * yeniden baslatmada sifirlanir ve tum sitelerin toplamini sinirlamaz. Ucretli
 * model cagrisinin asil tavani kalici gunluk sayaclardir: site basina ve tum
 * siteler toplami (kv_store).
 */
function service(counts: { site: number; all: number }, opts: { failCounter?: boolean } = {}) {
  const prisma: any = {
    // MySQL gibi harf duyarsiz eslesme (utf8mb4_unicode_ci): 'S1' de 's1' satirini bulur.
    site: { findUnique: vi.fn(async ({ where }: any) => (String(where.id).toLowerCase() === 's1' ? { id: 's1', url: 'https://ornek.com', name: 'Ornek', brain: null } : null)) },
    article: { findMany: vi.fn(async () => []) },
    $executeRawUnsafe: vi.fn(async () => { if (opts.failCounter) throw new Error('db yok'); return 1; }),
    kvStore: { findUnique: vi.fn(async ({ where }: any) => ({ value: String(where.key.endsWith(':all') ? counts.all : counts.site) })) },
  };
  const svc = new PersonaChatService(prisma, { getString: vi.fn(async () => null) } as any);
  const create = vi.fn(async () => ({ content: [{ type: 'text', text: 'cevap' }] }));
  (svc as any).anthropic = { messages: { create } };
  return { svc, create, prisma };
}

afterEach(() => { delete process.env.PERSONA_CHAT_SITE_DAILY_LIMIT; delete process.env.PERSONA_CHAT_GLOBAL_DAILY_LIMIT; });

describe('persona sohbeti kalici gunluk butcesi', () => {
  it('site tavani asildiysa model cagrilmaz, kibar bir yanit doner', async () => {
    process.env.PERSONA_CHAT_SITE_DAILY_LIMIT = '5';
    const { svc, create } = service({ site: 6, all: 10 });
    const r = await svc.ask('s1', [{ role: 'user', content: 'merhaba' }]);
    expect(create).not.toHaveBeenCalled();
    expect(r.reply).toBe(PERSONA_BUDGET_REPLY);
  });

  it('tum siteler toplami asildiysa model cagrilmaz', async () => {
    process.env.PERSONA_CHAT_GLOBAL_DAILY_LIMIT = '100';
    const { svc, create } = service({ site: 1, all: 101 });
    await svc.ask('s1', [{ role: 'user', content: 'merhaba' }]);
    expect(create).not.toHaveBeenCalled();
  });

  it('varsayilan tavanlar site 300, toplam 3000', async () => {
    const atSite = service({ site: 300, all: 300 });
    await atSite.svc.ask('s1', [{ role: 'user', content: 'merhaba' }]);
    expect(atSite.create).toHaveBeenCalledTimes(1);
    const overSite = service({ site: 301, all: 301 });
    await overSite.svc.ask('s1', [{ role: 'user', content: 'merhaba' }]);
    expect(overSite.create).not.toHaveBeenCalled();
    const overAll = service({ site: 1, all: 3001 });
    await overAll.svc.ask('s1', [{ role: 'user', content: 'merhaba' }]);
    expect(overAll.create).not.toHaveBeenCalled();
  });

  it('tavan altinda model cagrilir; max_tokens 1024', async () => {
    const { svc, create } = service({ site: 1, all: 1 });
    const r = await svc.ask('s1', [{ role: 'user', content: 'merhaba' }]);
    expect(create).toHaveBeenCalledTimes(1);
    expect((create.mock.calls[0] as any)[0].max_tokens).toBe(1024);
    expect(r.reply).toBe('cevap');
  });

  it('sayac yazilamazsa ucretli cagri yapilmaz (guvenli taraf)', async () => {
    const { svc, create } = service({ site: 1, all: 1 }, { failCounter: true });
    const r = await svc.ask('s1', [{ role: 'user', content: 'merhaba' }]);
    expect(create).not.toHaveBeenCalled();
    expect(r.reply).toBe(PERSONA_BUDGET_REPLY);
  });

  it('bilinmeyen site ve harf varyanti 404; sayac artmaz', async () => {
    const { svc, prisma, create } = service({ site: 1, all: 1 });
    await expect(svc.ask('yok', [{ role: 'user', content: 'x' }])).rejects.toBeInstanceOf(NotFoundException);
    await expect(svc.ask('S1', [{ role: 'user', content: 'x' }])).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.$executeRawUnsafe).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });

  it('sayac anahtarlari kanonik site kimligi ve UTC gunle kurulur', async () => {
    const { svc, prisma } = service({ site: 1, all: 1 });
    await svc.ask('s1', [{ role: 'user', content: 'merhaba' }]);
    const keys = prisma.$executeRawUnsafe.mock.calls.map((c: any[]) => String(c[1]));
    const day = new Date().toISOString().slice(0, 10);
    expect(keys).toEqual([`persona-chat:${day}:site:s1`, `persona-chat:${day}:all`]);
  });
});
