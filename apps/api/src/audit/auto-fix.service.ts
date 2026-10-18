import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service.js';
import { SiteCrawlerService, type CrawlResult } from '../sites/site-crawler.service.js';
import { GeneratorsService } from './generators.service.js';
import { decryptCredentials } from '@luviai/shared';
import { getAdapter } from '@luviai/adapters';
import { publishTargetBlockReason } from '../publish-targets/publish-target-url.js';
import { crawlAccessMessage } from '../sites/crawl-access.js';
import { AppliedFixService } from './applied-fix.service.js';
import { JobQueueService } from '../jobs/job-queue.service.js';
import { partitionFixes, canonicalFixKey, ROOT_FIX_FILENAME, type RootFixKey } from './fix-routes.js';
import { probeUrl, isUnmeasured, type Probe } from './axo-fetch.js';
import { mergeRobotsTxt, assessRobotsBody, robotsSitemapUrls, parseRobots } from './robots-merge.js';
import { lineDiff, type DiffLine } from './line-diff.js';
import { looksLikeHtml, sitemapKind } from './axo-validators.js';

/**
 * Kok dosya duzeltmeleri — robots.txt, sitemap.xml, llms.txt — ONIZLEMELI ve
 * GERI ALINABILIR.
 *
 * NEDEN YENIDEN YAZILDI: eski surum uretilen dosyayi musterinin mevcut
 * dosyasinin UZERINE yaziyordu: birlestirme, yedek, onizleme, geri alma yoktu.
 * Elle yazilmis Disallow kurallari, CMS'in site haritasi, musterinin kendi
 * llms.txt'si tek tikla kayboluyordu. Ayrica auth.md / agent.json uydurma
 * bilgi yayinliyordu (fix-routes.ts'ten cikarildi).
 *
 * Kurallar:
 *  - robots.txt: canli dosya okunur ve robots-merge.ts ile YALNIZ eksikler
 *    sona eklenir (mevcut satirlar byte byte korunur, hicbir Disallow
 *    zayiflamaz). Canli dosya guvenilir okunamiyorsa (engel, zaman asimi,
 *    soft-404, kesik, UTF-8 disi) YAZILMAZ. Her zaman onizleme onayi ister.
 *  - sitemap.xml / llms.txt: yalniz dosya YOKKEN olusturulur. Var olan gecerli
 *    dosyanin uzerine yazilmaz; tek istisna RanksUp'in kendi yazdigi ve o
 *    gunden beri DEGISMEMIS dosya (son kaydin sha256'si ile ayni).
 *  - Onizleme: mevcut icerik + onerilen icerik + satir farki + previewToken.
 *    Uygulama token'la gelir; canli dosya o arada degistiyse reddedilir.
 *  - Yedek: AppliedFix.detail.previous mevcut icerigi tasir; geri alma bu
 *    icerigi yazar (yalniz dosya o gunden beri degismediyse).
 *  - Yazimdan sonra canli adres yeniden okunur; "yuklendi" ile "sitede
 *    gorunuyor" ayri raporlanir (onbellek); dogrulanamayan yazim sonuctaki
 *    `unverified` listesinde de doner, duz basari sayilmaz.
 *  - Kok dizin KANITI (proveRootDir): karar sitenin canli adresinden
 *    (https://<site>/robots.txt ...) veriliyor ama yazim adaptorun sabit
 *    kokune gidiyordu (cPanel'de hep public_html, FTP/SFTP'de giris dizini).
 *    Paylasimli hostingte eklenti alan adi (public_html/ek.com) ana alan
 *    adinin klasorunden sunulmaz: ek.com icin "dosya yok, olustur" karari ana
 *    alan adinin sitemap/llms/robots dosyasinin UZERINE yaziyordu; yedek de
 *    ek.com'dan okundugu icin geri alinamiyordu. Artik her yazimdan once aday
 *    klasore rastgele icerikli ROOT_VERIFY_FILENAME yazilir ve
 *    https://<site>/ROOT_VERIFY_FILENAME birebir okunmadan hicbir kok dosya
 *    yazilmaz ('wrong_root' / 'root_unverified').
 */

export type FixAction = 'merge' | 'create' | 'regenerate' | 'none' | 'refuse';

export interface PreviewOptions {
  /**
   * robots.txt Content-Signal ai-train degeri — varsayilan yes; secim
   * musterinin. Satir yalniz bir beyandir, hicbir botu teknik olarak
   * engellemez (bkz. agent-readiness-checks.ts content-signals notu).
   */
  aiTrain?: 'yes' | 'no';
}

export interface ApplyOptions {
  /** fix anahtari (takma ad ya da kanonik) → onizlemeden gelen previewToken */
  confirm?: Record<string, string> | null;
  userId?: string | null;
}

export interface FixPreview {
  fix: string;
  canonical: RootFixKey;
  filename: string;
  url: string;
  action: FixAction;
  canApply: boolean;
  reason: string;
  notes: string[];
  current: { exists: boolean; status: number | null; content: string | null };
  proposed: string | null;
  diff: DiffLine[];
  stats: { added: number; removed: number };
  previewToken: string | null;
  target: { name: string | null; type: string } | null;
}

/** Canli durum karari — icerik uretimi (tarama) haric */
interface LiveDecision {
  fix: RootFixKey;
  url: string;
  action: FixAction;
  canApply: boolean;
  reason: string;
  notes: string[];
  live: Probe | null;
  currentContent: string | null;
  currentExists: boolean;
  /** 'absent' ya da canli icerigin sha256'si — onizleme ile uygulama arasinda degismemeli */
  fingerprint: string;
  proposed: string | null;
  robotsOptions?: { aiTrain: 'yes' | 'no'; sitemapUrl: string | null };
}

interface StoredPreview {
  fix: RootFixKey;
  fingerprint: string;
  proposedSha: string;
  action: FixAction;
  robotsOptions: { aiTrain: 'yes' | 'no'; sitemapUrl: string | null } | null;
  /** sitemap/llms: taramadan uretilen icerik (yeniden tarama farkli sonuc verebilir) */
  proposed: string | null;
}

const PREVIEW_TTL_MS = 30 * 60_000;
/** kv_store.value MySQL TEXT (64 KB); payi birakarak */
const KV_MAX_BYTES = 60_000;

const FIX_ALIASES: Record<RootFixKey, string[]> = {
  robots: ['robots', 'robots_txt'],
  sitemap: ['sitemap', 'sitemap_xml'],
  llms: ['llms', 'llms_txt'],
};

const NO_TARGET_TEXT = 'Dosya yazabilen bir yayın hedefi yok (SFTP / FTP / cPanel); önerilen içeriği kopyalayıp site köküne elle yükleyebilirsin.';

/**
 * Kok dizin dogrulama dosyasi (sabit ad, belgelenmis). Her kok dosya
 * yazimindan once aday klasore yeni rastgele icerikle yazilir ve sitenin
 * kendi adresinden okunur. Adaptorlerde dosya silme olmadigi icin SILINMEZ;
 * her denemede uzerine yazilir. Icerigi yalniz rastgele bir anahtar: kucuk,
 * zararsiz, silinebilir.
 */
export const ROOT_VERIFY_FILENAME = 'ranksup-verify.txt';
/** Bir kanit denemesinde en fazla bu kadar klasor yoklanir (her biri bir yukleme + bir okuma) */
const ROOT_VERIFY_MAX_DIRS = 4;
const ROOT_VERIFY_NOTE = `Yazmadan önce yayın hedefinin bu siteyi sunduğu küçük bir doğrulama dosyasıyla (${ROOT_VERIFY_FILENAME}) kontrol edilir; dosya sitende kalır, silebilirsin.`;

