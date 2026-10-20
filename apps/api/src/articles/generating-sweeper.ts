import { Logger } from '@nestjs/common';
import type { JobType, Queue } from 'bullmq';
import type { PrismaService } from '../prisma/prisma.service.js';
import { acquireCronLock } from '../common/cron-lock.js';
import { DEMO_SITE_URL, isScheduledGenerationJobId } from './article-scheduler.service.js';
import { failGenerationWithRefund } from './allowance-refund.js';

/**
 * GENERATING'de takili kalan yazilarin supurucusu.
 *
 * NEDEN: yazi uretime "sahiplenilerek" alinir (SCHEDULED/DRAFT → GENERATING,
 * article-scheduler.service claimAndQueue, articles.service triggerNow /
 * queueGeneration) ve sonucu uretim isi yazar (READY_TO_PUBLISH, REVIZE_NEEDED
 * ya da son denemede FAILED). Isi yazacak kimse kalmazsa yazi panelde sonsuza
 * kadar "Üretiliyor" kalir ve takvim onu bir daha almaz (tarama yalniz
 * SCHEDULED okur):
 *  - worker sahiplenme ile kuyruga atma arasinda oldu (is hic olusmadi),
 *  - is maxStalledCount'u asti ya da surec son denemede oldu (worker'in
 *    catch'i calismadi, yazi FAILED yapilamadi),
 *  - yer tutucu yazildi ama is kuyruga girmeden hata oldu (Redis yok).
 *
 * KURAL: yazi GENERATING_STALE_MS'ten uzun suredir degismediyse VE ona ait
 * canli bir BullMQ isi yoksa:
 *  - takvim yazisi (scheduledAt dolu) takvime geri konur (SCHEDULED): saatlik
 *    tarama ya da gecikmeli takvim isi her zamanki atomik sahiplenmeyle alir,
 *    akis durdurulmussa bekler. En fazla GENERATING_SWEEP_MAX_REQUEUES kez;
 *    surekli coken bir uretim LLM maliyetini sonsuza kadar tekrarlamasin.
 *  - takvim disi yazi (Uret, MCP, icerik firsati) ve hakki biten takvim yazisi
 *    FAILED olur: panel "başarısız" gosterir, kullanici "Şimdi üret" ile
 *    yeniden baslatir (triggerNow FAILED'i kabul eder). FAILED yapilan yazinin
 *    dusulen makale hakki AYNI islemde iade edilir (allowance-refund.ts): uretim
 *    makale cikmadan bitti. Takvime geri konan yazinin hakki iade edilmez; isareti
 *    yazida kalir ve yeniden uretilirken ikinci kez dusmez.
 *
 * "Canli is" GUVENLIK KOSULUDUR: bekleyen bir is varken yazi SCHEDULED
 * yapilirsa tarama onu ikinci kez sahiplenip ayri bir is kuyruga atar; eski is
 * de calisinca claimForGeneration yaziyi GENERATING gorup "surer" der ve yazi
 * iki kez uretilir (iki kat LLM maliyeti, Tam otomatikte iki yayin). Bu yuzden
 * dogrulanamayan her durumda (Redis yanit vermiyor, kuyruk taranamayacak kadar
 * kalabalik) yaziya DOKUNULMAZ; sonraki tur yeniden bakar.
 * Canli sayilanlar: kuyrukta bekleyen/islenen GENERATE_ARTICLE isi (DB kaydi
 * olmasa bile), yaziya ait is kaydinin BullMQ durumu bitmemis olan (yeniden
 * deneme beklemesi dahil) ve son GENERATING_STALE_MS icinde kuyruga atilmis is
 * kaydi (BullMQ kimligi henuz yazilmamis olabilir). Takvimin gecikmeli isi
 * (gen:article:<id>) sayilmaz: GENERATING yaziyi hic uretmez
 * (dispatchScheduledArticle ALREADY_CLAIMED).
 *
 * Kayit: worker'da BullMQ tekrar isi (apps/worker/src/index.ts,
 * SWEEP_STUCK_GENERATING, GENERATING_SWEEP_EVERY_MS). Tur ayrica cift-calisma
 * kilidiyle korunur (common/cron-lock.ts): tekrar araligi degistirilirse eski
 * zamanlama Redis'te kalip ikinci bir tur baslatabilir.
 */

/**
 * GENERATING'de bu kadar suredir degismeyen yazi aday olur (canli isi yoksa).
 * Olcu Article.updatedAt: sahiplenme (updateMany SCHEDULED → GENERATING) de
 * onu yeniler — Prisma @updatedAt'i updateMany'de de yazar
 * (prisma-engines query_graph_builder/write/update.rs update_many_record_node
 * → args.update_datetimes). Yani yeni sahiplenilmis yazi, isi henuz kuyruga
 * girmemis olsa bile 2 saat boyunca aday olmaz.
 */
