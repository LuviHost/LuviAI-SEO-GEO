import type { StuckPageStatus } from '@prisma/client';
import { STUCK_ALREADY_QUEUED, STUCK_PAGE_NOT_FOUND, stuckStatusSkipText } from './stuck-page-messages.js';
import {
  STUCK_ARTICLE_SELECT, STUCK_RECOVER_JOB_PRIORITY, liveStuckRecoverJobs, planStuckRepublish, recoverableStuckStatuses,
  releaseAbandonedStuckClaim, stuckArticleSkipReason, stuckPlanAllows, stuckPlanRequiredText, type StuckArticleRow, type StuckClaimDeps,
  type StuckJobLivenessDeps,
} from './stuck-page-autopilot.js';

/**
 * Takili sayfa TOPLU onarimi (POST stuck-pages/recover-batch) — KUYRUGA ALMA.
 *
 * NEDEN: uc her sayfanin kurtarmasini (GEO taramasi ~14 sirali istek + Sonnet
 * cagrisi, sayfa basina ~30-60 sn) TEK HTTP isteginin icinde sirayla
 * bekliyordu. api.ranksup.ai Cloudflare vekilinin arkasinda; vekil kaynak
 * sunucunun yanitini sinirli bekler, sonra 524 doner (iki kaynak:
 * developers.cloudflare.com fundamentals/reference/connection-limits "Proxy
 * Read Timeout | 125", Enterprise disinda degistirilemez; support/.../error-524
 * "the default 125 seconds"; uretimde 524 goruldu: intel.controller.ts,
 * audit-reports-panel.tsx). Birkac sayfalik secimde panel 524 alip "tekrar
 * dene" diyor, sunucu ise yazilari duzenleyip yayin kuyruguna atmaya devam
 * ediyordu. Tekrar deneme ayni sayfalari ikinci kez duzenliyordu. Artik uygun
 * her sayfa icin bir STUCK_PAGE_RECOVER isi kuyruga girer ve cevap HEMEN doner.
 *
 * Kuyruga almadan ONCE (paylasilan sozlesme D4) — is kosunca atlanacagi
 * bastan bilinen sayfa kuyruga girmez, nedeni satirda hemen doner (eskiden
 * yalniz durum denetleniyordu; isin atlama nedeni yalniz is kaydinda kaliyor,
 * panel 15 dk bekleyip sessizce vazgeciyordu):
 *  - sayfa bu sitede olmali ve kullanicinin duzeltebilecegi durumda (Tespit
 *    edildi / Basarisiz — panel canRecover); kira suresi dolmus, isi olmayan
 *    RECOVERING satir once onceki durumuna birakilir (releaseAbandonedStuckClaim);
 *  - sayfa icin bekleyen ya da islenen bir kurtarma isi olmamali (sayfa basina
 *    TEK is; satir o isin jobId'sini tasir) — yeniden gonderilen secim ayni GEO
 *    taramasini ve Sonnet cagrisini ikinci kez kosturuyordu. Kullanicinin istegini
 *    yalniz bekleyen KULLANICI isi karsilar; bekleyen otopilot isi sayilmaz, o
 *    otopilot kurallariyla atlayabilir (batchLivenessDeps);
 *  - RanksUp makalesi olan sayfada recover()'un ucuz denetimleri AYNEN
 *    (stuck-page-autopilot.ts stuckArticleSkipReason): yazi var, kopya cop
 *    kutusunda / hedefte yok degil, kayittaki metin canlida (bekleyen surum,
 *    kopyaya yazilamamis son metin, yayinlanmamis degisiklik yok), govde bos degil;
 *  - yapay zeka kullanilabilir olmali (anahtar tanimli, yonetici kapatmamis);
 *  - site sahibinin plani Takili Sayfalar'i kapsamali (uc @RequiresPlan ile
 *    zaten reddeder; servis baska yoldan cagrilirsa da is acilmaz). Istegi
 *    yonetici (ADMIN) yaptiysa bu kapi uygulanmaz: PlanFeatureGuard ile ayni
 *    kural. Takili sayfa kurtarmasinin ayrica bir kotasi yok.
 * Is kosarken servis hepsini yeniden denetler (arada degisebilir); is
 * kosmadan once sayfa baska yoldan islendiyse is yapay zeka cagirmadan atlar
 * (payload.requestedAt). Plan kapisi (@RequiresPlan('stuckPages')) ve kullanici
 * + site basina hiz siniri uctadir: kuyruga alma aninda uygulanir. Isler dusuk
 * oncelikle (STUCK_RECOVER_JOB_PRIORITY) kuyruga girer: tek musterinin 50
 * sayfalik secimi diger musterilerin yayin / uretim / kurulum islerini bekletmez.
 *
 * Cevap bicimi (paylasilan sozlesme C4 + D4):
 *   results[]: { stuckPageId, queued, jobId?, notProcessed?, reason?, code?, error? }
 *   summary:   { queued, notProcessed, failed }
 * jobId DB is kimligidir (GET /jobs/:id ile izlenir; auto-fix.service ile ayni):
 * kuyruga alinan satirda yeni is, 'already_queued' satirinda bekleyen is.
 * Eski satir alanlarindan yalniz `id` (stuckPageId ile ayni) anlamini korudugu
 * icin kalir; ok / recoveryId / editsCount / manual kuyruga alma aninda
 * bilinemez, ozetteki succeeded / proposals de oyle.
 */

