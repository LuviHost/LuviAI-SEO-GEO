import { isScheduledGenerationJobId, readAllowanceCharge } from '../articles/article-scheduler.service.js';

/**
 * YONETICININ "DURDUR"U — yanlislikla baslatilan taramayi ve olcumu durdurma (sahip
 * istegi 21.11.2026: "yanlislikla tarama baslatinca admin'de arka plandaki istekleri
 * durduracak bir dugme; site listesinde Vazgecildi gibi bir sey gorunsun").
 *
 * NEDEN VAR: kuyruktaki is DB'de CANCELED olunca worker onu hic calistirmiyordu
 * (index.ts accountSkip) ama CALISAN zinciri durduran bir yol yoktu; tek care is
 * satirini elle CANCELED yapip TUM worker'i yeniden baslatmakti — bu ayni anda baska
 * bir sitenin kurulumunu da oldurdu. Artik:
 *  1. API (cancelSiteJobs) sitenin QUEUED / PROCESSING is satirlarini CANCELED yapar,
 *     bekleyen BullMQ islerini siler (en iyi caba) ve kurulumun takvime yazdigi, hic
 *     uretilmemis yazilari siler.
 *  2. Worker zincirin adim sinirlarinda is satirina bakar (jobCancelCheck): satir
 *     CANCELED ise JobCanceledError firlatir, zincir temiz durur, satir CANCELED kalir.
 *
 * KESILEMEYENLER (acik risk): adim sinirinda bakilir — o an suren TEK bir uzun cagri
 * (beyin uretimi, asistanlara olcum turu, konu motoru, makale hattinin 5 ajani) kendi
 * sonuna kadar kosar; harcanan kisim geri gelmez.
 */

/** Yonetici iptalinin is satirindaki izi (Job.error) */
export const ADMIN_CANCEL_ERROR = 'Yonetici durdurdu (panelden iptal edildi)';

/** Site listesinde "Vazgecildi" hesabina giren tarama isleri */
export const SCAN_JOB_TYPES = ['ONBOARDING_CHAIN', 'SITE_AUDIT'] as const;

const LIVE_STATUSES = ['QUEUED', 'PROCESSING'] as const;

/** Kurulumun takvime yazdigi ama hic uretilmemis yazilarin durumlari */
const UNGENERATED_STATUSES = ['SCHEDULED', 'GENERATING'] as const;

/**
 * Is satiri iptal edildigi icin calisan isin durduruldugunu bildirir. Worker
 * sarmalayicisi bunu hata saymaz: is { skipped, reason: 'job_canceled' } ile biter,
 * satir CANCELED kalir (FAILED / COMPLETED olmaz, yeniden denenmez).
 */
export class JobCanceledError extends Error {
  /** instanceof modul kopyasi farkinda da tutsun diye isaret */
  readonly jobCanceled = true as const;
  constructor(readonly step: string) {
    super(`Is iptal edildi (${step})`);
    this.name = 'JobCanceledError';
  }
}

export function isJobCanceledError(err: unknown): err is JobCanceledError {
  return !!err && typeof err === 'object' && (err as { jobCanceled?: unknown }).jobCanceled === true;
}

interface JobRowReader {
  job: { findUnique(args: unknown): Promise<{ status: string } | null> };
}

/**
 * Calisan isin adim siniri denetimi: is satiri CANCELED ise JobCanceledError firlatir.
 * Tek sorgu (bullJobId tekil indeks). DB kaydi olmayan is (cron tekrarlari) ya da
 * okunamayan satir icin hicbir sey yapmaz: denetim isi DUSURMEZ, yalniz iptali gorur.
 */
export function jobCancelCheck(prisma: JobRowReader, bullJobId: string | number | null | undefined) {
  const id = bullJobId === null || bullJobId === undefined ? '' : String(bullJobId);
  return async (step: string): Promise<void> => {
    if (!id) return;
    const row = await prisma.job.findUnique({ where: { bullJobId: id }, select: { status: true } }).catch(() => null);
    if (row?.status === 'CANCELED') throw new JobCanceledError(step);
  };
}

interface ArticleCleanupDb {
  article: {
    findMany(args: unknown): Promise<Array<{ id: string; status: string; agentOutputs: unknown }>>;
    deleteMany(args: unknown): Promise<{ count: number }>;
  };
}