/**
 * Adaptorun config.rootPath yokken yazdigi kok (packages/adapters:
 * cpanel-api.ts 'public_html'; ftp.ts / sftp.ts giris dizini).
 */
const ADAPTER_DEFAULT_ROOT: Record<string, string> = { CPANEL_API: 'public_html', FTP: '', SFTP: '' };
/** Klasik web koku klasor adlari — remotePath'te buradan sonrasi aday kok klasorlerdir */
const DOC_ROOT_SEGMENT = /^(?:public_html|htdocs|httpdocs|www|wwwroot|html)$/i;

/**
 * Kok dosyalarin yazilabilecegi ADAY klasorler, denenme sirasiyla. Hicbiri
 * kanitlanmadan kullanilmaz (proveRootDir); burasi yalniz tahmin listesidir.
 *  1. config.rootPath / docRoot ya da adaptorun varsayilani (eski davranis).
 *  2. remotePath'in (yazi klasoru, ornek public_html/ek.com/blog) web koku
 *     klasorunden baslayan ust klasorleri: public_html, public_html/ek.com,
 *     public_html/ek.com/blog. Eklenti alan adi ve alt alan adi klasorleri
 *     boyle bulunur. '..' iceren yol turetilmez.
 * Bos dize = FTP/SFTP giris dizini.
 */
export function rootDirCandidates(target: { type?: unknown; config?: unknown }): string[] {
  const cfg = target.config && typeof target.config === 'object' ? (target.config as Record<string, unknown>) : {};
  const segments = (v: string) => v.replace(/\\/g, '/').split('/').filter((s) => s && s !== '.');
  const out: string[] = [];
  const add = (dir: string) => {
    if (!out.includes(dir) && out.length < ROOT_VERIFY_MAX_DIRS) out.push(dir);
  };
  const explicit = typeof cfg.rootPath === 'string' ? cfg.rootPath : typeof cfg.docRoot === 'string' ? cfg.docRoot : null;
  if (explicit !== null && !segments(explicit).includes('..')) add(segments(explicit).join('/'));
  else add(ADAPTER_DEFAULT_ROOT[String(target.type)] ?? '');
  const remote = typeof cfg.remotePath === 'string' ? segments(cfg.remotePath) : [];
  if (remote.includes('..')) return out;
  const marker = remote.findIndex((s) => DOC_ROOT_SEGMENT.test(s));
  const start = marker >= 0 ? marker : 0;
  for (let i = start + 1; i <= remote.length; i++) add(remote.slice(start, i).join('/'));
  return out;
}

/** Kok dizin kaniti: yazilacak klasor ya da yazmama nedeni */
type RootProof =
  | { ok: true; rootPath: string; url: string }
  | { ok: false; code: 'wrong_root' | 'root_unverified' | 'write_failed'; error: string };

/** Sifresi cozulmus, adres denetiminden gecmis adaptor kurulumu */
type PreparedTarget =
  | { ok: true; Adapter: any; credentials: Record<string, any>; config: Record<string, unknown> }
  | { ok: false; error: string };
const ROBOTS_PREVIEW_REQUIRED = 'robots.txt mevcut dosyanla birleştirilir ve önizleme onayı gerektirir — Ajan Hazırlığı sayfasında robots.txt kontrolünden "Önizle ve uygula" ile devam edin.';

const sha256 = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex');
/** Sunucu satir sonlarini (CRLF / tek CR) ya da sondaki bosluklari degistirebilir; karsilastirma icin */
const normalizeBody = (s: string) => s.replace(/\r\n?/g, '\n').replace(/\s+$/, '');

/**
 * Kok dosyalar Content-Type'tan BAGIMSIZ okunur. NEDEN: safeFetchText
 * varsayilan olarak metin disi turde (application/octet-stream, S3'un
 * binary/octet-stream'i) govdeyi indirmeyip bos metin donuyordu; robots.txt
 * "bos" sanilip mevcut Disallow kurallari gormeden birlestiriliyor, llms.txt /
 * sitemap.xml "yok" sanilip onizlemesiz uzerine yaziliyordu. Govde artik
 * okunur ve gercek icerigiyle degerlendirilir (512 KB tavan probeUrl'de).
 */
const ROOT_FILE = { skipBinary: false } as const;

/** Sikistirilmis site haritasi (.xml.gz) — icerigi metin olarak dogrulanamaz, varligi yeter */
function isGzipSitemap(p: Probe): boolean {
  if (p.state !== 'ok') return false;
  if (/gzip/.test(p.contentType)) return true;
  try {
    return /\.gz$/i.test(new URL(p.finalUrl || p.url).pathname) && !!p.text.trim() && !looksLikeHtml(p.text);
  } catch {
    return false;
  }
}

/** Canli dosya gercek bir site haritasi mi (XML urlset / sitemapindex ya da .gz) */
const isSitemapFile = (p: Probe) => p.state === 'ok' && (!!sitemapKind(p.text) || isGzipSitemap(p));

/**
 * Govdesi indirilmemis 2xx (ROOT_FILE ile olmamali; savunma): icerigi
 * gormeden ne birlestirir ne de "yok" sayariz.
 */
const unreadBody = (p: Probe | null): boolean => !!p && p.state === 'ok' && p.binary;
const binaryReason = (filename: string, p: Probe) =>
  `${filename} metin dışı bir içerik türüyle (${p.contentType || 'bilinmeyen'}) sunuluyor; içeriğini okuyamadan üzerine yazmıyoruz.`;

function safeOrigin(raw: string): string | null {
  try { return new URL(raw).origin; } catch { return null; }
}

/** Yonlendirme ayni siteye mi (www ve http→https farki yok sayilir) ve ayni yola mi */
function sameFile(finalUrl: string, requested: string): boolean {
  try {
    const a = new URL(finalUrl);
    const b = new URL(requested);
    return a.hostname.replace(/^www\./, '') === b.hostname.replace(/^www\./, '') && a.pathname === b.pathname;
  } catch {
    return false;
  }
}

function refuse(fix: RootFixKey, url: string, reason: string, extra: Partial<LiveDecision> = {}): LiveDecision {
  return {
    fix, url, action: 'refuse', canApply: false, reason, notes: [], live: null,
    currentContent: null, currentExists: false, fingerprint: 'unknown', proposed: null, ...extra,
  };
}

@Injectable()
export class AutoFixService {
  private readonly log = new Logger(AutoFixService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly crawler: SiteCrawlerService,
    private readonly generators: GeneratorsService,
    private readonly appliedFix: AppliedFixService,
    private readonly jobQueue: JobQueueService,
  ) {}

  /**
   * Arka planda calistir (POST /auto-fix). Kuyruk yolu onizleme onayi
   * tasimaz: robots.txt burada 'preview_required' ile doner; sitemap/llms
   * yalniz dosya yokken olusturulur.
   */
  async applyFixes(siteId: string, fixes: string[]) {
    const site = await this.prisma.site.findUniqueOrThrow({ where: { id: siteId } });
    const { supported, unsupported } = partitionFixes(fixes);
    if (supported.length === 0) return { queued: false, jobId: null, unsupported };
    const job = await this.jobQueue.enqueue({
      type: 'AUTO_FIX',
      userId: site.userId,
      siteId,
      payload: { siteId, fixes: supported },
    });
    // jobId = DB Job id → GET /jobs/:id ile izlenir
    return { queued: true, jobId: job.dbJobId, unsupported };
  }

