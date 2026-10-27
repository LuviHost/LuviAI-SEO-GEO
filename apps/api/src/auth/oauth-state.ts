import { randomBytes } from 'node:crypto';
import { BadRequestException, ForbiddenException, HttpException } from '@nestjs/common';
import { encrypt, decrypt } from '@luviai/shared';
import type { PrismaService } from '../prisma/prisma.service.js';

/**
 * OAuth state — tahmin edilemez, tek kullanimlik, kisa omurlu, sunucuda
 * saklanan nonce. GSC, GA4, Google Ads ve Meta Ads akislari ortak kullanir.
 *
 * NEDEN: GSC/GA akisi state olarak HAM siteId gonderiyordu; @Public callback
 * token'i where:{id: state} ile yaziyordu. siteId tahmin edilebilir oldugu icin
 * saldirgan, sahibi olmadigi bir siteye token yazdirabiliyor ya da kendi
 * baslattigi akisi kurbana tamamlatip kurbanin Google verisini KENDI sitesine
 * baglatabiliyordu. Kural (iki kaynak):
 *   RFC 6749 §10.12 — state tahmin edilemez ve kullanici ajaninin oturumuna bagli olmali
 *     https://www.rfc-editor.org/rfc/rfc6749#section-10.12
 *   RFC 9700 §2.1 — tek kullanimlik, kullanici ajanina guvenle bagli CSRF belirteci
 *     https://www.rfc-editor.org/rfc/rfc9700#section-2.1
 *
 * Kayit: kv_store 'oauth-state:<nonce>' → { userId, siteId, provider, createdAt }.
 * Callback siteId'yi YALNIZCA bu kayittan alir; kayit ilk kullanimda silinir.
 *
 * Kullanici ajanina baglama: callback tarayicinin RanksUp oturumunu okuyabiliyorsa
 * oturum kullanicisi == state kullanicisi sarti aranir. Okuyamiyorsa (API ayri
 * alan adindaysa NextAuth cerezi oraya gitmez) yetkilendirme kodu tek
 * kullanimlik ikinci bir anahtarla 'oauth-pending:' altina PARK edilir ve
 * akis panelde, oturumlu bir istekle tamamlanir (bkz. auth.controller.ts).
 */

export type OAuthProvider = 'gsc' | 'ga' | 'google-ads' | 'meta-ads' | 'gbp';

const PROVIDERS: readonly OAuthProvider[] = ['gsc', 'ga', 'google-ads', 'meta-ads', 'gbp'];

/** RFC 6749 §4.1.2 yetkilendirme kodu icin en fazla 10 dk onerir; state de ayni pencerede yasar. */
export const OAUTH_STATE_TTL_MS = 10 * 60_000;
export const OAUTH_PENDING_TTL_MS = 10 * 60_000;

const STATE_PREFIX = 'oauth-state:';
const PENDING_PREFIX = 'oauth-pending:';
/** 32 bayt → base64url 43 karakter; bicim disi girdi DB'ye hic sorulmaz */
const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;

export type OAuthErrorCode =
  | 'state_invalid'
  | 'state_expired'
  | 'access_denied'
  | 'provider_error'
  | 'session_mismatch'
  | 'site_access_denied'
  | 'scope_not_granted'
  | 'no_refresh_token'
  | 'token_exchange_failed'
  | 'unknown';

export interface OAuthStateRecord {
  userId: string;
  siteId: string;
  provider: OAuthProvider;
  createdAt: string;
}

/** Akis hatasi — `record` yalnizca sunucudaki kayittan gelir (yonlendirme hedefi icin guvenli). */
export class OAuthFlowError extends Error {
  constructor(
    readonly code: OAuthErrorCode,
    readonly record?: OAuthStateRecord,
    detail?: string,
  ) {
    super(detail ? `${code}: ${detail}` : code);
    this.name = 'OAuthFlowError';
  }
}

type KvPrisma = Pick<PrismaService, 'kvStore'>;

