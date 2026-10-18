import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';

vi.mock('@luviai/shared', () => ({
  encrypt: (s: string) => `enc:${s}`,
  decrypt: (s: string) => s.replace(/^enc:/, ''),
}));

import { encode } from 'next-auth/jwt';
import { AuthController } from './auth.controller.js';
import { OAuthFlowError } from './oauth-state.js';

const SECRET = 'test-secret-for-oauth-controller-spec-0123456789';
const WEB = 'https://panel.test';

let envBackup: Record<string, string | undefined>;
beforeAll(() => {
  envBackup = { NEXTAUTH_SECRET: process.env.NEXTAUTH_SECRET, AUTH_SECRET: process.env.AUTH_SECRET, WEB_BASE_URL: process.env.WEB_BASE_URL };
  process.env.NEXTAUTH_SECRET = SECRET;
  delete process.env.AUTH_SECRET;
  process.env.WEB_BASE_URL = WEB;
});
afterAll(() => {
  for (const [k, v] of Object.entries(envBackup)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

type SiteRow = { id: string; userId: string };

function fakePrisma(sites: SiteRow[], users: Array<{ id: string; role: string }>) {
  const siteMap = new Map(sites.map((s) => [s.id, { ...s }]));
  const userMap = new Map(users.map((u) => [u.id, u]));
  const rows = new Map<string, { key: string; value: string; expiresAt: Date | null }>();
  return {
    siteMap,
    rows,
    site: {
      async findUnique({ where }: any) { return siteMap.get(where.id) ?? null; },
    },
    user: {
      async findUnique({ where }: any) { return userMap.get(where.id) ?? null; },
    },
    kvStore: {
      async create({ data }: any) { rows.set(data.key, { key: data.key, value: data.value, expiresAt: data.expiresAt ?? null }); return data; },
      async findUnique({ where }: any) { const r = rows.get(where.key); return r ? { ...r } : null; },
      async deleteMany({ where }: any) {
        if (typeof where.key === 'string') return { count: rows.delete(where.key) ? 1 : 0 };
        return { count: 0 };
      },
    },
  } as any;
}

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

function fakeRes() {
  return { redirect: vi.fn(), setHeader: vi.fn() } as any;
}

async function cookieFor(userId: string): Promise<string> {
  const token = await encode({ token: { sub: userId }, secret: SECRET, salt: 'authjs.session-token', maxAge: 3600 });
  return `authjs.session-token=${token}`;
}

const reqAs = (user: any, cookie?: string) => ({ user, headers: cookie ? { cookie } : {} }) as any;

const owner = { id: 'u1', role: 'USER' };
const other = { id: 'u2', role: 'USER' };
const admin = { id: 'a1', role: 'ADMIN' };
const baseSites: SiteRow[] = [{ id: 's1', userId: 'u1' }, { id: 's2', userId: 'u2' }];
const baseUsers = [owner, other, admin];

function stateFrom(url: string): string {
  return new URL(url).searchParams.get('state') ?? '';
}

describe('GSC/GA start + disconnect — site sahipligi', () => {
  it('sahibi olmayan kullanici izin akisi baslatamaz', async () => {
    const { ctl, gsc } = makeController(fakePrisma(baseSites, baseUsers));
    await expect(ctl.startGscOAuth('s1', reqAs(other))).rejects.toBeInstanceOf(ForbiddenException);
    await expect(ctl.startGaOAuth('s1', reqAs(other))).rejects.toBeInstanceOf(ForbiddenException);
    expect(gsc.buildAuthorizationUrl).not.toHaveBeenCalled();
  });

  it('eksik siteId 400, olmayan site 404', async () => {
    const { ctl } = makeController(fakePrisma(baseSites, baseUsers));
    await expect(ctl.startGscOAuth(undefined as any, reqAs(owner))).rejects.toBeInstanceOf(BadRequestException);
    await expect(ctl.startGscOAuth('yok', reqAs(owner))).rejects.toBeInstanceOf(NotFoundException);
  });

  it('sahibi ve ADMIN baslatabilir; state ham siteId degil', async () => {
    const prisma = fakePrisma(baseSites, baseUsers);
    const { ctl } = makeController(prisma);
    const { url } = await ctl.startGscOAuth('s1', reqAs(owner));
    const state = stateFrom(url);
    expect(state).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(state).not.toBe('s1');
    await expect(ctl.startGaOAuth('s2', reqAs(admin))).resolves.toHaveProperty('url');
  });

  it('sahibi olmayan kullanici baglantiyi kesemez', async () => {
    const { ctl, gsc, ga } = makeController(fakePrisma(baseSites, baseUsers));
    await expect(ctl.disconnectGsc({ siteId: 's1' }, reqAs(other))).rejects.toBeInstanceOf(ForbiddenException);
    await expect(ctl.disconnectGa({ siteId: 's1' }, reqAs(other))).rejects.toBeInstanceOf(ForbiddenException);
    expect(gsc.disconnect).not.toHaveBeenCalled();
    expect(ga.disconnect).not.toHaveBeenCalled();
    await expect(ctl.disconnectGsc({ siteId: 's1' }, reqAs(owner))).resolves.toEqual({ ok: true });
    expect(gsc.disconnect).toHaveBeenCalledWith('s1');
  });
});

describe('GSC callback', () => {
  it('ayni oturumla donus tamamlanir; siteId sunucu kaydindan gelir', async () => {
    const prisma = fakePrisma(baseSites, baseUsers);
    const { ctl, gsc } = makeController(prisma);
    const state = stateFrom((await ctl.startGscOAuth('s1', reqAs(owner))).url);
    const res = fakeRes();
    await ctl.gscCallback('code-1', state, undefined, reqAs(undefined, await cookieFor('u1')), res);
    expect(gsc.completeConnection).toHaveBeenCalledWith('s1', 'code-1');
    expect(res.redirect).toHaveBeenCalledWith(`${WEB}/sites/s1/connections?gsc=connected`);
  });

  it('state olarak ham siteId gonderilirse token yazilmaz ve girdi yanki yapilmaz', async () => {
    const { ctl, gsc } = makeController(fakePrisma(baseSites, baseUsers));
    const res = fakeRes();
    await ctl.gscCallback('code-1', 's2', undefined, reqAs(undefined, await cookieFor('u1')), res);
    expect(gsc.completeConnection).not.toHaveBeenCalled();
    const target = res.redirect.mock.calls[0][0] as string;
    expect(target).toBe(`${WEB}/dashboard?gsc=error&gscerror=state_invalid`);
    expect(target).not.toContain('s2');
  });

  it('saldirganin baslattigi akisi kurban tamamlarsa reddedilir', async () => {
    const prisma = fakePrisma(baseSites, baseUsers);
    const { ctl, gsc } = makeController(prisma);
    const attackerState = stateFrom((await ctl.startGscOAuth('s2', reqAs(other))).url);
    const res = fakeRes();
    await ctl.gscCallback('victim-code', attackerState, undefined, reqAs(undefined, await cookieFor('u1')), res);
    expect(gsc.completeConnection).not.toHaveBeenCalled();
    expect(res.redirect).toHaveBeenCalledWith(`${WEB}/dashboard?gsc=error&gscerror=session_mismatch`);
  });

  it('ayni callback ikinci kez islenmez (tekrar)', async () => {
    const prisma = fakePrisma(baseSites, baseUsers);
    const { ctl, gsc } = makeController(prisma);
    const state = stateFrom((await ctl.startGscOAuth('s1', reqAs(owner))).url);
    const cookie = await cookieFor('u1');
    await ctl.gscCallback('c', state, undefined, reqAs(undefined, cookie), fakeRes());
    const res2 = fakeRes();
    await ctl.gscCallback('c', state, undefined, reqAs(undefined, cookie), res2);
    expect(gsc.completeConnection).toHaveBeenCalledTimes(1);
    expect(res2.redirect.mock.calls[0][0]).toContain('gscerror=state_invalid');
  });

  it('kapsam verilmediyse scope_not_granted koduyla Baglantilar sayfasina doner', async () => {
    const prisma = fakePrisma(baseSites, baseUsers);
    const { ctl, gsc } = makeController(prisma);
    gsc.completeConnection.mockRejectedValueOnce(new OAuthFlowError('scope_not_granted'));
    const state = stateFrom((await ctl.startGscOAuth('s1', reqAs(owner))).url);
    const res = fakeRes();
    await ctl.gscCallback('c', state, undefined, reqAs(undefined, await cookieFor('u1')), res);
    expect(res.redirect).toHaveBeenCalledWith(`${WEB}/sites/s1/connections?gsc=error&gscerror=scope_not_granted`);
  });

  it('kullanici izni reddettiyse token degisimi denenmez', async () => {
    const prisma = fakePrisma(baseSites, baseUsers);
    const { ctl, gsc } = makeController(prisma);
    const state = stateFrom((await ctl.startGscOAuth('s1', reqAs(owner))).url);
    const res = fakeRes();
    await ctl.gscCallback(undefined as any, state, 'access_denied', reqAs(undefined, await cookieFor('u1')), res);
    expect(gsc.completeConnection).not.toHaveBeenCalled();
    expect(res.redirect).toHaveBeenCalledWith(`${WEB}/sites/s1/connections?gsc=error&gscerror=access_denied`);
  });

  it('akis sirasinda site devredildiyse token yazilmaz', async () => {
    const prisma = fakePrisma(baseSites, baseUsers);
    const { ctl, gsc } = makeController(prisma);
    const state = stateFrom((await ctl.startGscOAuth('s1', reqAs(owner))).url);
    prisma.siteMap.get('s1').userId = 'u2';
    const res = fakeRes();
    await ctl.gscCallback('c', state, undefined, reqAs(undefined, await cookieFor('u1')), res);
    expect(gsc.completeConnection).not.toHaveBeenCalled();
    expect(res.redirect).toHaveBeenCalledWith(`${WEB}/dashboard?gsc=error&gscerror=site_access_denied`);
  });
});

describe('oturum callback te okunamadiginda: park + panelden tamamlama', () => {
  it('kod park edilir, akisi baslatan kullanici /finish ile tamamlar', async () => {
    const prisma = fakePrisma(baseSites, baseUsers);
    const { ctl, gsc } = makeController(prisma);
    const state = stateFrom((await ctl.startGscOAuth('s1', reqAs(owner))).url);
    const res = fakeRes();
    await ctl.gscCallback('code-9', state, undefined, reqAs(undefined), res);
    expect(gsc.completeConnection).not.toHaveBeenCalled();
    const target = new URL(res.redirect.mock.calls[0][0]);
    expect(target.pathname).toBe('/sites/s1/connections');
    expect(target.searchParams.get('gsc')).toBe('finish');
    const key = target.searchParams.get('k')!;
    expect(key).not.toBe(state);
    await expect(ctl.finishGsc({ key }, reqAs(owner))).resolves.toEqual({ ok: true, siteId: 's1' });
    expect(gsc.completeConnection).toHaveBeenCalledWith('s1', 'code-9');
  });

  it('baska kullanici park edilmis akisi tamamlayamaz (403) ve anahtar yanar', async () => {
    const prisma = fakePrisma(baseSites, baseUsers);
    const { ctl, gsc } = makeController(prisma);
    const state = stateFrom((await ctl.startGscOAuth('s2', reqAs(other))).url);
    const res = fakeRes();
    await ctl.gscCallback('victim-code', state, undefined, reqAs(undefined), res);
    const key = new URL(res.redirect.mock.calls[0][0]).searchParams.get('k')!;
    const err: any = await ctl.finishGsc({ key }, reqAs(owner)).catch((e) => e);
    expect(err).toBeInstanceOf(ForbiddenException);
    expect(err.getResponse()).toMatchObject({ code: 'session_mismatch' });
    expect(gsc.completeConnection).not.toHaveBeenCalled();
    await expect(ctl.finishGsc({ key }, reqAs(other))).rejects.toBeInstanceOf(BadRequestException);
  });

  it('GA ayni kurallar; hata parametresi gaerror', async () => {
    const prisma = fakePrisma(baseSites, baseUsers);
    const { ctl, ga } = makeController(prisma);
    const res = fakeRes();
    await ctl.gaCallback('c', 'not-a-state', undefined, reqAs(undefined), res);
    expect(res.redirect).toHaveBeenCalledWith(`${WEB}/dashboard?ga=error&gaerror=state_invalid`);
    const state = stateFrom((await ctl.startGaOAuth('s1', reqAs(owner))).url);
    const res2 = fakeRes();
    await ctl.gaCallback('c2', state, undefined, reqAs(undefined, await cookieFor('u1')), res2);
    expect(ga.completeConnection).toHaveBeenCalledWith('s1', 'c2');
    expect(res2.redirect).toHaveBeenCalledWith(`${WEB}/sites/s1/connections?ga=connected`);
  });
});