  // ────────────────────────────────────────────────────────────
  //  ONIZLEME
  // ────────────────────────────────────────────────────────────

  async preview(siteId: string, fix: string, opts: PreviewOptions = {}): Promise<FixPreview> {
    const canonical = canonicalFixKey(fix);
    if (!canonical) throw new BadRequestException('Bu düzeltme otomatik uygulanamaz.');
    const site = await this.loadSite(siteId);
    const decision = await this.decide(site, canonical, opts);
    if ((decision.action === 'create' || decision.action === 'regenerate') && decision.proposed === null) {
      await this.generateInto(site, decision, { crawl: null });
    }
    const target = this.pickRootFileTarget(site.publishTargets);
    let canApply = decision.canApply && !!target;
    let reason = decision.reason;
    if (decision.canApply && !target) reason = `${reason} ${NO_TARGET_TEXT}`;
    let previewToken: string | null = null;
    if (canApply) {
      previewToken = await this.storePreview(siteId, decision);
      if (!previewToken) {
        canApply = false;
        reason = `${reason} Dosya otomatik uygulama için çok büyük; önerilen içeriği elle yükleyebilirsin.`;
      }
    }
    // Oneri yoksa (degisiklik gerekmiyor / reddedildi) fark da yok — mevcut
    // satirlari "silinecek" gibi gostermek yanlis olur
    const d = decision.proposed !== null ? lineDiff(decision.currentContent, decision.proposed) : { lines: [], added: 0, removed: 0 };
    return {
      fix,
      canonical,
      filename: ROOT_FIX_FILENAME[canonical],
      url: decision.url,
      action: decision.action,
      canApply,
      reason,
      // Uygulama once kok dizini dogrular (proveRootDir): kullanici sitesinde kalacak dosyayi bilsin
      notes: canApply ? [...decision.notes, ROOT_VERIFY_NOTE] : decision.notes,
      current: { exists: decision.currentExists, status: decision.live?.status ?? null, content: decision.currentContent },
      proposed: decision.proposed,
      diff: d.lines,
      stats: { added: d.added, removed: d.removed },
      previewToken,
      target: target ? { name: target.name ?? null, type: String(target.type) } : null,
    };
  }

  // ────────────────────────────────────────────────────────────
  //  UYGULAMA
  // ────────────────────────────────────────────────────────────

  /** Worker'dan ve auto-fix-now ucundan çağrılır */
  async runAutoFix(siteId: string, requested: string[], opts: ApplyOptions = {}) {
    // Uretilemeyen anahtarlar (meta_title, schema_markup, geo_*, auth_md...) cagirana ACIKCA doner.
    const { supported: fixes, unsupported } = partitionFixes(requested);
    if (fixes.length === 0) {
      return { applied: [], errors: [], files: [], unsupported, unchanged: [], reason: 'nothing-auto-fixable' };
    }
    const site = await this.loadSite(siteId);

    if (site.publishTargets.length === 0) {
      this.log.warn(`[${siteId}] Aktif publish target yok, fix uygulanamadı`);
      return { applied: [], skipped: fixes, unsupported, unchanged: [], reason: 'no-publish-target' };
    }

    // Kök dosyalar yalnızca dosya-tabanlı adapter'larla (SFTP / FTP / cPanel)
    // yazılabilir. WordPress REST kök dosya yazamaz — publish() çağrılsaydı
    // "robots.txt" başlıklı çöp bir blog postu oluştururdu.
    const target = this.pickRootFileTarget(site.publishTargets);
    if (!target) {
      this.log.warn(`[${siteId}] Kök dosya yazabilen target yok (SFTP/FTP/cPanel gerekli)`);
      return {
        applied: [],
        skipped: fixes,
        unsupported,
        unchanged: [],
        reason: 'no-file-target',
        errors: fixes.map((fix) => ({
          fix,
          code: 'no_file_target',
          error: 'robots.txt / llms.txt / sitemap.xml için dosya yazabilen bir publish target gerekli (SFTP / FTP / cPanel). WordPress REST API kök dosya yazamaz — Yayın Hedefleri\'nden bir SFTP target ekleyin.',
        })),
      };
    }

    const applied: string[] = [];
    const errors: Array<{ fix: string; error: string; code: string }> = [];
    const unchanged: Array<{ fix: string; reason: string }> = [];
    // Frontend'in indirip görüntüleyebilmesi için yazılan dosya içerikleri
    const files: Array<{ fix: string; filename: string; content: string; externalUrl?: string; verified: boolean; action: FixAction }> = [];
    // Yuklendi ama canli adreste henuz gorunmuyor: "uygulandi" diye duz basari sayilmasin
    const unverified: Array<{ fix: string; filename: string; url: string; reason: string }> = [];
    const crawlCache: { crawl: CrawlResult | null } = { crawl: null };
    // Kok dizin kaniti turda bir kez (sitemap + llms ayni klasore yazilir)
    let rootProof: RootProof | null = null;

    for (const fix of fixes) {
      const canonical = canonicalFixKey(fix)!;
      try {
        const token = opts.confirm?.[fix] ?? opts.confirm?.[canonical] ?? null;
        let decision: LiveDecision;
        if (token) {
          const stored = await this.loadPreview(siteId, token);
          if (!stored || stored.fix !== canonical) {
            errors.push({ fix, code: 'preview_expired', error: 'Önizlemenin süresi doldu ya da bulunamadı; yeniden önizleyin.' });
            continue;
          }
          decision = await this.decide(site, canonical, { aiTrain: stored.robotsOptions?.aiTrain }, stored.robotsOptions?.sitemapUrl);
          if (decision.fingerprint !== stored.fingerprint || decision.action !== stored.action) {
            errors.push({ fix, code: 'preview_stale', error: 'Dosya önizlemeden sonra değişti; değişiklikleri görmek için yeniden önizleyin.' });
            continue;
          }
          if (canonical !== 'robots') decision.proposed = stored.proposed;
          if (!decision.proposed || sha256(decision.proposed) !== stored.proposedSha) {
            errors.push({ fix, code: 'preview_stale', error: 'Önerilen içerik önizlemedekiyle aynı değil; yeniden önizleyin.' });
            continue;
          }
        } else {
          if (canonical === 'robots') {
            errors.push({ fix, code: 'preview_required', error: ROBOTS_PREVIEW_REQUIRED });
            continue;
          }
          decision = await this.decide(site, canonical, {});
          if (decision.action === 'create' || decision.action === 'regenerate') await this.generateInto(site, decision, crawlCache);
        }

        if (decision.action === 'none') {
          unchanged.push({ fix, reason: decision.reason });
          continue;
        }
        if (!decision.canApply || !decision.proposed) {
          errors.push({ fix, code: 'refused', error: decision.reason });
          continue;
        }

        // Yazilacak klasor bu siteyi sunuyor mu? Kanitlanmadan kok dosya yazilmaz:
        // baska bir sitenin (ana alan adi) dosyasi geri alinamaz sekilde ezilebilirdi
        rootProof ??= await this.proveRootDir(site, target);
        if (!rootProof.ok) {
          await this.appliedFix.kaydet({
            siteId: site.id, userId: opts.userId ?? null, kind: 'auto_fix', fixType: fix, target: decision.url, status: 'FAILED',
            error: rootProof.error, adapter: String(target.type),
            detail: { filename: ROOT_FIX_FILENAME[canonical], url: decision.url, action: decision.action, code: rootProof.code },
          });
          errors.push({ fix, code: rootProof.code, error: rootProof.error });
          this.log.warn(`[${siteId}] ✗ ${fix}: ${rootProof.code} — ${rootProof.error}`);
          continue;
        }

        const w = await this.writeAndRecord(site, target, fix, decision, opts.userId ?? null, rootProof.rootPath);
        if (w.ok) {
          applied.push(fix);
          files.push({ fix, filename: ROOT_FIX_FILENAME[canonical], content: decision.proposed, externalUrl: w.externalUrl, verified: w.verified, action: decision.action });
          if (!w.verified) {
            unverified.push({
              fix,
              filename: ROOT_FIX_FILENAME[canonical],
              url: decision.url,
              reason: `${ROOT_FIX_FILENAME[canonical]} yüklendi ama ${decision.url} adresinde henüz görünmüyor; önbellek (CDN) olabilir. Birkaç dakika sonra yeniden kontrol et.`,
            });
          }
          if (token) await this.prisma.kvStore.deleteMany({ where: { key: this.previewKey(siteId, token) } }).catch(() => {});
          this.log.log(`[${siteId}] ✓ ${fix} (${decision.action}) → ${w.externalUrl ?? decision.url}${w.verified ? '' : ' — canlıda henüz doğrulanamadı'}`);
        } else {
          errors.push({ fix, code: 'write_failed', error: w.error ?? 'unknown' });
          this.log.error(`[${siteId}] ✗ ${fix}: ${w.error}`);
        }
      } catch (err: any) {
        errors.push({ fix, code: 'error', error: err.message });
        this.log.error(`[${siteId}] ✗ ${fix}: ${err.message}`);
      }
    }

    // En son audit'i güncelle — yalnız bir şey yazıldıysa ve öncekilerle birleştirerek:
    // onaysız robots denemesi (preview_required) aynı taramadaki eski düzeltmeyi silmesin
    const latestAudit = applied.length > 0
      ? await this.prisma.audit.findFirst({ where: { siteId }, orderBy: { ranAt: 'desc' } })
      : null;
    if (latestAudit) {
      const before = Array.isArray(latestAudit.fixesApplied) ? (latestAudit.fixesApplied as unknown[]).filter((x): x is string => typeof x === 'string') : [];
      await this.prisma.audit.update({
        where: { id: latestAudit.id },
        data: {
          autoFixApplied: true,
          fixesApplied: [...new Set([...before, ...applied])],
        },
      });
    }

    return { applied, errors, files, unsupported, unchanged, unverified };
  }

