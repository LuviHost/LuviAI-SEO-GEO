import { isIP } from 'node:net';

/**
 * Bot dogrulama — SAF mantik (ag yok, saat yok; testte birebir sinanir).
 *
 * NEDEN VAR (02.11.2026, gercek bir musteri sitesinde 30 gunluk Cloudflare
 * analitigiyle karsilastirildi): AI botu kullanici ajani (UA) tasiyan isteklerin
 * cogu gercek bot DEGIL. ChatGPT-User UA'li 18.260 istegin 3.180'i, Claude-User
 * UA'li 13.740 istegin 270'i Cloudflare tarafindan dogrulandi; PerplexityBot ve
 * CCBot UA'lilarin hicbiri. Ikinci bagimsiz sinyal: bu farkli "botlar" ayni
 * ulkelerden ve ayni bir avuc IP'den geliyordu — UA degistiren tek bir kaziyici.
 * RanksUp botlari yalniz UA desenine gore sayiyordu; panel "Claude-User 4.121"
 * gibi sayilari gercek asistan ziyareti diye gosteriyordu.
 *
 * Artik her isabet istemci IP'siyle siniflandirilir:
 *  - verified   : IP saglayicinin YAYIMLADIGI aralikta (ya da ileri dogrulanan
 *                 ters DNS / saglayicinin ASN'i / Cloudflare dogrulanmis bot)
 *  - unverified : dogrulama yontemi var, calisti ve IP saglayiciya ait degil —
 *                 kendini bot olarak tanitan, taklit olabilecek istek
 *  - unknown    : IP yok (eski Worker), IP bir proxy'nin (Cloudflare / ic ag),
 *                 liste o an okunamadi ya da bu bot icin resmi yontem yok
 *
 * "unknown" ASLA "verified" sayilmaz; "unverified" ile de karistirilmaz.
 */

export type BotVerdict = 'verified' | 'unverified' | 'unknown';

export type BotVerifyReason =
  // verified
  | 'ip-list'
  | 'rdns'
  | 'asn'
  | 'cloudflare'
  // unverified
  | 'ip-not-in-list'
  | 'rdns-mismatch'
  | 'asn-mismatch'
  // unknown
  | 'no-ip'
  | 'proxy-ip'
  | 'list-unavailable'
  | 'rdns-unavailable'
  | 'no-asn'
  | 'no-method';

export interface BotClassification {
  verdict: BotVerdict;
  reason: BotVerifyReason;
}

// ────────────────────────────────────────────────────────────
//  IP + CIDR
// ────────────────────────────────────────────────────────────

export interface ParsedIp {
  family: 4 | 6;
  value: bigint;
}

function parseV4(s: string): bigint | null {
  const parts = s.split('.');
  if (parts.length !== 4) return null;
  let n = 0n;
  for (const p of parts) {
    if (!/^\d{1,3}$/.test(p)) return null;
    const v = Number(p);
    if (v > 255) return null;
    n = (n << 8n) | BigInt(v);
  }
  return n;
}

function parseV6(s: string): bigint | null {
  let str = s.toLowerCase();
  const zone = str.indexOf('%');
  if (zone >= 0) str = str.slice(0, zone);
  // Sonda gomulu IPv4 (::ffff:1.2.3.4) — iki 16 bitlik gruba cevrilir
  const lastColon = str.lastIndexOf(':');
  const tail = str.slice(lastColon + 1);
  if (tail.includes('.')) {
    const v4 = parseV4(tail);
    if (v4 === null) return null;
    str = `${str.slice(0, lastColon + 1)}${(v4 >> 16n).toString(16)}:${(v4 & 0xffffn).toString(16)}`;
  }
  const halves = str.split('::');
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(':') : [];
  const rest = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  const missing = 8 - head.length - rest.length;
  if (halves.length === 1 ? head.length !== 8 : missing < 1) return null;
  const groups = halves.length === 2 ? [...head, ...Array(missing).fill('0'), ...rest] : head;
  let n = 0n;
  for (const g of groups) {
    if (!/^[0-9a-f]{1,4}$/.test(g)) return null;
    n = (n << 16n) | BigInt(parseInt(g, 16));
  }
  return n;
}

