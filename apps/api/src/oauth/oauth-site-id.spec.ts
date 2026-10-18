import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { ForbiddenException, NotFoundException } from '@nestjs/common';

vi.mock('@luviai/shared', () => ({
  encrypt: (s: string) => `enc:${s}`,
  decrypt: (s: string) => s.replace(/^enc:/, ''),
}));

import { OAuthService } from './oauth.service.js';
import { OAuthController } from './oauth.controller.js';
import { SITE_NOT_FOUND_MESSAGE } from '../auth/site-access.guard.js';

/**
 * Reklam hesabi OAuth uclari — sorgudaki siteId KANONIK olmali (common/site-id.ts).
 *
 * NEDEN VAR: assertSiteOwnership findFirst({ id, userId }) ile bakiyordu;
 * utf8mb4_unicode_ci harmanlamasi 'S1' ya da 's1 ' yazimini ayni satira esler.
 * Handler'lar sonra HAM parametreyi kullaniyor: start onu OAuth state kaydina
 * (callback token'i bu kimlikle yazar, yonlendirme yolu bunu tasir), select
 * ve options sorgularina yaziyordu. Sahte DB harmanlamayi taklit eder.
 */

const collate = (s: string) => s.replace(/ +$/, '').toLowerCase();

function fakePrisma(sites: Array<{ id: string; userId: string }>) {
  const rows = new Map<string, any>();
  return {
    rows,
    user: { findUnique: vi.fn(async () => ({ deletionRequestedAt: null })) },
    site: {
      findFirst: vi.fn(async ({ where }: any) => {
        const s = sites.find((x) => collate(x.id) === collate(String(where.id)) && x.userId === where.userId);
        return s ? { id: s.id } : null;
      }),
      findUniqueOrThrow: vi.fn(async ({ where }: any) => ({ id: where.id, googleAdsRefreshToken: null, metaAdsAccessToken: null })),
      update: vi.fn(async ({ where, data }: any) => ({ id: where.id, ...data })),
    },
    kvStore: {
      async create({ data }: any) { rows.set(data.key, { ...data, expiresAt: data.expiresAt ?? null }); return data; },
      async findUnique({ where }: any) { const r = rows.get(where.key); return r ? { ...r } : null; },
      async deleteMany({ where }: any) { return { count: typeof where.key === 'string' && rows.delete(where.key) ? 1 : 0 }; },
    },
  } as any;
}

const ENV_KEYS = ['NEXTAUTH_SECRET', 'AUTH_SECRET', 'WEB_BASE_URL', 'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'META_APP_ID', 'META_APP_SECRET'];
let envBackup: Record<string, string | undefined> = {};
beforeAll(() => {
  envBackup = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  process.env.NEXTAUTH_SECRET = 'test-secret-for-oauth-site-id-spec-0123456789';
  delete process.env.AUTH_SECRET;
  process.env.WEB_BASE_URL = 'https://panel.test';
  process.env.GOOGLE_CLIENT_ID = 'cid';
  process.env.GOOGLE_CLIENT_SECRET = 'csecret';
  process.env.META_APP_ID = 'mid';
  process.env.META_APP_SECRET = 'msecret';
});
afterAll(() => {
  for (const [k, v] of Object.entries(envBackup)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

const reqAs = (user: any) => ({ user, headers: {} }) as any;
const U1 = reqAs({ id: 'u1' });

function setup(sites = [{ id: 's1', userId: 'u1' }, { id: 's2', userId: 'u2' }]) {
  const prisma = fakePrisma(sites);
  const ctl = new OAuthController(prisma, new OAuthService());
  return { prisma, ctl };
}

async function notFound(p: Promise<unknown>) {
  const err: any = await p.catch((e) => e);
  expect(err).toBeInstanceOf(NotFoundException);
  expect(err.message).toBe(SITE_NOT_FOUND_MESSAGE);
}

describe('OAuth reklam uclari — varyant siteId reddedilir', () => {
  it('start: buyuk harf / sonu bosluk 404; state kaydi yazilmaz, DB sorgusu yok', async () => {
    const { ctl, prisma } = setup();
    await notFound(ctl.startGoogleAds('S1', U1));
    await notFound(ctl.startMetaAds('s1 ', U1));
    expect(prisma.rows.size).toBe(0);
    expect(prisma.site.findFirst).not.toHaveBeenCalled();
    // Kanonik kimlikle akis aynen
    await expect(ctl.startGoogleAds('s1', U1)).resolves.toHaveProperty('url');
    expect(prisma.rows.size).toBe(1);
    expect([...prisma.rows.values()][0].value).toContain('"siteId":"s1"');
  });

  it('select: varyant kimlikle siteye yazim yok', async () => {
    const { ctl, prisma } = setup();
    await notFound(ctl.selectGoogleAds('S1', { customerId: '1234567890' } as any, U1));
    await notFound(ctl.selectMetaAds('S1', { adAccountId: 'act_1' } as any, U1));
    expect(prisma.site.update).not.toHaveBeenCalled();
    await expect(ctl.selectGoogleAds('s1', { customerId: '1234567890' } as any, U1)).resolves.toEqual({ ok: true });
    expect(prisma.site.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 's1' } }));
  });

  it('options: varyant kimlikle site okunmaz', async () => {
    const { ctl, prisma } = setup();
    await notFound(ctl.optionsGoogleAds('S1', U1));
    await notFound(ctl.optionsMetaAds('S1', U1));
    expect(prisma.site.findUniqueOrThrow).not.toHaveBeenCalled();
  });

  it('ikinci kapi: elle yazilmis kanonik olmayan satiri kanonik girdi bulsa da 404', async () => {
    const { ctl, prisma } = setup([{ id: 'S3', userId: 'u1' }]);
    await notFound(ctl.startGoogleAds('s3', U1));
    expect(prisma.site.findFirst).toHaveBeenCalledTimes(1);
    expect(prisma.rows.size).toBe(0);
  });

  it('sahiplik kurali aynen: baskasinin sitesi 403 (Turkce metin)', async () => {
    const { ctl } = setup();
    const err: any = await ctl.startGoogleAds('s2', U1).catch((e) => e);
    expect(err).toBeInstanceOf(ForbiddenException);
    expect(err.message).toBe('Site sana ait değil');
  });
});