  // ────────────────────────────────────────────────────────────
  //  GECMIS + GERI ALMA
  // ────────────────────────────────────────────────────────────

  async history(siteId: string, limit = 10) {
    const rows = await this.prisma.appliedFix.findMany({
      where: { siteId, kind: 'auto_fix', fixType: { in: Object.values(FIX_ALIASES).flat() } },
      orderBy: { appliedAt: 'desc' },
      take: Math.min(Math.max(limit, 1), 50),
      select: { id: true, fixType: true, status: true, error: true, appliedAt: true, revertedAt: true, target: true, detail: true },
    });
    return rows.map((r) => {
      const d = (r.detail ?? {}) as any;
      const canonical = canonicalFixKey(r.fixType);
      const hasBackup = !!d.previous && !!d.written;
      const revertible = r.status === 'APPLIED' && hasBackup && d.previous.existed === true && typeof d.previous.content === 'string';
      return {
        id: r.id,
        fix: r.fixType,
        filename: canonical ? ROOT_FIX_FILENAME[canonical] : r.fixType,
        status: r.status,
        action: (d.action ?? null) as FixAction | null,
        verified: typeof d.verified === 'boolean' ? d.verified : null,
        error: r.error,
        url: d.url ?? r.target ?? null,
        appliedAt: r.appliedAt,
        revertedAt: r.revertedAt,
        revertible,
        revertNote: r.status !== 'APPLIED' || revertible
          ? null
          : !hasBackup
            ? 'Bu kayıtta yedek yok (yedekleme öncesi bir düzeltme); otomatik geri alınamaz.'
            : 'Düzeltmeden önce bu dosya yoktu; geri almak için dosyayı sunucudan silmen gerekir.',
      };
    });
  }

  async revert(siteId: string, fixId: string, userId?: string | null): Promise<{ ok: boolean; code?: string; error?: string; verified?: boolean; note?: string }> {
    const row = await this.prisma.appliedFix.findFirst({ where: { id: fixId, siteId, kind: 'auto_fix' } });
    if (!row) throw new NotFoundException('Düzeltme kaydı bulunamadı.');
    if (row.status !== 'APPLIED') return { ok: false, code: 'not_applied', error: 'Bu düzeltme zaten geri alınmış ya da hiç uygulanmamış.' };
    const canonical = canonicalFixKey(row.fixType);
    const d = (row.detail ?? {}) as any;
    if (!canonical || !d.previous || !d.written) {
      return { ok: false, code: 'no_backup', error: 'Bu kayıtta yedek yok (yedekleme öncesi bir düzeltme); otomatik geri alınamaz.' };
    }
    const filename = ROOT_FIX_FILENAME[canonical];
    if (d.previous.existed !== true || typeof d.previous.content !== 'string') {
      return { ok: false, code: 'was_absent', error: `Düzeltmeden önce ${filename} yoktu. Geri almak için dosyayı sunucudan silmen gerekir; RanksUp dosya silemez.` };
    }
    const site = await this.loadSite(siteId);
    const target = this.pickRootFileTarget(site.publishTargets);
    if (!target) return { ok: false, code: 'no_file_target', error: NO_TARGET_TEXT };

    // Geri yazmadan once: dosya hala bizim yazdigimiz mi? Degilse sonraki
    // degisiklikleri silerdik.
    const url = String(d.url ?? row.target);
    const live = await probeUrl(url, { accept: 'text/plain, application/xml, */*;q=0.5', ...ROOT_FILE });
    // Govdesi indirilmeyen yanit (binary) "bizim yazdigimiz mi" sorusuna cevap vermez
    if (live.state !== 'ok' || live.truncated || live.binary) {
      return { ok: false, code: 'unreadable', error: 'Dosyanın şu anki hali güvenilir okunamadı; görmeden geri yazmıyoruz.' };
    }
    const liveMatches = sha256(live.text) === d.written.sha256 || sha256(normalizeBody(live.text)) === d.written.normSha256;
    if (!liveMatches) {
      return { ok: false, code: 'changed', error: 'Dosya RanksUp\'ın yazdığından sonra değişmiş; geri almak o değişiklikleri silerdi. Gerekirse elle düzenleyin.' };
    }

    // Geri yazim da kanitlanmis klasore: hedef ayarlari degismis ya da eski kayit
    // yanlis koke yazilmis olabilir (kanit oncesi duzeltmeler)
    const root = await this.proveRootDir(site, target);
    if (!root.ok) return { ok: false, code: root.code, error: root.error };

    const up = await this.uploadToTarget(target, filename, d.previous.content, root.rootPath);
    if (!up.ok) return { ok: false, code: 'write_failed', error: up.error ?? 'Yükleme başarısız' };
    await this.appliedFix.geriAlindi(row.id);
    this.log.log(`[${siteId}] ↺ ${row.fixType} geri alındı${userId ? ` (kullanıcı ${userId})` : ''}`);
    const verified = await this.verifyLive(url, d.previous.content);
    return {
      ok: true,
      verified,
      note: canonical === 'robots'
        ? 'Önceki içerik aynen geri yazıldı. robots.txt önceden bir eklenti/CMS tarafından üretiliyorsa, sunucudaki robots.txt dosyasını silerek o duruma tamamen dönebilirsin.'
        : 'Önceki içerik aynen geri yazıldı.',
    };
  }

