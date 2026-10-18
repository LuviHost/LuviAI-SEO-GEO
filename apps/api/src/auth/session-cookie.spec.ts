import { describe, it, expect } from 'vitest';
import { encode } from 'next-auth/jwt';
import { extractSessionToken, readSessionUserId } from './session-cookie.js';

const SECRET = 'test-secret-session-cookie-spec-0123456789abcdef';

async function token(sub: string, salt: string) {
  return encode({ token: { sub }, secret: SECRET, salt, maxAge: 3600 });
}

describe('extractSessionToken', () => {
  it('cerez adi salt olarak doner; v4 adlari da kabul', () => {
    expect(extractSessionToken({ headers: { cookie: 'a=1; __Secure-authjs.session-token=abc' } } as any))
      .toEqual({ token: 'abc', salt: '__Secure-authjs.session-token' });
    expect(extractSessionToken({ headers: { cookie: 'next-auth.session-token=x%2By' } } as any))
      .toEqual({ token: 'x+y', salt: 'next-auth.session-token' });
  });

  it('Bearer yalniz cookiesOnly kapaliyken (AuthGuard davranisi)', () => {
    const req = { headers: { authorization: 'Bearer tok' } } as any;
    expect(extractSessionToken(req)).toEqual({ token: 'tok', salt: 'authjs.session-token' });
    expect(extractSessionToken(req, { cookiesOnly: true })).toBeNull();
  });

  it('bozuk yuzde-kodlamasi istisna firlatmaz', () => {
    expect(extractSessionToken({ headers: { cookie: 'authjs.session-token=%E0%A4%A' } } as any)).toBeNull();
  });
});

describe('readSessionUserId', () => {
  it('gecerli cerezden kullanici kimligi', async () => {
    const t = await token('u1', '__Secure-authjs.session-token');
    await expect(readSessionUserId({ headers: { cookie: `__Secure-authjs.session-token=${t}` } } as any, SECRET)).resolves.toBe('u1');
  });

  it('yanlis salt / yanlis sir / cerez yok → null (hata firlatmaz)', async () => {
    const t = await token('u1', 'authjs.session-token');
    await expect(readSessionUserId({ headers: { cookie: `__Secure-authjs.session-token=${t}` } } as any, SECRET)).resolves.toBeNull();
    await expect(readSessionUserId({ headers: { cookie: `authjs.session-token=${t}` } } as any, 'baska-sir-0123456789abcdef0123456789')).resolves.toBeNull();
    await expect(readSessionUserId({ headers: {} } as any, SECRET)).resolves.toBeNull();
    await expect(readSessionUserId({ headers: { cookie: `authjs.session-token=${t}` } } as any, '')).resolves.toBeNull();
  });
});
