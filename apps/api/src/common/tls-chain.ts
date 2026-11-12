import { X509Certificate } from 'node:crypto';
import { isIP } from 'node:net';
import { connect as tlsConnect, rootCertificates } from 'node:tls';

/**
 * Eksik sertifika zincirini tamamlama.
 *
 * NEDEN: labenko.com (12.11.2026) yalnizca kendi sertifikasini gonderiyordu;
 * onu imzalayan ara sertifika (Let's Encrypt YR2) ve ISRG Root X1 ile capraz
 * imzali "Root YR" yanitta yoktu. Tarayicilar eksik sertifikayi sertifikanin
 * icindeki adresten (AIA "CA Issuers") kendileri indirir; Node indirmez ve
 * baglantiyi UNABLE_TO_VERIFY_LEAF_SIGNATURE ile reddeder. Site tarayicida
 * aciliyor, bizim tarayicimiz "Siteye baglanti kurulamadi" diyordu.
 *
 * GUVENLIK: dogrulamayi KAPATMIYORUZ. Eksik sertifikalar indirilir, her halka
 * imzasiyla denetlenir ve zincir Node'un GUVENDIGI bir koke baglanmadikca
 * kullanilmaz. Yalniz boyle dogrulanmis ara sertifikalar guven deposuna
 * eklenip baglanti yeniden denenir; alan adi ve gecerlilik denetimini yine
 * Node'un kendi TLS dogrulamasi yapar. Saldirgan AIA adresinden kendi kokunu
 * sunarsa zincir guvenilen bir koke baglanmaz ve reddedilir.
 *
 * Bu dosya safe-fetch.ts'i ICE AKTARMAZ (dongu olmasin): korumali baglanti
 * secenekleri ve AIA indirme islevi disaridan verilir.
 */

/** Node'un "zincir kurulamadi" hata kodlari — tamamlama yalniz bunlarda denenir */
const CHAIN_ERROR_CODES = new Set([
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'UNABLE_TO_GET_ISSUER_CERT',
  'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
]);

export type TlsErrorDetail = 'chain' | 'expired' | 'name' | 'self_signed' | 'other';

const TLS_ERROR_DETAIL: Record<string, TlsErrorDetail> = {
  UNABLE_TO_VERIFY_LEAF_SIGNATURE: 'chain',
  UNABLE_TO_GET_ISSUER_CERT: 'chain',
  UNABLE_TO_GET_ISSUER_CERT_LOCALLY: 'chain',
  CERT_HAS_EXPIRED: 'expired',
  CERT_NOT_YET_VALID: 'expired',
  ERR_TLS_CERT_ALTNAME_INVALID: 'name',
  HOSTNAME_MISMATCH: 'name',
  DEPTH_ZERO_SELF_SIGNED_CERT: 'self_signed',
  SELF_SIGNED_CERT_IN_CHAIN: 'self_signed',
  CERT_UNTRUSTED: 'other',
  CERT_REJECTED: 'other',
  CERT_REVOKED: 'other',
  CERT_SIGNATURE_FAILURE: 'other',
  INVALID_CA: 'other',
  INVALID_PURPOSE: 'other',
  PATH_LENGTH_EXCEEDED: 'other',
  CERT_CHAIN_TOO_LONG: 'other',
};

function errorCode(err: unknown): string | undefined {
  const e = err as { code?: unknown; cause?: { code?: unknown } } | null | undefined;
  const code = e?.code ?? e?.cause?.code;
  return typeof code === 'string' ? code : undefined;
}

/** Sertifika dogrulama hatasi mi? Oyleyse turu; degilse null. */
export function tlsErrorDetail(err: unknown): TlsErrorDetail | null {
  const code = errorCode(err);
  return code ? TLS_ERROR_DETAIL[code] ?? null : null;
}

/** Sunucu zinciri eksik gondermis olabilir mi (tamamlama denenebilir mi)? */
export function isChainError(err: unknown): boolean {
  const code = errorCode(err);
  return !!code && CHAIN_ERROR_CODES.has(code);
}

