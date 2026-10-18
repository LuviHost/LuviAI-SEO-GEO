import { BadRequestException } from '@nestjs/common';
import { isIP } from 'node:net';
import { assertResolvesPublic, isBlockedAddress, SafeFetchError } from '../common/safe-fetch.js';

/**
 * Kullanicinin girdigi site adresi / alan adi — kayit ve kontrol aninda denetim.
 *
 * NEDEN VAR: CreateSiteDto yalnizca @IsUrl() ile dogrulaniyordu ve validator.js
 * IP adresini gecerli host sayar (http://169.254.169.254, http://10.0.0.5).
 * Deneme hesabi kart istemedigi icin herkes ic agdaki bir adresi "site" diye
 * kaydedip tarayici, platform tespiti ve URL envanteri isteklerini oraya
 * yonlendirebiliyordu. Anonim ucretsiz kontrol de IP, port ve kimlik bilgili
 * adres kabul ediyordu.
 *
 * Buradaki denetim ERKEN ve ANLASILIR hata icindir. Asil koruma her istekte
 * baglanti anindaki adres denetimidir (common/safe-fetch.ts) — DNS kaydi
 * kayittan sonra degisebilir.
 *
 * Ayristirma WHATWG URL ile yapilir (undici'nin de kullandigi ayristirici):
 * validator.js ile farkli ayristiran bir girdi denetimi atlatmasin.
 */

export type HostProblem =
  | 'empty' | 'invalid' | 'protocol' | 'credentials' | 'port' | 'ip_literal'
  | 'single_label' | 'too_long' | 'blocked_address' | 'dns';

type Messages = Record<HostProblem, string>;

/** Site ekleme / duzenleme formu */
export const SITE_URL_MESSAGES: Messages = {
  empty: 'Site adresi girilmedi.',
  invalid: 'Geçerli bir site adresi girin (ör. https://siteniz.com).',
  protocol: 'Site adresi http:// veya https:// ile başlamalı.',
  credentials: 'Site adresi kullanıcı adı veya parola içeremez.',
  port: 'Site adresinde port belirtilemez; yalnızca standart 80/443 portları desteklenir.',
  ip_literal: 'Site adresi bir alan adı olmalı (ör. siteniz.com); IP adresi kabul edilmiyor.',
  single_label: 'Geçerli bir alan adı girin (ör. siteniz.com).',
  too_long: 'Site adresi çok uzun.',
  blocked_address: 'Bu adres özel veya iç ağ adresine çıkıyor; yalnızca herkese açık siteler eklenebilir.',
  dns: 'Alan adı çözülemedi; adresin doğru yazıldığını ve sitenin yayında olduğunu kontrol edin.',
};

/** Landing'deki ucretsiz AI gorunurluk kontrolu */
export const PUBLIC_DOMAIN_MESSAGES: Messages = {
  empty: 'Alan adı girilmedi.',
  invalid: 'Geçersiz alan adı. Örnek: siteniz.com',
  protocol: 'Yalnızca http veya https adresleri kontrol edilebilir.',
  credentials: 'Alan adı kullanıcı adı veya parola içeremez.',
  port: 'Alan adına port eklemeyin (ör. siteniz.com).',
  ip_literal: 'IP adresi yerine alan adı girin (ör. siteniz.com).',
  single_label: 'Geçersiz alan adı (uzantı eksik). Örnek: siteniz.com',
  too_long: 'Alan adı çok uzun.',
  blocked_address: 'Bu alan adı özel veya iç ağ adresine çıkıyor; yalnızca herkese açık siteler kontrol edilebilir.',
  dns: 'Alan adı çözülemedi; yazımını kontrol edin.',
};

export class HostPolicyError extends BadRequestException {
  constructor(public readonly problem: HostProblem, message: string) {
    super(message);
  }
}

/** Koseli parantez ve sondaki nokta(lar) olmadan host: "[::1]" → "::1", "a.com." → "a.com" */
export function bareHost(u: URL): string {
  return u.hostname.replace(/^\[|\]$/g, '').replace(/\.+$/, '');
}