  // ────────────────────────────────────────────────────────────
  //  KARAR (canli durum)
  // ────────────────────────────────────────────────────────────

  private async loadSite(siteId: string) {
    return this.prisma.site.findUniqueOrThrow({
      where: { id: siteId },
      include: { publishTargets: { where: { isActive: true } }, brain: true },
    });
  }

  private async decide(site: any, fix: RootFixKey, opts: PreviewOptions, pinnedSitemapUrl?: string | null): Promise<LiveDecision> {
    const origin = safeOrigin(site.url);
    if (!origin) return refuse(fix, site.url, 'Site adresi geçersiz.');
    if (fix === 'robots') return this.decideRobots(origin, opts.aiTrain === 'no' ? 'no' : 'yes', pinnedSitemapUrl);
    if (fix === 'sitemap') return this.decideSitemap(site.id, origin);
    return this.decideLlms(site.id, origin);
  }

  private async decideRobots(origin: string, aiTrain: 'yes' | 'no', pinnedSitemapUrl?: string | null): Promise<LiveDecision> {
    const url = `${origin}/robots.txt`;
    const live = await probeUrl(url, { accept: 'text/plain, */*;q=0.5', ...ROOT_FILE });
    const signal = `search=yes, ai-input=yes, ai-train=${aiTrain}`;
    // Elle kullanim onerisi YALNIZ mevcut durum biliniyorsa: dosyasini goremedigimiz
    // sitede tam bir robots.txt onermek, kopyalanirsa gercek dosyayi ezerdi
    const unreadable = (reason: string, opts: { notes?: string[]; propose?: { base: string | null } } = {}) => {
      const merged = opts.propose ? mergeRobotsTxt(opts.propose.base, { contentSignal: signal }) : null;
      const base = opts.propose?.base ?? null;
      return refuse('robots', url, reason, {
        live, notes: opts.notes ?? [],
        proposed: merged?.changed ? merged.content : null,
        currentContent: base,
        currentExists: base !== null,
      });
    };

    if (isUnmeasured(live)) return unreadable(`robots.txt güvenilir okunamadı: ${live.block?.reason ?? ''} Dosyayı göremeden üzerine yazmıyoruz.`, { notes: live.block?.hint ? [live.block.hint] : [] });
    if (live.state === 'http_error') return unreadable(`robots.txt okunamadı (HTTP ${live.status}); mevcut durumu bilmeden yazmıyoruz.`);

    let base: string | null = null;
    if (live.state === 'ok') {
      if (unreadBody(live)) return refuse('robots', url, binaryReason('robots.txt', live), { live });
      if (live.truncated) return refuse('robots', url, 'robots.txt 512 KB\'tan büyük; tamamını okuyamadan değiştirmiyoruz.', { live });
      if (!sameFile(live.finalUrl, url)) return refuse('robots', url, `robots.txt başka bir adrese yönleniyor (${live.finalUrl}); yayın hedefine yazılan dosya orada görünmeyebilir.`, { live });
      const state = assessRobotsBody(live.text);
      // HTML: sitede gercek robots.txt yok gibi — yeni dosya onerisi elle kullanilabilir
      if (state === 'html') return unreadable('robots.txt adresi dosya yerine HTML sayfa döndürüyor (soft-404 / catch-all). Gerçek dosya durumu güvenilir okunamadığı için otomatik yazmıyoruz; önerilen içeriği elle ekleyebilirsin.', { propose: { base: null } });
      if (state === 'invalid') return unreadable('robots.txt yanıtı geçerli bir robots dosyası değil (yönerge satırı yok); üzerine yazmıyoruz.');
      if (state === 'encoding') return unreadable('robots.txt UTF-8 olarak çözülemeyen karakterler içeriyor; otomatik düzenleme bu karakterleri bozabilir. Eklenecek satırları elle ekleyebilirsin.', { propose: { base: live.text } });
      // Cloudflare Managed robots.txt: blogu Cloudflare kenarda, sunucudaki dosyanin
      // ONUNE kendisi ekler. Canli icerigi sunucuya yazmak bu blogu dosyaya kopyalar;
      // sonra Cloudflare ayari degisse bile eski kurallar dosyada kalirdi. Elle ekleme:
      // sona eklenen satirlar servis edilen dosyanin da sonuna duser.
      // https://developers.cloudflare.com/bots/additional-configurations/managed-robots-txt/
      if (/#\s*BEGIN Cloudflare Managed content/i.test(live.text)) {
        return unreadable('robots.txt\'nin bir kısmını Cloudflare yönetiyor (Managed robots.txt): Cloudflare bu bloğu sunucundaki dosyanın önüne kendisi ekler. Otomatik yazma bu bloğu dosyaya kopyalayıp ileride Cloudflare ayarlarını geçersiz kılabileceği için yazmıyoruz; eklenecek satırları sunucundaki robots.txt\'nin sonuna elle ekleyebilirsin.', { propose: { base: live.text } });
      }
      base = live.text;
    }

    const hasSitemapLine = parseRobots(base ?? '').sitemaps.length > 0;
    const sitemapUrl = hasSitemapLine ? null : pinnedSitemapUrl !== undefined ? pinnedSitemapUrl : await this.discoverStandardSitemap(origin);
    const merged = mergeRobotsTxt(base, { contentSignal: signal, sitemapUrl });
    const common = { live, currentContent: base, currentExists: base !== null, fingerprint: base !== null ? sha256(base) : 'absent' };
    if (!merged.accessUnchanged) {
      // Savunma agi: birlestirme mantiginda bir hata bir botun erisimini degistiriyordu
      this.log.error(`[robots-merge] erisim degisikligi engellendi: ${origin} ${JSON.stringify(merged.accessChange)}`);
      return refuse('robots', url, 'Güvenlik kontrolü: ekleme bir botun erişimini değiştirecekti; otomatik düzenleme durduruldu.', common);
    }
    if (!merged.changed) {
      return { fix: 'robots', url, action: 'none', canApply: false, reason: 'robots.txt\'de eksik bir şey yok: önerilen AI botları isimle anılıyor, Content-Signal ve Sitemap satırları mevcut.', notes: [], proposed: null, ...common };
    }
    const notes = [...merged.notes];
    if (!hasSitemapLine && !sitemapUrl) notes.push('Canlı bir site haritası bulunamadığı için Sitemap satırı eklenmedi; önce site haritası oluştur, sonra yeniden önizle.');
    if (base !== null && /# START YOAST BLOCK|rank math|wp-sitemap\.xml|\/wp-admin\//i.test(base)) {
      // WordPress / SEO eklentisi sanal robots.txt uretiyor olabilir: fiziksel dosya onun yerine gecer
      notes.push('robots.txt şu an WordPress ya da bir SEO eklentisi tarafından üretiliyorsa, sunucuya yazılan dosya bundan sonra onun yerine geçer; eklentinin robots ayarları artık uygulanmaz.');
    }
    return {
      fix: 'robots', url,
      action: base !== null ? 'merge' : 'create',
      canApply: true,
      reason: base !== null ? 'Mevcut robots.txt korunur; yalnız eksik satırlar dosyanın sonuna eklenir.' : 'Sitede robots.txt yok; yeni bir dosya oluşturulur.',
      notes,
      proposed: merged.content,
      robotsOptions: { aiTrain, sitemapUrl },
      ...common,
    };
  }