export const GENERATING_STALE_MS = 2 * 60 * 60_000;
/** Takvim yazisi en fazla bu kadar kez takvime geri konur; sonrakinde FAILED */
export const GENERATING_SWEEP_MAX_REQUEUES = 2;
/** Tur basina en fazla aday (en eskiler once); kalanlar sonraki turda */
export const GENERATING_SWEEP_BATCH = 100;
/** Worker tekrar isinin araligi */
export const GENERATING_SWEEP_EVERY_MS = 30 * 60_000;
/**
 * Kuyruk taramasinin tavani. Daha kalabalik kuyrukta tur atlanir: hepsini
 * okumadan "bu yazinin bekleyen isi yok" denemez (yukaridaki guvenlik kosulu).
 */
export const LIVE_QUEUE_SCAN_LIMIT = 1000;

/** Uretim isi kayitlarina bu kadar geriye bakilir (daha eski isler BullMQ'dan coktan silinir) */
const JOB_LOOKBACK_MS = 7 * 24 * 60 * 60_000;
/** Redis bu surede yanit vermezse durum "dogrulanamadi" sayilir (yaziya dokunulmaz) */
const REDIS_TIMEOUT_MS = 5_000;
/** Tek sorguda en fazla bu kadar JSON yolu kosulu (OR) */
const JOB_QUERY_CHUNK = 50;
/** Geri koyma sayaci (kv_store); KvSweepCron suresi dolani siler */
const REQUEUE_TTL_MS = 7 * 24 * 60 * 60_000;
const requeueKey = (articleId: string) => `generating-sweep:${articleId}`;
// Demo sitesi (DEMO_SITE_URL) ornek bir GENERATING yazi tasir; arkasinda
// bilerek is yoktur. Supurulse demo "başarısız" gosterirdi.
/** BullMQ'da isin bittigini ya da hic olmadigini gosteren durumlar; digerleri canli */
const DEAD_STATES: ReadonlySet<string> = new Set(['completed', 'failed', 'unknown']);
/** Kuyrukta bekleyen/islenen isler (delayed haric: orada takvimin gecikmeli isleri yigilir) */
const LIVE_TYPES: JobType[] = ['active', 'waiting', 'prioritized', 'paused', 'waiting-children'];

/** BullMQ sorgulari — worker kendi Queue'sundan kurar (bullmqQueueInspector), testte sahtelenir */
export interface QueueInspector {
  /** Isin BullMQ durumu; kuyrukta yoksa 'unknown' */
  jobState(bullJobId: string): Promise<string>;
  /** Kuyrukta bekleyen/islenen GENERATE_ARTICLE islerinin yazi kimlikleri; tavan asilirsa null */
  liveArticleIds(): Promise<Set<string> | null>;
}

export function bullmqQueueInspector(
  queue: Pick<Queue, 'getJobState' | 'getJobCounts' | 'getJobs'>,
  limit = LIVE_QUEUE_SCAN_LIMIT,
): QueueInspector {
  return {
    jobState: (bullJobId) => queue.getJobState(bullJobId),
    async liveArticleIds() {
      const counts = await queue.getJobCounts(...LIVE_TYPES);
      const total = Object.values(counts).reduce((sum, n) => sum + (Number(n) || 0), 0);
      if (total > limit) return null;
      const ids = new Set<string>();
      // getJobs listeleme ile okuma arasinda silinen is icin undefined dondurebilir
      for (const job of await queue.getJobs(LIVE_TYPES, 0, limit)) {
        if (!job || job.name !== 'GENERATE_ARTICLE' || isScheduledGenerationJobId(job.id)) continue;
        const articleId = (job.data as { articleId?: unknown } | undefined)?.articleId;
        if (typeof articleId === 'string' && articleId) ids.add(articleId);
      }
      return ids;
    },
  };
}

export interface GeneratingSweepResult {
  /** Bayat GENERATING aday sayisi */
  candidates: number;
  /** Takvime geri konan (SCHEDULED) */
  requeued: number;
  /** FAILED yapilan */
  failed: number;
  /** FAILED yapilanlardan makale hakki iade edilen */
  refunded: number;
  /** Canli isi oldugu icin dokunulmayan */
  live: number;
  /** Is durumu dogrulanamadigi icin dokunulmayan */
  unverified: number;
  /** Okuma ile yazma arasinda yazi degisti (kosullu guncelleme 0 satir) */
  raced: number;
}

export interface GeneratingSweepDeps {
  prisma: PrismaService;
  inspector: QueueInspector;
  log?: Pick<Logger, 'log' | 'warn'>;
  now?: Date;
}

const defaultLog = new Logger('GeneratingSweeper');