function newToken(): string {
  return randomBytes(32).toString('base64url');
}

function parseRecord(raw: string): (OAuthStateRecord & { code?: string }) | null {
  try {
    const v = JSON.parse(raw);
    if (!v || typeof v !== 'object') return null;
    if (typeof v.userId !== 'string' || !v.userId) return null;
    if (typeof v.siteId !== 'string' || !v.siteId) return null;
    if (!PROVIDERS.includes(v.provider)) return null;
    return v;
  } catch {
    return null;
  }
}

/**
 * Satiri oku ve ATOMIK sil. Es zamanli iki istekten yalnizca silmeyi basaran
 * (count === 1) devam eder — ayni state/anahtar ikinci kez kullanilamaz.
 */
async function takeRow(prisma: KvPrisma, key: string) {
  const row = await prisma.kvStore.findUnique({ where: { key } });
  if (!row) return null;
  const del = await prisma.kvStore.deleteMany({ where: { key } });
  if (del.count !== 1) return null;
  return row;
}

function isExpired(row: { expiresAt: Date | null }, createdAt: string | undefined, ttlMs: number, now: number): boolean {
  if (row.expiresAt) return row.expiresAt.getTime() <= now;
  const t = Date.parse(createdAt ?? '');
  return !Number.isFinite(t) || t + ttlMs <= now;
}

/** Terk edilmis akislar birikmesin — en iyi caba, hata akisi bozmaz */
async function sweep(prisma: KvPrisma, prefix: string, now: number) {
  await prisma.kvStore
    .deleteMany({ where: { key: { startsWith: prefix }, expiresAt: { lt: new Date(now) } } })
    .catch(() => undefined);
}

/** Izin akisini baslatirken cagrilir; donen nonce Google/Meta'ya `state` olarak gider. */
export async function issueOAuthState(
  prisma: KvPrisma,
  input: { userId: string; siteId: string; provider: OAuthProvider },
  now: number = Date.now(),
): Promise<string> {
  await sweep(prisma, STATE_PREFIX, now);
  const nonce = newToken();
  const record: OAuthStateRecord = {
    userId: input.userId,
    siteId: input.siteId,
    provider: input.provider,
    createdAt: new Date(now).toISOString(),
  };
  await prisma.kvStore.create({
    data: { key: STATE_PREFIX + nonce, value: JSON.stringify(record), expiresAt: new Date(now + OAUTH_STATE_TTL_MS) },
  });
  return nonce;
}

/**
 * Callback'te state'i tuketir. Bilinmeyen / tekrar kullanilan / baska saglayiciya
 * ait state 'state_invalid', suresi gecmis state 'state_expired' (kayitla) atar.
 * Kayit her durumda silinir: yanlis yere sunulan state de tek kullanimliktir.
 */
export async function consumeOAuthState(
  prisma: KvPrisma,
  state: unknown,
  provider: OAuthProvider,
  now: number = Date.now(),
): Promise<OAuthStateRecord> {
  if (typeof state !== 'string' || !TOKEN_RE.test(state)) throw new OAuthFlowError('state_invalid');
  const row = await takeRow(prisma, STATE_PREFIX + state);
  if (!row) throw new OAuthFlowError('state_invalid');
  const rec = parseRecord(row.value);
  if (!rec) throw new OAuthFlowError('state_invalid');
  const record: OAuthStateRecord = { userId: rec.userId, siteId: rec.siteId, provider: rec.provider, createdAt: rec.createdAt };
  if (record.provider !== provider) throw new OAuthFlowError('state_invalid');
  if (isExpired(row, record.createdAt, OAUTH_STATE_TTL_MS, now)) throw new OAuthFlowError('state_expired', record);
  return record;
}

/**
 * Oturum callback'te okunamadiginda kodu sifreli olarak park eder. Donen
 * anahtar YENI ve rastgeledir: state'i bilen (akisi kendisi baslatan) saldirgan
 * bu anahtari bilemez; yalnizca kodu teslim eden tarayici gorur.
 */
