import type { Request } from 'express';
import { decode } from 'next-auth/jwt';

/**
 * NextAuth oturum cerezi — AuthGuard ve OAuth callback'leri AYNI listeyi okur.
 *
 * NextAuth v5'te cerez adi (`authjs.session-token` veya
 * `__Secure-authjs.session-token`) decode salt'i olarak da kullanilir.
 * Geriye donuk uyum icin v4 adlari (`next-auth.session-token`) de kabul edilir.
 */
export const SESSION_COOKIE_NAMES = [
  'authjs.session-token',
  '__Secure-authjs.session-token',
  'next-auth.session-token',
  '__Secure-next-auth.session-token',
] as const;

/** Bearer branch'inin salt'i — mintSessionToken (auth.controller) ile simetrik */
const BEARER_SALT = 'authjs.session-token';

/**
 * Cookie veya Authorization header'dan token + salt cikartir.
 * `cookiesOnly`: tarayici yonlendirmesi (OAuth callback) icin — orada yalniz
 * tarayicinin kendi cerezi kanittir.
 */
export function extractSessionToken(
  req: Pick<Request, 'headers'>,
  opts: { cookiesOnly?: boolean } = {},
): { token: string; salt: string } | null {
  const authHeader = req.headers?.authorization;
  if (!opts.cookiesOnly && typeof authHeader === 'string' && authHeader.startsWith('Bearer ')) {
    return { token: authHeader.slice(7), salt: BEARER_SALT };
  }

  const cookies = req.headers?.cookie ?? '';
  for (const name of SESSION_COOKIE_NAMES) {
    const re = new RegExp(`(?:^|;\\s*)${name.replace(/[\\^$.*+?()[\]{}|]/g, '\\$&')}=([^;]+)`);
    const m = cookies.match(re);
    if (m) {
      try {
        return { token: decodeURIComponent(m[1]), salt: name };
      } catch {
        return null; // bozuk yuzde-kodlamasi — oturum yok say
      }
    }
  }
  return null;
}

/**
 * Bu tarayicinin RanksUp oturumundaki kullanici kimligi; cerez yoksa, suresi
 * dolmussa ya da cozulemiyorsa null. Hata FIRLATMAZ — callback "oturum yok"
 * durumunu ayrica ele alir (bkz. auth.controller.ts OAuth akisi).
 */
export async function readSessionUserId(
  req: Pick<Request, 'headers'>,
  secret: string = process.env.NEXTAUTH_SECRET ?? process.env.AUTH_SECRET ?? '',
): Promise<string | null> {
  const extracted = extractSessionToken(req, { cookiesOnly: true });
  if (!extracted || !secret) return null;
  try {
    const decoded = await decode({ token: extracted.token, secret, salt: extracted.salt });
    return typeof decoded?.sub === 'string' && decoded.sub ? decoded.sub : null;
  } catch {
    return null;
  }
}