/**
 * Iptal edilen kurulumun takvime yazdigi, HIC URETILMEMIS yazilari siler
 * (since: zincirin kuyruga girdigi an; kurulumun yazilari ondan sonra acilir).
 *
 * Silinenler: SCHEDULED / GENERATING, govdesi bos, yayinlanmamis ve makale hakkindan
 * DUSMEMIS (isaretsiz) ya da ucretli planin ucretsiz ilk yazisi ('onboarding_free').
 * Boylece saatlik tarama onlari sonradan uretmez; hemen uretime alinan ilk yazinin isi
 * calisirsa yaziyi bulamaz ve LLM harcamadan doner (claimForGeneration
 * 'article_missing').
 * Dokunulmayanlar: hak dusulmus yazi (iadesiz silinirse hak kaybolurdu) — onu takili
 * uretim supurucusu bilinen kuralla takvime geri koyar ya da FAILED yapip iade eder.
 * Silme kosullu (ayni durum + bos govde): arada uretime gecen yazi silinmez.
 */
export async function removeCanceledOnboardingArticles(db: ArticleCleanupDb, siteId: string, since: Date): Promise<number> {
  const rows = await db.article.findMany({
    where: {
      siteId,
      createdAt: { gte: since },
      status: { in: [...UNGENERATED_STATUSES] },
      publishedAt: null,
      bodyMd: null,
    },
    select: { id: true, status: true, agentOutputs: true },
  });
  const ids = rows
    .filter((r) => {
      const charge = readAllowanceCharge(r.agentOutputs);
      return !charge || charge.source === 'onboarding_free';
    })
    .map((r) => r.id);
  if (ids.length === 0) return 0;
  const res = await db.article.deleteMany({
    where: { id: { in: ids }, siteId, status: { in: [...UNGENERATED_STATUSES] }, publishedAt: null, bodyMd: null },
  });
  return res.count;
}

export interface SiteJobCancelDeps {
  prisma: ArticleCleanupDb & {
    job: {
      findMany(args: unknown): Promise<Array<{ id: string; type: string; status: string; bullJobId: string | null; queuedAt: Date }>>;
      updateMany(args: unknown): Promise<{ count: number }>;
    };
  };
  /** Bekleyen BullMQ isini siler (JobQueueService.removeJob); calisan is silinemez, false doner */
  removeJob(bullJobId: string): Promise<boolean>;
  log?: { log(msg: string): void; warn(msg: string): void };
}

export interface SiteJobCancelResult {
  /** CANCELED yapilan is satiri */
  canceled: number;
  /** O an calisan (worker adim sinirinda duracak) is */
  running: number;
  /** Kuyruktan silinen bekleyen BullMQ isi */
  removedFromQueue: number;
  /** Silinen, hic uretilmemis kurulum yazisi */
  deletedArticles: number;
}

/**
 * Sitenin arka plan islerini durdurur (yalniz yonetici; admin.controller).
 *
 * Takvimin gecikmeli uretim tetikleri (gen:article:<id>) BILEREK disarida: tarama
 * degiller, iptalleri bir sey durdurmaz (yaziyi saatlik tarama yine alir), yalniz
 * yazinin zamaninda uretilmesini bozar.
 */