  /** /sitemap.xml ya da /sitemap_index.xml canli ve gecerliyse adresi */
  private async discoverStandardSitemap(origin: string): Promise<string | null> {
    for (const path of ['/sitemap.xml', '/sitemap_index.xml']) {
      const p = await probeUrl(`${origin}${path}`, { accept: 'application/xml, text/xml, */*;q=0.5', ...ROOT_FILE });
      if (isSitemapFile(p)) return `${origin}${path}`;
    }
    return null;
  }

  private async decideSitemap(siteId: string, origin: string): Promise<LiveDecision> {
    const url = `${origin}/sitemap.xml`;
    const accept = { accept: 'application/xml, text/xml, */*;q=0.5', ...ROOT_FILE };
    const isSitemap = isSitemapFile;

    // 1) robots.txt'de bildirilen site haritalari
    const brokenDeclared: string[] = [];
    const robots = await probeUrl(`${origin}/robots.txt`, { accept: 'text/plain, */*;q=0.5', ...ROOT_FILE });
    if (robots.state === 'ok' && ['ok', 'encoding'].includes(assessRobotsBody(robots.text))) {
      for (const declared of robotsSitemapUrls(robots.text).slice(0, 3)) {
        const p = await probeUrl(declared, accept);
        if (isSitemap(p)) return { ...refuse('sitemap', url, ''), action: 'none', reason: `Site haritası zaten var: ${declared} (robots.txt'de bildirilmiş). Var olan site haritasının üzerine yazmıyoruz.` };
        if (isUnmeasured(p)) return refuse('sitemap', url, `robots.txt'de bildirilen site haritası (${declared}) okunamadı: ${p.block?.reason ?? ''} Var olan bir haritayla çakışmamak için yeni dosya oluşturmuyoruz.`);
        if (unreadBody(p)) return refuse('sitemap', url, `robots.txt'de bildirilen site haritası (${declared}) metin dışı bir içerik türüyle (${p.contentType || 'bilinmeyen'}) sunuluyor; içeriğini okuyamadığımız için yeni dosya oluşturmuyoruz.`);
        brokenDeclared.push(declared);
      }
    }

    // 2) /sitemap.xml
    const live = await probeUrl(url, accept);
    if (isUnmeasured(live)) return refuse('sitemap', url, `/sitemap.xml güvenilir okunamadı: ${live.block?.reason ?? ''} Göremediğimiz dosyanın üzerine yazmıyoruz.`, { live, notes: live.block?.hint ? [live.block.hint] : [] });
    if (live.state === 'http_error') return refuse('sitemap', url, `/sitemap.xml okunamadı (HTTP ${live.status}); mevcut durumu bilmeden yazmıyoruz.`, { live });
    const notes: string[] = [];
    if (live.state === 'ok') {
      if (unreadBody(live) && !isSitemap(live)) return refuse('sitemap', url, binaryReason('/sitemap.xml', live), { live });
      if (isSitemap(live)) {
        const own = await this.isOwnUnchanged(siteId, 'sitemap', live.text);
        if (own && !live.truncated) {
          return { fix: 'sitemap', url, action: 'regenerate', canApply: true, reason: '/sitemap.xml RanksUp\'ın daha önce oluşturduğu ve o günden beri değişmemiş dosya; güncel taramayla yenilenir (eski hali yedeklenir).', notes, live, currentContent: live.text, currentExists: true, fingerprint: sha256(live.text), proposed: null };
        }
        return { ...refuse('sitemap', url, '', { live }), action: 'none', reason: 'Site haritası zaten var: /sitemap.xml. Var olan site haritasının üzerine yazmıyoruz.' };
      }
      if (live.text.trim() && !looksLikeHtml(live.text)) {
        return refuse('sitemap', url, '/sitemap.xml adresinde site haritası olmayan bir içerik var; üzerine yazmıyoruz.', { live });
      }
      if (live.text.trim()) notes.push('/sitemap.xml şu an dosya yerine HTML sayfa döndürüyor (dosya yok); yüklemeden sonra dosyanın sitede görünüp görünmediği ayrıca doğrulanır.');
    }

    // 3) /sitemap_index.xml — standart disi konumda dizin varsa yenisini olusturma
    const idx = await probeUrl(`${origin}/sitemap_index.xml`, accept);
    if (isSitemap(idx)) {
      return { ...refuse('sitemap', url, '', { live }), action: 'none', reason: 'Site haritası dizini var: /sitemap_index.xml. Yeni dosya oluşturmuyoruz; robots.txt\'e Sitemap satırı eklemek için robots.txt düzeltmesini önizle.' };
    }
    if (isUnmeasured(idx)) return refuse('sitemap', url, `/sitemap_index.xml okunamadı: ${idx.block?.reason ?? ''} Var olan bir haritayla çakışmamak için yeni dosya oluşturmuyoruz.`, { live });

    if (brokenDeclared.length > 0) {
      // Otomatik duzeltme mevcut satirlari degistirmez; bozuk Sitemap satirini sahibi duzeltmeli
      notes.push(`robots.txt'deki Sitemap satırı çalışmayan bir adresi gösteriyor (${brokenDeclared.join(', ')}). Yeni dosyayı göstermesi için bu satırı elle düzelt; otomatik düzeltme mevcut satırları değiştirmez.`);
    } else {
      notes.push('Oluşturduktan sonra robots.txt\'e "Sitemap:" satırı eklemek için robots.txt düzeltmesini yeniden önizle.');
    }
    return { fix: 'sitemap', url, action: 'create', canApply: true, reason: 'Sitede site haritası yok; taranan sayfalardan yeni bir sitemap.xml oluşturulur.', notes, live, currentContent: null, currentExists: false, fingerprint: 'absent', proposed: null };
  }

  private async decideLlms(siteId: string, origin: string): Promise<LiveDecision> {
    const url = `${origin}/llms.txt`;
    const live = await probeUrl(url, { accept: 'text/plain, text/markdown, */*;q=0.5', ...ROOT_FILE });
    if (isUnmeasured(live)) return refuse('llms', url, `llms.txt güvenilir okunamadı: ${live.block?.reason ?? ''} Göremediğimiz dosyanın üzerine yazmıyoruz.`, { live, notes: live.block?.hint ? [live.block.hint] : [] });
    if (live.state === 'http_error') return refuse('llms', url, `llms.txt okunamadı (HTTP ${live.status}); mevcut durumu bilmeden yazmıyoruz.`, { live });
    const notes: string[] = [];
    if (live.state === 'ok') {
      if (unreadBody(live)) return refuse('llms', url, binaryReason('llms.txt', live), { live });
      if (live.truncated) return refuse('llms', url, 'llms.txt 512 KB\'tan büyük; üzerine yazmıyoruz.', { live });
      const body = live.text.trim();
      if (body && !looksLikeHtml(live.text)) {
        const own = await this.isOwnUnchanged(siteId, 'llms', live.text);
        if (own) {
          return { fix: 'llms', url, action: 'regenerate', canApply: true, reason: 'llms.txt RanksUp\'ın daha önce oluşturduğu ve o günden beri değişmemiş dosya; güncel taramayla yenilenir (eski hali yedeklenir).', notes, live, currentContent: live.text, currentExists: true, fingerprint: sha256(live.text), proposed: null };
        }
        return { ...refuse('llms', url, '', { live }), action: 'none', reason: 'Sitede zaten bir llms.txt var; senin içeriğinin üzerine yazmıyoruz.' };
      }
      if (body) notes.push('llms.txt şu an dosya yerine HTML sayfa döndürüyor (dosya yok); yüklemeden sonra dosyanın sitede görünüp görünmediği ayrıca doğrulanır.');
    }
    return { fix: 'llms', url, action: 'create', canApply: true, reason: 'Sitede llms.txt yok; taranan sayfalardan yeni bir dosya oluşturulur.', notes, live, currentContent: null, currentExists: false, fingerprint: 'absent', proposed: null };
  }

