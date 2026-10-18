import { Injectable, Logger } from '@nestjs/common';
import { createRemoteJWKSet, importPKCS8, jwtVerify, SignJWT } from 'jose';
import { encrypt, decrypt } from '@luviai/shared';
import { PrismaService } from '../prisma/prisma.service.js';

/**
 * Sign in with Apple REST API — yetki kodu takasi ve token iptali.
 *
 * NEDEN: Apple hesap silmede SIWA token'larinin iptalini bekler
 * ("Apps that support Sign in with Apple should use the Sign in with Apple
 * REST API to revoke user tokens" —
 * https://developer.apple.com/support/offering-account-deletion-in-your-app/).
 * Iptal icin gecerli bir refresh ya da access token sart
 * (https://developer.apple.com/documentation/sign_in_with_apple/revoke_tokens);
 * token yalnizca yetki kodunun /auth/token ile takasindan cikar
 * (https://developer.apple.com/documentation/sign_in_with_apple/generate_and_validate_tokens).
 * TN3194 onerisi: giriste kodu takas edip refresh token'i sakla, silmede iptal et
 * (https://developer.apple.com/documentation/technotes/tn3194-handling-account-deletions-and-revoking-tokens-for-sign-in-with-apple).
 *
 * Iki yol:
 *  1. Giris: mobil `authorizationCode` gonderirse takas edilir, refresh token
 *     Account.refresh_token'a SIFRELI yazilir (giris bu yuzden asla bozulmaz).
 *  2. Silme: saklanan token iptal edilir; yoksa uygulamanin silme aninda
 *     aldigi taze kod takas edilip iptal edilir.
 *
 * Yapilandirma eksikse (APPLE_TEAM_ID / APPLE_SIWA_KEY_ID / APPLE_SIWA_PRIVATE_KEY /
 * APPLE_IOS_BUNDLE_ID) ozellik kapali kalir; hesap silme yine tamamlanir —
 * TN3194: token yoksa da silme talebi yerine getirilmeli.
 */

const APPLE_ISSUER = 'https://appleid.apple.com';
const TOKEN_URL = 'https://appleid.apple.com/auth/token';
const REVOKE_URL = 'https://appleid.apple.com/auth/revoke';
const APPLE_JWKS = createRemoteJWKSet(new URL('https://appleid.apple.com/auth/keys'));
const HTTP_TIMEOUT_MS = 10_000;
/** client_secret her istekte yeniden uretilir; Apple ust siniri 6 ay, kisa omur yeterli */
const CLIENT_SECRET_TTL_SEC = 300;

export interface AppleSiwaConfig {
  teamId: string;
  keyId: string;
  privateKey: string;
  /** Native uygulamada client_id = bundle ID (yetki kodu o istemciye verilir) */
  clientId: string;
}

/** .env'de tek satira sigdirilmis PEM'deki "\n" kacislari gercek satir sonuna doner */
export function normalizePem(raw: string): string {
  return raw.replace(/\\n/g, '\n').trim();
}

export function readAppleSiwaConfig(env: NodeJS.ProcessEnv = process.env): AppleSiwaConfig | null {
  const teamId = env.APPLE_TEAM_ID?.trim();
  const keyId = env.APPLE_SIWA_KEY_ID?.trim();
  const rawKey = env.APPLE_SIWA_PRIVATE_KEY;
  const clientId = env.APPLE_IOS_BUNDLE_ID?.trim();
  if (!teamId || !keyId || !rawKey?.trim() || !clientId) return null;
  return { teamId, keyId, privateKey: normalizePem(rawKey), clientId };
}

/**
 * client_secret JWT claim'leri — iss=Team ID, sub=client_id, aud=Apple, ES256 + kid
 * (https://developer.apple.com/documentation/accountorganizationaldatasharing/creating-a-client-secret).
 */
export function clientSecretClaims(cfg: AppleSiwaConfig, nowSec: number) {
  return { iss: cfg.teamId, iat: nowSec, exp: nowSec + CLIENT_SECRET_TTL_SEC, aud: APPLE_ISSUER, sub: cfg.clientId };
}

export type AppleRevokeOutcome =
  /** Hesapta Apple girisi yok — yapilacak bir sey yok */
  | 'not_linked'
  /** Sunucuda SIWA anahtari tanimli degil */
  | 'not_configured'
  | 'revoked'
  /** Ne saklanan token ne taze kod var (eski giris + web'den silme) */
  | 'no_token'
  | 'failed';

export type AppleRevokePlan = 'not_linked' | 'not_configured' | 'stored_then_code' | 'code' | 'no_token';

/** Hangi yolla iptal denenecek — saf karar (testli). */
export function appleRevokePlan(i: { linked: boolean; configured: boolean; storedTokens: number; hasCode: boolean }): AppleRevokePlan {
  if (!i.linked) return 'not_linked';
  if (!i.configured) return 'not_configured';
  if (i.storedTokens > 0) return 'stored_then_code';
  if (i.hasCode) return 'code';
  return 'no_token';
}

export interface AppleTokenExchange {
  refreshToken: string | null;
  accessToken: string | null;
  /** Dogrulanmis id_token'daki Apple kullanici kimligi */
  sub: string | null;
}

@Injectable()
export class AppleSiwaService {
  private readonly log = new Logger(AppleSiwaService.name);

  constructor(private readonly prisma: PrismaService) {}

  private config(): AppleSiwaConfig | null {
    return readAppleSiwaConfig();
  }

