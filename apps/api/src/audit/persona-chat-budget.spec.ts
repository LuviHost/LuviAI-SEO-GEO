import { describe, it, expect, vi, afterEach } from 'vitest';
import { NotFoundException } from '@nestjs/common';
import { PersonaChatService } from './persona-chat.service.js';

/**
 * Herkese acik persona sohbeti: IP sinirlamasi baslik sahteciligi / IPv6 adres
 * degistirme ile asilabildigi icin site basina ve toplam gunluk butce ucretli
 * model cagrisini sinirlar.
 */
function service(counts: { site: number; all: number }, opts: { failCounter?: boolean } = {}) {
  const prisma: any = {
    site: { findUnique: vi.fn(async ({ where }: any) => (where.id === 's1' ? { id: 's1', url: 'https://ornek.com', name: 'Ornek', brain: null } : null)) },
    article: { findMany: vi.fn(async () => []) },
    $executeRawUnsafe: vi.fn(async () => { if (opts.failCounter) throw new Error('db yok'); return 1; }),
    kvStore: { findUnique: vi.fn(async ({ where }: any) => ({ value: String(where.key.endsWith(':all') ? counts.all : counts.site) })) },
  };
  const svc = new PersonaChatService(prisma, { get: vi.fn(async () => null) } as any);
  const create = vi.fn(async () => ({ content: [{ type: 'text', text: 'cevap' }] }));
  (svc as any).anthropic = { messages: { create } };
  return { svc, create, prisma };
}

afterEach(() => { delete process.env.PERSONA_CHAT_SITE_DAILY_LIMIT; delete process.env.PERSONA_CHAT_GLOBAL_DAILY_LIMIT; });

describe('persona sohbeti gunluk butcesi', () => {
  it('site tavani asildiysa model cagrilmaz, kibar bir yanit doner', async () => {
    process.env.PERSONA_CHAT_SITE_DAILY_LIMIT = '5';
    const { svc, create } = service({ site: 6, all: 10 });
    const r = await svc.ask('s1', [{ role: 'user', content: 'merhaba' }] as any);
    expect(create).not.toHaveBeenCalled();
    expect(r.reply).toMatch(/bugunluk yanit sinirina/);
  });

  it('toplam tavan asildiysa model cagrilmaz', async () => {
    process.env.PERSONA_CHAT_GLOBAL_DAILY_LIMIT = '100';
    const { svc, create } = service({ site: 1, all: 101 });
    await svc.ask('s1', [{ role: 'user', content: 'merhaba' }] as any);
    expect(create).not.toHaveBeenCalled();
  });

  it('tavan altinda model cagrilir; max_tokens 1024', async () => {
    const { svc, create } = service({ site: 1, all: 1 });
    const r = await svc.ask('s1', [{ role: 'user', content: 'merhaba' }] as any);
    expect(create).toHaveBeenCalledTimes(1);
    expect((create.mock.calls[0] as any)[0].max_tokens).toBe(1024);
    expect(r.reply).toBe('cevap');
  });

  it('sayac yazilamazsa ucretli cagri yapilmaz (guvenli taraf)', async () => {
    const { svc, create } = service({ site: 1, all: 1 }, { failCounter: true });
    await svc.ask('s1', [{ role: 'user', content: 'merhaba' }] as any);
    expect(create).not.toHaveBeenCalled();
  });

  it('bilinmeyen site 404 (500 degil) ve sayac artmaz', async () => {
    const { svc, prisma } = service({ site: 1, all: 1 });
    await expect(svc.ask('yok', [{ role: 'user', content: 'x' }] as any)).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.$executeRawUnsafe).not.toHaveBeenCalled();
  });

  it('widget girisi soru sinirini bilir ve hata mesajini gosterir', () => {
    const { svc } = service({ site: 1, all: 1 });
    const js = svc.buildWidgetJs('s1');
    expect(js).toMatch(/input\.maxLength = \d+/);
    expect(js).toContain('Soru gonderilemedi');
  });
});
