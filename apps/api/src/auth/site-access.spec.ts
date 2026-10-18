import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';

vi.mock('@luviai/shared', () => ({
  encrypt: (s: string) => `enc:${s}`,
  decrypt: (s: string) => s.replace(/^enc:/, ''),
}));

import { assertSiteAccess } from './site-access.js';
import { AuthController } from './auth.controller.js';
import { SITE_NOT_FOUND_MESSAGE } from './site-access.guard.js';

/**
 * assertSiteAccess — govde/sorgu siteId'si KANONIK olmali (common/site-id.ts).
 *
 * NEDEN VAR: sites tablosu utf8mb4_unicode_ci harmanlamasinda; 'S1', 's1 ',
 * tam genislik 's' (U+FF53) ile '1' ya da araya sifir genislikli bosluk konmus yazim MySQL'de
 * AYNI satiri bulur. Eskiden varyant sahiplik kontrolunden geciyordu ve
 * cagiran (gsc/ga start + disconnect) onu oldugu gibi kullaniyordu. Sahte DB
 * bu harmanlamayi taklit eder: duzeltme olmadan varyantlar gercekten gecer.
 */

/** utf8mb4_unicode_ci'nin bu testte onemli kismi: harf duyarsiz, PAD SPACE, yok sayilan karakter, tam genislik */
const ignorable = (c: string) => {
  const cp = c.codePointAt(0) ?? 0;
  return cp <= 0x1f || cp === 0x200b; // kontrol karakterleri ve sifir genislikli bosluk
};
const collate = (s: string) => [...s.normalize('NFKC')].filter((c) => !ignorable(c)).join('').replace(/ +$/, '').toLowerCase();

type SiteRow = { id: string; userId: string };

function fakePrisma(sites: SiteRow[]) {
  const rows = new Map<string, { key: string; value: string; expiresAt: Date | null }>();
  return {
    rows,
    site: {
      findUnique: vi.fn(async ({ where }: any) => {
        const s = sites.find((x) => collate(x.id) === collate(String(where.id)));
        return s ? { id: s.id, userId: s.userId } : null;
      }),
    },
    user: { findUnique: vi.fn(async () => null) },
    kvStore: {
      async create({ data }: any) { rows.set(data.key, { key: data.key, value: data.value, expiresAt: data.expiresAt ?? null }); return data; },
      async findUnique({ where }: any) { const r = rows.get(where.key); return r ? { ...r } : null; },
      async deleteMany({ where }: any) { return { count: typeof where.key === 'string' && rows.delete(where.key) ? 1 : 0 }; },
    },
  } as any;
}

const owner = { id: 'u1', role: 'USER' };
const admin = { id: 'a1', role: 'ADMIN' };
const SITES: SiteRow[] = [{ id: 's1', userId: 'u1' }, { id: 'cmsq25bko005farswo54hf856', userId: 'u1' }];
const VARIANTS = ['S1', 's1 ', '\uFF531', 's\u200B1', 's1\t', 'CMSQ25BKO005FARSWO54HF856', 'Cmsq25bko005farswo54hf856'];