const V4_MAPPED_PREFIX = 0xffffn << 32n;

/**
 * Adres metnini sayiya cevirir; gecersizse null. IPv4-eslenmis IPv6
 * (::ffff:1.2.3.4) IPv4 sayilir — ayni istemci iki farkli bicimde gelebilir.
 */
export function parseIp(raw: string | null | undefined): ParsedIp | null {
  const s = (raw ?? '').trim();
  if (!s) return null;
  const fam = isIP(s);
  if (fam === 4) {
    const v = parseV4(s);
    return v === null ? null : { family: 4, value: v };
  }
  if (fam === 6) {
    const v = parseV6(s);
    if (v === null) return null;
    if (v >> 32n === 0xffffn && (v & ~((1n << 32n) - 1n)) === V4_MAPPED_PREFIX) {
      return { family: 4, value: v & 0xffffffffn };
    }
    return { family: 6, value: v };
  }
  return null;
}

export interface ParsedCidr {
  family: 4 | 6;
  prefix: number;
  /** Maskelenmis ag adresi */
  network: bigint;
}

/** "1.2.3.0/24" ya da "2001:db8::/32"; onek yoksa tek adres (/32, /128). */
export function parseCidr(raw: string): ParsedCidr | null {
  const s = (raw ?? '').trim();
  const slash = s.indexOf('/');
  const addr = slash >= 0 ? s.slice(0, slash) : s;
  const ip = parseIp(addr);
  if (!ip) return null;
  // IPv4-eslenmis yazimda onek IPv6 bitidir; sade tutmak icin yalniz duz yazim kabul
  const nativeFamily = isIP(addr) as 4 | 6;
  if (nativeFamily !== ip.family) return null;
  const max = ip.family === 4 ? 32 : 128;
  let prefix = max;
  if (slash >= 0) {
    const p = s.slice(slash + 1);
    if (!/^\d{1,3}$/.test(p)) return null;
    prefix = Number(p);
    if (prefix > max) return null;
  }
  return { family: ip.family, prefix, network: maskOf(ip.value, prefix, max) };
}

function maskOf(value: bigint, prefix: number, max: number): bigint {
  if (prefix === 0) return 0n;
  const hostBits = BigInt(max - prefix);
  return (value >> hostBits) << hostBits;
}

/**
 * CIDR kumesi — onek uzunlugu basina maskelenmis aglar. Arama, kumedeki
 * farkli onek uzunlugu sayisi kadar (en fazla 33 / 129) Set bakisidir.
 */
export class CidrSet {
  private readonly byFamily: Record<4 | 6, Map<number, Set<bigint>>> = { 4: new Map(), 6: new Map() };
  private count = 0;

  static from(cidrs: Iterable<string>): CidrSet {
    const set = new CidrSet();
    for (const c of cidrs) set.add(c);
    return set;
  }

  /** Gecersiz giris sessizce atlanir; eklendiyse true */
  add(cidr: string): boolean {
    const c = parseCidr(cidr);
    if (!c) return false;
    const m = this.byFamily[c.family];
    let nets = m.get(c.prefix);
    if (!nets) { nets = new Set(); m.set(c.prefix, nets); }
    if (!nets.has(c.network)) { nets.add(c.network); this.count++; }
    return true;
  }

  get size(): number {
    return this.count;
  }

  has(ip: string | ParsedIp | null | undefined): boolean {
    const p = typeof ip === 'string' || ip == null ? parseIp(ip as string | null | undefined) : ip;
    if (!p) return false;
    const max = p.family === 4 ? 32 : 128;
    for (const [prefix, nets] of this.byFamily[p.family]) {
      if (nets.has(maskOf(p.value, prefix, max))) return true;
    }
    return false;
  }
}