export async function parkAuthorizationCode(
  prisma: KvPrisma,
  record: OAuthStateRecord,
  code: string,
  now: number = Date.now(),
): Promise<string> {
  await sweep(prisma, PENDING_PREFIX, now);
  const key = newToken();
  await prisma.kvStore.create({
    data: {
      key: PENDING_PREFIX + key,
      value: JSON.stringify({ ...record, code: encrypt(code), parkedAt: new Date(now).toISOString() }),
      expiresAt: new Date(now + OAUTH_PENDING_TTL_MS),
    },
  });
  return key;
}

/**
 * Park edilmis kodu tuketir (tek kullanimlik). Oturum kullanicisinin kayitla
 * eslesmesini CAGIRAN dogrular — eslesmese de kayit silinmis olur (kurbanin
 * tarayicisinda acilan saldirgan akisi bir daha kullanilamaz).
 */
export async function consumeParkedCode(
  prisma: KvPrisma,
  key: unknown,
  provider: OAuthProvider,
  now: number = Date.now(),
): Promise<{ record: OAuthStateRecord; code: string }> {
  if (typeof key !== 'string' || !TOKEN_RE.test(key)) throw new OAuthFlowError('state_invalid');
  const row = await takeRow(prisma, PENDING_PREFIX + key);
  if (!row) throw new OAuthFlowError('state_invalid');
  const rec = parseRecord(row.value);
  if (!rec || typeof rec.code !== 'string') throw new OAuthFlowError('state_invalid');
  const record: OAuthStateRecord = { userId: rec.userId, siteId: rec.siteId, provider: rec.provider, createdAt: rec.createdAt };
  if (record.provider !== provider) throw new OAuthFlowError('state_invalid');
  if (isExpired(row, (rec as any).parkedAt, OAUTH_PENDING_TTL_MS, now)) throw new OAuthFlowError('state_expired', record);
  let code: string;
  try {
    code = decrypt(rec.code);
  } catch {
    throw new OAuthFlowError('state_invalid');
  }
  return { record, code };
}

// ────────────────────────────────────────────────────────────
//  Callback / tamamlama kararlari (GSC, GA4, Google Ads, Meta Ads ortak)
// ────────────────────────────────────────────────────────────

export type CallbackOutcome =
  | { kind: 'complete'; record: OAuthStateRecord; code: string }
  | { kind: 'park'; record: OAuthStateRecord; key: string };

/**
 * Saglayicidan donen tarayici yonlendirmesini karara baglar:
 *  - state tuketilir (tek kullanimlik, 10 dk, saglayici eslesmeli)
 *  - `error` (kullanici reddetti) ya da kod yoksa → hata, kayitla
 *  - tarayicinin oturumu VARSA state'i baslatan kullaniciyla ayni olmali;
 *    degilse 'session_mismatch' (saldirganin akisini kurbana tamamlatma)
 *  - oturum YOKSA kod park edilir; panel oturumlu /finish ile tamamlar
 * `sessionUserId` cagirandan gelir (readSessionUserId) — burada istek yok.
 */
export async function resolveOAuthCallback(
  prisma: KvPrisma,
  provider: OAuthProvider,
  q: { code?: unknown; state?: unknown; error?: unknown },
  sessionUserId: string | null,
  now: number = Date.now(),
): Promise<CallbackOutcome> {
  const record = await consumeOAuthState(prisma, q.state, provider, now);
  if (q.error) throw new OAuthFlowError(q.error === 'access_denied' ? 'access_denied' : 'provider_error', record);
  if (typeof q.code !== 'string' || !q.code || q.code.length > 2048) throw new OAuthFlowError('provider_error', record);
  if (sessionUserId && sessionUserId !== record.userId) throw new OAuthFlowError('session_mismatch');
  if (!sessionUserId) {
    return { kind: 'park', record, key: await parkAuthorizationCode(prisma, record, q.code, now) };
  }
  return { kind: 'complete', record, code: q.code };
}

