import { describe, it, expect, vi, afterEach } from 'vitest';
import { NotFoundException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ThrottlerException, ThrottlerStorageService } from '@nestjs/throttler';
import { PersonaChatThrottlerGuard } from './persona-chat-throttler.guard.js';
import { SiteUserThrottlerGuard } from './site-user-throttler.guard.js';
import { AiSitemapThrottlerGuard } from './ai-sitemap-throttler.guard.js';
import { PersonaChatService } from './persona-chat.service.js';
import { AiSitemapService } from './ai-sitemap.service.js';
import { SiteAccessGuard } from '../auth/site-access.guard.js';
import { Public } from '../auth/public.decorator.js';

/**
 * Site kimliginin harf varyantlari yeni hiz siniri kovasi ACAMAZ.
 *
 * NEDEN VAR: sites tablosu utf8mb4_unicode_ci — 'CMSQ...' ayni siteyi bulur.
 * Kovalar ham :siteId ile sayildigi icin 25 karakterlik bir cuid'in
 * milyonlarca yaziminin her biri bos kovayla basliyordu: herkese acik persona
 * sohbetinin gunluk site butcesi (RanksUp'in Anthropic anahtari), oturumlu
 * pahali uclarin saatlik tavani ve site haritasi siniri boyle asiliyordu.
 * Ilk kapi global SiteAccessGuard (kanonik olmayan kimlik 404); guard'larin
 * kendisi de varyantlari tek ortak kovada sayar; @Public servisler satirdaki
 * kimligi birebir karsilastirir.
 */
const CANON = 'cmsq25bko005farswo54hf856';

/** Kanonik kimligin n farkli harf varyanti (hicbiri kanonik degil) */
function caseVariants(id: string, n: number): string[] {
  const letters = [...id].flatMap((ch, i) => (/[a-z]/.test(ch) ? [i] : []));
  const out: string[] = [];
  for (let mask = 1; out.length < n && mask < 2 ** letters.length; mask++) {
    const chars = [...id];
    letters.forEach((pos, bit) => { if (mask & (1 << bit)) chars[pos] = chars[pos].toUpperCase(); });
    out.push(chars.join(''));
  }
  return out;
}

class Routes {
  @Public()
  personaChat() {}
  snippets() {}
  @Public()
  sitemap() {}
}

const storages: ThrottlerStorageService[] = [];
afterEach(() => {
  for (const s of storages.splice(0)) s.onApplicationShutdown();
  vi.unstubAllEnvs();
});

async function make<T extends { onModuleInit(): Promise<void> }>(Guard: new (...a: any[]) => T): Promise<T> {
  const storage = new ThrottlerStorageService();
  storages.push(storage);
  const guard = new Guard([{ ttl: 60_000, limit: 60 }], storage, new Reflector());
  await guard.onModuleInit();
  return guard;
}

function ctx(handler: () => void, siteId: string, ip: string, user?: { id: string; role?: string }) {
  const req = { params: { siteId }, headers: { 'cf-connecting-ip': ip }, ip: '127.0.0.1', user };
  const res = { header: () => undefined };
  return {
    getHandler: () => handler,
    getClass: () => Routes,
    switchToHttp: () => ({ getRequest: () => req, getResponse: () => res }),
  } as any;
}

async function passes(guard: { canActivate(c: any): Promise<boolean> }, c: any): Promise<boolean> {
  try {
    return await guard.canActivate(c);
  } catch (err) {
    if (err instanceof ThrottlerException) return false;
    throw err;
  }
}

describe('PersonaChatThrottlerGuard — gunluk site butcesi varyantla buyumez', () => {
  it('farkli IP\'lerden 10 harf varyanti: toplamda gunluk sinirdan fazlasi gecemez', async () => {
    vi.stubEnv('PERSONA_CHAT_SITE_DAILY_LIMIT', '3');
    const guard = await make(PersonaChatThrottlerGuard);
    for (let i = 0; i < 3; i++) expect(await passes(guard, ctx(Routes.prototype.personaChat, CANON, `198.51.100.${i + 1}`))).toBe(true);
    expect(await passes(guard, ctx(Routes.prototype.personaChat, CANON, '198.51.100.50'))).toBe(false);

    const variants = caseVariants(CANON, 10);
    let passed = 0;
    for (const [i, v] of variants.entries()) {
      if (await passes(guard, ctx(Routes.prototype.personaChat, v, `203.0.113.${i + 1}`))) passed++;
    }
    // Eskiden 10/10 gecerdi (her varyant ayri ve bos kova)
    expect(passed).toBeLessThanOrEqual(3);
  });

  it('global sira (SiteAccessGuard, sonra rota guard\'i): varyant kovaya ulasmadan 404', async () => {
    vi.stubEnv('PERSONA_CHAT_SITE_DAILY_LIMIT', '2');
    const throttler = await make(PersonaChatThrottlerGuard);
    const siteAccess = new SiteAccessGuard({ site: { findUnique: vi.fn() } } as any, new Reflector());
    const chain = async (siteId: string, ip: string) => {
      const c = ctx(Routes.prototype.personaChat, siteId, ip);
      await siteAccess.canActivate(c);
      return throttler.canActivate(c);
    };
    await chain(CANON, '198.51.100.1');
    await chain(CANON, '198.51.100.2');
    await expect(chain(CANON, '198.51.100.3')).rejects.toBeInstanceOf(ThrottlerException);
    for (const v of caseVariants(CANON, 5)) {
      await expect(chain(v, '203.0.113.9')).rejects.toBeInstanceOf(NotFoundException);
    }
  });
});