/** Bizim ya da musterinin proxy katmani: loopback, ozel ag, link-local, ULA, CGNAT */
const PRIVATE_RANGES = CidrSet.from([
  '0.0.0.0/8', '10.0.0.0/8', '100.64.0.0/10', '127.0.0.0/8', '169.254.0.0/16', '172.16.0.0/12', '192.168.0.0/16',
  '::/128', '::1/128', 'fc00::/7', 'fe80::/10',
]);

export function isPrivateIp(ip: string | ParsedIp | null | undefined): boolean {
  return PRIVATE_RANGES.has(ip);
}

// ────────────────────────────────────────────────────────────
//  RESMI IP LISTELERI
// ────────────────────────────────────────────────────────────

export type IpListFormat =
  /** {"prefixes":[{"ipv4Prefix":".."},{"ipv6Prefix":".."}]} — OpenAI/Google/Bing/Anthropic/... */
  | 'prefixes-json'
  /** {"result":{"ipv4_cidrs":[],"ipv6_cidrs":[]}} — Cloudflare API */
  | 'cloudflare-json'
  /** Duz metin ya da HTML sayfadaki IPv4/CIDR'ler (Amazon yalniz HTML sayfa yayimliyor) */
  | 'ip-text';

export interface IpListSource {
  url: string;
  format: IpListFormat;
  /** Bu kadardan az aralik cikarsa liste bozuk sayilir (bos/degismis sayfa "herkes taklit" demesin) */
  minEntries: number;
}

/**
 * Resmi listeler — 02.11.2026'da her biri cekilip bicimi dogrulandi.
 *
 * Google: eski /static/search/apis/ipranges/*.json adresleri 301 ile
 * /static/crawling/ipranges/ altina tasindi (googlebot.json → common-crawlers.json).
 * user-triggered-fetchers.json (App Engine uzerinden calisan fetcher'lar,
 * gae.googleusercontent.com) BILEREK kullanilmiyor: izlenen botlardan hicbiri o
 * araliktan gelmez; Googlebot/GoogleOther icin common + special + google'a ait
 * kullanici-tetikli liste yeterli.
 * Anthropic: destek makalesi "Does Anthropic crawl data from the web..." su
 * listeyi gosteriyor: https://claude.com/crawling/bots.json (tum Anthropic botlari).
 * Amazon: JSON yok; https://developer.amazon.com/amazonbot/ip-addresses/ HTML
 * sayfasinda ~1.300 tekil IPv4 adres (ters DNS ec2-*.amazonaws.com doner,
 * yani ters DNS ile dogrulanamaz).
 */
export const IP_LIST_SOURCES = {
  'openai-gptbot': { url: 'https://openai.com/gptbot.json', format: 'prefixes-json', minEntries: 1 },
  'openai-chatgpt-user': { url: 'https://openai.com/chatgpt-user.json', format: 'prefixes-json', minEntries: 1 },
  'openai-searchbot': { url: 'https://openai.com/searchbot.json', format: 'prefixes-json', minEntries: 1 },
  'perplexity-bot': { url: 'https://www.perplexity.ai/perplexitybot.json', format: 'prefixes-json', minEntries: 1 },
  'perplexity-user': { url: 'https://www.perplexity.ai/perplexity-user.json', format: 'prefixes-json', minEntries: 1 },
  'anthropic': { url: 'https://claude.com/crawling/bots.json', format: 'prefixes-json', minEntries: 1 },
  'google-common': { url: 'https://developers.google.com/static/crawling/ipranges/common-crawlers.json', format: 'prefixes-json', minEntries: 10 },
  'google-special': { url: 'https://developers.google.com/static/crawling/ipranges/special-crawlers.json', format: 'prefixes-json', minEntries: 10 },
  'google-user-triggered-google': { url: 'https://developers.google.com/static/crawling/ipranges/user-triggered-fetchers-google.json', format: 'prefixes-json', minEntries: 10 },
  'bing': { url: 'https://www.bing.com/toolbox/bingbot.json', format: 'prefixes-json', minEntries: 5 },
  'apple': { url: 'https://search.developer.apple.com/applebot.json', format: 'prefixes-json', minEntries: 5 },
  'amazon': { url: 'https://developer.amazon.com/amazonbot/ip-addresses/', format: 'ip-text', minEntries: 50 },
  'commoncrawl': { url: 'https://index.commoncrawl.org/ccbot.json', format: 'prefixes-json', minEntries: 1 },
  'duckduckgo': { url: 'https://duckduckgo.com/duckassistbot.json', format: 'prefixes-json', minEntries: 5 },
  'mistral-user': { url: 'https://mistral.ai/mistralai-user-ips.json', format: 'prefixes-json', minEntries: 1 },
  /** Bot listesi DEGIL: IP'nin bir Cloudflare proxy'si olup olmadigini anlamak icin */
  'cloudflare': { url: 'https://api.cloudflare.com/client/v4/ips', format: 'cloudflare-json', minEntries: 10 },
} as const satisfies Record<string, IpListSource>;