/** Panelin /finish istegi: park edilmis kod + oturum kullanicisi == akisi baslatan kullanici */
export async function resolveParkedFinish(
  prisma: KvPrisma,
  provider: OAuthProvider,
  key: unknown,
  userId: string,
  now: number = Date.now(),
): Promise<{ record: OAuthStateRecord; code: string }> {
  const parked = await consumeParkedCode(prisma, key, provider, now);
  if (parked.record.userId !== userId) throw new OAuthFlowError('session_mismatch');
  return parked;
}

/** /finish cevabi: { code, message } — web toUserMessage `message`i gosterir; ham hata asla */
export function oauthHttpError(err: unknown, provider: OAuthProvider): HttpException {
  const code = oauthErrorCode(err);
  const body = { code, message: oauthErrorMessage(code, provider) };
  return code === 'session_mismatch' || code === 'site_access_denied'
    ? new ForbiddenException(body)
    : new BadRequestException(body);
}

// ────────────────────────────────────────────────────────────
//  Kullaniciya gosterilen metinler
// ────────────────────────────────────────────────────────────

const SCOPE_TEXT: Record<OAuthProvider, string> = {
  gsc: 'Google izin ekranında Search Console erişim kutusunu işaretlemeniz gerekiyor. Bağlantıyı yeniden başlatıp Search Console erişimine izin verin.',
  ga: 'Google izin ekranında Google Analytics erişim kutusunu işaretlemeniz gerekiyor. Bağlantıyı yeniden başlatıp Analytics erişimine izin verin.',
  'google-ads': 'Google izin ekranında Google Ads erişim kutusunu işaretlemeniz gerekiyor. Bağlantıyı yeniden başlatıp Google Ads erişimine izin verin.',
  'meta-ads': 'Meta izin ekranında istenen izinler verilmedi. Bağlantıyı yeniden başlatıp izinleri onaylayın.',
  gbp: 'Google izin ekranında İşletme Profili yönetim iznini işaretlemeniz gerekiyor. Bağlantıyı yeniden başlatıp izin verin.',
};

const ERROR_TEXT: Record<Exclude<OAuthErrorCode, 'scope_not_granted'>, string> = {
  state_invalid: 'Bağlantı isteği geçersiz ya da daha önce kullanılmış. Bağlantıyı panelden yeniden başlatın.',
  state_expired: 'Bağlantı isteğinin süresi doldu (10 dakika). Bağlantıyı panelden yeniden başlatın.',
  access_denied: 'İzin ekranında erişime izin verilmedi. Bağlanmak için yeniden başlatıp izin verin.',
  provider_error: 'Sağlayıcı bağlantıyı tamamlamadı. Lütfen tekrar deneyin.',
  session_mismatch: 'Bağlantıyı başlatan RanksUp hesabı ile bu tarayıcıdaki oturum eşleşmiyor. Aynı hesapla giriş yapıp bağlantıyı yeniden başlatın.',
  site_access_denied: 'Bu siteye erişim yetkiniz yok.',
  no_refresh_token: 'Sağlayıcı kalıcı erişim izni döndürmedi. Hesabınızın güvenlik ayarlarından RanksUp erişimini kaldırıp yeniden bağlanın.',
  token_exchange_failed: 'Sağlayıcıdan erişim anahtarı alınamadı. Lütfen bağlantıyı yeniden başlatın.',
  unknown: 'Bağlantı tamamlanamadı. Lütfen tekrar deneyin.',
};

export function oauthErrorMessage(code: OAuthErrorCode, provider: OAuthProvider): string {
  return code === 'scope_not_granted' ? SCOPE_TEXT[provider] : ERROR_TEXT[code];
}

/** Bilinmeyen hatalari koda indirger — ham mesaj (saglayici govdesi) disari cikmaz */
export function oauthErrorCode(err: unknown): OAuthErrorCode {
  return err instanceof OAuthFlowError ? err.code : 'unknown';
}
