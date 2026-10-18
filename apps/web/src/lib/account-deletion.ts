/**
 * Hesap silme istemcisi — API: apps/api/src/me/me.controller.ts.
 *
 * lib/api.ts'ten ayri tutuldu (o dosya baska is akisinda). Oturum cerezi
 * `credentials: 'include'` ile gider; uclar API anahtarini kabul etmez
 * (@SessionOnly), hesap silmek panelde verilen insan karari.
 */
const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

/** Sunucu bu degeri acikca bekler (account-deletion.policy.ts DELETE_ACCOUNT_CONFIRMATION) */
export const DELETE_ACCOUNT_CONFIRMATION = 'DELETE_MY_ACCOUNT';

export interface AccountDeletionBlocker {
  code: 'agency_has_clients' | 'admin_account';
  message: string;
  clientCount?: number;
}

export interface AccountDeletionStatus {
  /**
   * Silinecek hesabin kimligi ("a***@gmail.com"; account-deletion.policy.ts
   * maskEmail). Farkli bir Google hesabiyla girilince sessizce yeni, bos bir
   * hesap acilir; ekran hangi hesabin silinecegini gostermeli. Eski API'de yok.
   */
  maskedEmail?: string | null;
  /** Hesaba bagli site sayisi (bos hesabi gercek hesaptan ayirt etmek icin) */
  siteCount?: number;
  purgeAfterDays: number;
  blockers: AccountDeletionBlocker[];
  subscriptionActive: boolean;
  plan: string;
  signInProviders: string[];
  apple: { linked: boolean; configured: boolean; tokenStored: boolean };
}

export type AppleRevokeOutcome = 'not_linked' | 'not_configured' | 'revoked' | 'no_token' | 'failed';

export interface AccountDeletionResult {
  ok: true;
  alreadyRequested: boolean;
  deletionRequestedAt: string;
  purgeAfter: string;
  purgeAfterDays: number;
  apple: AppleRevokeOutcome | null;
}

export class AccountDeletionError extends Error {
  constructor(message: string, public readonly status: number, public readonly code?: string) {
    super(message);
    this.name = 'AccountDeletionError';
  }
}

async function call<T>(path: string, init: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE}/api${path}`, {
      ...init,
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', ...init.headers },
    });
  } catch {
    throw new AccountDeletionError('Bağlantı kurulamadı. İnternet bağlantını kontrol et.', 0);
  }
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    const message = typeof body?.message === 'string' && body.message ? body.message : `İşlem tamamlanamadı (${res.status}).`;
    throw new AccountDeletionError(message, res.status, typeof body?.code === 'string' ? body.code : undefined);
  }
  return body as T;
}

export function getAccountDeletionStatus(): Promise<AccountDeletionStatus> {
  return call('/me/account-deletion', { method: 'GET' });
}

export function requestAccountDeletion(): Promise<AccountDeletionResult> {
  return call('/me/delete-account', { method: 'POST', body: JSON.stringify({ confirm: DELETE_ACCOUNT_CONFIRMATION }) });
}

/** Ajans sahibi: musteri hesaplarini ajanstan ayirir (hesaplar ve verileri silinmez) */
export function detachAgencyClients(): Promise<{ detached: number }> {
  return call('/me/agency-clients/detach', { method: 'POST', body: JSON.stringify({ confirm: true }) });
}

/** Apple ile Giriş bağlantısı sunucuda kapatılamadıysa kullanıcıya elle kaldırma adımı gösterilir */
export function appleNeedsManualRemoval(status: AccountDeletionStatus | null, outcome: AppleRevokeOutcome | null): boolean {
  if (!status?.apple.linked) return false;
  if (outcome) return outcome !== 'revoked' && outcome !== 'not_linked';
  return !(status.apple.configured && status.apple.tokenStored);
}

export function formatTrDate(iso: string): string {
  return new Date(iso).toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Istanbul' });
}