export type IpListId = keyof typeof IP_LIST_SOURCES;

/**
 * Liste govdesini CIDR dizisine cevirir. Bicim tutmazsa ya da aralik sayisi
 * minEntries altindaysa null — cagiran listeyi "okunamadi" sayar (fail-open:
 * isabetler 'unknown' olur, asla toplu 'unverified').
 */
export function parseIpList(body: unknown, source: Pick<IpListSource, 'format' | 'minEntries'>): string[] | null {
  const out: string[] = [];
  const push = (v: unknown) => {
    if (typeof v === 'string' && parseCidr(v)) out.push(v.trim());
  };
  if (source.format === 'prefixes-json') {
    const obj = typeof body === 'string' ? safeJson(body) : body;
    const prefixes = (obj as { prefixes?: unknown } | null)?.prefixes;
    if (!Array.isArray(prefixes)) return null;
    for (const p of prefixes) {
      if (!p || typeof p !== 'object') continue;
      push((p as Record<string, unknown>).ipv4Prefix);
      push((p as Record<string, unknown>).ipv6Prefix);
    }
  } else if (source.format === 'cloudflare-json') {
    const obj = typeof body === 'string' ? safeJson(body) : body;
    const result = (obj as { result?: { ipv4_cidrs?: unknown; ipv6_cidrs?: unknown } } | null)?.result;
    if (!result) return null;
    for (const arr of [result.ipv4_cidrs, result.ipv6_cidrs]) if (Array.isArray(arr)) arr.forEach(push);
  } else {
    if (typeof body !== 'string') return null;
    // HTML/metin: yalniz IPv4 adres ya da CIDR; surum numarasi gibi 3 noktali olmayan dizgeler eslesmez
    for (const m of body.matchAll(/(?<![\d.])(\d{1,3}(?:\.\d{1,3}){3}(?:\/\d{1,2})?)(?![\d.])/g)) push(m[1]);
  }
  const unique = [...new Set(out)];
  return unique.length >= source.minEntries ? unique : null;
}

function safeJson(s: string): unknown {
  try { return JSON.parse(s); } catch { return null; }
}

// ────────────────────────────────────────────────────────────
//  BOT → DOGRULAMA YONTEMI
// ────────────────────────────────────────────────────────────

export interface BotVerifyMethod {
  /** IP bu listelerden birindeyse dogrulandi (ayni saglayicinin listeleri birlikte) */
  lists?: readonly IpListId[];
  /** Ters DNS + ileri dogrulama: ad bu son eklerden biriyle bitmeli ve ayni IP'ye cozulmeli */
  rdns?: readonly string[];
  /** Saglayicinin ASN'i (yalniz Cloudflare Worker request.cf.asn gonderir) */
  asn?: readonly number[];
}