/**
 * Baglanmadan sekil denetimi. null = sorun yok.
 * Site bir ALAN ADIDIR: IP adresi (genel olsa bile) kabul edilmez.
 */
export function hostProblem(u: URL): HostProblem | null {
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return 'protocol';
  if (u.username || u.password) return 'credentials';
  // WHATWG URL varsayilan portu (80/443) bos birakir; dolu olmasi standart disi port demek
  if (u.port) return 'port';
  const host = bareHost(u);
  if (!host) return 'invalid';
  if (isIP(host)) return isBlockedAddress(host) ? 'blocked_address' : 'ip_literal';
  if (host.length > 253) return 'too_long';
  // "localhost", "intranet" gibi tek etiketli adlar ic aga isaret eder
  if (!host.includes('.')) return 'single_label';
  return null;
}

const SCHEME = /^[a-z][a-z0-9+.-]*:\/\//i;

function parseWith(raw: unknown, messages: Messages, maxLength: number): URL {
  if (typeof raw !== 'string' || !raw.trim()) throw new HostPolicyError('empty', messages.empty);
  const trimmed = raw.trim();
  if (trimmed.length > maxLength) throw new HostPolicyError('too_long', messages.too_long);
  let u: URL;
  try {
    u = new URL(SCHEME.test(trimmed) ? trimmed : `https://${trimmed}`);
  } catch {
    throw new HostPolicyError('invalid', messages.invalid);
  }
  const problem = hostProblem(u);
  if (problem) throw new HostPolicyError(problem, messages[problem]);
  u.hostname = bareHost(u);
  return u;
}

/** Site adresi (sema yoksa https eklenir) — yalnizca sekil, ag yok. */
export function parseSiteUrlInput(raw: unknown): URL {
  return parseWith(raw, SITE_URL_MESSAGES, 2048);
}

export type PublicResolver = (url: string) => Promise<unknown>;

async function resolveOrThrow(u: URL, resolve: PublicResolver, messages: Messages): Promise<void> {
  try {
    await resolve(u.toString());
  } catch (err) {
    const code = err instanceof SafeFetchError ? err.code : 'dns';
    const problem: HostProblem =
      code === 'blocked_address' ? 'blocked_address'
        : code === 'port' ? 'port'
          : code === 'protocol' ? 'protocol'
            : 'dns';
    throw new HostPolicyError(problem, messages[problem]);
  }
}

/**
 * Site kaydi: sekil + alan adinin SIMDI herkese acik bir adrese cozuldugu.
 * resolve yalnizca test icin degistirilir.
 */
export async function assertSiteUrlAllowed(raw: unknown, resolve: PublicResolver = assertResolvesPublic): Promise<URL> {
  const u = parseSiteUrlInput(raw);
  await resolveOrThrow(u, resolve, SITE_URL_MESSAGES);
  return u;
}

export interface PublicDomainInput {
  /** Cekilecek adres — her zaman anasayfa: "https://www.ornek.com/" */
  url: string;
  /** Onbellek / marka anahtari: www'suz, kucuk harf */
  host: string;
}

/**
 * Ucretsiz kontrol alan adi girdisi. Yol, sorgu ve parca atilir: kontrol
 * alan adi icindir ve onbellek de alan adina gore tutulur.
 */
export function normalizePublicDomainInput(input: unknown): PublicDomainInput {
  const u = parseWith(typeof input === 'string' ? input.toLowerCase() : input, PUBLIC_DOMAIN_MESSAGES, 300);
  const hostname = u.hostname;
  if (hostname.length > 200) throw new HostPolicyError('too_long', PUBLIC_DOMAIN_MESSAGES.too_long);
  return { url: `${u.protocol}//${hostname}/`, host: hostname.replace(/^www\./, '') };
}

/** Ucretsiz kontrol: alan adi simdi herkese acik bir adrese mi cozuluyor? */
export async function assertPublicDomainResolves(url: string, resolve: PublicResolver = assertResolvesPublic): Promise<void> {
  await resolveOrThrow(new URL(url), resolve, PUBLIC_DOMAIN_MESSAGES);
}