/** Redis cagrisini sinirli sure bekler: maxRetriesPerRequest null iken baglanti yokken komut suresiz bekler */
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`Redis ${ms} ms içinde yanıt vermedi`)), ms);
    timer.unref?.();
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

type JobRef = { bullJobId: string | null; queuedAt: Date };

/** Adaylarin uretim isi kayitlari (takvimin gecikmeli isi haric), yazi kimligine gore */
async function loadGenerationJobs(prisma: PrismaService, articleIds: string[], now: Date): Promise<Map<string, JobRef[]>> {
  const byArticle = new Map<string, JobRef[]>();
  const since = new Date(now.getTime() - JOB_LOOKBACK_MS);
  for (let i = 0; i < articleIds.length; i += JOB_QUERY_CHUNK) {
    const chunk = articleIds.slice(i, i + JOB_QUERY_CHUNK);
    const rows = await prisma.job.findMany({
      where: {
        type: 'GENERATE_ARTICLE' as any,
        queuedAt: { gte: since },
        // MySQL'de JSON yolu `$` ile baslayan tek dize (translator.service.ts ile ayni kalip)
        OR: chunk.map((id) => ({ payload: { path: '$.articleId', equals: id } })),
      },
      select: { bullJobId: true, queuedAt: true, payload: true },
    });
    for (const row of rows) {
      const articleId = (row.payload as { articleId?: unknown } | null)?.articleId;
      if (typeof articleId !== 'string' || isScheduledGenerationJobId(row.bullJobId)) continue;
      const list = byArticle.get(articleId) ?? [];
      list.push({ bullJobId: row.bullJobId, queuedAt: row.queuedAt });
      byArticle.set(articleId, list);
    }
  }
  return byArticle;
}

type Liveness = 'live' | 'dead' | 'unverified';

async function articleLiveness(
  articleId: string,
  liveIds: Set<string>,
  jobs: JobRef[],
  cutoff: Date,
  inspector: QueueInspector,
): Promise<Liveness> {
  if (liveIds.has(articleId)) return 'live';
  // Yeni kuyruga atilmis is: kayit var, BullMQ kimligi henuz yazilmamis olabilir
  if (jobs.some((j) => j.queuedAt.getTime() >= cutoff.getTime())) return 'live';
  for (const job of jobs) {
    if (!job.bullJobId) continue;
    let state: string;
    try {
      state = await withTimeout(Promise.resolve(inspector.jobState(job.bullJobId)), REDIS_TIMEOUT_MS);
    } catch {
      return 'unverified';
    }
    // delayed burada yeniden deneme beklemesidir (takvim isleri yukarida elendi)
    if (!DEAD_STATES.has(state)) return 'live';
  }
  return 'dead';
}

async function readRequeues(prisma: PrismaService, articleId: string, now: Date): Promise<number> {
  const row = await prisma.kvStore.findUnique({ where: { key: requeueKey(articleId) }, select: { value: true, expiresAt: true } });
  if (!row || (row.expiresAt && row.expiresAt.getTime() <= now.getTime())) return 0;
  const n = Number(row.value);
  return Number.isInteger(n) && n > 0 ? n : 0;
}

async function writeRequeues(prisma: PrismaService, articleId: string, count: number, now: Date): Promise<void> {
  const key = requeueKey(articleId);
  const expiresAt = new Date(now.getTime() + REQUEUE_TTL_MS);
  await prisma.kvStore.upsert({
    where: { key },
    create: { key, value: String(count), expiresAt },
    update: { value: String(count), expiresAt },
  });
}