const OPENAI: readonly IpListId[] = ['openai-gptbot', 'openai-chatgpt-user', 'openai-searchbot'];
const PERPLEXITY: readonly IpListId[] = ['perplexity-bot', 'perplexity-user'];
const ANTHROPIC: readonly IpListId[] = ['anthropic'];
const GOOGLE: readonly IpListId[] = ['google-common', 'google-special', 'google-user-triggered-google'];
/** Google ve Bing ters DNS adlarini da belgeliyor; liste bayatsa yeni IP buradan kurtarilir */
const GOOGLE_RDNS = ['googlebot.com', 'google.com'] as const;
/** Meta: "whois -h whois.radb.net -- '-i origin AS32934'" (Meta web crawlers belgesi) */
const META_ASN = [32934] as const;

/**
 * NEDEN saglayici bazinda birlesik liste (or. GPTBot icin OpenAI'nin uc
 * listesi): liste uyeligi IP'nin o saglayiciya ait oldugunu kanitlar; UA hangi
 * urun oldugunu soyler. Saglayicilar IP'leri listeler arasinda kaydirip JSON'u
 * gec guncelleyebiliyor — amac "taklitci kaziyici degil" ayrimi.
 *
 * Yontemi olmayan botlar (Bytespider, cohere-ai, Diffbot, AI2Bot, DeepSeek,
 * YouBot, genel "Mistral" UA'si, Ahrefs/Semrush, sosyal onizleme botlari)
 * resmi bir liste/ad yayimlamiyor ya da izlenmiyor → 'unknown' ('no-method').
 * Cloudflare'in "dogrulanmis bot" isareti varsa onlar da dogrulanir.
 */
export const BOT_VERIFY_METHODS: Readonly<Record<string, BotVerifyMethod>> = {
  'GPTBot': { lists: OPENAI },
  'ChatGPT-User': { lists: OPENAI },
  'OAI-SearchBot': { lists: OPENAI },
  'PerplexityBot': { lists: PERPLEXITY },
  'Perplexity-User': { lists: PERPLEXITY },
  'ClaudeBot': { lists: ANTHROPIC },
  'Claude-User': { lists: ANTHROPIC },
  'Claude-SearchBot': { lists: ANTHROPIC },
  'Claude-Web': { lists: ANTHROPIC },
  'Googlebot': { lists: GOOGLE, rdns: GOOGLE_RDNS },
  'GoogleOther': { lists: GOOGLE, rdns: GOOGLE_RDNS },
  'Bingbot': { lists: ['bing'], rdns: ['search.msn.com'] },
  'Applebot': { lists: ['apple'], rdns: ['applebot.apple.com'] },
  'Applebot-Extended': { lists: ['apple'], rdns: ['applebot.apple.com'] },
  'Amazonbot': { lists: ['amazon'] },
  'CCBot': { lists: ['commoncrawl'] },
  'DuckAssistBot': { lists: ['duckduckgo'] },
  'MistralAI-User': { lists: ['mistral-user'] },
  'Meta-ExternalAgent': { asn: META_ASN },
  'Meta-ExternalFetcher': { asn: META_ASN },
  'FacebookBot': { asn: META_ASN },
};

/** Herhangi bir botun kullandigi listeler + proxy tespiti icin Cloudflare */
export function requiredListIds(): IpListId[] {
  const ids = new Set<IpListId>(['cloudflare']);
  for (const m of Object.values(BOT_VERIFY_METHODS)) for (const l of m.lists ?? []) ids.add(l);
  return [...ids];
}

/** Ters DNS adinin son ek eslesmesi — "evilgooglebot.com" eslesmez, "crawl-1.googlebot.com" eslesir */
export function hostnameMatchesSuffix(hostname: string, suffixes: readonly string[]): boolean {
  const h = hostname.toLowerCase().replace(/\.+$/, '');
  return suffixes.some((sfx) => {
    const s = sfx.toLowerCase().replace(/^\.+|\.+$/g, '');
    return h === s || h.endsWith(`.${s}`);
  });
}

