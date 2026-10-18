import { HttpException, HttpStatus } from '@nestjs/common';
import { unblockHint, type BlockKind, type BlockSignal } from '../common/block-detect.js';
import { SafeFetchError } from '../common/safe-fetch.js';

/**
 * Tarayicimiz siteyi okuyabildi mi? — "site kotu" ile "biz giremedik" ayrimi.
 *
 * NEDEN VAR: ofsayt.com Cloudflare arkasinda tarayicimiza 403 "Sorry, you have
 * been blocked" donuyordu; denetim engel sayfasini site sanip 44 puan yazdi.
 * Anasayfa okunamadiginda (engel, ulasilamama, sunucu hatasi) PUAN
 * HESAPLANMAZ ve Audit satiri YAZILMAZ — overallScore zorunlu bir sayi ve
 * rapor, trend, MCP, ozet gibi 20'den fazla yer onu gercek skor diye okuyor.
 * Durum bunun yerine kv_store'a yazilir; panel "Erisim engellendi" der ve
 * nasil izin verilecegini gosterir. Basarili bir tarama kaydi siler.
 */

export type CrawlAccessKind = BlockKind | 'robots' | 'timeout' | 'dns' | 'network' | 'unsafe_target' | 'http_error';

export interface CrawlAccessIssue {
  /**
   * blocked: site bizi reddetti (WAF, bot dogrulamasi, giris, hiz siniri, 503)
   *          ya da robots.txt RanksUpBot'u yasakladi
   * unreachable: baglanti kurulamadi, zaman asimi, alan adi cozulemedi,
   *          sunucu hatasi
   */
  state: 'blocked' | 'unreachable';
  kind: CrawlAccessKind;
  url: string;
  status: number | null;
  vendor: string | null;
  /** Kullaniciya gosterilecek kisa Turkce aciklama */
  reason: string;
  /** Site sahibinin yapmasi gereken (Turkce) */
  hint: string;
}

export interface CrawlAccessRecord extends CrawlAccessIssue {
  /** ISO zaman */
  at: string;
  source: 'audit' | 'brain';
}

export function accessFromBlock(url: string, signal: BlockSignal): CrawlAccessIssue {
  return {
    state: 'blocked',
    kind: signal.kind,
    url,
    status: signal.status,
    vendor: signal.vendor,
    reason: signal.reason,
    hint: unblockHint(signal),
  };
}

export function accessFromRobots(url: string): CrawlAccessIssue {
  return {
    state: 'blocked',
    kind: 'robots',
    url,
    status: null,
    vendor: null,
    reason: 'robots.txt dosyası RanksUpBot\'un bu adresi taramasını yasaklıyor.',
    hint: 'Taramaya izin vermek için robots.txt dosyasındaki "User-agent: RanksUpBot" grubundan ilgili Disallow kuralını kaldırın.',
  };
}

/** SafeFetchError → kullaniciya gosterilecek neden. Ic adres/IP mesaja SIZMAZ. */
export function accessFromFetchError(url: string, err: unknown): CrawlAccessIssue {
  const code = err instanceof SafeFetchError ? err.code : 'network';
  const base = { state: 'unreachable' as const, url, status: null, vendor: null };
  switch (code) {
    case 'timeout':
      return {
        ...base, kind: 'timeout',
        reason: 'Site zamanında yanıt vermedi (zaman aşımı).',
        hint: 'Sunucunun açık ve hızlı yanıt verdiğini kontrol edip taramayı yeniden başlatın.',
      };
    case 'dns':
      return {
        ...base, kind: 'dns',
        reason: 'Alan adı çözülemedi.',
        hint: 'Alan adının DNS kayıtlarının doğru olduğunu ve sitenin yayında olduğunu kontrol edin.',
      };
    case 'blocked_address':
    case 'protocol':
    case 'port':
      return {
        ...base, kind: 'unsafe_target',
        reason: 'Alan adı özel veya iç ağ adresine çözülüyor; güvenlik nedeniyle bağlantı kurulmadı.',
        hint: 'Alan adının herkese açık bir sunucuya yönlendiğini kontrol edin.',
      };
    case 'redirect':
      return {
        ...base, kind: 'network',
        reason: 'Site çok fazla yönlendirme yaptı (yönlendirme döngüsü olabilir).',
        hint: 'Sunucudaki yönlendirme kurallarını kontrol edin.',
      };
    // Sunucu cevap verdi ama govde cozulemedi (zstd gibi desteklenmeyen ya da
    // bozuk sikistirma — safe-fetch.ts). "Baglanti kurulamadi" demek yanlis
    // olurdu: site ayakta, sorun sikistirma ayarinda.
    case 'content_encoding':
      return {
        ...base, kind: 'network',
        reason: 'Site yanıtı çözülemedi: sunucu desteklenmeyen ya da bozuk bir sıkıştırmayla (Content-Encoding) yanıt verdi.',
        hint: 'Sunucunun yalnızca gzip, br veya deflate sıkıştırması kullandığını ve sıkıştırılmış dosyaların bozuk olmadığını kontrol edin.',
      };
    default:
      return {
        ...base, kind: 'network',
        reason: 'Siteye bağlantı kurulamadı.',
        hint: 'Sunucunun açık olduğunu ve HTTPS sertifikasının geçerli olduğunu kontrol edin.',
      };
  }
}

/** Engel olmayan HTTP hatasi (404, 500, 502...) — sitenin kendi durumu */
export function accessFromHttpStatus(url: string, status: number, label = 'Anasayfa'): CrawlAccessIssue {
  return {
    state: 'unreachable',
    kind: 'http_error',
    url,
    status,
    vendor: null,
    reason: `${label} HTTP ${status} döndürdü.`,
    hint: status >= 500
      ? 'Sunucu hatasını giderdikten sonra taramayı yeniden başlatın.'
      : 'Site adresinin doğru olduğundan ve anasayfanın açıldığından emin olun.',
  };
}