  get configured(): boolean {
    return this.config() !== null;
  }

  async createClientSecret(now: Date = new Date()): Promise<string> {
    const cfg = this.config();
    if (!cfg) throw new Error('Apple SIWA yapilandirilmamis');
    const key = await importPKCS8(cfg.privateKey, 'ES256');
    const nowSec = Math.floor(now.getTime() / 1000);
    const c = clientSecretClaims(cfg, nowSec);
    return new SignJWT({})
      .setProtectedHeader({ alg: 'ES256', kid: cfg.keyId })
      .setIssuer(c.iss)
      .setIssuedAt(c.iat)
      .setExpirationTime(c.exp)
      .setAudience(c.aud)
      .setSubject(c.sub)
      .sign(key);
  }

  /** Yetki kodunu token'a cevirir. Kod tek kullanimlik ve 5 dk gecerli (Apple). */
  async exchangeCode(code: string): Promise<AppleTokenExchange | null> {
    const cfg = this.config();
    if (!cfg) return null;
    const body = new URLSearchParams({
      client_id: cfg.clientId,
      client_secret: await this.createClientSecret(),
      code,
      grant_type: 'authorization_code',
    });
    const res = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
      signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
    });
    const data: any = await res.json().catch(() => ({}));
    if (!res.ok) {
      // Apple hata govdesi yalniz kod tasir (invalid_grant vb.) — kullaniciya sizdirilmaz
      this.log.warn(`Apple kod takasi HTTP ${res.status}: ${String(data?.error ?? '').slice(0, 60)}`);
      return null;
    }
    let sub: string | null = null;
    if (typeof data?.id_token === 'string') {
      try {
        const { payload } = await jwtVerify(data.id_token, APPLE_JWKS, { issuer: APPLE_ISSUER, audience: cfg.clientId });
        sub = typeof payload.sub === 'string' ? payload.sub : null;
      } catch {
        sub = null;
      }
    }
    return {
      refreshToken: typeof data?.refresh_token === 'string' ? data.refresh_token : null,
      accessToken: typeof data?.access_token === 'string' ? data.access_token : null,
      sub,
    };
  }

  /** 200 = iptal edildi ya da zaten gecersizdi (Apple dokumani). */
  async revoke(token: string, hint: 'refresh_token' | 'access_token'): Promise<boolean> {
    const cfg = this.config();
    if (!cfg) return false;
    const body = new URLSearchParams({
      client_id: cfg.clientId,
      client_secret: await this.createClientSecret(),
      token,
      token_type_hint: hint,
    });
    const res = await fetch(REVOKE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
      signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
    });
    if (!res.ok) this.log.warn(`Apple token iptali HTTP ${res.status}`);
    return res.ok;
  }

  /**
   * Giriste gelen yetki kodundan refresh token'i saklar. HATA FIRLATMAZ:
   * giris bu adim yuzunden bozulmamali; basarisizsa silme aninda taze kod yolu kalir.
   */
  async captureRefreshToken(appleSub: string, code: string | undefined): Promise<boolean> {
    if (!code || !this.configured) return false;
    try {
      const t = await this.exchangeCode(code);
      // Kod baska bir Apple kimligine aitse saklanmaz
      if (!t?.refreshToken || t.sub !== appleSub) return false;
      const updated = await this.prisma.account.updateMany({
        where: { provider: 'apple', providerAccountId: appleSub },
        data: { refresh_token: encrypt(t.refreshToken) },
      });
      return updated.count > 0;
    } catch (err: any) {
      this.log.warn(`Apple refresh token saklanamadi: ${String(err?.message ?? err).slice(0, 120)}`);
      return false;
    }
  }

  /**
   * Hesap silmede Apple token iptali. HATA FIRLATMAZ — sonuc kullaniciya
   * dogru bilgi vermek icin doner (iptal edilemediyse elle kaldirma adimi gosterilir).
   *
   * @param appleSubs hesaba bagli Apple kimlikleri (Account.providerAccountId)
   * @param storedTokens Account.refresh_token'daki sifreli degerler
   * @param code uygulamanin silme aninda aldigi taze yetki kodu (opsiyonel)
   */
  async revokeForDeletion(input: { appleSubs: string[]; storedTokens: string[]; code?: string | null }): Promise<AppleRevokeOutcome> {
    const plan = appleRevokePlan({
      linked: input.appleSubs.length > 0,
      configured: this.configured,
      storedTokens: input.storedTokens.length,
      hasCode: !!input.code,
    });
    if (plan === 'not_linked' || plan === 'not_configured' || plan === 'no_token') return plan;

    try {
      if (plan === 'stored_then_code') {
        for (const enc of input.storedTokens) {
          let token: string;
          try {
            token = decrypt(enc);
          } catch {
            continue; // bozuk/eski kayit — diger yola dus
          }
          if (await this.revoke(token, 'refresh_token')) return 'revoked';
        }
        if (!input.code) return 'failed';
      }
      const t = await this.exchangeCode(input.code!);
      if (!t || !t.sub || !input.appleSubs.includes(t.sub)) return 'failed';
      if (t.refreshToken && (await this.revoke(t.refreshToken, 'refresh_token'))) return 'revoked';
      if (t.accessToken && (await this.revoke(t.accessToken, 'access_token'))) return 'revoked';
      return 'failed';
    } catch (err: any) {
      this.log.warn(`Apple token iptali basarisiz: ${String(err?.message ?? err).slice(0, 120)}`);
      return 'failed';
    }
  }
}