/** Denenmeyen satirin makine okunur nedeni (reason Turkce metindir; ek alan) */
export type StuckBatchSkipCode = 'status' | 'already_queued' | 'not_eligible' | 'ai_unavailable' | 'plan' | 'over_limit';

export interface StuckBatchQueueRow {
  stuckPageId: string;
  /** Eski alan — stuckPageId ile ayni */
  id: string;
  /** true: kurtarma isi kuyruga alindi (sonuc sayfanin durumunda ve GET /jobs/:id'de gorunur) */
  queued: boolean;
  /** DB is kimligi (GET /jobs/:id): kuyruga alinan is ya da zaten bekleyen is (code 'already_queued') */
  jobId?: string;
  /** Hic denenmedi: istek basina sinirin (max) ustunde, durumu uygun degil ya da is bastan atlanacak */
  notProcessed?: boolean;
  /** Sayfa neden kuyruga alinmadi (Turkce; panel aynen gosterir) */
  reason?: string;
  /** reason'in makine okunur turu (ek alan) */
  code?: StuckBatchSkipCode;
  /** Sayfa bulunamadi ya da is kuyruga alinamadi (Turkce) */
  error?: string;
}

export interface StuckBatchQueueSummary {
  /** Kuyruga alinan sayfa */
  queued: number;
  /** Denenmeyen sayfa: tek istek sinirini asti, durumu uygun degil, zaten sirada ya da is bastan atlanacakti */
  notProcessed: number;
  /** Kuyruga alinamayan sayfa: bu sitede yok ya da is kuyruga alinamadi */
  failed: number;
}

export interface StuckBatchQueueResult {
  results: StuckBatchQueueRow[];
  summary: StuckBatchQueueSummary;
}

type StuckBatchRow = { id: string; status: StuckPageStatus | string; updatedAt?: unknown; articleId?: string | null; url?: string | null };

export interface StuckBatchQueueDeps {
  prisma: {
    site: { findUnique(args: any): Promise<{ userId?: string | null; user?: { plan?: unknown } | null } | null> };
    /** Istegi yapanin rolu (yonetici plan kapisindan muaf); yoksa kapi herkese uygulanir */
    user?: { findUnique(args: any): Promise<{ role?: unknown } | null> };
    stuckPage: { findMany(args: any): Promise<StuckBatchRow[]>; updateMany?(args: any): Promise<{ count: number }> };
    /** Makale denetimleri icin (yoksa yalniz durum ve tekil is denetlenir) */
    article?: { findMany(args: any): Promise<any[]>; findUnique?(args: any): Promise<any>; updateMany?(args: any): Promise<{ count: number }> };
    publishTarget?: { findMany(args: any): Promise<any[]> };
    job?: StuckClaimDeps['prisma']['job'];
    kvStore?: StuckClaimDeps['prisma']['kvStore'];
    stuckPageRecovery?: StuckClaimDeps['prisma']['stuckPageRecovery'];
  };
  jobs: { enqueue(opts: any): Promise<{ dbJobId?: unknown } | unknown>; getJobState?(bullJobId: string): Promise<string> };
  /** Yapay zeka kullanilamiyorsa Turkce neden (anahtar yok / yonetici kapatti), yoksa null */
  aiBlock?: () => Promise<string | null>;
  log?: { warn(msg: string): void };
  now?: () => Date;
}