/** DER ya da PEM baytlarindan sertifika; sertifika degilse (PKCS#7, HTML...) null */
export function parseCertificate(buf: Buffer): X509Certificate | null {
  try {
    return new X509Certificate(buf);
  } catch {
    return null;
  }
}

/** Sertifikanin "CA Issuers" (AIA) adresi — yalniz http/https */
export function caIssuersUrl(cert: X509Certificate): string | null {
  const m = /CA Issuers - URI:(\S+)/.exec(cert.infoAccess ?? '');
  if (!m) return null;
  try {
    const u = new URL(m[1]);
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.toString() : null;
  } catch {
    return null;
  }
}

function validAt(cert: X509Certificate, now: Date): boolean {
  const from = new Date(cert.validFrom).getTime();
  const to = new Date(cert.validTo).getTime();
  const t = now.getTime();
  return Number.isFinite(from) && Number.isFinite(to) && from <= t && t <= to;
}

/** child'i issuer mi imzalamis? Ad eslesmesi + imza dogrulamasi. */
function issuedBy(child: X509Certificate, issuer: X509Certificate): boolean {
  try {
    return child.checkIssued(issuer) && child.verify(issuer.publicKey);
  } catch {
    return false;
  }
}

/** Guvenilen kokler — konu adina gore dizinlenir (her sertifikada ~150 koku imzayla denememek icin) */
class TrustStore {
  private readonly bySubject = new Map<string, X509Certificate[]>();

  constructor(pems: readonly string[]) {
    for (const pem of pems) {
      const cert = parseCertificate(Buffer.from(pem));
      if (!cert) continue;
      const list = this.bySubject.get(cert.subject);
      if (list) list.push(cert);
      else this.bySubject.set(cert.subject, [cert]);
    }
  }

  /** cert'i imzalayan, su an gecerli bir guvenilen kok var mi? */
  trusts(cert: X509Certificate, now: Date): boolean {
    const candidates = this.bySubject.get(cert.issuer) ?? [];
    return candidates.some((root) => validAt(root, now) && issuedBy(cert, root));
  }
}

let defaultStore: TrustStore | null = null;
function storeFor(roots: readonly string[] | undefined): TrustStore {
  if (roots) return new TrustStore(roots);
  defaultStore ??= new TrustStore(rootCertificates);
  return defaultStore;
}

export type IssuerFetcher = (url: string) => Promise<Buffer>;

export interface CompleteChainInput {
  /** Sunucunun gonderdigi sertifikalar; yaprak (sitenin kendi sertifikasi) ILK */
  presented: X509Certificate[];
  /** AIA adresinden sertifika indirir — SSRF korumali olmali (safe-fetch.ts verir) */
  fetchIssuer: IssuerFetcher;
  /** Guvenilen kokler (PEM). Varsayilan: Node'un kok deposu. Yalniz test baska verir. */
  roots?: readonly string[];
  now?: Date;
  /** En fazla kac sertifika indirilir (varsayilan 4) */
  maxFetches?: number;
}

/**
 * Yapraktan guvenilen bir koke kadar eksik halkalari bulur.
 *
 * Doner: guven deposuna eklenecek ara sertifikalar (PEM, yapraktan koke dogru).
 * Zincir guvenilen bir koke BAGLANAMIYORSA null — o zaman hicbir sey eklenmez.
 * Bos dizi: eksik halka yok (hata zincir eksikliginden degil).
 */