  /** Canli icerik, RanksUp'in en son YAZDIGI icerikle birebir mi (o gunden beri dokunulmamis) */
  private async isOwnUnchanged(siteId: string, fix: RootFixKey, liveText: string): Promise<boolean> {
    const last = await this.prisma.appliedFix.findFirst({
      where: { siteId, kind: 'auto_fix', status: 'APPLIED', fixType: { in: FIX_ALIASES[fix] } },
      orderBy: { appliedAt: 'desc' },
      select: { detail: true },
    });
    const w = (last?.detail as any)?.written;
    if (!w?.sha256) return false;
    return sha256(liveText) === w.sha256 || sha256(normalizeBody(liveText)) === w.normSha256;
  }

  /** sitemap/llms icerigini taramadan uretir (tarama istek basina bir kez) */
  private async generateInto(site: any, decision: LiveDecision, cache: { crawl: CrawlResult | null }): Promise<void> {
    // Anasayfa okunamazsa (404/500 dahil) tarama orada dursun: sonuc zaten kullanilmayacak
    if (!cache.crawl) cache.crawl = await this.crawler.crawl(site.url, 30, { stopIfHomeUnreadable: true });
    const crawl = cache.crawl;
    if (crawl.homeAccess) {
      // Okuyamadigimiz siteden uretilen dosya (0 sayfa ya da anasayfasiz yarim
      // liste) gercek sayfalari yansitmaz; yuklenirse musterinin dosyasinin
      // yerine gecer. "Sayfa bulunamadi" demek de yalan olur: site bizi reddetti.
      const filename = ROOT_FIX_FILENAME[decision.fix];
      Object.assign(decision, {
        action: 'refuse', canApply: false, proposed: null,
        reason: `${crawlAccessMessage(crawl.homeAccess)} Sitenin sayfalarını okuyamadan ${filename} üretmiyoruz; erişim düzelince yeniden deneyin.`,
      });
      return;
    }
    if (!crawl.pages.length) {
      Object.assign(decision, { action: 'refuse', canApply: false, proposed: null, reason: 'Sitede taranabilir sayfa bulunamadı; içerik üretilemedi.' });
      return;
    }
    if (crawl.stoppedEarly) {
      // Bot korumasi taramayi yarida kesti: dosya yalniz okunabilen sayfalari listeler
      decision.notes.push(`Tarama bot koruması yüzünden erken durdu: ${crawl.stoppedEarly} Dosya yalnız okunabilen ${crawl.pages.length} sayfadan üretildi; RanksUpBot'a izin verip yeniden önizlersen daha fazla sayfa okunabilir.`);
    }
    if (decision.fix === 'sitemap') {
      decision.proposed = this.generators.generateSitemap(crawl);
      decision.notes.push(`Site haritası taranan ${crawl.pages.length} sayfadan üretildi (tarama en fazla 30 sayfa). Sitende daha fazla sayfa varsa CMS'inin site haritası özelliği daha eksiksiz olur.`);
    } else {
      const description = site.brain?.brandVoice?.tagline ?? `${site.name} — ${site.niche ?? 'web sitesi'}`;
      decision.proposed = this.generators.generateLlmsTxt(crawl, site.name, description);
    }
  }

  // ────────────────────────────────────────────────────────────
  //  ONIZLEME DEPOSU (kv_store)
  // ────────────────────────────────────────────────────────────

  private previewKey(siteId: string, token: string) {
    return `autofix-preview:${siteId}:${token}`;
  }

  private async storePreview(siteId: string, d: LiveDecision): Promise<string | null> {
    if (!d.proposed) return null;
    const token = sha256([siteId, d.fix, d.fingerprint, d.proposed].join('\u0000')).slice(0, 32);
    const stored: StoredPreview = {
      fix: d.fix,
      fingerprint: d.fingerprint,
      proposedSha: sha256(d.proposed),
      action: d.action,
      robotsOptions: d.robotsOptions ?? null,
      // robots deterministik: uygulamada canli dosyadan yeniden hesaplanir, govde saklanmaz
      proposed: d.fix === 'robots' ? null : d.proposed,
    };
    const value = JSON.stringify(stored);
    if (Buffer.byteLength(value, 'utf8') > KV_MAX_BYTES) return null;
    const key = this.previewKey(siteId, token);
    const expiresAt = new Date(Date.now() + PREVIEW_TTL_MS);
    await this.prisma.kvStore.upsert({ where: { key }, create: { key, value, expiresAt }, update: { value, expiresAt } });
    return token;
  }

  private async loadPreview(siteId: string, token: string): Promise<StoredPreview | null> {
    if (!/^[a-f0-9]{32}$/.test(token)) return null;
    const row = await this.prisma.kvStore.findUnique({ where: { key: this.previewKey(siteId, token) } }).catch(() => null);
    if (!row || (row.expiresAt && row.expiresAt.getTime() < Date.now())) return null;
    try {
      const v = JSON.parse(row.value) as StoredPreview;
      return v && typeof v.fingerprint === 'string' && typeof v.proposedSha === 'string' ? v : null;
    } catch {
      return null;
    }
  }

  // ────────────────────────────────────────────────────────────
  //  YAZMA + DOGRULAMA + KAYIT
  // ────────────────────────────────────────────────────────────

  private async writeAndRecord(site: any, target: any, fixKey: string, d: LiveDecision, userId: string | null, rootPath: string): Promise<{ ok: boolean; error?: string; externalUrl?: string; verified: boolean }> {
    const filename = ROOT_FIX_FILENAME[d.fix];
    const content = d.proposed!;
    const up = await this.uploadToTarget(target, filename, content, rootPath);
    if (!up.ok) {
      await this.appliedFix.kaydet({
        siteId: site.id, userId, kind: 'auto_fix', fixType: fixKey, target: d.url, status: 'FAILED',
        error: up.error ?? 'unknown', adapter: String(target.type), detail: { filename, url: d.url, action: d.action, rootPath },
      });
      return { ok: false, error: up.error, verified: false };
    }
    const verified = await this.verifyLive(d.url, content);
    // Yedek: onceki icerik AYNEN saklanir — geri alma bunu yazar
    await this.appliedFix.kaydet({
      siteId: site.id, userId, kind: 'auto_fix', fixType: fixKey, target: d.url, status: 'APPLIED', adapter: String(target.type),
      detail: {
        filename,
        url: d.url,
        action: d.action,
        previous: {
          existed: d.currentExists,
          status: d.live?.status ?? null,
          sha256: d.currentContent !== null ? sha256(d.currentContent) : null,
          content: d.currentContent,
        },
        written: { sha256: sha256(content), normSha256: sha256(normalizeBody(content)), bytes: Buffer.byteLength(content, 'utf8') },
        verified,
        externalUrl: up.externalUrl ?? null,
        // Siteyi sundugu kanitlanan klasor ('' = FTP/SFTP giris dizini)
        rootPath,
      },
    });
    return { ok: true, externalUrl: up.externalUrl, verified };
  }