/** Satirlardan ozet; her satir tam olarak bir kovaya girer */
export function stuckBatchQueueSummary(results: readonly StuckBatchQueueRow[]): StuckBatchQueueSummary {
  const summary: StuckBatchQueueSummary = { queued: 0, notProcessed: 0, failed: 0 };
  for (const r of results) {
    if (r.queued) summary.queued++;
    else if (r.notProcessed) summary.notProcessed++;
    else summary.failed++;
  }
  return summary;
}

/** Sahipsiz sahiplenmeyi birakmak icin gereken yuzey (stuckPage.updateMany yoksa birakilmaz) */
function batchClaimDeps(deps: StuckBatchQueueDeps): StuckClaimDeps | null {
  const { prisma } = deps;
  if (typeof prisma.stuckPage.updateMany !== 'function') return null;
  return { prisma: prisma as unknown as StuckClaimDeps['prisma'], jobs: deps.jobs, now: deps.now, log: deps.log };
}

/**
 * BullMQ kimligi yazilmamis is kaydi toplu onarimda en fazla bu kadar sure
 * "kuyruga ekleniyor" (canli) sayilir; liveStuckRecoverJobs'un genel 5 dakikasi
 * yerine.
 *
 * NEDEN (inceleme S24'un yan etkisi): JobQueueService.enqueue once DB kaydini
 * acar, sonra queue.add ile BullMQ'ya ekler ve kimligi hemen yazar
 * (milisaniyeler). Ekleme hata verince kayit kimliksiz kaliyor ve 5 dk canli
 * sayiliyordu: "Düzeltme kuyruğa alınamadı; biraz sonra tekrar dene" yanitini
 * alip birkac dakika icinde yeniden deneyen musteri hic kosmayacak bir is icin
 * "zaten sırada" goruyor, kart yarim saat donuyordu. enqueue artik o kaydi
 * FAILED yapar; surec ekleme sirasinda oldugu icin kimliksiz kalan kayit da 30
 * sn sonra engel sayilmaz. Eklenmis ama kimligi yazilamamis bir isin ikinci kez
 * kuyruga girmesi zararsizdir: is kosarken sahiplenme ve istek zamani
 * denetimi (recover requestedAt) ikinci yapay zeka turunu durdurur.
 */
export const STUCK_UNQUEUED_JOB_GRACE_MS = 30_000;

/**
 * Toplu onarimin "sayfa basina tek bekleyen is" denetimine (liveStuckRecoverJobs)
 * giden is kayitlari suzulur:
 *  - BullMQ kimligi olmayan, STUCK_UNQUEUED_JOB_GRACE_MS'ten eski kayit sayilmaz
 *    (kuyruga hic eklenemedi; S24).
 *  - Kullanicinin istegini yalniz KULLANICI isi karsilar: bekleyen otopilot isi
 *    (payload.triggeredBy 'autopilot') sayilmaz. NEDEN (inceleme S19'un yan
 *    etkisi): otopilot isi kosarken otopilota ozgu kurallari uygular (Yari
 *    otomatik, duraklatilmis akis, plan, son 30 gunde yazim, oneri plani) ve
 *    atlayabilir; panel ise kullanicinin acik istegini "zaten sırada" diye o ise
 *    baglayip sonucta "Site Yarı otomatik modda…" gosteriyordu. Kullanici isi bu
 *    kurallara tabi degil. Iki is ard arda kosarsa ikincisi sahiplenme ve istek
 *    zamani denetimiyle yapay zeka cagirmadan atlar. Ikinci asama isleri
 *    (triggeredBy tasimaz) her istegi karsilamaya devam eder.
 */
