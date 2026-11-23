/**
 * YONLENDIRME ZINCIRI — alan adinin dort yazilisi (http / https × www'lu / www'suz)
 * sitenin son adresine kac adimda ulasiyor?
 *
 * NEDEN: kobipratik.com'da `http://kobipratik.com` once `https://kobipratik.com`'a
 * (Cloudflare), sonra `https://www.kobipratik.com`'a (sunucu) gidiyordu: iki
 * yonlendirme. PageSpeed bunu "Avoid multiple page redirects" (mobilde ~0,8–1 sn)
 * diye gosterir (developers.google.com/speed — Lighthouse "redirects" denetimi:
 * her yonlendirme sayfa yuklenmesini geciktirir). Disaridan gelen baglantilarin
 * cogu www'suz adrese gidiyorsa her ziyaret bu gecikmeyi oder. Tek adim normaldir;
 * iki ve ustu BILGI olarak raporlanir (puana girmez: sayfa acilir, yalniz gec acilir).
 *
 * Saf degerlendirme + enjekte edilen fetcher ile yoklama (site-crawler cagirir).
 */
import type { SafeTextOptions, SafeTextResult } from '../common/safe-fetch.js';

type Fetcher = (url: string, opts?: SafeTextOptions) => Promise<SafeTextResult>;

export interface RedirectProbe {
  /** Denenen yazilis: "http://ornek.com/" */
  start: string;
  /** Yonlendirmelerden sonra varilan adres; ulasilamadiysa null */
  final: string | null;
  /** Son yanitin durum kodu; ulasilamadiysa null */
  status: number | null;
  /** start dahil gidilen adresler sirasiyla */
  chain: string[];
  /** Yonlendirme sayisi (chain.length - 1) */
  hops: number;
}

export interface RedirectChainSummary {
  /** Yoklanan yazilis sayisi */
  probed: number;
  /** 2xx ile biten ve 2+ adim suren yazilislar */
  longChains: string[];
  longChainCount: number;
  /** En uzun zincirin adim sayisi */
  maxHops: number;
  probes: RedirectProbe[];
}

/** Yonlendirme 2 adim ve ustu bilgi olarak raporlanir */
export const LONG_CHAIN_HOPS = 2;
const MAX_REDIRECTS = 5;

function apexOf(hostname: string): string {
  return hostname.toLowerCase().replace(/\.+$/, '').replace(/^www\./, '');
}

/**
 * Alan adinin yazilislari. IP adresi ya da localhost gibi noktasiz adlarda
 * www eklenmez (yalniz protokol farki denenir).
 */
export function redirectVariants(origin: string): string[] {
  const u = new URL(origin);
  const apex = apexOf(u.hostname);
  const port = u.port ? `:${u.port}` : '';
  const isIp = /^[\d.]+$/.test(apex) || apex.includes(':');
  const hosts = !apex.includes('.') || isIp ? [u.hostname] : [apex, `www.${apex}`];
  const out: string[] = [];
  for (const proto of ['http:', 'https:']) {
    for (const h of hosts) out.push(`${proto}//${h}${port}/`);
  }
  return [...new Set(out)];
}

/** Bir yazilisi yoklar: her yonlendirme adimi allowRedirect ile kaydedilir */
export async function probeRedirect(fetcher: Fetcher, start: string, opts: { timeoutMs?: number } = {}): Promise<RedirectProbe> {
  const chain = [start];
  try {
    const res = await fetcher(start, {
      maxRedirects: MAX_REDIRECTS,
      maxBytes: 1024,
      errorBodyBytes: 0,
      timeoutMs: opts.timeoutMs ?? 10_000,
      allowRedirect: (next) => {
        chain.push(next.toString());
        return true;
      },
    });
    return { start, final: res.url, status: res.status, chain, hops: chain.length - 1 };
  } catch {
    return { start, final: null, status: null, chain, hops: chain.length - 1 };
  }
}

export async function probeRedirectChains(fetcher: Fetcher, origin: string, opts: { timeoutMs?: number } = {}): Promise<RedirectProbe[]> {
  return Promise.all(redirectVariants(origin).map((v) => probeRedirect(fetcher, v, opts)));
}

/** "a → b → c" */
function chainText(p: RedirectProbe): string {
  return p.chain.map((u) => u.replace(/\/$/, '')).join(' → ');
}

export function summarizeRedirectChains(probes: RedirectProbe[]): RedirectChainSummary {
  const long = probes.filter((p) => p.status !== null && p.status >= 200 && p.status < 300 && p.hops >= LONG_CHAIN_HOPS);
  return {
    probed: probes.length,
    longChains: long.map(chainText),
    longChainCount: long.length,
    maxHops: Math.max(0, ...probes.filter((p) => p.status !== null).map((p) => p.hops)),
    probes,
  };
}
