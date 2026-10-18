import { Logger } from '@nestjs/common';
import { AsaApiClient } from './asa-api.client.js';
import { AsaPlatformClient } from './asa-platform.client.js';
import type { AsaClientDeps, AsaCredentials } from './asa-http.js';
import type { AsaAdsClient, AsaApiVersion } from './asa-types.js';

/**
 * Apple Ads API surum anahtari.
 *
 * Ortam degiskeni (apps/api .env):
 *   ASA_API_VERSION=v5        → Campaign Management API v5 (varsayilan)
 *   ASA_API_VERSION=platform  → Apple Ads Platform API (https://api.ads.apple.com/v1)
 *
 * Gecis tek satirlik env degisikligi + yeniden baslatma. Kimlik bilgileri iki
 * surumde ayni (clientId, teamId, keyId, ozel anahtar — musteri bazinda DB'de);
 * baska env gerekmez. Varsayilan, sahibi gercek kimlik bilgileriyle test edip
 * cevirene kadar v5 kalir.
 *
 * Kapanis tarihi: Apple v5'i 26 Ocak 2027'de kapatiyor.
 *   https://developer.apple.com/documentation/apple_ads/apple-search-ads-campaign-management-api-5
 *   https://developer.apple.com/documentation/apple-ads-platform-api/changelog-apple-ads-platform-api
 */

export const ASA_V5_SUNSET_DATE = '2027-01-26';
/** Bu tarihten itibaren v5 ile calisilirsa her cron kosusunda uyari loglanir. */
export const ASA_V5_WARN_FROM = '2026-12-01';

export function resolveAsaApiVersion(raw: string | undefined): { version: AsaApiVersion; invalid: string | null } {
  const v = (raw ?? '').trim().toLowerCase();
  if (!v || v === 'v5') return { version: 'v5', invalid: null };
  if (v === 'platform') return { version: 'platform', invalid: null };
  // Yazim hatasi uygulamayi dusurmesin; bilinen calisan surumde kal + uyar
  return { version: 'v5', invalid: raw ?? null };
}

/** v5 kapanisina yaklasirken/gectikten sonra operatore gosterilecek uyari; gerek yoksa null. */
export function v5SunsetNotice(version: AsaApiVersion, now: Date = new Date()): string | null {
  if (version !== 'v5') return null;
  const today = now.toISOString().slice(0, 10);
  if (today >= ASA_V5_SUNSET_DATE) {
    return `Apple Ads Campaign Management API v5 ${ASA_V5_SUNSET_DATE} tarihinde kapatıldı; ASA çağrıları başarısız olacak. ASA_API_VERSION=platform yapıp sunucuyu yeniden başlatın.`;
  }
  if (today >= ASA_V5_WARN_FROM) {
    return `Apple Ads Campaign Management API v5 ${ASA_V5_SUNSET_DATE} tarihinde kapanıyor ve sunucu hâlâ v5 kullanıyor. Gerçek kimlik bilgileriyle test edip ASA_API_VERSION=platform yapın.`;
  }
  return null;
}

const log = new Logger('AsaClientFactory');
let warnedInvalid = false;

export function getAsaApiVersion(env: NodeJS.ProcessEnv = process.env): AsaApiVersion {
  const { version, invalid } = resolveAsaApiVersion(env.ASA_API_VERSION);
  if (invalid !== null && !warnedInvalid) {
    warnedInvalid = true;
    log.warn(`ASA_API_VERSION="${invalid}" tanınmadı; v5 kullanılıyor (geçerli değerler: v5 | platform)`);
  }
  return version;
}

export interface CreateAsaClientOptions extends AsaClientDeps {
  version?: AsaApiVersion;
  /** Yalniz Platform: daha once secilmis reklam hesabi */
  adAccountId?: string | null;
  /** Yalniz Platform: reklam hesabi ilk kez cozuldugunde */
  onAdAccountResolved?: (adAccountId: string) => void | Promise<void>;
}

export function createAsaClient(creds: AsaCredentials, opts: CreateAsaClientOptions = {}): AsaAdsClient {
  const { version = getAsaApiVersion(), adAccountId, onAdAccountResolved, ...deps } = opts;
  if (version === 'platform') {
    return new AsaPlatformClient(creds, { ...deps, adAccountId, onAdAccountResolved });
  }
  return new AsaApiClient(creds, deps);
}
