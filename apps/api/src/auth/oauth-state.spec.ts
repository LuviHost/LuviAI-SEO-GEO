import { describe, it, expect, vi } from 'vitest';

// Sifreleme anahtari test ortaminda yok — park edilen kodun sifrelenmesi yalnizca bicim olarak dogrulanir
vi.mock('@luviai/shared', () => ({
  encrypt: (s: string) => `enc:${s}`,
  decrypt: (s: string) => {
    if (!s.startsWith('enc:')) throw new Error('bozuk');
    return s.slice(4);
  },
}));

import {
  issueOAuthState, consumeOAuthState, parkAuthorizationCode, consumeParkedCode,
  resolveOAuthCallback, resolveParkedFinish, oauthHttpError, oauthErrorMessage,
  OAuthFlowError, OAUTH_STATE_TTL_MS, OAUTH_PENDING_TTL_MS,
} from './oauth-state.js';

/** kv_store'un bellek ici esi — deleteMany tek adimda (atomik) uygulanir */
function fakePrisma() {
  const rows = new Map<string, { key: string; value: string; expiresAt: Date | null }>();
  const calls = { findUnique: 0 };
  const kvStore = {
    async create({ data }: any) {
      if (rows.has(data.key)) throw Object.assign(new Error('Unique constraint'), { code: 'P2002' });
      rows.set(data.key, { key: data.key, value: data.value, expiresAt: data.expiresAt ?? null });
      return data;
    },
    async findUnique({ where }: any) {
      calls.findUnique++;
      const r = rows.get(where.key);
      return r ? { ...r } : null;
    },
    async deleteMany({ where }: any) {
      if (typeof where.key === 'string') {
        return rows.delete(where.key) ? { count: 1 } : { count: 0 };
      }
      // sweep: { key: { startsWith }, expiresAt: { lt } }
      let count = 0;
      for (const [k, r] of rows) {
        if (k.startsWith(where.key.startsWith) && r.expiresAt && r.expiresAt < where.expiresAt.lt) {
          rows.delete(k);
          count++;
        }
      }
      return { count };
    },
  };
  return { kvStore, rows, calls } as any;
}

const T0 = Date.parse('2026-10-17T10:00:00.000Z');
const input = { userId: 'u1', siteId: 's1', provider: 'gsc' as const };

async function expectCode(p: Promise<unknown>, code: string) {
  const err: any = await p.then(() => null, (e) => e);
  expect(err, `beklenen kod: ${code}`).toBeInstanceOf(OAuthFlowError);
  expect(err.code).toBe(code);
  return err as OAuthFlowError;
}

