import { describe, it, expect, vi, beforeAll, afterAll, afterEach } from 'vitest';
import { generateKeyPairSync } from 'node:crypto';
import { decodeProtectedHeader, importSPKI, jwtVerify } from 'jose';
import { encrypt } from '@luviai/shared';
import {
  AppleSiwaService,
  appleRevokePlan,
  clientSecretClaims,
  normalizePem,
  readAppleSiwaConfig,
} from './apple-siwa.service.js';

const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
const PRIVATE_PEM = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
const PUBLIC_PEM = publicKey.export({ type: 'spki', format: 'pem' }).toString();

const ENV_KEYS = ['APPLE_TEAM_ID', 'APPLE_SIWA_KEY_ID', 'APPLE_SIWA_PRIVATE_KEY', 'APPLE_IOS_BUNDLE_ID'] as const;
const saved: Record<string, string | undefined> = {};

function configure() {
  process.env.APPLE_TEAM_ID = 'TEAM123456';
  process.env.APPLE_SIWA_KEY_ID = 'KEY1234567';
  // .env'de tek satira sigdirilmis bicim
  process.env.APPLE_SIWA_PRIVATE_KEY = PRIVATE_PEM.replace(/\n/g, '\\n');
  process.env.APPLE_IOS_BUNDLE_ID = 'ai.ranksup.app';
}

beforeAll(() => { for (const k of ENV_KEYS) saved[k] = process.env[k]; });
afterEach(() => {
  vi.unstubAllGlobals();
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});
afterAll(() => vi.unstubAllGlobals());

describe('Apple SIWA yapilandirmasi', () => {
  it('tek satirlik PEM gercek satir sonlarina doner', () => {
    expect(normalizePem('-----BEGIN X-----\\nabc\\n-----END X-----\\n')).toBe('-----BEGIN X-----\nabc\n-----END X-----');
  });

  it('dort degiskenden biri eksikse ozellik kapali', () => {
    expect(readAppleSiwaConfig({ APPLE_TEAM_ID: 'T', APPLE_SIWA_KEY_ID: 'K', APPLE_IOS_BUNDLE_ID: 'b' })).toBeNull();
    expect(readAppleSiwaConfig({ APPLE_TEAM_ID: 'T', APPLE_SIWA_KEY_ID: 'K', APPLE_SIWA_PRIVATE_KEY: 'x', APPLE_IOS_BUNDLE_ID: 'b' }))
      .toEqual({ teamId: 'T', keyId: 'K', privateKey: 'x', clientId: 'b' });
  });

  it('client_secret claim\'leri Apple belgesindeki gibi; omur 6 ay sinirinin cok altinda', () => {
    const c = clientSecretClaims({ teamId: 'T', keyId: 'K', privateKey: '', clientId: 'ai.ranksup.app' }, 1_000);
    expect(c).toEqual({ iss: 'T', iat: 1_000, exp: 1_300, aud: 'https://appleid.apple.com', sub: 'ai.ranksup.app' });
    expect(c.exp - c.iat).toBeLessThan(15_777_000);
  });

  it('client_secret ES256 + kid ile imzalanir ve ortak anahtarla dogrulanir', async () => {
    configure();
    const svc = new AppleSiwaService({} as any);
    const jwt = await svc.createClientSecret(new Date('2026-10-18T00:00:00Z'));
    expect(decodeProtectedHeader(jwt)).toEqual({ alg: 'ES256', kid: 'KEY1234567' });
    const { payload } = await jwtVerify(jwt, await importSPKI(PUBLIC_PEM, 'ES256'), {
      issuer: 'TEAM123456', audience: 'https://appleid.apple.com', subject: 'ai.ranksup.app',
      currentDate: new Date('2026-10-18T00:01:00Z'),
    });
    expect(payload.exp! - payload.iat!).toBe(300);
  });
});

describe('Apple token iptal plani', () => {
  it('Apple girisi yoksa hicbir sey denenmez; anahtar yoksa yapilandirma eksik', () => {
    expect(appleRevokePlan({ linked: false, configured: true, storedTokens: 1, hasCode: true })).toBe('not_linked');
    expect(appleRevokePlan({ linked: true, configured: false, storedTokens: 1, hasCode: true })).toBe('not_configured');
  });
  it('once saklanan token, yoksa taze kod; ikisi de yoksa token yok', () => {
    expect(appleRevokePlan({ linked: true, configured: true, storedTokens: 1, hasCode: false })).toBe('stored_then_code');
    expect(appleRevokePlan({ linked: true, configured: true, storedTokens: 0, hasCode: true })).toBe('code');
    expect(appleRevokePlan({ linked: true, configured: true, storedTokens: 0, hasCode: false })).toBe('no_token');
  });
});

describe('Apple token iptali (ag sahte)', () => {
  it('saklanan refresh token /auth/revoke ile iptal edilir', async () => {
    configure();
    const fetchMock = vi.fn(async () => new Response('', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const svc = new AppleSiwaService({} as any);
    const out = await svc.revokeForDeletion({ appleSubs: ['sub-1'], storedTokens: [encrypt('rt-123')] });
    expect(out).toBe('revoked');
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://appleid.apple.com/auth/revoke');
    const body = new URLSearchParams(String(init.body));
    expect(body.get('token')).toBe('rt-123');
    expect(body.get('token_type_hint')).toBe('refresh_token');
    expect(body.get('client_id')).toBe('ai.ranksup.app');
    expect(body.get('client_secret')).toMatch(/^ey/);
  });

  it('yapilandirma yoksa ag cagrisi yapilmaz, silme yine de surer', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const svc = new AppleSiwaService({} as any);
    expect(await svc.revokeForDeletion({ appleSubs: ['sub-1'], storedTokens: [], code: 'c' })).toBe('not_configured');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('kod takasi basarisizsa sonuc failed (hata firlatmaz)', async () => {
    configure();
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: 'invalid_grant' }), { status: 400 })));
    const svc = new AppleSiwaService({} as any);
    expect(await svc.revokeForDeletion({ appleSubs: ['sub-1'], storedTokens: [], code: 'expired' })).toBe('failed');
  });

  it('giriste kod baska Apple kimligine aitse refresh token saklanmaz', async () => {
    configure();
    const prisma = { account: { updateMany: vi.fn() } };
    const svc = new AppleSiwaService(prisma as any);
    vi.spyOn(svc, 'exchangeCode').mockResolvedValue({ refreshToken: 'rt', accessToken: 'at', sub: 'baska-sub' });
    expect(await svc.captureRefreshToken('sub-1', 'code')).toBe(false);
    expect(prisma.account.updateMany).not.toHaveBeenCalled();
  });

  it('giriste refresh token SIFRELI saklanir', async () => {
    configure();
    const prisma = { account: { updateMany: vi.fn(async () => ({ count: 1 })) } };
    const svc = new AppleSiwaService(prisma as any);
    vi.spyOn(svc, 'exchangeCode').mockResolvedValue({ refreshToken: 'rt-plain', accessToken: 'at', sub: 'sub-1' });
    expect(await svc.captureRefreshToken('sub-1', 'code')).toBe(true);
    const arg = (prisma.account.updateMany.mock.calls[0] as any[])[0];
    expect(arg.where).toEqual({ provider: 'apple', providerAccountId: 'sub-1' });
    expect(arg.data.refresh_token).not.toContain('rt-plain');
    expect(arg.data.refresh_token.split(':')).toHaveLength(3);
  });
});