export async function completeChain(input: CompleteChainInput): Promise<string[] | null> {
  const now = input.now ?? new Date();
  const maxFetches = input.maxFetches ?? 4;
  const trust = storeFor(input.roots);
  const [leaf, ...sent] = input.presented;
  if (!leaf) return null;

  const extras: X509Certificate[] = [];
  let current = leaf;
  let fetches = 0;

  // Derinlik siniri: gercek zincirler 2-4 halkadir
  for (let depth = 0; depth < 8; depth++) {
    if (trust.trusts(current, now)) return extras.map((c) => c.toString());

    let issuer = sent.find((c) => issuedBy(current, c)) ?? null;
    if (!issuer) {
      const url = caIssuersUrl(current);
      if (!url || fetches >= maxFetches) return null;
      fetches++;
      let body: Buffer;
      try {
        body = await input.fetchIssuer(url);
      } catch {
        return null;
      }
      const candidate = parseCertificate(body);
      // Indirilen sertifika gercekten bu halkayi imzalamis olmali
      if (!candidate || !issuedBy(current, candidate)) return null;
      issuer = candidate;
    }

    if (!issuer.ca || !validAt(issuer, now)) return null;
    // Kendini imzalayan (guvenilmeyen) kok ya da dongu: ayni sertifikaya ikinci kez gelindi
    const fp = issuer.fingerprint256;
    if (fp === current.fingerprint256 || extras.some((c) => c.fingerprint256 === fp)) return null;
    extras.push(issuer);
    current = issuer;
  }
  return null;
}

export interface PresentedChainOptions {
  host: string;
  port: number;
  /** Korumali baglanti secenekleri (safe-fetch.ts guardedConnectOptions) — SSRF denetimi burada */
  connect: { lookup: unknown; family?: 4 };
  timeoutMs: number;
}

/**
 * Sunucunun gonderdigi sertifikalari okur (yaprak ilk).
 *
 * Bu baglantida dogrulama kapalidir, cunku amac tam da dogrulanamayan zinciri
 * GORMEK. Baglanti yalniz el sikisir: istek gonderilmez, veri okunmaz, hemen
 * kapatilir. Okunan sertifikalar completeChain'de imzalariyla denetlenir.
 */
export function fetchPresentedChain(opts: PresentedChainOptions): Promise<X509Certificate[]> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const socket = tlsConnect({
      host: opts.host,
      port: opts.port,
      servername: isIP(opts.host) ? undefined : opts.host,
      rejectUnauthorized: false,
      lookup: opts.connect.lookup as never,
      ...(opts.connect.family ? { family: opts.connect.family } : {}),
    });
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      fn();
    };
    socket.setTimeout(opts.timeoutMs, () => finish(() => reject(new Error('Sertifika okunurken zaman asimi'))));
    socket.once('error', (err) => finish(() => reject(err)));
    socket.once('secureConnect', () => {
      try {
        const out: X509Certificate[] = [];
        const seen = new Set<string>();
        let cert: any = socket.getPeerCertificate(true);
        while (cert?.raw && !seen.has(cert.fingerprint256) && out.length < 8) {
          seen.add(cert.fingerprint256);
          out.push(new X509Certificate(cert.raw));
          cert = cert.issuerCertificate;
        }
        finish(() => resolve(out));
      } catch (err) {
        finish(() => reject(err as Error));
      }
    });
  });
}

// ─── Tamamlanan zincirlerin kaydi ────────────────────────────────────────────

/**
 * Tamamlanan zincir kisa sure onbellekte kalir: bir taramanin art arda istekleri
 * her seferinde yeniden indirmesin diye. Sure dolunca ilk istek NORMAL yoldan
 * denenir; site sahibi zinciri duzelttiyse bu gorulur ve bulgu kalkar (uzun
 * onbellek, onarilan siteyi saatlerce "eksik" gostermeye devam ederdi).
 */
const COMPLETED_TTL_MS = 10 * 60 * 1000;
/** Basarisiz deneme kisa tutulur: gecici bir indirme hatasi "Tekrar dene"yi dakikalarca kilitlemesin */
const FAILED_TTL_MS = 60 * 1000;
const MAX_HOSTS = 500;

/** Zincirini bizim tamamladigimiz alan adlari (surec ici) — denetimde bulgu olarak gosterilir */
const completedHosts = new Map<string, number>();

function remember(map: Map<string, unknown>, key: string, value: unknown): void {
  map.delete(key);
  map.set(key, value);
  if (map.size > MAX_HOSTS) map.delete(map.keys().next().value as string);
}