function batchLivenessDeps(deps: StuckBatchQueueDeps, triggeredBy: string): StuckJobLivenessDeps {
  const job = deps.prisma.job;
  const userRequest = triggeredBy !== 'autopilot';
  return {
    prisma: {
      job: job
        ? {
          findMany: async (args: any) => {
            const rows = await job.findMany(args);
            const now = (deps.now?.() ?? new Date()).getTime();
            return (Array.isArray(rows) ? rows : []).filter((row) => {
              if (userRequest && (row?.payload as { triggeredBy?: unknown } | null | undefined)?.triggeredBy === 'autopilot') return false;
              if (typeof row?.bullJobId === 'string' && row.bullJobId) return true;
              const queuedAt = row?.queuedAt instanceof Date ? row.queuedAt.getTime() : Number.NaN;
              return Number.isFinite(queuedAt) && now - queuedAt < STUCK_UNQUEUED_JOB_GRACE_MS;
            });
          },
        }
        : undefined,
    },
    jobs: deps.jobs,
    now: deps.now,
  };
}

/** Istegi yapan kullanici yonetici mi? Okunamazsa hayir: plan kapisi uygulanir. */
async function actorIsAdmin(deps: StuckBatchQueueDeps, actorId: string): Promise<boolean> {
  if (!deps.prisma.user || !actorId) return false;
  const actor = await deps.prisma.user.findUnique({ where: { id: actorId }, select: { role: true } }).catch(() => null);
  return actor?.role === 'ADMIN';
}

/**
 * Uygun her sayfa icin bir STUCK_PAGE_RECOVER isi kuyruga alir.
 * triggeredBy oturumdaki kullanici (denetim kaydindaki kisi; govdeden alinmaz).
 * Ayni kimlik listede birden cok kez gelirse tek satir doner.
 */
