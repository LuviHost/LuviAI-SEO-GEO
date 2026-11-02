import { Logger } from '@nestjs/common';
import { promises as dnsPromises } from 'node:dns';
import {
  CidrSet,
  IP_LIST_SOURCES,
  classifyBotHit,
  decideRdns,
  parseIp,
  parseIpList,
  pickClientIp,
  requiredListIds,
  BOT_VERIFY_METHODS,
  type BotClassification,
  type ClassifyInput,
  type IpListId,
  type ParsedIp,
} from './bot-verification.js';

/**
 * Bot dogrulayici — resmi IP listelerini ceker/onbellege alir, ters DNS yapar,
 * saf siniflandiriciyi (bot-verification.ts) besler.
 *
 * DAYANIKLILIK KURALLARI:
 *  - Liste 24 saat taze sayilir; basarisiz cekimde 15 dk sonra yeniden denenir.
 *  - Basarisizlikta eldeki eski kopya 7 gune kadar kullanilir; hic kopya yoksa
 *    liste "okunamadi" sayilir ve isabetler 'unknown' olur (fail-open). Ingest
 *    hicbir kosulda bu yuzden dusmez.
 *  - Ag erisimi ENJEKTE edilir (fetchText / reverse / resolve): testler sahte
 *    liste ve sahte DNS ile calisir.
 *  - Ham IP saklanmaz; ters DNS onbellegi bellekte, sinirli ve sureli.
 */

export interface BotVerifierDeps {
  /** Govdeyi metin olarak doner; 2xx disi ya da ag hatasinda firlatir */
  fetchText(url: string): Promise<string>;
  /** PTR adlari; NXDOMAIN icin [] doner, gecici hatada firlatir */
  reverse(ip: string): Promise<string[]>;
  /** A + AAAA; ad yoksa [] doner, gecici hatada firlatir */
  resolve(host: string): Promise<string[]>;
  now(): number;
}

const LIST_TTL_MS = 24 * 3_600_000;
const LIST_RETRY_MS = 15 * 60_000;
const LIST_STALE_MAX_MS = 7 * 86_400_000;
const LIST_MAX_BYTES = 2 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 10_000;

const RDNS_TTL_MS = 6 * 3_600_000;
const RDNS_FAIL_TTL_MS = 10 * 60_000;
const RDNS_TIMEOUT_MS = 2_000;
const RDNS_CACHE_MAX = 20_000;
/** Tek cagrida en fazla bu kadar yeni ters DNS sorgusu (log yuklemesi binlerce IP tasiyabilir) */
const RDNS_MAX_PER_CALL = 200;
const RDNS_CONCURRENCY = 8;

/** Ingest'in listeleri beklemeye razi oldugu en uzun sure — sonra eldekiyle siniflandirir */
const ENSURE_BUDGET_MS = 3_000;

const DNS_MISS = new Set(['ENOTFOUND', 'ENODATA', 'NXDOMAIN', 'ENONAME']);

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timeout')), ms);
    (t as { unref?: () => void }).unref?.();
    p.then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); });
  });
}

