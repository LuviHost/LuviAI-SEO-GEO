import { BadRequestException } from '@nestjs/common';
import { isIP } from 'node:net';
import { assertResolvesPublic, isBlockedAddress, SafeFetchError } from '../common/safe-fetch.js';
import { catalogFieldLabel } from './publish-target-catalog.js';

/**
 * Yayin hedefi adresleri — kayit, baglanti testi ve yayin oncesi denetim.
 *
 * NEDEN VAR: CMS adaptorleri (packages/adapters) HTTP / FTP / SSH ile
 * kullanicinin girdigi adrese baglanir. "Site URL" alanina
 * http://169.254.169.254/ ya da http://127.0.0.1:3001/ yazan biri sunucumuzu
 * ic aga istek atmaya (yayin, test, kok dosya yukleme) zorlayabiliyordu.
 * Bu dosyadaki denetim kayitta (erken, anlasilir hata) ve her adaptor
 * olusturulmadan HEMEN ONCE calisir (DNS kayittan sonra degisebilir).
 *
 * ASIL KORUMA BAGLANTIDA (adapter-egress.ts, PublishTargetsModule acilista
 * kaydeder): buradaki denetim yalniz KAYITLI adresin o an nereye cozuldugune
 * bakar. Yonlendirme zamanlama gerektirmez — denetimi gecen site istegi
 * 127.0.0.1:3001'e yonlendirebilirdi; DNS de denetimden sonra degisebilir.
 * Adaptorlerin HTTP istekleri artik korumali fetch'ten gecer: her baglanti
 * baglanti aninda denetlenir (rebinding yok), yonlendirmeler elle izlenir ve
 * her adim bastan denetlenir, govde baska kokene tasinmaz, hata metinleri
 * kisa ve adres maskeli. FTP/SFTP adi once cozer, denetler ve DENETLENEN IP'ye
 * baglanir; FTP veri baglantisi (PASV) de kontrol adresine gider.
 *
 * KALAN RISK:
 *  - Kayit yalniz Nest uygulamasi kurulunca yapilir (API + worker). Adaptoru
 *    Nest disinda (betik) kullanan kod eski davranisa duser: global fetch,
 *    yonlendirme denetimsiz, FTP/SFTP'de DNS baglanti aninda. packages/adapters
 *    derlemesi (dist) deploy'da eski kalirsa da kayit yapilamaz; acilista
 *    "[AdapterEgress] ... KAYDEDILEMEDI" hatasi loglanir.
 *  - SDK kullanan hedefler (GitHub/Octokit, Sanity, Contentful) kendi HTTP
 *    istemcileriyle sabit, herkese acik API'lere gider (api.github.com,
 *    <projectId>.api.sanity.io — @sanity/client 7.22 projectId'yi
 *    /^[-a-z0-9]+$/i ile sinirlar (dist/_chunks-es/config.js), adaptor apiHost
 *    vermez; api.contentful.com); korumali fetch'ten gecmezler.
 *  - FTP/SFTP'de baglanilan IP denetlenir ama SSH sunucu anahtari
 *    dogrulanmaz (adaptor hostVerifier kullanmiyor) — SSRF degil, MITM riski.
 *
 * PORT: kisitlanmaz. Hedef musterinin kendi altyapisi ve standart disi port
 * olagan (cPanel 2083, Strapi 1337, Ghost 2368). Asil tehlike ic adresler; o
 * reddedilir. Tehlikeli portlari (25, 110, 6000...) fetch zaten reddeder:
 * https://fetch.spec.whatwg.org/#port-blocking (Node/undici "bad port").
 */

/**
 * Adaptorlerin istek attigi URL alanlari (credentials) → GENEL etiket.
 *
 * Hata metnindeki etiket once hedef tipinin katalogdaki form etiketidir
 * (fieldLabel): ayni `baseUrl` Strapi formunda 'Strapi URL', WHMCS'te
 * 'WHMCS URL', KobiPratik'te 'Base URL'. Eskiden hepsine 'Base URL'
 * yaziliyordu; kullanici formda olmayan bir alan adi goruyordu. Buradaki
 * deger yalniz katalogda karsiligi olmayan tip/alan icin yedektir.
 */
const CREDENTIAL_URL_FIELDS: Record<string, string> = {
  siteUrl: 'Site URL',
  apiUrl: 'API URL',
  baseUrl: 'Base URL',
  endpointUrl: 'Endpoint URL',
  strapiUrl: 'Strapi URL',
  whmcsUrl: 'WHMCS URL',
  cpanelUrl: 'cPanel host',
};

/** Yayin sonrasi uretilen genel adres — dogrulama/ping icin istek atilabilir */
const CONFIG_URL_FIELDS: Record<string, string> = {
  publicBaseUrl: 'Public site URL',
};

/** Ad (URL degil) bekleyen alanlar */
const HOSTNAME_FIELDS: Record<string, string> = {
  storeDomain: 'Mağaza alan adı',
};

/** Formdaki etiket (eski ad katalog adina cevrilir), yoksa genel etiket */
function fieldLabel(type: string, key: string, fallback: string, section: 'fields' | 'configFields' = 'fields'): string {
  return catalogFieldLabel(type, key, section) ?? fallback;
}

export type PublicResolver = (url: string) => Promise<unknown>;

function fail(label: string, why: string): never {
  throw new BadRequestException(`${label}: ${why}`);
}

