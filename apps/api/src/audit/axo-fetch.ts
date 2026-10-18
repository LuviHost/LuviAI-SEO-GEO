import { safeFetchText, SafeFetchError, type SafeTextOptions, type SafeTextResult } from '../common/safe-fetch.js';
import { detectBlock, unblockHint } from '../common/block-detect.js';

/**
 * AXO taramasi ve kok dosya duzeltmesi icin tek istek bicimi: safeFetchText
 * (SSRF korumali, durust RanksUpBot kimligi) + detectBlock siniflandirmasi.
 *
 * NEDEN: eski fetchText yalniz res.ok'a bakiyor ve govdeyi yalniz 2xx'te
 * okuyordu. Cloudflare'in 403 "you have been blocked" sayfasi, 429 ve 503
 * "dosya yok" sayiliyordu; site sahibine sitesi eksik gibi gosteriliyordu.
 * Oysa olculen sey sitenin kendisi degil, bizim erisimimizdi. Engel
 * ('blocked') ve ulasilamazlik ('unreachable') puan paydasindan duser.
 */

export type ProbeState =
  /** 2xx, engel/challenge yok — govde cagiranin dogrulamasina hazir */
  | 'ok'
  /** 404 / 410 — dosya gercekten yok */
  | 'missing'
  /** WAF / challenge / 401 / 429 / 503 — bize kapali, olculemedi */
  | 'blocked'
  /** Diger 4xx/5xx — sitenin kendi durumu, raporlanir */
  | 'http_error'
  /** Zaman asimi, DNS, ag, ic adres — olculemedi */
  | 'unreachable';

export interface ProbeBlock {
  /** BlockKind ('waf', 'challenge'...) ya da SafeFetchError kodu ('timeout', 'dns'...) */
  kind: string;
  /** Kullaniciya gosterilecek kisa Turkce gerekce */
  reason: string;
  /** Site sahibine ne yapacagi (engeli ASMAYI degil izin vermeyi anlatir) */
  hint: string;
  vendor: string | null;
  status: number;
}

export interface Probe {
  url: string;
  finalUrl: string;
  state: ProbeState;
  status: number;
  text: string;
  contentType: string;
  headers: Record<string, string>;
  truncated: boolean;
  binary: boolean;
  block: ProbeBlock | null;
}

/**
 * skipBinary: varsayilan (true) metin disi Content-Type'ta govdeyi indirmez.
 * Kok dosyalar (robots.txt, llms.txt, sitemap.xml) skipBinary:false ile
 * okunur: application/octet-stream ile sunulan gercek bir robots.txt "bos /
 * yok" sanilip uzerine yazilmasin, taramada da "bos" diye raporlanmasin.
 * Tavan yine maxBytes (varsayilan 512 KB).
 */
export type ProbeOptions = Pick<SafeTextOptions, 'accept' | 'timeoutMs' | 'maxBytes' | 'headers' | 'skipBinary'>;

type TextFetcher = (url: string, opts?: SafeTextOptions) => Promise<SafeTextResult>;

const UNREACHABLE_REASON: Record<string, string> = {
  timeout: 'Site zamanında yanıt vermedi (zaman aşımı).',
  dns: 'Alan adı çözülemedi.',
  network: 'Siteye bağlantı kurulamadı.',
  blocked_address: 'Adres özel / iç ağ adresine çözülüyor; güvenlik nedeniyle taranmadı.',
  protocol: 'Adres taranabilir değil (yalnız http/https).',
  port: 'Adres standart dışı bir port kullanıyor (yalnız 80/443 taranır).',
  redirect: 'Çok fazla ya da geçersiz yönlendirme var.',
  // safeFetchText 2xx govdeyi acamadiginda (desteklenmeyen ya da bozuk
  // Content-Encoding) bu kodla hata atar; "baglanti kurulamadi" demek yanlis olur
  content_encoding: 'Sitenin yanıtı çözülemedi (desteklenmeyen ya da bozuk sıkıştırma).',
};

const UNREACHABLE_HINT = 'Sitenin herkese açık olduğundan ve sunucunun yanıt verdiğinden emin olun; sorun sürerse barındırma sağlayıcınızla görüşün.';

export async function probeUrl(url: string, opts: ProbeOptions = {}, fetcher: TextFetcher = safeFetchText): Promise<Probe> {
  const empty = { url, finalUrl: url, status: 0, text: '', contentType: '', headers: {}, truncated: false, binary: false };
  let res: SafeTextResult;
  try {
    res = await fetcher(url, { timeoutMs: 10_000, maxBytes: 512 * 1024, ...opts });
  } catch (err: any) {
    const kind = err instanceof SafeFetchError ? err.code : 'network';
    return { ...empty, state: 'unreachable', block: { kind, reason: UNREACHABLE_REASON[kind] ?? UNREACHABLE_REASON.network, hint: UNREACHABLE_HINT, vendor: null, status: 0 } };
  }

  const base = {
    url, finalUrl: res.url, status: res.status, text: res.text, contentType: res.contentType,
    headers: res.headers, truncated: res.truncated, binary: res.binary,
  };
  const signal = detectBlock({ status: res.status, headers: res.headers, text: res.text });
  if (signal) {
    return { ...base, state: 'blocked', block: { kind: signal.kind, reason: signal.reason, hint: unblockHint(signal), vendor: signal.vendor, status: res.status } };
  }
  if (res.ok) return { ...base, state: 'ok', block: null };
  if (res.status === 404 || res.status === 410) return { ...base, state: 'missing', block: null };
  return { ...base, state: 'http_error', block: null };
}

/** Engel / ulasilamazlik — puan paydasindan duser */
export const isUnmeasured = (p: Probe): boolean => p.state === 'blocked' || p.state === 'unreachable';

/** Denetim adimi icin kisa durum etiketi: "200", "404 (yok)", "403 (engellendi, cloudflare)" */
export function describeProbe(p: Probe): string {
  switch (p.state) {
    case 'ok': return `${p.status}`;
    case 'missing': return `${p.status} (yok)`;
    case 'blocked': return `${p.status || '—'} (erişim engellendi${p.block?.vendor ? `, ${p.block.vendor}` : ''})`;
    case 'http_error': return `${p.status} (hata)`;
    case 'unreachable': return `erişilemedi (${p.block?.kind ?? 'ağ'})`;
  }
}

/**
 * Siteye ayni anda en fazla `n` istek — taramanin kendisi hiz sinirina
 * (429) takilip "engellendi" sonucu uretmesin.
 */
export function createLimiter(n: number) {
  let active = 0;
  const queue: Array<() => void> = [];
  const next = () => {
    if (active >= n || queue.length === 0) return;
    active++;
    queue.shift()!();
  };
  return function limit<T>(task: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      queue.push(() => {
        task().then(resolve, reject).finally(() => { active--; next(); });
      });
      next();
    });
  };
}