export const defaultBotVerifierDeps: BotVerifierDeps = {
  async fetchText(url) {
    const res = await fetch(url, {
      headers: { 'user-agent': 'RanksUpBotVerifier/1.0 (+https://ranksup.ai)', accept: 'application/json,text/html;q=0.8,*/*;q=0.5' },
      redirect: 'follow',
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const text = await res.text();
    if (text.length > LIST_MAX_BYTES) throw new Error('liste cok buyuk');
    return text;
  },
  async reverse(ip) {
    try {
      return await dnsPromises.reverse(ip);
    } catch (err: any) {
      if (DNS_MISS.has(err?.code)) return [];
      throw err;
    }
  },
  async resolve(host) {
    const out: string[] = [];
    let miss = 0;
    for (const fn of [dnsPromises.resolve4, dnsPromises.resolve6]) {
      try {
        out.push(...(await fn(host)));
      } catch (err: any) {
        if (DNS_MISS.has(err?.code)) miss++;
        else throw err;
      }
    }
    return miss === 2 ? [] : out;
  },
  now: () => Date.now(),
};

/** Testte ag yok: her cekim basarisiz → listeler okunamadi → 'unknown' */
export const offlineBotVerifierDeps: BotVerifierDeps = {
  fetchText: async () => { throw new Error('offline'); },
  reverse: async () => { throw new Error('offline'); },
  resolve: async () => { throw new Error('offline'); },
  now: () => Date.now(),
};

interface ListEntry {
  set: CidrSet | null;
  /** Son BASARILI yukleme */
  loadedAt: number;
  /** Son deneme (basarili ya da degil) */
  triedAt: number;
}

interface RdnsEntry {
  res: 'match' | 'nomatch' | 'unavailable';
  until: number;
}

export interface VerifiedHit extends BotClassification {
  /** Cloudflare Worker'in bildirdigi ASN (saklanir; IP saklanmaz) */
  asn: number | null;
}

export class BotVerifier {
  private readonly log = new Logger('BotVerifier');
  private readonly lists = new Map<IpListId, ListEntry>();
  private readonly rdnsCache = new Map<string, RdnsEntry>();
  private loading: Promise<void> | null = null;

  constructor(private readonly deps: BotVerifierDeps = defaultBotVerifierDeps) {}

  /** Bayat ya da eksik listeleri ceker; ayni anda tek yukleme. Asla firlatmaz. */
  ensureFresh(): Promise<void> {
    if (this.loading) return this.loading;
    const now = this.deps.now();
    const due = requiredListIds().filter((id) => {
      const e = this.lists.get(id);
      if (!e) return true;
      if (e.set && now - e.loadedAt < LIST_TTL_MS) return false;
      return now - e.triedAt >= LIST_RETRY_MS;
    });
    if (due.length === 0) return Promise.resolve();
    const run = Promise.all(due.map((id) => this.loadList(id))).then(() => undefined);
    this.loading = run.finally(() => { this.loading = null; });
    return this.loading;
  }

  private async loadList(id: IpListId): Promise<void> {
    const src = IP_LIST_SOURCES[id];
    const now = this.deps.now();
    const prev = this.lists.get(id);
    try {
      const text = await this.deps.fetchText(src.url);
      const cidrs = parseIpList(src.format === 'ip-text' ? text : safeParse(text), src);
      if (!cidrs) throw new Error('bicim tanınmadi ya da liste bos');
      this.lists.set(id, { set: CidrSet.from(cidrs), loadedAt: now, triedAt: now });
    } catch (err: any) {
      // Eski kopya varsa korunur (lookup'ta 7 gun siniri uygulanir)
      this.lists.set(id, { set: prev?.set ?? null, loadedAt: prev?.loadedAt ?? 0, triedAt: now });
      this.log.warn(`IP listesi okunamadi (${id} ${src.url}): ${err?.message ?? err}`);
    }
  }

  /** Liste yuklu ve 7 gunden eski degilse kume; aksi halde null (okunamadi) */
  listSet(id: IpListId): CidrSet | null {
    const e = this.lists.get(id);
    if (!e?.set) return null;
    if (this.deps.now() - e.loadedAt > LIST_STALE_MAX_MS) return null;
    return e.set;
  }

  /** Teshis: hangi liste yuklu (ops/test) */
  listStatus(): Record<string, { loaded: boolean; entries: number; loadedAt: string | null }> {
    const out: Record<string, { loaded: boolean; entries: number; loadedAt: string | null }> = {};
    for (const id of requiredListIds()) {
      const set = this.listSet(id);
      const e = this.lists.get(id);
      out[id] = { loaded: !!set, entries: set?.size ?? 0, loadedAt: e?.loadedAt ? new Date(e.loadedAt).toISOString() : null };
    }
    return out;
  }

  /**
   * SENKRON siniflandirma — yalniz eldeki listelerle, ters DNS yok (ara katman
   * istegi bekletmez). Bayat listeler arka planda tazelenir.
   */
  classifySync(input: ClassifyInput): VerifiedHit {
    this.ensureFresh().catch(() => undefined);
    const c = classifyBotHit(input, { list: (id) => this.listSet(id) });
    return { ...c, asn: normAsn(input.asn) };
  }

  /**
   * ASENKRON toplu siniflandirma — ingest ve log yuklemesi. Listeler en fazla
   * ENSURE_BUDGET_MS beklenir; ters DNS yalniz liste eslesmeyen ve ters DNS
   * yontemi olan botlar icin, tekil IP basina bir kez (onbellekli, sinirli).
   * Hicbir hata disari sizmaz: en kotu durumda her isabet 'unknown'.
   */
  async classifyMany(inputs: ClassifyInput[]): Promise<VerifiedHit[]> {
    try {
      await withTimeout(this.ensureFresh(), ENSURE_BUDGET_MS);
    } catch { /* eldekiyle devam */ }

    const cf = this.listSet('cloudflare');
    const isCf = cf ? (ip: ParsedIp) => cf.has(ip) : null;
    // Ters DNS gereken (ip, son ekler) ciftleri
    const need = new Map<string, { ip: ParsedIp; raw: string; suffixes: readonly string[] }>();
    for (const inp of inputs) {
      const m = BOT_VERIFY_METHODS[inp.bot];
      if (!m?.rdns?.length) continue;
      const picked = pickClientIp(inp, isCf);
      if (!picked.ip) continue;
      if (m.lists?.some((id) => this.listSet(id)?.has(picked.ip!))) continue;
      const key = rdnsKey(picked.ip, m.rdns);
      if (this.rdnsCached(key) || need.has(key)) continue;
      need.set(key, { ip: picked.ip, raw: ipText(picked.ip), suffixes: m.rdns });
    }
    if (need.size > 0) {
      try {
        await this.resolveRdns([...need.entries()].slice(0, RDNS_MAX_PER_CALL));
      } catch { /* ters DNS opsiyonel */ }
    }

    return inputs.map((inp) => {
      try {
        const c = classifyBotHit(inp, {
          list: (id) => this.listSet(id),
          rdns: (ip, suffixes) => this.rdnsCached(rdnsKey(ip, suffixes))?.res ?? 'unavailable',
        });
        return { ...c, asn: normAsn(inp.asn) };
      } catch {
        return { verdict: 'unknown', reason: 'list-unavailable', asn: normAsn(inp.asn) };
      }
    });
  }

  private rdnsCached(key: string): RdnsEntry | undefined {
    const e = this.rdnsCache.get(key);
    if (!e) return undefined;
    if (e.until <= this.deps.now()) { this.rdnsCache.delete(key); return undefined; }
    return e;
  }

  private async resolveRdns(jobs: Array<[string, { ip: ParsedIp; raw: string; suffixes: readonly string[] }]>): Promise<void> {
    let i = 0;
    const worker = async () => {
      while (i < jobs.length) {
        const [key, job] = jobs[i++]!;
        const res = await this.rdnsOne(job.ip, job.raw, job.suffixes);
        const ttl = res === 'unavailable' ? RDNS_FAIL_TTL_MS : RDNS_TTL_MS;
        this.rdnsCache.set(key, { res, until: this.deps.now() + ttl });
        while (this.rdnsCache.size > RDNS_CACHE_MAX) {
          const oldest = this.rdnsCache.keys().next().value;
          if (oldest === undefined) break;
          this.rdnsCache.delete(oldest);
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(RDNS_CONCURRENCY, jobs.length) }, worker));
  }

  private async rdnsOne(ip: ParsedIp, raw: string, suffixes: readonly string[]): Promise<'match' | 'nomatch' | 'unavailable'> {
    let names: string[] | null;
    try {
      names = await withTimeout(this.deps.reverse(raw), RDNS_TIMEOUT_MS);
    } catch {
      names = null;
    }
    const forward = new Map<string, ParsedIp[] | null>();
    for (const host of (names ?? []).slice(0, 5)) {
      try {
        const addrs = await withTimeout(this.deps.resolve(host), RDNS_TIMEOUT_MS);
        forward.set(host, addrs.map((a) => parseIp(a)).filter((a): a is ParsedIp => !!a));
      } catch {
        forward.set(host, null);
      }
    }
    return decideRdns(ip, names, (h) => forward.get(h) ?? null, suffixes);
  }
}

function safeParse(text: string): unknown {
  try { return JSON.parse(text); } catch { return null; }
}

function normAsn(v: unknown): number | null {
  const n = typeof v === 'number' ? v : typeof v === 'string' && /^\d{1,10}$/.test(v) ? Number(v) : NaN;
  return Number.isInteger(n) && n > 0 && n < 2 ** 32 ? n : null;
}

function rdnsKey(ip: ParsedIp, suffixes: readonly string[]): string {
  return `${ip.family}:${ip.value.toString(16)}|${suffixes.join(',')}`;
}

/** ParsedIp → metin (ters DNS sorgusu icin) */
export function ipText(ip: ParsedIp): string {
  if (ip.family === 4) {
    const v = ip.value;
    return [24n, 16n, 8n, 0n].map((s) => ((v >> s) & 0xffn).toString()).join('.');
  }
  const groups: string[] = [];
  for (let s = 112n; s >= 0n; s -= 16n) groups.push(((ip.value >> s) & 0xffffn).toString(16));
  return groups.join(':');
}

/**
 * Surec basina TEK dogrulayici: Nest servisi, ara katman ve log yuklemesi ayni
 * liste onbellegini paylasir (her biri ayri ayri 16 liste cekmesin).
 * Vitest altinda ag kapali (offline): testler kendi sahte bagimliliklarini verir.
 */
let shared: BotVerifier | null = null;
export function sharedBotVerifier(): BotVerifier {
  shared ??= new BotVerifier(process.env.VITEST && process.env.BOT_VERIFY_NETWORK !== '1' ? offlineBotVerifierDeps : defaultBotVerifierDeps);
  return shared;
}
