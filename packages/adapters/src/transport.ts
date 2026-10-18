import { isIP } from 'node:net';

/**
 * Adaptorlerin ag erisimi — disaridan degistirilebilir.
 *
 * NEDEN: adaptorler kullanicinin girdigi adrese (Site URL, cPanel host, FTP
 * sunucusu...) baglanir. Paket kendi basina hangi adresin "ic ag" oldugunu
 * bilmez; API ve worker acilista korumali bir uygulama kaydeder
 * (apps/api/src/publish-targets/adapter-egress.ts): yonlendirmeler elle
 * izlenir, her adim ve her baglanti ic adrese karsi denetlenir.
 *
 * Kayit yoksa (betikler, paket testleri) davranis eskisiyle AYNI: global fetch
 * (varsayilan redirect: 'follow'), FTP/SFTP'de DNS baglanti aninda cozulur.
 */

/** Adaptorlerin kullandigi fetch imzasi (yalniz dize URL) */
export type AdapterFetch = (url: string, init?: RequestInit) => Promise<Response>;

/**
 * Soket tabanli adaptorler (FTP/SFTP) icin: sunucu adini cozer, denetler ve
 * baglanilacak (denetlenmis) IP'yi doner. Engelli adreste hata atar; mesaji
 * kullaniciya aynen gosterilir.
 */
export type AdapterHostResolver = (host: string) => Promise<string>;

let registeredFetch: AdapterFetch | null = null;
let registeredResolver: AdapterHostResolver | null = null;

/** null → varsayilana (global fetch) don */
export function setAdapterFetch(fn: AdapterFetch | null): void {
  registeredFetch = fn;
}

/** null → varsayilana (adi oldugu gibi kullan) don */
export function setAdapterHostResolver(fn: AdapterHostResolver | null): void {
  registeredResolver = fn;
}

/** Her adaptor HTTP istegini buradan atar — dogrudan fetch() cagrilmaz. */
export function adapterFetch(url: string, init?: RequestInit): Promise<Response> {
  if (registeredFetch) return registeredFetch(url, init);
  // global fetch CAGRI ANINDA okunur: testler vi.stubGlobal ile degistirebilsin
  return globalThis.fetch(url, init);
}

/** FTP/SFTP baglanacagi adres. Kayit yoksa ad aynen doner (eski davranis). */
export function resolveAdapterHost(host: string): Promise<string> {
  return registeredResolver ? registeredResolver(host) : Promise.resolve(host);
}

/** API korumali cozucuyu kaydetti mi (FTP veri baglantisi kurali buna bagli) */
export function hasAdapterHostResolver(): boolean {
  return registeredResolver !== null;
}

/** Form '21' gibi dize de gonderebilir; gecersizse undefined (kutuphane varsayilani) */
export function socketPort(v: unknown): number | undefined {
  const n = typeof v === 'number' ? v : typeof v === 'string' && /^\d{1,5}$/.test(v.trim()) ? Number(v.trim()) : Number.NaN;
  return Number.isInteger(n) && n > 0 && n < 65536 ? n : undefined;
}

// ─── Hata metni: kisa, temiz, adres sizdirmayan ─────────────────────────────

/** 2xx disi yanit govdesinden okunan en fazla bayt — tamamini bellege almayiz */
const ERROR_READ_BYTES = 8 * 1024;

const BRACKETED_V6 = /\[([0-9a-f:.]+)\](?::\d{1,5})?/gi;
const IPV4_PORT = /\b(\d{1,3}(?:\.\d{1,3}){3})(?::\d{1,5})?\b/g;
const BARE_V6 = /(?<![\w:.])((?:[0-9a-f]{1,4})?(?::[0-9a-f]{0,4}){2,7})(?![\w:])/gi;
const LOCALHOST = /\blocalhost(?::\d{1,5})?\b/gi;

/**
 * Sunucudan gelen metni kullaniciya gosterilebilir hale getirir: HTML etiketi,
 * betik/stil ve yorum atilir, IP adresleri ve localhost '[adres]' olur,
 * bosluklar toplanir, en fazla `max` karakter.
 *
 * NEDEN: adaptorler yanit govdesini hata metnine koyuyordu (WP REST tum
 * govdeyi). Hata yayin sonucunda saklanir ve panelde gosterilir; ic agdan
 * donen bir sayfa ya da sunucunun yazdigi ic adres boylece kullaniciya
 * tasinabiliyordu. Adres maskelemesi gercek IP sozdizimine bakar (isIP):
 * '1.18.0' surum numarasi ya da '12:30:45' saati dokunulmadan kalir.
 */
export function sanitizeErrorText(raw: unknown, max = 200): string {
  let s = String(raw ?? '')
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;|&#160;/gi, ' ')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, ' ');
  s = s
    .replace(BRACKETED_V6, (m, ip: string) => (isIP(ip) ? '[adres]' : m))
    .replace(IPV4_PORT, (m, ip: string) => (isIP(ip) ? '[adres]' : m))
    .replace(BARE_V6, (m, ip: string) => (isIP(ip) ? '[adres]' : m))
    .replace(LOCALHOST, '[adres]')
    .replace(/\s+/g, ' ')
    .trim();
  if (s.length > max) s = `${s.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
  return s;
}

/** Govdenin basini en fazla `limit` bayt okur, gerisini iptal eder. */
async function readCapped(res: Response, limit: number): Promise<string> {
  const body = res.body as ReadableStream<Uint8Array> | null | undefined;
  if (!body || typeof body.getReader !== 'function') {
    // Govde akisi olmayan (sahte/test) yanit
    const text = typeof res.text === 'function' ? await res.text().catch(() => '') : '';
    return text.slice(0, limit);
  }
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (size < limit) {
      const { done, value } = await reader.read();
      if (done || !value) break;
      chunks.push(value);
      size += value.byteLength;
    }
  } catch {
    // yarida kesilen govde — eldekiyle devam
  } finally {
    reader.cancel().catch(() => {});
  }
  const all = new Uint8Array(Math.min(size, limit));
  let at = 0;
  for (const c of chunks) {
    if (at >= all.length) break;
    const part = c.subarray(0, all.length - at);
    all.set(part, at);
    at += part.length;
  }
  return new TextDecoder().decode(all);
}

/**
 * 2xx disi yanitin aciklamasi: 3xx ise yonlendirme rehberi (govde okunmaz),
 * degilse govdeden temiz kisa alinti (bos olabilir).
 *
 * 3xx NEDEN gelir: korumali fetch govdeli istegi (POST/PUT) baska kokene ya da
 * GET'e cevirerek izlemez — yayin sessizce kaybolup "yayinlandi" denmesin diye
 * yonlendirme yaniti adaptore aynen doner.
 */
export async function httpErrorDetail(res: Response, max = 200): Promise<string> {
  if (res.status >= 300 && res.status < 400) {
    const loc = res.headers?.get?.('location');
    await res.body?.cancel().catch(() => {});
    const where = loc ? ` (${sanitizeErrorText(loc, 120)})` : '';
    return `hedef adres isteği başka bir adrese yönlendiriyor${where}; ayarlardaki adresi yönlendirmenin son hâliyle (https:// ve www dahil) güncelleyin.`;
  }
  return sanitizeErrorText(await readCapped(res, ERROR_READ_BYTES), max);
}

/** `${label} ${status}: ${aciklama}` — aciklama bossa yalniz durum kodu */
export async function httpErrorText(label: string, res: Response, max = 200): Promise<string> {
  const detail = await httpErrorDetail(res, max);
  return detail ? `${label} ${res.status}: ${detail}` : `${label} ${res.status}`;
}