/** Yazili IP ya da alan adi — ozel/ic adres degil, tek etiketli degil */
function assertHostShape(label: string, rawHost: string): void {
  const host = rawHost.replace(/^\[|\]$/g, '').replace(/\.+$/, '').toLowerCase();
  if (!host) fail(label, 'adres boş.');
  if (isIP(host)) {
    if (isBlockedAddress(host)) fail(label, 'özel veya iç ağ adresi kullanılamaz; herkese açık bir adres girin.');
    return;
  }
  if (!host.includes('.')) fail(label, 'geçerli bir alan adı girin (ör. siteniz.com).');
}

async function assertResolves(label: string, host: string, resolve: PublicResolver): Promise<void> {
  const bare = host.replace(/^\[|\]$/g, '');
  if (isIP(bare)) return;
  try {
    // Port bilerek atilir: yalnizca alan adinin nereye cozuldugu soruluyor
    await resolve(`https://${bare}/`);
  } catch (err) {
    if (err instanceof SafeFetchError && err.code === 'blocked_address') {
      fail(label, 'alan adı özel veya iç ağ adresine çıkıyor; herkese açık bir adres girin.');
    }
    fail(label, 'alan adı çözülemedi; adresi kontrol edin.');
  }
}

async function assertHttpUrl(label: string, raw: string, resolve: PublicResolver): Promise<void> {
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    fail(label, 'geçerli bir adres girin (https:// ile başlamalı).');
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') fail(label, 'adres http:// veya https:// ile başlamalı.');
  if (u.username || u.password) fail(label, 'adres kullanıcı adı veya parola içeremez; kimlik bilgilerini ilgili alanlara girin.');
  assertHostShape(label, u.hostname);
  await assertResolves(label, u.hostname, resolve);
}

async function assertHostname(label: string, raw: string, resolve: PublicResolver): Promise<void> {
  let host = raw.trim();
  // "ftp://ftp.ornek.com" ya da "ornek.com:21" yazilmis olabilir — denetlenen ad
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(host)) {
    try { host = new URL(host).hostname; } catch { fail(label, 'geçerli bir sunucu adı girin.'); }
  } else if (!host.startsWith('[') && (host.match(/:/g) ?? []).length === 1) {
    host = host.split(':')[0];
  }
  assertHostShape(label, host);
  await assertResolves(label, host, resolve);
}

/**
 * Hedefin baglanacagi tum adresleri denetler; sorun varsa Turkce
 * BadRequestException atar. Adres alani olmayan tipler (GitHub, Webflow,
 * Contentful, Sanity, Markdown ZIP) icin is yapmaz — onlar sabit API'lere gider.
 *
 * @param resolve yalnizca test icin degistirilir
 */
export async function assertPublishTargetSafe(
  type: string,
  credentials: Record<string, unknown> | null | undefined,
  config?: Record<string, unknown> | null,
  resolve: PublicResolver = assertResolvesPublic,
): Promise<void> {
  const creds = credentials ?? {};
  const cfg = config ?? {};

  for (const [key, label] of Object.entries(CREDENTIAL_URL_FIELDS)) {
    const v = creds[key];
    if (typeof v === 'string' && v.trim()) await assertHttpUrl(fieldLabel(type, key, label), v, resolve);
  }

  // "host": cPanel'de tam URL (https://cpanel.ornek.com:2083), FTP/SFTP'de sunucu adi
  const host = creds.host;
  if (typeof host === 'string' && host.trim()) {
    if (type === 'CPANEL_API') await assertHttpUrl(fieldLabel(type, 'host', 'cPanel host'), host, resolve);
    else await assertHostname(fieldLabel(type, 'host', 'Host'), host, resolve);
  }

  for (const [key, label] of Object.entries(HOSTNAME_FIELDS)) {
    const v = creds[key];
    if (typeof v === 'string' && v.trim()) await assertHostname(fieldLabel(type, key, label), v, resolve);
  }

  for (const [key, label] of Object.entries(CONFIG_URL_FIELDS)) {
    const v = cfg[key];
    if (typeof v !== 'string' || !v.trim()) continue;
    // Adaptor bu adrese istek atmiyor, yalnizca link uretiyor: semasiz yazilmis
    // eski kayitlar duzenlemeyi kilitlemesin — host yine ayni kuralla denetlenir.
    const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(v.trim()) ? v : `https://${v.trim()}`;
    await assertHttpUrl(fieldLabel(type, key, label, 'configFields'), withScheme, resolve);
  }
}

/**
 * Adaptor isteginden HEMEN once cagiranlarin ortak kapisi: hedef adresi
 * reddedilirse kullaniciya gosterilecek Turkce neden, gecerse null. Hata
 * ATMAZ — toplu yayin / onarim akislari bozuk hedefi atlayip digerleriyle
 * surer; neden sonuca ve kayda (AppliedFix FAILED) aynen gecer.
 *
 * NEDEN TEK YER: ayni try/catch ve "Yayın hedefine bağlanılmadı — ..." metni
 * alti cagiranda (yayinci, snippet, statik HTML, kok dosya, takili sayfa
 * onarimi, alt metni) kopyaydi; biri degisince digerleri ayrisirdi.
 *
 * @param config hedefin ham config JSON'u (null/undefined → bos)
 * @param resolve yalnizca test icin degistirilir
 */
export async function publishTargetBlockReason(
  type: string,
  credentials: Record<string, unknown> | null | undefined,
  config?: unknown,
  resolve?: PublicResolver,
): Promise<string | null> {
  try {
    await assertPublishTargetSafe(type, credentials, (config ?? {}) as Record<string, unknown>, resolve);
    return null;
  } catch (err: any) {
    return `Yayın hedefine bağlanılmadı — ${err?.message ?? 'adres doğrulanamadı.'}`;
  }
}
