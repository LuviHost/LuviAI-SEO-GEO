import { BlockList, isIP } from 'node:net';

/**
 * Istegin gercek istemci IP'si — rate limit, Turnstile remoteip, PayTR user_ip
 * ve denetim kaydi icin TEK kural. Eskiden her uc kendi okumasini yapiyordu ve
 * cogu X-Forwarded-For'un ILK adresini aliyordu: o adres istemcinin kendi
 * yazdigi basliktan gelir, istenen deger yazilip IP limiti atlatilabiliyordu.
 *
 * Zincir (docs/DEPLOYMENT.md): Cloudflare -> nginx -> (gerekirse Next.js proxy) -> API.
 *
 *  1) CF-Connecting-IP — Cloudflare edge'den origin'e giden her istekte bu
 *     basliga Cloudflare'a baglanan istemcinin IP'sini yazar; tek adres tasir.
 *     https://developers.cloudflare.com/fundamentals/reference/http-headers/#cf-connecting-ip
 *  2) X-Forwarded-For'da SAGDAN ilk ic-ag-olmayan adres — nginx
 *     `$proxy_add_x_forwarded_for` ile kendi gordugu TCP esini ($remote_addr)
 *     zincirin SONUNA ekler. Soldaki degerler istemcinin gonderdigi (sahte
 *     olabilir) adreslerdir; Cloudflare da var olan basligi silmez, sona ekler
 *     (ayni sayfa). Sagdaki loopback/ozel adresler bizim proxy'lerimizdir
 *     (Next.js -> API) ve atlanir.
 *  3) Soket adresi (dogrudan baglanti / yerel gelistirme).
 *
 * KALAN ACIK (bilerek kabul edilen): origin dogrudan internete acik oldugu
 * icin Cloudflare'i atlayip nginx'e baglanan bir istemci CF-Connecting-IP'yi
 * kendisi gonderip hangi IP sayilacagini secebilir. Bu yalniz IP limitlerini
 * atlatmaktir, veri sizmasi degil; asil cozum origin firewall'unu Cloudflare
 * IP araliklarina kisitlamaktir (altyapi isi, ProxyThrottlerGuard notu).
 * Gecersiz (IP olmayan ya da birden cok degerli) CF-Connecting-IP yok sayilir
 * ve nginx'in ekledigi gercek TCP esine dusulur.
 */

/** Bizim proxy katmanlarimizin adresleri: loopback, ozel ag, link-local, ULA. */
const IC_AG = new BlockList();
for (const [net, prefix] of [
  ['127.0.0.0', 8], ['10.0.0.0', 8], ['172.16.0.0', 12], ['192.168.0.0', 16], ['169.254.0.0', 16],
] as const) IC_AG.addSubnet(net, prefix, 'ipv4');
for (const [net, prefix] of [['::1', 128], ['fc00::', 7], ['fe80::', 10]] as const) IC_AG.addSubnet(net, prefix, 'ipv6');

type HeaderValue = string | string[] | undefined;

export interface ClientIpRequest {
  headers?: Record<string, unknown> | null;
  socket?: { remoteAddress?: string | null } | null;
  ip?: string | null;
}

function headerText(v: unknown): string {
  if (typeof v === 'string') return v;
  if (Array.isArray(v)) return (v as HeaderValue[]).filter((x): x is string => typeof x === 'string').join(',');
  return '';
}

/**
 * Tek bir adres metnini dogrular ve sadelestirir; gecersizse null.
 * '::ffff:1.2.3.4' → '1.2.3.4' (ayni istemci farkli kaynaktan farkli anahtar
 * almasin), '1.2.3.4:5678' ve '[::1]:80' gibi portlu yazimlar kirpilir.
 */
export function normalizeIp(raw: string | null | undefined): string | null {
  let s = (raw ?? '').trim();
  if (!s) return null;
  const bracket = /^\[([^\]]+)\](?::\d+)?$/.exec(s);
  if (bracket) s = bracket[1];
  else if (/^\d{1,3}(?:\.\d{1,3}){3}:\d+$/.test(s)) s = s.slice(0, s.lastIndexOf(':'));
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(s);
  if (mapped) s = mapped[1];
  return isIP(s) ? s : null;
}

/** Adres bizim proxy katmanimiza mi ait (loopback / ozel ag) — XFF'te atlanir. */
export function isInternalHop(ip: string): boolean {
  const v = isIP(ip);
  if (v === 4) return IC_AG.check(ip, 'ipv4');
  if (v === 6) return IC_AG.check(ip, 'ipv6');
  return true;
}

export function clientIp(req: ClientIpRequest | null | undefined): string {
  const headers = req?.headers ?? {};

  // Birden cok deger (virgul) = Cloudflare yazmamis demektir: yok sayilir.
  const cfRaw = headerText(headers['cf-connecting-ip']);
  const cf = cfRaw.includes(',') ? null : normalizeIp(cfRaw);
  if (cf) return cf;

  const hops = headerText(headers['x-forwarded-for'])
    .split(',')
    .map((h) => normalizeIp(h))
    .filter((h): h is string => !!h);
  for (let i = hops.length - 1; i >= 0; i--) {
    if (!isInternalHop(hops[i])) return hops[i];
  }

  return normalizeIp(req?.socket?.remoteAddress) ?? normalizeIp(req?.ip) ?? '';
}