// ────────────────────────────────────────────────────────────
//  ISTEMCI IP'SI + SINIFLANDIRMA
// ────────────────────────────────────────────────────────────

/**
 * Edge kaynaginin bildirdigi adreslerden siniflandirilacak IP.
 *
 *  - ip  : kaynagin gordugu TCP esi. Cloudflare Worker icin cf-connecting-ip
 *          (Cloudflare yazar, istemci degistiremez); WordPress icin REMOTE_ADDR;
 *          nginx ajani / log icin $remote_addr.
 *  - fwd : WordPress'in HTTP_CF_CONNECTING_IP basligi. YALNIZ ip bir Cloudflare
 *          proxy adresiyse kullanilir: Cloudflare arkasinda olmayan sitede bu
 *          basligi ziyaretci yazar — "CF-Connecting-IP: <OpenAI IP'si>" ile
 *          taklitci kendini dogrulatamasin.
 *  - ip ozel ag ya da Cloudflare adresiyse (ve kullanilabilir fwd yoksa) gercek
 *    istemci bilinmiyor → 'proxy-ip' (unknown). "unverified" DEGIL: dogru bot da
 *    bir proxy arkasinda gorunebilir.
 *  - Cloudflare listesi okunamadiysa fwd'ye guvenilmez; ip yine de saglayici
 *    listesiyle sinanir (Cloudflare adresi hicbir bot listesinde olmaz).
 */
export function pickClientIp(
  input: { ip?: string | null; fwd?: string | null },
  isCloudflare: ((ip: ParsedIp) => boolean | null) | null,
): { ip: ParsedIp | null; reason?: 'no-ip' | 'proxy-ip' } {
  const edge = parseIp(input.ip);
  if (!edge) return { ip: null, reason: 'no-ip' };
  const cf = isCloudflare ? isCloudflare(edge) : null;
  if (cf === true) {
    const fwd = parseIp(input.fwd);
    if (fwd && !isPrivateIp(fwd)) return { ip: fwd };
    return { ip: null, reason: 'proxy-ip' };
  }
  if (isPrivateIp(edge)) return { ip: null, reason: 'proxy-ip' };
  return { ip: edge };
}

export type MethodResult = 'match' | 'nomatch' | 'unavailable' | 'none';

export interface ClassifyInput {
  bot: string;
  ip?: string | null;
  fwd?: string | null;
  asn?: number | null;
  /** Cloudflare Worker: request.cf.botManagement.verifiedBot === true ya da dolu verifiedBotCategory */
  cfVerified?: boolean | null;
}

export interface ClassifyLookup {
  /** Liste yuklu: CidrSet; okunamadi: null */
  list(id: IpListId): CidrSet | null;
  /**
   * Ters DNS sonucu (onceden hesaplanmis). undefined: bu yolda ters DNS
   * yapilmiyor (senkron ara katman) — karar listeye birakilir.
   */
  rdns?(ip: ParsedIp, suffixes: readonly string[]): 'match' | 'nomatch' | 'unavailable' | undefined;
}

/**
 * Tek isabeti siniflandir.
 *
 * Kural: herhangi bir yontem eslesirse verified. Eslesme yoksa, uygulanan
 * yontemlerden en az biri KESIN "hayir" dediyse ve hicbiri "okunamadi"
 * demediyse unverified. Aksi halde unknown. Cloudflare dogrulamasi yalniz
 * EK olumlu sinyaldir: isaret yoksa ya da false ise karari degistirmez
 * (alt planlarda alan hic gelmez; Cloudflare'in listesinde olmayan mesru
 * botlar da vardir).
 */