describe('SiteUserThrottlerGuard — saatlik tavan varyantla sifirlanmaz', () => {
  it('ayni kullanici 25 harf varyantiyla en fazla varsayilan tavan (20) kadar gecer', async () => {
    const guard = await make(SiteUserThrottlerGuard);
    const user = { id: 'u1' };
    for (let i = 0; i < 20; i++) expect(await passes(guard, ctx(Routes.prototype.snippets, CANON, '203.0.113.7', user))).toBe(true);
    expect(await passes(guard, ctx(Routes.prototype.snippets, CANON, '203.0.113.7', user))).toBe(false);

    let passed = 0;
    for (const v of caseVariants(CANON, 25)) {
      if (await passes(guard, ctx(Routes.prototype.snippets, v, '203.0.113.7', user))) passed++;
    }
    expect(passed).toBeLessThanOrEqual(20);
  });
});

describe('AiSitemapThrottlerGuard — harita siniri varyantla asilmaz', () => {
  it('ayni IP 40 harf varyantiyla en fazla 30 istek gecirir', async () => {
    const guard = await make(AiSitemapThrottlerGuard);
    let passed = 0;
    for (const v of caseVariants(CANON, 40)) {
      if (await passes(guard, ctx(Routes.prototype.sitemap, v, '203.0.113.7'))) passed++;
    }
    expect(passed).toBeLessThanOrEqual(30);
  });
});

/** MySQL harmanlamasi gibi harf duyarsiz eslesen sahte site tablosu */
function ciSites(rows: Array<Record<string, any>>) {
  return vi.fn(async ({ where }: any) => rows.find((r) => r.id.toLowerCase() === String(where.id).trim().toLowerCase()) ?? null);
}

describe('PersonaChatService.ask — satirdaki kimlik birebir ayni olmali', () => {
  function svc(rows: Array<Record<string, any>>) {
    const prisma = {
      site: { findUnique: ciSites(rows) },
      article: { findMany: vi.fn(async () => []) },
    };
    const s = new PersonaChatService(prisma as any, { getString: vi.fn(async () => null) } as any);
    const create = vi.fn(async () => ({ content: [{ type: 'text', text: 'Merhaba' }] }));
    (s as any).anthropic = { messages: { create } };
    return { s, prisma, create };
  }
  const site = { id: CANON, name: 'Örnek', url: 'https://ornek.com', niche: 'kuafor', brain: null };

  it('harf varyanti ayni satiri bulsa da 404; model cagrisi yok', async () => {
    const { s, create, prisma } = svc([site]);
    await expect(s.ask(CANON.toUpperCase(), [{ role: 'user', content: 'Merhaba' }])).rejects.toBeInstanceOf(NotFoundException);
    await expect(s.ask(`C${CANON.slice(1)}`, [{ role: 'user', content: 'Merhaba' }])).rejects.toBeInstanceOf(NotFoundException);
    expect(create).not.toHaveBeenCalled();
    expect(prisma.article.findMany).not.toHaveBeenCalled();
  });

  it('kanonik kimlik eskisi gibi cevap alir', async () => {
    const { s, create } = svc([site]);
    const r = await s.ask(CANON, [{ role: 'user', content: 'Merhaba' }]);
    expect(r.reply).toBe('Merhaba');
    expect(create).toHaveBeenCalledTimes(1);
  });
});

describe('AiSitemapService.getPublicXml — kanonik kimlik ve birebir esitlik', () => {
  function svc(rows: Array<Record<string, any>>) {
    const prisma = {
      site: { findUnique: ciSites(rows) },
      article: { findMany: vi.fn(async () => []) },
      publishTarget: { findMany: vi.fn(async () => []) },
    };
    const s = new AiSitemapService(prisma as any);
    (s as any).fetchText = vi.fn(async () => ({ ok: true, binary: false, text: '<meta name="description" content="Kuaför">' }));
    return { s, prisma };
  }
  const row = (id: string) => ({ id, url: 'https://lavantakuafor.com', user: { deletionRequestedAt: null } });

  it('harf varyanti DB\'ye gitmeden null (uc 404); onbellek varyantla sisirilemez', async () => {
    const { s, prisma } = svc([row(CANON)]);
    for (const v of caseVariants(CANON, 3)) expect(await s.getPublicXml(v)).toBeNull();
    expect(await s.getPublicXml(`${CANON} `)).toBeNull();
    expect(prisma.site.findUnique).not.toHaveBeenCalled();
    expect(prisma.article.findMany).not.toHaveBeenCalled();
  });

  it('kanonik bicimli kimlik farkli yazilmis satiri bulursa null', async () => {
    const { s, prisma } = svc([row('Demo-Luvihost')]);
    expect(await s.getPublicXml('demo-luvihost')).toBeNull();
    expect(prisma.article.findMany).not.toHaveBeenCalled();
  });

  it('kanonik kimlik haritayi alir', async () => {
    const { s } = svc([row(CANON)]);
    const xml = await s.getPublicXml(CANON);
    expect(xml).toContain('<loc>https://lavantakuafor.com/</loc>');
  });
});
