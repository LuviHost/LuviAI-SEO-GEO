import { describe, it, expect, afterEach, vi } from 'vitest';
import { Reflector } from '@nestjs/core';
import { ThrottlerException, ThrottlerStorageService } from '@nestjs/throttler';
import {
  PersonaChatThrottlerGuard, PERSONA_CHAT_IP_THROTTLE, PERSONA_CHAT_SITE_THROTTLE, personaChatSiteLimit,
  SITE_EXISTENCE_CACHE_MAX,
} from './persona-chat-throttler.guard.js';

/**
 * Herkese acik persona sohbeti: ziyaretci IP'si + site ve site toplami.
 * Guard elle kurulur (vitest dekorator metadata'si uretmez); IP
 * common/client-ip.ts kuralindan (CF-Connecting-IP) okunur.
 */
const { AuditController } = await import('./audit.controller.js');

const storages: ThrottlerStorageService[] = [];
afterEach(() => {
  for (const s of storages.splice(0)) s.onApplicationShutdown();
  delete process.env.PERSONA_CHAT_SITE_DAILY_LIMIT;
  vi.restoreAllMocks();
});

async function makeGuard(prisma?: { site: { findUnique: (...a: any[]) => Promise<any> } }) {
  const storage = new ThrottlerStorageService();
  storages.push(storage);
  const guard = new PersonaChatThrottlerGuard([{ ttl: 60_000, limit: 60 }], storage, new Reflector(), prisma as any);
  await guard.onModuleInit();
  return { guard, storage };
}

/** Yalniz `known` kimlikleri bulan sahte Prisma (select: { id } ile cagrilir) */
function fakePrisma(known: string[]) {
  return {
    site: {
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => (known.includes(where.id) ? { id: where.id } : null)),
    },
  };
}

function ctx(siteId: string, ip: string, xff?: string) {
  const headers: Record<string, unknown> = {};
  const reqHeaders: Record<string, string> = { 'cf-connecting-ip': ip };
  if (xff) reqHeaders['x-forwarded-for'] = xff;
  const req = { params: { siteId }, headers: reqHeaders, ip: '127.0.0.1' };
  const res = { header: (k: string, v: unknown) => { headers[k] = v; } };
  return {
    headers,
    context: {
      getHandler: () => (AuditController.prototype as any).personaChatAsk,
      getClass: () => AuditController,
      switchToHttp: () => ({ getRequest: () => req, getResponse: () => res }),
    } as any,
  };
}

describe('PersonaChatThrottlerGuard', () => {
  it('ayni IP + site: 21. mesaj 429 + Turkce neden; baska IP ve baska site ayri kova', async () => {
    const { guard } = await makeGuard();
    for (let i = 0; i < 20; i++) {
      await expect(guard.canActivate(ctx('s1', '203.0.113.7').context)).resolves.toBe(true);
    }
    const blocked = ctx('s1', '203.0.113.7');
    const err = await guard.canActivate(blocked.context).catch((e) => e);
    expect(err).toBeInstanceOf(ThrottlerException);
    expect(err.getStatus()).toBe(429);
    expect(String(err.message)).toMatch(/Kısa sürede çok fazla mesaj gönderildi\. Yaklaşık \d+ dakika sonra tekrar deneyin\./);
    expect(blocked.headers[`Retry-After-${PERSONA_CHAT_IP_THROTTLE}`]).toBeGreaterThan(0);

    await expect(guard.canActivate(ctx('s1', '198.51.100.1').context)).resolves.toBe(true);
    await expect(guard.canActivate(ctx('s2', '203.0.113.7').context)).resolves.toBe(true);
  });

  it('X-Forwarded-For sahte sol adresi kovayi degistirmez (client-ip kurali)', async () => {
    const { guard } = await makeGuard();
    for (let i = 0; i < 20; i++) {
      // CF yok: XFF'in SAGDAN ilk dis adresi gercek istemci; soldakiler istemcinin yazdigi
      await guard.canActivate({
        ...ctx('s1', '', `10.${i}.0.1, 198.51.100.50`).context,
      });
    }
    await expect(guard.canActivate(ctx('s1', '', '9.9.9.9, 198.51.100.50').context)).rejects.toBeInstanceOf(ThrottlerException);
  });

  it('site toplami: IP degistiren istemci de gunluk sinira takilir; mesaj site sinirini soyler', async () => {
    process.env.PERSONA_CHAT_SITE_DAILY_LIMIT = '5';
    const { guard } = await makeGuard();
    for (let i = 0; i < 5; i++) {
      await expect(guard.canActivate(ctx('s1', `198.51.100.${i + 1}`).context)).resolves.toBe(true);
    }
    const blocked = ctx('s1', '198.51.100.200');
    const err = await guard.canActivate(blocked.context).catch((e) => e);
    expect(err).toBeInstanceOf(ThrottlerException);
    expect(String(err.message)).toBe('Bu sitenin sohbet asistanı bugünkü mesaj sınırına ulaştı. Lütfen daha sonra tekrar deneyin.');
    expect(blocked.headers[`Retry-After-${PERSONA_CHAT_SITE_THROTTLE}`]).toBeGreaterThan(0);
    // Baska site etkilenmez
    await expect(guard.canActivate(ctx('s2', '198.51.100.200').context)).resolves.toBe(true);
  });

  it('gunluk site limiti: varsayilan 300, gecersiz ortam degiskeni varsayilana duser', () => {
    expect(personaChatSiteLimit({} as any)).toEqual({ limit: 300, ttl: 24 * 60 * 60_000 });
    expect(personaChatSiteLimit({ PERSONA_CHAT_SITE_DAILY_LIMIT: 'abc' } as any).limit).toBe(300);
    expect(personaChatSiteLimit({ PERSONA_CHAT_SITE_DAILY_LIMIT: '-4' } as any).limit).toBe(300);
    expect(personaChatSiteLimit({ PERSONA_CHAT_SITE_DAILY_LIMIT: '1000' } as any).limit).toBe(1000);
  });
});