export function classifyBotHit(input: ClassifyInput, lookup: ClassifyLookup): BotClassification {
  const cfList = lookup.list('cloudflare');
  const picked = pickClientIp(input, cfList ? (ip) => cfList.has(ip) : null);
  const cfOk = input.cfVerified === true;
  if (!picked.ip) return cfOk ? { verdict: 'verified', reason: 'cloudflare' } : { verdict: 'unknown', reason: picked.reason ?? 'no-ip' };
  const ip = picked.ip;

  const method = BOT_VERIFY_METHODS[input.bot];
  if (!method) return cfOk ? { verdict: 'verified', reason: 'cloudflare' } : { verdict: 'unknown', reason: 'no-method' };

  // 1) Resmi liste
  let listRes: MethodResult = 'none';
  if (method.lists?.length) {
    let anyUnavailable = false;
    listRes = 'nomatch';
    for (const id of method.lists) {
      const set = lookup.list(id);
      if (!set) { anyUnavailable = true; continue; }
      if (set.has(ip)) { listRes = 'match'; break; }
    }
    if (listRes !== 'match' && anyUnavailable) listRes = 'unavailable';
  }
  if (listRes === 'match') return { verdict: 'verified', reason: 'ip-list' };

  // 2) Ters DNS + ileri dogrulama (yalniz liste eslesmediyse sorulur)
  let rdnsRes: MethodResult | 'skipped' = 'none';
  if (method.rdns?.length) {
    const r = lookup.rdns ? lookup.rdns(ip, method.rdns) : undefined;
    rdnsRes = r ?? 'skipped';
  }
  if (rdnsRes === 'match') return { verdict: 'verified', reason: 'rdns' };

  // 3) ASN (Cloudflare Worker'dan)
  let asnRes: MethodResult = 'none';
  if (method.asn?.length) {
    const asn = typeof input.asn === 'number' && Number.isFinite(input.asn) ? input.asn : null;
    asnRes = asn === null ? 'unavailable' : method.asn.includes(asn) ? 'match' : 'nomatch';
  }
  if (asnRes === 'match') return { verdict: 'verified', reason: 'asn' };

  if (cfOk) return { verdict: 'verified', reason: 'cloudflare' };

  // Olumsuz karar: liste kesin hayir dedi ve ters DNS de hayir dedi / yapilmadi
  if (listRes === 'nomatch' && (rdnsRes === 'nomatch' || rdnsRes === 'none' || rdnsRes === 'skipped')) {
    return { verdict: 'unverified', reason: 'ip-not-in-list' };
  }
  if (listRes === 'none' && rdnsRes === 'nomatch') return { verdict: 'unverified', reason: 'rdns-mismatch' };
  if (asnRes === 'nomatch' && listRes === 'none' && rdnsRes === 'none') return { verdict: 'unverified', reason: 'asn-mismatch' };

  if (listRes === 'unavailable') return { verdict: 'unknown', reason: 'list-unavailable' };
  if (rdnsRes === 'unavailable') return { verdict: 'unknown', reason: 'rdns-unavailable' };
  if (asnRes === 'unavailable') return { verdict: 'unknown', reason: 'no-asn' };
  return { verdict: 'unknown', reason: 'no-method' };
}

/** Bot listede kayitli bir yonteme sahip mi (panel "dogrulama yontemi yok" etiketi icin) */
export function hasVerifyMethod(bot: string): boolean {
  return !!BOT_VERIFY_METHODS[bot];
}

/** Ters DNS + ileri dogrulama — saf karar (cozucu sonuclari disaridan) */
export function decideRdns(
  ip: ParsedIp,
  reverseNames: string[] | null,
  forward: (host: string) => ParsedIp[] | null,
  suffixes: readonly string[],
): 'match' | 'nomatch' | 'unavailable' {
  if (reverseNames === null) return 'unavailable';
  const candidates = reverseNames.filter((h) => hostnameMatchesSuffix(h, suffixes));
  if (candidates.length === 0) return 'nomatch';
  let unavailable = false;
  for (const host of candidates) {
    const addrs = forward(host);
    if (addrs === null) { unavailable = true; continue; }
    if (addrs.some((a) => a.family === ip.family && a.value === ip.value)) return 'match';
  }
  return unavailable ? 'unavailable' : 'nomatch';
}