  /**
   * Yazilacak klasorun site.url'yi SUNDUGUNU kanitlar: aday klasore
   * (rootDirCandidates) yeni rastgele icerikli ROOT_VERIFY_FILENAME yazilir ve
   * https://<site>/ROOT_VERIFY_FILENAME BIREBIR ayni okunmalidir (onbellek
   * atlatma parametresiyle; baska alan adina yonlenen yanit sayilmaz). Rastgele
   * 128 bit icerik yanlis pozitifi imkansiz kilar: okunan dosya, az once o
   * klasore yazilan dosyadir.
   *  - wrong_root: dosya yuklendi ama sitede gorunmedi (klasor baska siteyi sunuyor)
   *  - root_unverified: dogrulama adresi okunamadi (engel / zaman asimi)
   *  - write_failed: hicbir aday klasore yuklenemedi (baglanti / yetki / adres denetimi)
   */
  private async proveRootDir(site: any, target: any): Promise<RootProof> {
    const origin = safeOrigin(site.url);
    if (!origin) return { ok: false, code: 'wrong_root', error: 'Site adresi geçersiz; kök dosyanın hangi klasöre yazılacağı doğrulanamadı.' };
    const url = `${origin}/${ROOT_VERIFY_FILENAME}`;
    const prepared = await this.prepareTarget(target);
    if (!prepared.ok) return { ok: false, code: 'write_failed', error: prepared.error };
    const dirs = rootDirCandidates(target);
    let uploaded = 0;
    let firstError: string | null = null;
    for (const dir of dirs) {
      const body = `ranksup-root-verification\n${randomBytes(16).toString('hex')}\n`;
      const up = await this.putWith(prepared, dir, ROOT_VERIFY_FILENAME, body, 'text/plain; charset=utf-8');
      if (!up.ok) {
        firstError ??= up.error ?? 'bilinmeyen hata';
        continue;
      }
      uploaded++;
      const p = await probeUrl(`${url}?ranksup_verify=${Date.now()}`, { accept: 'text/plain, */*;q=0.5', ...ROOT_FILE });
      if (isUnmeasured(p)) {
        // Engel diger klasorlerde de ayni: daha fazla yazmadan dur
        return {
          ok: false,
          code: 'root_unverified',
          error: `Doğrulama dosyası (${url}) okunamadı: ${p.block?.reason ?? 'erişim engellendi.'} Yayın hedefinin bu siteyi sunduğunu doğrulayamadan robots.txt / sitemap.xml / llms.txt yazmıyoruz.${p.block?.hint ? ` ${p.block.hint}` : ''}`,
        };
      }
      if (p.state === 'ok' && !p.truncated && !p.binary && sameFile(p.finalUrl, url) && normalizeBody(p.text) === normalizeBody(body)) {
        return { ok: true, rootPath: dir, url };
      }
    }
    if (uploaded === 0) return { ok: false, code: 'write_failed', error: firstError ?? 'Doğrulama dosyası yayın hedefine yazılamadı.' };
    const tried = dirs.map((d) => d || 'giriş klasörü').join(', ');
    return {
      ok: false,
      code: 'wrong_root',
      error: `Yayın hedefinin yazdığı klasör ${new URL(origin).host} sitesini sunmuyor: doğrulama dosyası yüklendi ama ${url} adresinde görünmedi (denenen klasörler: ${tried}). Paylaşımlı hostingte eklenti alan adları ve alt alan adları ayrı bir klasörden sunulur; başka bir sitenin dosyasının üzerine yazmamak için kök dosya yazılmadı. Önerilen içeriği sitenin kök klasörüne elle yükleyebilirsin.`,
    };
  }

  /** Yazilan dosya canli adreste gorunuyor mu (onbellek atlatma parametresiyle) */
  private async verifyLive(url: string, expected: string): Promise<boolean> {
    // ROOT_FILE: sunucu dosyayi octet-stream ile sunsa da yazilan icerik karsilastirilabilsin
    const p = await probeUrl(`${url}${url.includes('?') ? '&' : '?'}ranksup_verify=${Date.now()}`, { accept: '*/*', ...ROOT_FILE });
    if (p.state !== 'ok' || p.truncated || p.binary) return false;
    return p.text === expected || normalizeBody(p.text) === normalizeBody(expected);
  }

  /** Kanitlanmis klasore (rootPath) kok dosya yazar */
  private async uploadToTarget(target: any, filename: string, content: string, rootPath: string): Promise<{ ok: boolean; error?: string; externalUrl?: string }> {
    const prepared = await this.prepareTarget(target);
    if (!prepared.ok) return { ok: false, error: prepared.error };
    // Kök dosya yazımı — slug.html DEĞİL, dosya adı birebir web root'a.
    const contentType = filename.endsWith('.xml')
      ? 'application/xml; charset=utf-8'
      : filename.endsWith('.json')
        ? 'application/json; charset=utf-8'
        : filename.endsWith('.md')
          ? 'text/markdown; charset=utf-8'
          : 'text/plain; charset=utf-8';
    return this.putWith(prepared, rootPath, filename, content, contentType);
  }

  /**
   * Adaptor kurulumu: kimlik bilgisi cozulur ve adres denetlenir. Adaptor FTP /
   * SFTP / cPanel adresine dogrudan baglanir; kayittan sonra DNS ic aga
   * cevrilmis olabilir — istekten HEMEN once denetim. Hata kayda (AppliedFix
   * FAILED) ve sonuca Turkce neden olarak gecer.
   */
  private async prepareTarget(target: any): Promise<PreparedTarget> {
    const Adapter = getAdapter(target.type) as any;
    if (!Adapter) return { ok: false, error: `Adapter yok: ${target.type}` };
    const credentials = decryptCredentials(target.credentials as Record<string, any>);
    const blockReason = await publishTargetBlockReason(String(target.type), credentials, target.config);
    if (blockReason) return { ok: false, error: blockReason };
    const config = target.config && typeof target.config === 'object' ? (target.config as Record<string, unknown>) : {};
    return { ok: true, Adapter, credentials, config };
  }

  /**
   * Verilen klasore ham dosya yazar. Adaptorler kok klasoru config.rootPath'ten
   * okur (ftp.ts / sftp.ts / cpanel-api.ts putRootFile); kayitli ayar degismez,
   * yalniz bu cagriya ozel kopya verilir.
   */
  private async putWith(prepared: Extract<PreparedTarget, { ok: true }>, rootPath: string, filename: string, content: string, contentType: string): Promise<{ ok: boolean; error?: string; externalUrl?: string }> {
    try {
      const adapter = new prepared.Adapter(prepared.credentials, { ...prepared.config, rootPath });
      return await adapter.putRootFile(filename, content, contentType);
    } catch (err: any) {
      return { ok: false, error: err?.message ?? String(err) };
    }
  }

  /** Aktif target'lar arasından kök dosya yazabilen (SFTP/FTP/cPanel) ilkini seç; default'u tercih et. */
  private pickRootFileTarget(targets: any[]): any | null {
    const capable = targets.filter((t) => {
      const Adapter = getAdapter(t.type) as any;
      if (!Adapter) return false;
      try {
        // Yetenek kontrolü creds gerektirmez — boş constructor yeterli.
        return new Adapter({}, {}).supportsRootFiles === true;
      } catch {
        return false;
      }
    });
    if (capable.length === 0) return null;
    return capable.find((t) => t.isDefault) ?? capable[0];
  }
}