/**
 * Bu surec, verilen alan adina en son eksik sertifika zincirini tamamlayarak
 * mi baglandi? (Site bize acik, ama zinciri eksik gonderiyor.) Normal yoldan
 * basarili bir baglanti kaydi siler (bkz. tlsChainNotNeeded).
 */
export function tlsChainCompletedFor(hostname: string, now: number = Date.now()): boolean {
  const at = completedHosts.get(hostname.toLowerCase());
  return at !== undefined && now - at < COMPLETED_TTL_MS;
}

/** Alan adina normal yoldan (zincir tamamlamadan) baglanildi: "zinciri eksik" kaydini sil. */
export function tlsChainNotNeeded(hostname: string): void {
  completedHosts.delete(hostname.toLowerCase());
}

export interface ChainCompleterOptions {
  connect: { lookup: unknown; family?: 4 };
  fetchIssuer: IssuerFetcher;
  roots?: readonly string[];
  /** Sertifika okuma + indirme icin toplam sure siniri (varsayilan 10 sn) */
  budgetMs?: number;
}

/** Alan adi basina zincir tamamlama: sonuc onbellege alinir, es zamanli istekler tek deneme yapar. */
export class ChainCompleter {
  private readonly done = new Map<string, { extras: string[]; at: number }>();
  private readonly failed = new Map<string, number>();
  private readonly inflight = new Map<string, Promise<string[] | null>>();

  constructor(private readonly opts: ChainCompleterOptions) {}

  private key(url: URL): string {
    return `${url.hostname.toLowerCase()}:${url.port || '443'}`;
  }

  /** Daha once tamamlanmis zincirin ek sertifikalari (PEM); yoksa null */
  cached(url: URL): string[] | null {
    const hit = this.done.get(this.key(url));
    if (!hit) return null;
    if (Date.now() - hit.at > COMPLETED_TTL_MS) {
      this.done.delete(this.key(url));
      return null;
    }
    return hit.extras;
  }

  /** Onbellekteki zinciri unut (sunucu sertifikasini degistirmis olabilir) */
  forget(url: URL): void {
    this.done.delete(this.key(url));
  }

  /** Zinciri tamamlamayi dener. Doner: eklenecek sertifikalar; tamamlanamazsa null. */
  complete(url: URL): Promise<string[] | null> {
    const key = this.key(url);
    const known = this.cached(url);
    if (known) return Promise.resolve(known);
    const failedAt = this.failed.get(key);
    if (failedAt !== undefined && Date.now() - failedAt < FAILED_TTL_MS) return Promise.resolve(null);
    const running = this.inflight.get(key);
    if (running) return running;

    const attempt = this.run(url)
      .catch(() => null)
      .then((extras) => {
        this.inflight.delete(key);
        if (extras && extras.length > 0) {
          remember(this.done as Map<string, unknown>, key, { extras, at: Date.now() });
          remember(completedHosts as Map<string, unknown>, url.hostname.toLowerCase(), Date.now());
          this.failed.delete(key);
          return extras;
        }
        remember(this.failed as Map<string, unknown>, key, Date.now());
        return null;
      });
    this.inflight.set(key, attempt);
    return attempt;
  }

  private async run(url: URL): Promise<string[] | null> {
    const budgetMs = this.opts.budgetMs ?? 10_000;
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<null>((resolve) => {
      timer = setTimeout(() => resolve(null), budgetMs);
    });
    const work = (async () => {
      const presented = await fetchPresentedChain({
        host: url.hostname.replace(/^\[|\]$/g, ''),
        port: url.port ? Number(url.port) : 443,
        connect: this.opts.connect,
        timeoutMs: Math.min(8_000, budgetMs),
      });
      return completeChain({ presented, fetchIssuer: this.opts.fetchIssuer, roots: this.opts.roots });
    })();
    try {
      return await Promise.race([work, timeout]);
    } finally {
      if (timer) clearTimeout(timer);
      // Sure dolduysa arka planda suren is sessizce bitsin
      work.catch(() => {});
    }
  }
}