describe('assertSiteAccess — kanonik kimlik', () => {
  it('harmanlamanin ayni satira esledigi varyantlar 404 "Site bulunamadı"; DB sorgusu yok', async () => {
    for (const v of VARIANTS) {
      const prisma = fakePrisma(SITES);
      // Sahte DB varyanti gercekten buluyor (duzeltme olmasa erisim verilirdi)
      expect(await prisma.site.findUnique({ where: { id: v } }), v).not.toBeNull();
      prisma.site.findUnique.mockClear();
      const err = await assertSiteAccess(prisma, owner, v).catch((e) => e);
      expect(err, v).toBeInstanceOf(NotFoundException);
      expect(err.message, v).toBe(SITE_NOT_FOUND_MESSAGE);
      expect(prisma.site.findUnique, v).not.toHaveBeenCalled();
      // ADMIN de varyantla gecemez
      await expect(assertSiteAccess(prisma, admin, v), v).rejects.toBeInstanceOf(NotFoundException);
    }
  });

  it('harmanlamada eslesmeyen ama kurala uymayan girdi de (bastaki bosluk, nesne) DB\'ye gitmez', async () => {
    const prisma = fakePrisma(SITES);
    await expect(assertSiteAccess(prisma, owner, ' s1')).rejects.toBeInstanceOf(NotFoundException);
    await expect(assertSiteAccess(prisma, owner, ['s1'])).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.site.findUnique).not.toHaveBeenCalled();
  });

  it('kanonik kimlik gecer; satir birebir doner', async () => {
    const prisma = fakePrisma(SITES);
    await expect(assertSiteAccess(prisma, owner, 's1')).resolves.toEqual({ id: 's1', userId: 'u1' });
    await expect(assertSiteAccess(prisma, owner, 'cmsq25bko005farswo54hf856')).resolves.toMatchObject({ id: 'cmsq25bko005farswo54hf856' });
  });

  it('ikinci kapi: semaya elle yazilmis kanonik olmayan satiri kanonik girdi bulsa da 404', async () => {
    const prisma = fakePrisma([{ id: 'S2', userId: 'u1' }]);
    const err = await assertSiteAccess(prisma, owner, 's2').catch((e) => e);
    expect(prisma.site.findUnique).toHaveBeenCalledTimes(1);
    expect(err).toBeInstanceOf(NotFoundException);
    expect(err.message).toBe(SITE_NOT_FOUND_MESSAGE);
  });

  it('onceki kurallar aynen: eksik 400, oturum yok 403, baskasinin sitesi 403, olmayan site 404', async () => {
    const prisma = fakePrisma(SITES);
    await expect(assertSiteAccess(prisma, owner, undefined)).rejects.toBeInstanceOf(BadRequestException);
    await expect(assertSiteAccess(prisma, owner, '  ')).rejects.toBeInstanceOf(BadRequestException);
    await expect(assertSiteAccess(prisma, null, 's1')).rejects.toBeInstanceOf(ForbiddenException);
    await expect(assertSiteAccess(prisma, { id: 'u2', role: 'USER' }, 's1')).rejects.toBeInstanceOf(ForbiddenException);
    await expect(assertSiteAccess(prisma, owner, 'yok')).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('GSC/GA uclari — varyant kimlik ne state\'e ne disconnect\'e gider', () => {
  const SECRET = 'test-secret-for-site-access-spec-0123456789abcdef';
  let backup: string | undefined;
  beforeAll(() => { backup = process.env.NEXTAUTH_SECRET; process.env.NEXTAUTH_SECRET = SECRET; });
  afterAll(() => { if (backup === undefined) delete process.env.NEXTAUTH_SECRET; else process.env.NEXTAUTH_SECRET = backup; });

  function makeController(prisma: any) {
    const svc = () => ({
      buildAuthorizationUrl: vi.fn((state: string) => `https://accounts.google.com/o/oauth2/v2/auth?state=${state}`),
      completeConnection: vi.fn(async (siteId: string) => ({ siteId })),
      disconnect: vi.fn(async () => ({ ok: true })),
    });
    const gsc = svc();
    const ga = svc();
    const ctl = new AuthController({} as any, gsc as any, ga as any, {} as any, prisma, {} as any);
    return { ctl, gsc, ga };
  }
  const reqAs = (user: any) => ({ user, headers: {} }) as any;

  it('start: buyuk harfli kimlik 404, OAuth state yazilmaz', async () => {
    const prisma = fakePrisma(SITES);
    const { ctl, gsc, ga } = makeController(prisma);
    await expect(ctl.startGscOAuth('S1', reqAs(owner))).rejects.toBeInstanceOf(NotFoundException);
    await expect(ctl.startGaOAuth('s1 ', reqAs(owner))).rejects.toBeInstanceOf(NotFoundException);
    expect(gsc.buildAuthorizationUrl).not.toHaveBeenCalled();
    expect(ga.buildAuthorizationUrl).not.toHaveBeenCalled();
    expect(prisma.rows.size).toBe(0);
    // Kanonik kimlikle akis aynen baslar
    await expect(ctl.startGscOAuth('s1', reqAs(owner))).resolves.toHaveProperty('url');
    expect(prisma.rows.size).toBe(1);
  });

  it('disconnect: varyant kimlikle servis cagrilmaz', async () => {
    const prisma = fakePrisma(SITES);
    const { ctl, gsc, ga } = makeController(prisma);
    await expect(ctl.disconnectGsc({ siteId: 'S1' }, reqAs(owner))).rejects.toBeInstanceOf(NotFoundException);
    await expect(ctl.disconnectGa({ siteId: 'CMSQ25BKO005FARSWO54HF856' }, reqAs(owner))).rejects.toBeInstanceOf(NotFoundException);
    expect(gsc.disconnect).not.toHaveBeenCalled();
    expect(ga.disconnect).not.toHaveBeenCalled();
    await expect(ctl.disconnectGsc({ siteId: 's1' }, reqAs(owner))).resolves.toEqual({ ok: true });
    expect(gsc.disconnect).toHaveBeenCalledWith('s1');
  });
});