/** Bir tur: bayat GENERATING yazilari bulur, canli isi olmayanlari geri koyar ya da FAILED yapar */
export async function sweepStuckGenerating(deps: GeneratingSweepDeps): Promise<GeneratingSweepResult> {
  const { prisma, inspector } = deps;
  const log = deps.log ?? defaultLog;
  const now = deps.now ?? new Date();
  const cutoff = new Date(now.getTime() - GENERATING_STALE_MS);
  const result: GeneratingSweepResult = { candidates: 0, requeued: 0, failed: 0, refunded: 0, live: 0, unverified: 0, raced: 0 };

  const stale = await prisma.article.findMany({
    where: {
      status: 'GENERATING' as any,
      updatedAt: { lt: cutoff },
      // Silme talebi olan hesap: isleri iptal edildi (account-deletion), yazilari
      // hesap kalici silinince gider; takvime geri koymak silme akisina ters.
      site: { url: { not: DEMO_SITE_URL }, user: { deletionRequestedAt: null } },
    },
    select: { id: true, siteId: true, scheduledAt: true, updatedAt: true },
    orderBy: { updatedAt: 'asc' },
    take: GENERATING_SWEEP_BATCH,
  });
  result.candidates = stale.length;
  if (stale.length === 0) return result;

  let liveIds: Set<string> | null = null;
  try {
    liveIds = await withTimeout(Promise.resolve(inspector.liveArticleIds()), REDIS_TIMEOUT_MS);
  } catch (err: any) {
    log.warn(`[generating-sweep] Kuyruk okunamadı (${String(err?.message ?? err).slice(0, 200)}); ${stale.length} yazıya dokunulmadı`);
  }
  if (!liveIds) {
    // Okunamadi ya da tavani asti: hicbir yazi icin "isi yok" denemez
    result.unverified = stale.length;
    return result;
  }

  const jobsByArticle = await loadGenerationJobs(prisma, stale.map((a) => a.id), now);

  for (const a of stale) {
    try {
      const liveness = await articleLiveness(a.id, liveIds, jobsByArticle.get(a.id) ?? [], cutoff, inspector);
      if (liveness === 'live') { result.live++; continue; }
      if (liveness === 'unverified') { result.unverified++; continue; }

      const requeues = a.scheduledAt ? await readRequeues(prisma, a.id, now) : 0;
      const target = a.scheduledAt && requeues < GENERATING_SWEEP_MAX_REQUEUES ? 'SCHEDULED' : 'FAILED';
      // Sayac ONCE yazilir: yazilamazsa geri koyma yapilmaz (tavan islemezse
      // coken bir uretim her turda yeniden kuyruga girerdi)
      if (target === 'SCHEDULED') await writeRequeues(prisma, a.id, requeues + 1, now);

      // Kosullu: okuma ile yazma arasinda uretim bittiyse ya da yazi baska
      // yoldan degistiyse dokunulmaz. FAILED karari hakki da iade eder (ayni kosulla,
      // tek islemde; worker'in son denemesiyle yarisirsa yalniz biri iade eder).
      const where = { id: a.id, status: 'GENERATING' as any, updatedAt: { lt: cutoff } };
      let moved: boolean;
      if (target === 'SCHEDULED') {
        moved = (await prisma.article.updateMany({ where, data: { status: target as any } })).count === 1;
      } else {
        const r = await failGenerationWithRefund(prisma, { articleId: a.id, where, now });
        moved = r.failed;
        if (r.refunded) result.refunded++;
      }
      if (!moved) { result.raced++; continue; }

      const hours = Math.round((now.getTime() - a.updatedAt.getTime()) / 3_600_000);
      if (target === 'SCHEDULED') {
        result.requeued++;
        log.warn(`[${a.siteId}] Takılı üretim: ${a.id} ~${hours} saattir GENERATING ve canlı işi yok → takvime geri kondu (${requeues + 1}/${GENERATING_SWEEP_MAX_REQUEUES})`);
      } else {
        result.failed++;
        log.warn(`[${a.siteId}] Takılı üretim: ${a.id} ~${hours} saattir GENERATING ve canlı işi yok → FAILED (${a.scheduledAt ? 'yeniden deneme hakkı bitti' : 'takvim dışı üretim'})`);
      }
    } catch (err: any) {
      // Tek yazinin hatasi turu durdurmaz; yaziya dokunulmadi, sonraki tur yeniden bakar
      result.unverified++;
      log.warn(`[${a.siteId}] Takılı üretim kontrolü başarısız (${a.id}): ${String(err?.message ?? err).slice(0, 200)}`);
    }
  }
  return result;
}

/**
 * acquireCronLock en ince saatlik kilit verir; 30 dakikalik tur icin anahtara
 * yarim saat dilimi eklenir (saat damgasini kilit kendisi ekler, UTC).
 */
export function generatingSweepLockName(now: Date): string {
  return `generating-sweep-${now.getUTCMinutes() < 30 ? 0 : 1}`;
}

/** Worker tekrar isinin girisi: kilit + tur + ozet log */
export async function runGeneratingSweep(
  deps: GeneratingSweepDeps,
): Promise<GeneratingSweepResult | { skipped: true; reason: 'LOCKED' }> {
  const log = deps.log ?? defaultLog;
  const now = deps.now ?? new Date();
  if (!(await acquireCronLock(deps.prisma, generatingSweepLockName(now), 'hourly'))) {
    return { skipped: true, reason: 'LOCKED' };
  }
  const r = await sweepStuckGenerating({ ...deps, now });
  if (r.requeued > 0 || r.failed > 0 || r.unverified > 0 || r.raced > 0) {
    log.log(`[generating-sweep] ${r.candidates} aday: ${r.requeued} takvime geri, ${r.failed} FAILED (${r.refunded} hak iadesi), ${r.live} canlı işli, ${r.unverified} doğrulanamadı, ${r.raced} yarışta değişti`);
  }
  return r;
}