export async function cancelSiteJobs(
  deps: SiteJobCancelDeps,
  siteId: string,
  opts: { now?: Date } = {},
): Promise<SiteJobCancelResult> {
  const now = opts.now ?? new Date();
  const live = (await deps.prisma.job.findMany({
    where: { siteId, status: { in: [...LIVE_STATUSES] } },
    select: { id: true, type: true, status: true, bullJobId: true, queuedAt: true },
  })).filter((j) => !isScheduledGenerationJobId(j.bullJobId));

  if (live.length === 0) return { canceled: 0, running: 0, removedFromQueue: 0, deletedArticles: 0 };

  // Kosullu: arada biten is (COMPLETED / FAILED) geri CANCELED'a cekilmez
  const upd = await deps.prisma.job.updateMany({
    where: { id: { in: live.map((j) => j.id) }, status: { in: [...LIVE_STATUSES] } },
    data: { status: 'CANCELED', error: ADMIN_CANCEL_ERROR, finishedAt: now },
  });

  // Bekleyen isi kuyruktan sil (en iyi caba): kalan olursa worker CANCELED satiri gorup atlar
  let removedFromQueue = 0;
  for (const j of live) {
    if (j.status !== 'QUEUED' || !j.bullJobId) continue;
    if (await deps.removeJob(j.bullJobId).catch(() => false)) removedFromQueue++;
  }

  // Kurulum zinciri iptal edildiyse takvime yazdigi uretilmemis yazilar da gider
  const chains = live.filter((j) => j.type === 'ONBOARDING_CHAIN');
  let deletedArticles = 0;
  if (chains.length > 0) {
    const since = new Date(Math.min(...chains.map((j) => new Date(j.queuedAt).getTime())));
    deletedArticles = await removeCanceledOnboardingArticles(deps.prisma, siteId, since).catch((err: any) => {
      deps.log?.warn(`[${siteId}] Iptal edilen kurulumun yazilari silinemedi: ${err?.message ?? err}`);
      return 0;
    });
  }

  const running = live.filter((j) => j.status === 'PROCESSING').length;
  deps.log?.log(
    `[${siteId}] Yonetici arka plan islerini durdurdu: ${upd.count} is iptal edildi `
    + `(${running} calisiyordu, adim sinirinda durur), ${removedFromQueue} kuyruktan silindi, ${deletedArticles} uretilmemis yazi silindi`,
  );
  return { canceled: upd.count, running, removedFromQueue, deletedArticles };
}

/** Site listesindeki is durumu (yalniz yonetici gorur) */
export interface SiteJobState {
  /** Kuyrukta bekleyen ya da calisan arka plan isi var: "Durdur" gosterilir */
  running: boolean;
  /** Sitenin en son tarama isi (kurulum zinciri / site taramasi) iptal edildi: "Vazgecildi" */
  canceled: boolean;
}

/**
 * Saf hesap: siteler icin is durumu.
 *  - liveJobs: QUEUED / PROCESSING satirlari (takvim tetikleri dahil gelebilir; elenir)
 *  - lastScanAt: site basina en son tarama isinin kuyruga girdigi an
 *  - lastCanceledScanAt: site basina en son IPTAL EDILEN tarama isinin ani
 * En son tarama isi iptal edildiyse (iki an esit) canceled; sonradan yeni tarama
 * baslatildiysa (daha yeni an) artik degil.
 *  - olcum (istege bagli): canceledAt = en son iptal edilen tarama isinin iptal ani
 *    (finishedAt), lastMeasuredAt = sitenin en son AI olcumu (AiCitationRun.runAt).
 *    Iptalden SONRA olcum yapildiysa site birakilmamistir (yonetici kurulumu makale
 *    uretmesin diye durdurup olcumu elle yapti): "Vazgecildi" yazilmaz, rozet site
 *    durumunu gosterir. Kurulumun kendi olcumu iptalden once oldugu icin sayilmaz.
 */
export function siteJobStates(
  siteIds: string[],
  liveJobs: Array<{ siteId: string | null; bullJobId: string | null }>,
  lastScanAt: Map<string, Date>,
  lastCanceledScanAt: Map<string, Date>,
  olcum?: { canceledAt: Map<string, Date>; lastMeasuredAt: Map<string, Date> },
): Map<string, SiteJobState> {
  const runningSites = new Set(
    liveJobs.filter((j) => j.siteId && !isScheduledGenerationJobId(j.bullJobId)).map((j) => j.siteId as string),
  );
  const out = new Map<string, SiteJobState>();
  for (const id of siteIds) {
    const last = lastScanAt.get(id);
    const lastCanceled = lastCanceledScanAt.get(id);
    const canceledAt = olcum?.canceledAt.get(id);
    const measuredAt = olcum?.lastMeasuredAt.get(id);
    const measuredAfterCancel = !!canceledAt && !!measuredAt && measuredAt.getTime() > canceledAt.getTime();
    const canceled = !!last && !!lastCanceled && lastCanceled.getTime() >= last.getTime() && !measuredAfterCancel;
    out.set(id, { running: runningSites.has(id), canceled });
  }
  return out;
}