/**
 * Son tarama denemesi siteye erisemediyse VE bu deneme eldeki denetimden
 * YENIYSE kayit, degilse null.
 *
 * TEK KURAL, TEK YER: anasayfa okunamayan taramada Audit satiri yazilmaz
 * (yukaridaki NEDEN VAR), yani en son Audit satiri ESKI bir olcumdur. Kayit
 * ondan yeniyse eldeki skor guncel degildir; eskiyse erisim sonradan duzelmis
 * demektir (basarili tarama kaydi zaten siler). Bu kural audit getLatest,
 * GEO Score Card, MCP araclari ve raporlarda ayri ayri kopyalanmisti; biri
 * kayinca panel "olculemedi" derken rapor eski skoru guncel diye yaziyordu.
 * Panel tarafindaki karsiligi web lib/crawl-access.ts currentCrawlAccess.
 *
 * Denetim hic yoksa kayit gecerlidir. Kayit tarihi bozuksa guvenli taraf:
 * null (uydurma engel yok); denetim tarihi bozuksa kayit gecerli sayilir.
 */
export function crawlAccessNewerThanAudit(
  access: CrawlAccessRecord | null,
  auditRanAt: Date | string | null | undefined,
): CrawlAccessRecord | null {
  if (!access) return null;
  if (!auditRanAt) return access;
  const at = new Date(access.at).getTime();
  const ranAt = new Date(auditRanAt).getTime();
  if (!Number.isFinite(at)) return null;
  return !Number.isFinite(ranAt) || at > ranAt ? access : null;
}

/** Panelde ve is hatasinda gorunen tek satir */
export function crawlAccessMessage(issue: CrawlAccessIssue): string {
  const title = issue.state === 'blocked' ? 'Erişim engellendi' : 'Siteye ulaşılamadı';
  return `${title}: ${issue.reason} ${issue.hint}`;
}

/**
 * Anasayfa okunamadi — denetim PUAN VERMEDI. 422: istek gecerli ama site
 * su an olculemiyor. Worker'da duz bir Error gibi davranir (is FAILED, mesaj
 * yukaridaki satir); HTTP ucunda panel mesaji ve `access` alanini alir.
 */
export class CrawlAccessError extends HttpException {
  constructor(public readonly issue: CrawlAccessIssue) {
    super(
      {
        statusCode: HttpStatus.UNPROCESSABLE_ENTITY,
        code: issue.state === 'blocked' ? 'CRAWL_BLOCKED' : 'CRAWL_UNREACHABLE',
        message: crawlAccessMessage(issue),
        access: issue,
      },
      HttpStatus.UNPROCESSABLE_ENTITY,
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
//  kv_store kaydi — sema degisikligi gerektirmez
// ─────────────────────────────────────────────────────────────────────────────

export const CRAWL_ACCESS_KEY_PREFIX = 'crawl-access:';

/** Site silinse de satir sonsuza kalmasin; okuma tarafi suresi gecmisi yok sayar */
const RETENTION_MS = 90 * 24 * 60 * 60 * 1000;

/** Prisma'nin yalnizca kvStore ucu — testte sahtelenebilir */
export interface KvStoreClient {
  kvStore: {
    upsert(args: any): Promise<unknown>;
    deleteMany(args: any): Promise<unknown>;
    findUnique(args: any): Promise<{ value: string; expiresAt?: Date | null } | null>;
  };
}

export function crawlAccessKey(siteId: string): string {
  return `${CRAWL_ACCESS_KEY_PREFIX}${siteId}`;
}

export async function recordCrawlAccess(
  prisma: KvStoreClient,
  siteId: string,
  issue: CrawlAccessIssue,
  source: CrawlAccessRecord['source'],
): Promise<void> {
  const key = crawlAccessKey(siteId);
  const record: CrawlAccessRecord = { ...issue, at: new Date().toISOString(), source };
  const value = JSON.stringify(record);
  const expiresAt = new Date(Date.now() + RETENTION_MS);
  await prisma.kvStore.upsert({ where: { key }, create: { key, value, expiresAt }, update: { value, expiresAt } });
}

export async function clearCrawlAccess(prisma: KvStoreClient, siteId: string): Promise<void> {
  await prisma.kvStore.deleteMany({ where: { key: crawlAccessKey(siteId) } });
}

/** Okuma ASLA hata atmaz: GET uclarini bir kv sorunu dusurmemeli. */
export async function readCrawlAccess(prisma: KvStoreClient, siteId: string): Promise<CrawlAccessRecord | null> {
  try {
    const row = await prisma.kvStore.findUnique({ where: { key: crawlAccessKey(siteId) } });
    if (!row) return null;
    if (row.expiresAt && row.expiresAt.getTime() < Date.now()) return null;
    const parsed = JSON.parse(row.value) as Partial<CrawlAccessRecord>;
    if (!parsed || typeof parsed.reason !== 'string' || typeof parsed.at !== 'string') return null;
    if (parsed.state !== 'blocked' && parsed.state !== 'unreachable') return null;
    return {
      state: parsed.state,
      kind: (parsed.kind ?? 'network') as CrawlAccessKind,
      url: String(parsed.url ?? ''),
      status: typeof parsed.status === 'number' ? parsed.status : null,
      vendor: typeof parsed.vendor === 'string' ? parsed.vendor : null,
      reason: parsed.reason,
      hint: String(parsed.hint ?? ''),
      at: parsed.at,
      source: parsed.source === 'brain' ? 'brain' : 'audit',
    };
  } catch {
    return null;
  }
}