/**
 * Uydurma kanonik kimlikler kova tablosunu buyutemez (inceleme R1 ek notu).
 *
 * NEDEN VAR: uc @Public, SiteAccessGuard bu rotada DB'ye gitmez; her yeni
 * uydurma kimlik iki yeni kova aciyordu ve @nestjs/throttler bellek deposu
 * anahtar silmez (site kovasi her istek icin 24 saatlik zamanlayici da tutar).
 * Uydurma kimlik ayrica taze bir gunluk butceyle basliyordu.
 */
describe('PersonaChatThrottlerGuard — DB\'de olmayan site kimlikleri tek kovada', () => {
  it('500 farkli uydurma kimlik: depo sabit kalir (eskiden istek basina 2 yeni anahtar)', async () => {
    const { guard, storage } = await makeGuard(fakePrisma(['s1']));
    for (let i = 0; i < 500; i++) {
      await guard.canActivate(ctx(`yok${i}`, '203.0.113.7').context).catch(() => false);
    }
    // ip+ortak kova ve ortak site kovasi
    expect(storage.storage.size).toBe(2);

    // Karsilastirma: DB'siz (eski davranis) her kimlik yeni anahtar acar
    const eski = await makeGuard();
    for (let i = 0; i < 50; i++) {
      await eski.guard.canActivate(ctx(`yok${i}`, '203.0.113.7').context).catch(() => false);
    }
    expect(eski.storage.storage.size).toBe(100);
  });

  it('uydurma kimlikler ortak gunluk butceyi paylasir; gercek site kendi kovasinda etkilenmez', async () => {
    process.env.PERSONA_CHAT_SITE_DAILY_LIMIT = '5';
    const { guard } = await makeGuard(fakePrisma(['s1']));
    let gecen = 0;
    for (let i = 0; i < 20; i++) {
      if (await guard.canActivate(ctx(`yok${i}`, `198.51.100.${i + 1}`).context).catch(() => false)) gecen++;
    }
    // Eskiden 20/20 (her uydurma kimlik taze butce)
    expect(gecen).toBe(5);
    await expect(guard.canActivate(ctx('s1', '198.51.100.99').context)).resolves.toBe(true);
  });

  it('kimlik birebir eslesmeli: harmanlamayla bulunan farkli kimlikli satir "bilinmeyen" sayilir', async () => {
    process.env.PERSONA_CHAT_SITE_DAILY_LIMIT = '1';
    const prisma = { site: { findUnique: vi.fn(async () => ({ id: 'baska' })) } };
    const { guard } = await makeGuard(prisma);
    await expect(guard.canActivate(ctx('a1', '198.51.100.1').context)).resolves.toBe(true);
    // a2 de ayni ortak kovaya duser: gunluk 1'lik ortak butce doldu
    await expect(guard.canActivate(ctx('a2', '198.51.100.2').context)).rejects.toBeInstanceOf(ThrottlerException);
  });

  it('onbellek: ayni site icin tek DB sorgusu (iki kova + tekrar eden istekler), hafiza sinirli', async () => {
    const prisma = fakePrisma(['s1']);
    const { guard } = await makeGuard(prisma);
    for (let i = 0; i < 5; i++) await guard.canActivate(ctx('s1', `198.51.100.${i + 1}`).context);
    expect(prisma.site.findUnique).toHaveBeenCalledTimes(1);
    expect(prisma.site.findUnique).toHaveBeenCalledWith({ where: { id: 's1' }, select: { id: true } });

    for (let i = 0; i < SITE_EXISTENCE_CACHE_MAX + 50; i++) {
      await guard.canActivate(ctx(`yok${i}`, '203.0.113.9').context).catch(() => false);
    }
    expect((guard as any).siteExistence.size).toBeLessThanOrEqual(SITE_EXISTENCE_CACHE_MAX);
  });

  it('olmayan site 1 dk hatirlanir: sonra yeniden sorulur (yeni acilan site kendi kovasina gecer)', async () => {
    const prisma = fakePrisma([]);
    const { guard } = await makeGuard(prisma);
    const now = vi.spyOn(Date, 'now');
    now.mockReturnValue(1_000_000);
    await guard.canActivate(ctx('yeni1', '198.51.100.1').context);
    await guard.canActivate(ctx('yeni1', '198.51.100.2').context);
    expect(prisma.site.findUnique).toHaveBeenCalledTimes(1);
    now.mockReturnValue(1_000_000 + 61_000);
    await guard.canActivate(ctx('yeni1', '198.51.100.3').context);
    expect(prisma.site.findUnique).toHaveBeenCalledTimes(2);
  });

  it('DB hatasi: sitenin kendi kovasi (eski davranis), onbellege yazilmaz', async () => {
    process.env.PERSONA_CHAT_SITE_DAILY_LIMIT = '1';
    const prisma = { site: { findUnique: vi.fn(async () => { throw new Error('db down'); }) } };
    const { guard } = await makeGuard(prisma);
    await expect(guard.canActivate(ctx('s1', '198.51.100.1').context)).resolves.toBe(true);
    // s2 kendi kovasinda: s1'in doldurdugu butceden etkilenmez
    await expect(guard.canActivate(ctx('s2', '198.51.100.2').context)).resolves.toBe(true);
    expect(prisma.site.findUnique).toHaveBeenCalledTimes(2);
  });
});
