import { describe, it, expect, vi } from 'vitest';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { SiteAccessGuard, SITE_NOT_FOUND_MESSAGE } from './site-access.guard.js';
import { Public } from './public.decorator.js';

/**
 * SiteAccessGuard — kanonik site kimligi (common/site-id.ts).
 *
 * NEDEN VAR: sites harmanlamasi (utf8mb4_unicode_ci) harf farkini yok sayar.
 * 'CMSQ...' sahibinin sitesini buluyor, sahiplik denetiminden geciyor ve rota
 * duzeyindeki hiz siniri guard'larina (SiteUserThrottlerGuard, persona,
 * site haritasi) ham parametreyle, yani BOS bir kovayla ulasiyordu.
 */
const CANON = 'cmsq25bko005farswo54hf856';

class Ctl {
  @Public()
  pub() {}
  priv() {}
}

/** Sahte Prisma: MySQL harmanlamasi gibi harf duyarsiz eslesir, satirdaki kimligi dondurur */
function prismaCi(rows: Array<{ id: string; userId: string }>) {
  return {
    site: {
      findUnique: vi.fn(async ({ where }: any) => rows.find((r) => r.id.toLowerCase() === String(where.id).trim().toLowerCase()) ?? null),
    },
  };
}

function ctx(handler: () => void, siteId: string | undefined, user: any = { id: 'u1', role: 'USER' }) {
  const req: any = { params: siteId === undefined ? {} : { siteId }, user };
  return {
    getHandler: () => handler,
    getClass: () => Ctl,
    switchToHttp: () => ({ getRequest: () => req }),
  } as any;
}

describe('SiteAccessGuard — kanonik site kimligi', () => {
  it('buyuk/karisik harfli ya da sonu bosluklu kimlik DB\'ye gitmeden 404 (sahibi olsa bile)', async () => {
    const prisma = prismaCi([{ id: CANON, userId: 'u1' }]);
    const guard = new SiteAccessGuard(prisma as any, new Reflector());
    for (const v of [CANON.toUpperCase(), `C${CANON.slice(1)}`, `${CANON} `]) {
      const err = await guard.canActivate(ctx(Ctl.prototype.priv, v)).catch((e) => e);
      expect(err, JSON.stringify(v)).toBeInstanceOf(NotFoundException);
      expect(err.message).toBe(SITE_NOT_FOUND_MESSAGE);
    }
    expect(prisma.site.findUnique).not.toHaveBeenCalled();
  });

  it('@Public rotada da varyant 404: persona sohbeti ve site haritasi kovalarina ulasamaz', async () => {
    const prisma = prismaCi([{ id: CANON, userId: 'u1' }]);
    const guard = new SiteAccessGuard(prisma as any, new Reflector());
    await expect(guard.canActivate(ctx(Ctl.prototype.pub, CANON.toUpperCase(), undefined))).rejects.toBeInstanceOf(NotFoundException);
    // Kanonik kimlikle @Public rota eskisi gibi sahiplik denetimsiz gecer
    await expect(guard.canActivate(ctx(Ctl.prototype.pub, CANON, undefined))).resolves.toBe(true);
    expect(prisma.site.findUnique).not.toHaveBeenCalled();
  });

  it('kanonik bicimli kimlik farkli yazilmis bir satiri bulursa (harmanlama esitligi) 404', async () => {
    // Elle yazilmis buyuk harfli eski bir kimlik: kurala uyan kucuk harfli yazim ayni satiri bulur
    const prisma = prismaCi([{ id: 'Demo-Luvihost', userId: 'u1' }]);
    const guard = new SiteAccessGuard(prisma as any, new Reflector());
    await expect(guard.canActivate(ctx(Ctl.prototype.priv, 'demo-luvihost'))).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.site.findUnique).toHaveBeenCalledTimes(1);
  });

  it('kanonik kimlik: sahibi gecer, baskasi 403, ADMIN gecer, olmayan site 404', async () => {
    const prisma = prismaCi([{ id: CANON, userId: 'u1' }]);
    const guard = new SiteAccessGuard(prisma as any, new Reflector());
    await expect(guard.canActivate(ctx(Ctl.prototype.priv, CANON))).resolves.toBe(true);
    await expect(guard.canActivate(ctx(Ctl.prototype.priv, CANON, { id: 'u2', role: 'USER' }))).rejects.toBeInstanceOf(ForbiddenException);
    await expect(guard.canActivate(ctx(Ctl.prototype.priv, CANON, { id: 'adm', role: 'ADMIN' }))).resolves.toBe(true);
    await expect(guard.canActivate(ctx(Ctl.prototype.priv, 'cyokyokyokyokyokyokyokyok'))).rejects.toBeInstanceOf(NotFoundException);
  });

  it(':siteId olmayan rota denetlenmez', async () => {
    const prisma = prismaCi([]);
    const guard = new SiteAccessGuard(prisma as any, new Reflector());
    await expect(guard.canActivate(ctx(Ctl.prototype.priv, undefined))).resolves.toBe(true);
    expect(prisma.site.findUnique).not.toHaveBeenCalled();
  });
});