export async function queueStuckRecoveries(
  deps: StuckBatchQueueDeps,
  input: { siteId: string; stuckPageIds: unknown[]; triggeredBy: string; max: number },
): Promise<StuckBatchQueueResult> {
  const ids = [...new Set((Array.isArray(input.stuckPageIds) ? input.stuckPageIds : []).filter((id): id is string => typeof id === 'string' && id.length > 0))];
  const head = ids.slice(0, input.max);
  const results: StuckBatchQueueRow[] = [];

  if (head.length > 0) {
    // Her kimlik siteId ile dogrulanir: govdedeki liste baska sitenin kaydini icerebilir
    const [site, rows] = await Promise.all([
      deps.prisma.site.findUnique({ where: { id: input.siteId }, select: { userId: true, user: { select: { plan: true } } } }),
      deps.prisma.stuckPage.findMany({
        where: { siteId: input.siteId, id: { in: head } },
        select: { id: true, status: true, updatedAt: true, articleId: true, url: true },
      }),
    ]);
    const byId = new Map(rows.map((r) => [r.id, r]));

    // Sahipsiz sahiplenme (onceki is oldu): onceki durumuna birakilir, sonra normal denetim
    const claimDeps = batchClaimDeps(deps);
    if (claimDeps) {
      for (const r of rows) {
        if (String(r.status) !== 'RECOVERING') continue;
        const released = await releaseAbandonedStuckClaim(claimDeps, r).catch(() => null);
        if (released) byId.set(r.id, { ...r, status: released });
      }
    }

    const allowed: readonly string[] = recoverableStuckStatuses(input.triggeredBy);
    const candidates = head.filter((id) => byId.has(id) && allowed.includes(String(byId.get(id)!.status)));
    // Sayfa basina tek bekleyen is. Dogrulanamazsa (Redis yanit vermedi) engel
    // sayilmaz: is kosarken sahiplenme ve istek zamani denetimi ikinci turu durdurur.
    // Kuyruga eklenemeyen kayit ve (kullanici isteginde) otopilot isi sayilmaz.
    const live = await liveStuckRecoverJobs(batchLivenessDeps(deps, input.triggeredBy), candidates).catch(() => null);

    // Makale denetimleri tek sorguda (recover() ile ayni ucuz kurallar)
    const articleIds = [...new Set(candidates.map((id) => byId.get(id)!.articleId).filter((a): a is string => typeof a === 'string' && a !== ''))];
    const checkArticles = articleIds.length > 0 && !!deps.prisma.article && !!deps.prisma.publishTarget;
    const [articles, targets] = checkArticles
      ? await Promise.all([
        deps.prisma.article!.findMany({ where: { id: { in: articleIds }, siteId: input.siteId }, select: { id: true, ...STUCK_ARTICLE_SELECT } }),
        deps.prisma.publishTarget!.findMany({ where: { siteId: input.siteId }, select: { id: true, type: true, isActive: true } }),
      ])
      : [[], []];
    const articleById = new Map((articles as Array<{ id: string } & StuckArticleRow>).map((a) => [a.id, a]));
    const aiReason = candidates.length > 0 && deps.aiBlock ? await deps.aiBlock() : null;
    // Plan bilinmiyorsa (kayit okunmadi) uctaki @RequiresPlan kapisina kalir.
    // Yonetici muaf (PlanFeatureGuard gibi). NEDEN (inceleme S9'un yan etkisi):
    // bu kapi site SAHIBININ planina bakiyordu; plani dusmus sahibin sitesinde
    // yoneticinin toplu onarimi 'plan' ile reddediliyor, ayni yoneticinin tekil
    // "AI Düzelt"i ise calisiyordu. Rol yalniz kapi kapaliyken okunur.
    const planBlocked = stuckPlanAllows(site?.user?.plan) === false && !(await actorIsAdmin(deps, input.triggeredBy));
    const requestedAt = (deps.now?.() ?? new Date()).toISOString();

    for (const id of head) {
      const sp = byId.get(id);
      if (!sp) {
        results.push({ stuckPageId: id, id, queued: false, error: STUCK_PAGE_NOT_FOUND });
        continue;
      }
      const skipRow = (reason: string, code: StuckBatchSkipCode, extra: Partial<StuckBatchQueueRow> = {}) => {
        results.push({ stuckPageId: id, id, queued: false, notProcessed: true, reason, code, ...extra });
      };
      if (!allowed.includes(String(sp.status))) {
        skipRow(stuckStatusSkipText(sp.status, input.triggeredBy === 'autopilot'), 'status');
        continue;
      }
      const pendingJob = live?.get(id);
      if (pendingJob) {
        skipRow(STUCK_ALREADY_QUEUED, 'already_queued', { jobId: pendingJob });
        continue;
      }
      if (sp.articleId && checkArticles) {
        const article = articleById.get(sp.articleId) ?? null;
        const plan = article ? planStuckRepublish({ publishedTo: article.publishedTo, targets: targets as any[], slug: article.slug, url: sp.url }) : null;
        const blocked = stuckArticleSkipReason(article, plan);
        if (blocked) {
          skipRow(blocked, 'not_eligible');
          continue;
        }
      }
      if (planBlocked) {
        skipRow(stuckPlanRequiredText(), 'plan');
        continue;
      }
      if (aiReason) {
        skipRow(aiReason, 'ai_unavailable');
        continue;
      }
      if (!site?.userId) {
        results.push({ stuckPageId: id, id, queued: false, error: 'Site bulunamadı; düzeltme kuyruğa alınamadı.' });
        continue;
      }
      try {
        const job = await deps.jobs.enqueue({
          type: 'STUCK_PAGE_RECOVER',
          userId: site.userId,
          siteId: input.siteId,
          // requestedAt: is kosmadan once sayfa islenirse (tekil "AI Düzelt") is yapay zeka cagirmadan atlar
          payload: { stuckPageId: id, triggeredBy: input.triggeredBy, requestedAt },
          priority: STUCK_RECOVER_JOB_PRIORITY,
        });
        const jobId = (job as { dbJobId?: unknown } | null | undefined)?.dbJobId;
        results.push({ stuckPageId: id, id, queued: true, ...(typeof jobId === 'string' && jobId ? { jobId } : {}) });
      } catch (err: any) {
        deps.log?.warn(`[${id}] Toplu onarim isi kuyruga alinamadi: ${err?.message ?? err}`);
        results.push({ stuckPageId: id, id, queued: false, error: 'Düzeltme kuyruğa alınamadı; biraz sonra tekrar dene.' });
      }
    }
  }
  // Eskiden sinirin ustu sessizce dusuyordu; panel "hepsi denendi" saniyordu
  for (const id of ids.slice(input.max)) {
    results.push({
      stuckPageId: id,
      id,
      queued: false,
      notProcessed: true,
      code: 'over_limit',
      error: `Tek seferde en fazla ${input.max} sayfa kuyruğa alınır; bu sayfa işlenmedi, tekrar deneyin.`,
    });
  }
  return { results, summary: stuckBatchQueueSummary(results) };
}