describe('issueOAuthState / consumeOAuthState', () => {
  it('state tahmin edilemez nonce — siteId tasimaz, 43 karakter base64url', async () => {
    const prisma = fakePrisma();
    const state = await issueOAuthState(prisma, input, T0);
    expect(state).toMatch(/^[A-Za-z0-9_-]{43}$/);
    // Rastgele base64url nonce'ta kisa bir dize (ör. 's1') tesadufen gecebilir
    // (~%1); siteId'nin state'te tasinmadigini ayirt edici uzun bir kimlikle sina.
    const longSite = 'site-cuid-x7k2p9q4m1';
    const s2 = await issueOAuthState(prisma, { ...input, siteId: longSite }, T0);
    expect(s2).not.toContain(longSite);
    const a = await issueOAuthState(prisma, input, T0);
    expect(a).not.toBe(state);
  });

  it('tuketince kaydi dondurur ve ikinci kullanim reddedilir (tek kullanimlik)', async () => {
    const prisma = fakePrisma();
    const state = await issueOAuthState(prisma, input, T0);
    const rec = await consumeOAuthState(prisma, state, 'gsc', T0 + 1000);
    expect(rec).toMatchObject({ userId: 'u1', siteId: 's1', provider: 'gsc' });
    await expectCode(consumeOAuthState(prisma, state, 'gsc', T0 + 2000), 'state_invalid');
  });

  it('10 dakika sonra state_expired (kayitla) ve kayit yine silinir', async () => {
    const prisma = fakePrisma();
    const state = await issueOAuthState(prisma, input, T0);
    const err = await expectCode(consumeOAuthState(prisma, state, 'gsc', T0 + OAUTH_STATE_TTL_MS + 1), 'state_expired');
    expect(err.record?.siteId).toBe('s1');
    expect(prisma.rows.size).toBe(0);
  });

  it('baska saglayicinin state i reddedilir ve yakilir', async () => {
    const prisma = fakePrisma();
    const state = await issueOAuthState(prisma, input, T0);
    await expectCode(consumeOAuthState(prisma, state, 'ga', T0 + 1000), 'state_invalid');
    // dogru saglayiciyla da artik kullanilamaz
    await expectCode(consumeOAuthState(prisma, state, 'gsc', T0 + 2000), 'state_invalid');
  });

  it('ham siteId ya da bicim disi state DB ye sorulmadan reddedilir', async () => {
    const prisma = fakePrisma();
    for (const bad of ['s1', '', undefined, null, 123, 'x'.repeat(43) + '!', '../../etc']) {
      await expectCode(consumeOAuthState(prisma, bad, 'gsc', T0), 'state_invalid');
    }
    expect(prisma.calls.findUnique).toBe(0);
  });

  it('es zamanli iki callback ten yalniz biri gecer', async () => {
    const prisma = fakePrisma();
    const state = await issueOAuthState(prisma, input, T0);
    const results = await Promise.allSettled([
      consumeOAuthState(prisma, state, 'gsc', T0 + 1),
      consumeOAuthState(prisma, state, 'gsc', T0 + 1),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
  });

  it('suresi gecmis terk edilmis kayitlar yeni akis baslarken temizlenir', async () => {
    const prisma = fakePrisma();
    await issueOAuthState(prisma, input, T0);
    await issueOAuthState(prisma, input, T0 + OAUTH_STATE_TTL_MS + 5000);
    expect(prisma.rows.size).toBe(1);
  });
});

describe('parkAuthorizationCode / consumeParkedCode', () => {
  const record = { userId: 'u1', siteId: 's1', provider: 'gsc' as const, createdAt: new Date(T0).toISOString() };

  it('kod sifreli saklanir, anahtar state ten farkli ve tek kullanimlik', async () => {
    const prisma = fakePrisma();
    const key = await parkAuthorizationCode(prisma, record, 'auth-code-1', T0);
    const stored = [...prisma.rows.values()][0];
    expect(stored.value).not.toContain('"auth-code-1"');
    const out = await consumeParkedCode(prisma, key, 'gsc', T0 + 1000);
    expect(out.code).toBe('auth-code-1');
    expect(out.record.siteId).toBe('s1');
    await expectCode(consumeParkedCode(prisma, key, 'gsc', T0 + 2000), 'state_invalid');
  });

  it('saglayici uyusmazligi ve sure asimi reddedilir', async () => {
    const prisma = fakePrisma();
    const k1 = await parkAuthorizationCode(prisma, record, 'c', T0);
    await expectCode(consumeParkedCode(prisma, k1, 'google-ads', T0 + 1), 'state_invalid');
    const k2 = await parkAuthorizationCode(prisma, record, 'c', T0);
    await expectCode(consumeParkedCode(prisma, k2, 'gsc', T0 + OAUTH_PENDING_TTL_MS + 1), 'state_expired');
  });
});

describe('resolveOAuthCallback — kullanici ajanina baglama', () => {
  it('oturum state i baslatanla ayniysa tamamlanir', async () => {
    const prisma = fakePrisma();
    const state = await issueOAuthState(prisma, input, T0);
    const out = await resolveOAuthCallback(prisma, 'gsc', { code: 'c1', state }, 'u1', T0 + 1);
    expect(out).toMatchObject({ kind: 'complete', code: 'c1', record: { siteId: 's1' } });
  });

  it('BASKA bir oturum (saldirganin akisini tamamlayan kurban) reddedilir', async () => {
    const prisma = fakePrisma();
    const state = await issueOAuthState(prisma, input, T0);
    const err = await expectCode(resolveOAuthCallback(prisma, 'gsc', { code: 'c1', state }, 'victim', T0 + 1), 'session_mismatch');
    // kurbanin tarayicisina siteye yonlendirme hedefi verilmez
    expect(err.record).toBeUndefined();
    expect(prisma.rows.size).toBe(0);
  });

  it('oturum okunamiyorsa kod YENI bir anahtarla park edilir', async () => {
    const prisma = fakePrisma();
    const state = await issueOAuthState(prisma, input, T0);
    const out = await resolveOAuthCallback(prisma, 'gsc', { code: 'c1', state }, null, T0 + 1);
    expect(out.kind).toBe('park');
    if (out.kind !== 'park') return;
    expect(out.key).not.toBe(state);
    const fin = await resolveParkedFinish(prisma, 'gsc', out.key, 'u1', T0 + 2);
    expect(fin.code).toBe('c1');
  });

  it('park edilen akisi baska kullanici tamamlayamaz; anahtar yakilir', async () => {
    const prisma = fakePrisma();
    const state = await issueOAuthState(prisma, input, T0);
    const out = await resolveOAuthCallback(prisma, 'gsc', { code: 'c1', state }, null, T0 + 1);
    if (out.kind !== 'park') throw new Error('park bekleniyordu');
    await expectCode(resolveParkedFinish(prisma, 'gsc', out.key, 'victim', T0 + 2), 'session_mismatch');
    await expectCode(resolveParkedFinish(prisma, 'gsc', out.key, 'u1', T0 + 3), 'state_invalid');
  });

  it('kullanici izin ekraninda reddettiyse access_denied (kayitla), kod beklenmez', async () => {
    const prisma = fakePrisma();
    const state = await issueOAuthState(prisma, input, T0);
    const err = await expectCode(resolveOAuthCallback(prisma, 'gsc', { state, error: 'access_denied' }, 'u1', T0 + 1), 'access_denied');
    expect(err.record?.siteId).toBe('s1');
  });

  it('kod yoksa provider_error', async () => {
    const prisma = fakePrisma();
    const state = await issueOAuthState(prisma, input, T0);
    await expectCode(resolveOAuthCallback(prisma, 'gsc', { state }, 'u1', T0 + 1), 'provider_error');
  });
});

describe('oauthHttpError / mesajlar', () => {
  it('oturum uyusmazligi 403, digerleri 400; govdede yalniz kod + Turkce mesaj', () => {
    const forbidden = oauthHttpError(new OAuthFlowError('session_mismatch'), 'gsc');
    expect(forbidden.getStatus()).toBe(403);
    const bad = oauthHttpError(new OAuthFlowError('scope_not_granted'), 'gsc');
    expect(bad.getStatus()).toBe(400);
    expect(bad.getResponse()).toMatchObject({ code: 'scope_not_granted' });
    expect((bad.getResponse() as any).message).toContain('Search Console erişim kutusunu işaretlemeniz gerekiyor');
  });

  it('beklenmeyen hata ham mesajini sizdirmaz', () => {
    const e = oauthHttpError(new Error('HTTP 400: {"error":"invalid_grant","org":"org-SECRET"}'), 'ga');
    expect(JSON.stringify(e.getResponse())).not.toContain('org-SECRET');
    expect(e.getResponse()).toMatchObject({ code: 'unknown' });
  });

  it('kapsam mesaji saglayiciya gore', () => {
    expect(oauthErrorMessage('scope_not_granted', 'ga')).toContain('Google Analytics erişim kutusunu');
    expect(oauthErrorMessage('scope_not_granted', 'gsc')).toContain('Search Console erişim kutusunu');
  });
});
