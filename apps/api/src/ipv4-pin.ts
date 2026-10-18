import * as dns from 'node:dns';
import * as net from 'node:net';

/**
 * Surec geneli IPv4 sabitlemesi — API (main.ts) ve worker (apps/worker/src/index.ts)
 * acilista, soket acilmadan once cagirir.
 *
 * NEDEN: uretim sunucusunda calisan bir IPv6 yolu yok. Node 20'den beri
 * happy-eyeballs (autoSelectFamily) varsayilan acik: soket A ve AAAA adreslerini
 * sirayla dener, her denemeye 250 ms verip sonrakine (IPv6) gecer; IPv4 el
 * sikismasi gec kalinca IPv6 denemesi takilir ve istek ETIMEDOUT ile duser.
 * API'nin undici dagiticisi family=4 ile sabit, ama kendi soketini acanlar
 * (http.request kullanan istemciler, ioredis, FTP/SFTP adaptorleri) ve worker'in
 * global fetch'i bu varsayilani kullanir. Worker'daki require('undici')
 * dagiticisi ESM'de hic calismiyordu (require tanimsiz, hata sessizce yutuluyordu).
 *  - dns.setDefaultResultOrder('ipv4first'): dns.lookup once A kayitlarini doner
 *    (Node 17'den beri varsayilan 'verbatim').
 *    https://nodejs.org/docs/latest-v22.x/api/dns.html#dnssetdefaultresultorderorder
 *  - net.setDefaultAutoSelectFamily(false): soket.connect'in autoSelectFamily
 *    varsayilani; kapaliyken soket lookup'in verdigi TEK adrese (ipv4first ile
 *    IPv4) baglanir. Kendi family'sini veren baglantilari etkilemez.
 *    https://nodejs.org/docs/latest-v22.x/api/net.html#netsetdefaultautoselectfamilyvalue
 *    undici (Node global fetch'i dahil) autoSelectFamily'yi yalniz acikca
 *    verildiginde iletir (undici lib/dispatcher/client.js), yoksa bu varsayilan gecer.
 *
 * ALLOW_IPV6=1 (ya da true/on/yes) sabitlemeyi kapatir — calisan IPv6 yolu olan
 * bir sunucuya tasininca. Musteri sitesi okumalarindaki ayri sabitleme
 * SAFE_FETCH_IPV4_ONLY ile yonetilir (common/safe-fetch.ts).
 */
export function ipv6AllowedFromEnv(env: NodeJS.ProcessEnv = process.env): boolean {
  const v = (env.ALLOW_IPV6 ?? '').trim().toLowerCase();
  return ['1', 'true', 'on', 'yes'].includes(v);
}

export interface Ipv4PinApi {
  setDefaultResultOrder(order: 'ipv4first'): void;
  setDefaultAutoSelectFamily(value: boolean): void;
}

const NODE_API: Ipv4PinApi = {
  setDefaultResultOrder: (order) => dns.setDefaultResultOrder(order),
  setDefaultAutoSelectFamily: (value) => net.setDefaultAutoSelectFamily(value),
};

/** Sabitlemeyi uygular; uygulandiysa true (ALLOW_IPV6 aciksa false, hicbir sey degismez) */
export function pinProcessToIpv4(env: NodeJS.ProcessEnv = process.env, api: Ipv4PinApi = NODE_API): boolean {
  if (ipv6AllowedFromEnv(env)) return false;
  api.setDefaultResultOrder('ipv4first');
  api.setDefaultAutoSelectFamily(false);
  return true;
}
