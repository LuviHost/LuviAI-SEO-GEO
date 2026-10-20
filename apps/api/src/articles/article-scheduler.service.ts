import { Injectable, Logger, ForbiddenException, BadRequestException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { JobQueueService } from '../jobs/job-queue.service.js';
import { QuotaService } from '../billing/quota.service.js';
import { automationPublishFields, type PublishApprovalSite } from './publish-approval.js';
import { loadPlanLockedIds, withPlanLock } from './plan-lock.js';

/**
 * Takvimin gecikmeli uretim isinin BullMQ kimligi: makale basina tekil, ayni
 * kimlikle yeniden kuyruga atmak eskisini siler (reschedule). Worker bu onekten
 * isin TAKVIM isi oldugunu anlar; is uretmez, yaziyi sahiplenip normal uretim
 * isi olarak kuyruga atar (dispatchScheduledArticle). Bu duzeltmeden once
 * kurulmus, haftalar sonra ateslenecek gecikmeli isler de ayni kimligi tasir.
 */
export const SCHEDULED_GENERATION_JOB_PREFIX = 'gen:article:';

export function scheduledGenerationJobId(articleId: string): string {
  return `${SCHEDULED_GENERATION_JOB_PREFIX}${articleId}`;
}

/**
 * Ornek (demo) sitenin adresi — sites/demo-seeder.service.ts ile ayni deger.
 * Demo sitesi otomatik akisi ACIK olarak ve SCHEDULED/GENERATING ornek
 * yazilarla kurulur; bunlar gostermelik. Saatlik tarama onlari gercekten
 * uretmez (LLM maliyeti, var olmayan site icin "makale hazir" e-postasi) ve
 * takili uretim supurucusu ornek GENERATING yaziya dokunmaz.
 */
export const DEMO_SITE_URL = 'https://demo.luviai.com';

export function isScheduledGenerationJobId(jobId: unknown): boolean {
  return typeof jobId === 'string'
    && jobId.startsWith(SCHEDULED_GENERATION_JOB_PREFIX)
    && jobId.length > SCHEDULED_GENERATION_JOB_PREFIX.length;
}

/**
 * Saatlik taramanin (processDueArticles) sinirlari.
 *
 * NEDEN: tarama eskiden sirasiz, sabit 50 satirlik TEK sorgu yapiyordu. Hakki
 * dolu kullanicinin yazisi SCHEDULED kaldigi icin ayni satirlar her saat yine
 * pencereye giriyordu; deneme hakkini bitirmis (omur boyu 2, hic sifirlanmaz)
 * birkac hesabin otopilot takvimi 50 satiri doldurunca ODEYEN musterilerin
 * takvim yazilari hic uretime alinmiyordu. Prisma `take` ile birincil anahtar
 * sirasi ekledigi icin pencere hep en eski satirlardi: takilma kalici oluyordu.
 * Artik tarama (scheduledAt, id) sirasiyla sayfa sayfa ilerler, hakki dolu ya
 * da hakki okunamayan kullanicilarin satirlari ayni turdaki sonraki sorgulara
 * hic gelmez ve okunan satira ayni turda bir daha donulmez (anahtar kumesi).
 */
export const DUE_SCAN_LIMITS = {
  /** Tek sorgudaki satir sayisi */
  batchSize: 50,
  /**
   * Bir turda en fazla bu kadar yazi uretime alinir — eski tavanla ayni (50).
   * NEDEN artirilmadi: uretim isleri kullanicinin kendi islerinin de bekledigi
   * ortak kuyruga (luviai-jobs, varsayilan es zamanlilik 2) girer; saatte
   * yuzlerce uretim "Üret" ve denetim islerini saatlerce bekletirdi. Duzeltme
   * kapasite degil, engelli satirlarin bu kapasiteyi tuketmemesi.
   */
  maxClaims: 50,
  /**
   * Bir turda en fazla bu kadar sorgu (40 x 50 = 2000 satir). Anahtar kumesi her
   * sorguda ilerledigi icin dongu zaten biter; bu emniyet tavanidir. Dolarsa
   * uyari loglanir.
   */
  maxBatches: 40,
} as const;

/**
 * MAKALE HAKKI MUHASEBESI — her yazi aylik makale hakkindan TAM BIR KEZ duser, uretime
 * alindigi anda; ayin toplami planin hakkini asamaz.
 *
 * Hakkin dustugu yerler (QuotaService.incrementArticleUsage cagiranlari + bu dosya):
 *  - Kullanicinin baslattigi uretim, baslarken: Uret (queueGeneration), run-now
 *    (runPipelineNow), Simdi uret (triggerNow), MCP create_article, icerik firsati
 *    (yeni yazi ya da kapali dongu guncellemesi). Hepsi once enforceArticleQuota.
 *  - Takvim yazisi, takvim onu uretime alirken (SCHEDULED → GENERATING; saatlik tarama,
 *    gecikmeli takvim isi ya da kuyruga atani sahiplenmemis uretim isi): claimAndQueue /
 *    claimForGeneration → chargeArticle.
 *  - Onboarding'in ilk yazisi: ucretli planda hemen ve ucretsiz (isaretli:
 *    'onboarding_free'); deneme hesabinda ucretsiz DEGIL, olusturulurken duser
 *    (isaretli: 'calendar'), hak doluysa uretilmez.
 *  - Dusmeyenler: otomatik yeniden yazim (icerik pivotu) ve ceviri — ikisi de deneme
 *    hesabinda hic calismaz (content-pivot.service, translator.service): deneme
 *    hesabi yapay zekayla toplam 2 makale uretir, fazlasi icin LLM harcanmaz.
 *
 * Durumlara gore:
 *  - SCHEDULED: henuz dusulmedi; kalan haktan AYRILIR (scheduleTopic'te sayilir).
 *  - GENERATING / EDITING / READY_TO_PUBLISH / REVIZE_NEEDED / FAILED / PUBLISHED: uretime
 *    alinirken dustu (ya da hic dusmeyecek bir yazi); kalan hak (articlesUsedThisMonth)
 *    onu zaten iceriyor, bir daha sayilmaz.
 *  - Istisna: dustukten sonra SCHEDULED'a geri donen yazi (takili uretim supurucusu,
 *    ARTICLE_GENERATION_DISABLED) agentOutputs.allowanceCharge isaretini tasir: yeniden
 *    uretime alinirken ikinci kez dusmez ve bekleyen sayilmaz. Isareti hat uretim bitince
 *    agentOutputs'u yeniden yazarak kendiliginden siler; o noktadan sonra yazi SCHEDULED'a
 *    donmez.
 * scheduleTopic kapasitesi = hak - dusulen (articlesUsedThisMonth) - isaretsiz SCHEDULED
 * yazilar (kullanicinin demo disi TUM sitelerinde; hak hesap basina).
 *
 * NEDEN (eski kural): takvim uretimi haktan hic dusmuyordu; scheduleTopic takvimde,
 * uretimde ya da onayda bekleyen yazilari kalan hakla karsilastiriyordu. Iki yanlis:
 *  1. Kullanicinin baslattigi ve henuz yayinlanmamis uretim hem sayactan dusmus hem de
 *     yayinlanana kadar bekleyen sayiliyordu: takvim kapasitesi iki kez kuculuyordu.
 *  2. Takvim yazisi yayinlaninca (ya da REVIZE_NEEDED / FAILED olunca) bekleyenlerden
 *     cikip hic dusulmemis oluyordu: yayinla-yeniden doldur, programatik SEO ve deneme
 *     hesabinin 8 onboarding yazisi (hak omur boyu 2) ayin toplamini planin hakkinin
 *     cok ustune cikarabiliyordu; tarama da yalniz kullanicinin kendi uretimleri hakki
 *     doldurduysa duruyordu.
 * Ayrica bekleyenler yalniz istenen sitede sayiliyordu; hak hesap basina oldugu icin cok
 * siteli hesap her sitede kalan hakkin tamamini takvime koyabiliyordu.
 */

/** Takvimde, uretimde ya da onayda bekleyen yeni yazi durumlari */
const PENDING_NEW_STATUSES = ['SCHEDULED', 'GENERATING', 'EDITING', 'READY_TO_PUBLISH'] as const;

/**
 * Takvimde, uretimde ya da onayda bekleyen YENI yazilar — takvim listesinin
 * (listScheduledForSite) kosulu. Hak hesabi bunun hakki henuz dusulmemis alt kumesini
 * (SCHEDULED, isaretsiz) sayar: unchargedPendingWhere ile ayni durum ve publishedAt kosulu.
 *
 * Daha once yayinlanmis yazi (publishedAt dolu) listelenmez. NEDEN: READY_TO_PUBLISH'te iki
 * tur yayinlanmis yazi durur ve ikisi de yeni makale hakki tuketmez:
 *  - Sitedeki son kopyasi kaldirilan yazi. Canlilik denetimi, yayincinin cop kutusu /
 *    silinmis kopya yolu ve "bu kaydi unut" PUBLISHED'i READY_TO_PUBLISH'e ceker
 *    (republish-policy statusAfterRetirement); publishedAt gecmis kaydi olarak kalir.
 *    Musterinin sitesinden bilerek kaldirdigi yazilar "onayda bekleyen" sayiliyor ve
 *    takvime yeni konu eklemeyi 403'le kesiyordu. Takvimden de cikarilamiyorlardi
 *    (unscheduleArticle yalniz SCHEDULED alir).
 *  - Yayindaki yazinin onay bekleyen yeniden yazimi (sitede eski metin durur). Yeni bir
 *    yazi degil, var olan sayfanin guncellemesi. Otomatik yeniden yazim (icerik pivotu)
 *    makale hakkindan hic dusmez; kullanicinin baslattigi kapali dongu guncellemesi
 *    hakkini baslatirken zaten dusurdu (content-opportunity incrementArticleUsage).
 */
function pendingNewArticleWhere(siteId: string) {
  return {
    siteId,
    status: { in: [...PENDING_NEW_STATUSES] as any },
    publishedAt: null,
  };
}

/**
 * Hakki henuz dusulmemis bekleyen yazi adaylari: kullanicinin demo disi tum sitelerindeki
 * hic yayinlanmamis SCHEDULED yazilar. Isaretli olanlar (allowanceCharge) sayimda elenir
 * (countUnchargedPending). Demo sitesinin ornek takvim yazilari hic uretilmez
 * (DEMO_SITE_URL): hakki ayirmalari yalniz kapasiteyi bosuna kucultur.
 */
function unchargedPendingWhere(userId: string) {
  return {
    status: 'SCHEDULED' as any,
    publishedAt: null,
    site: { userId, url: { not: DEMO_SITE_URL } },
  };
}

/** agentOutputs'taki isaretin anahtari (yeni veri yalniz mevcut JSON alaninda) */
export const ALLOWANCE_CHARGE_KEY = 'allowanceCharge';

/**
 * Isaretin kaynagi: takvim uretiminde dusuldu ('calendar'; deneme hesabinda
 * onboarding'in ilk yazisi da), kullanicinin "Simdi uret"inde dusuldu
 * ('trigger_now') ya da ucretli planda onboarding'in ucretsiz ilk yazisi
 * ('onboarding_free')
 */
export type AllowanceChargeSource = 'calendar' | 'trigger_now' | 'onboarding_free';

function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

/** Bu yazinin uretimi makale hakkindan dusuldu mu (ya da hic dusmeyecek mi) */
export function hasAllowanceCharge(agentOutputs: unknown): boolean {
  const mark = asRecord(asRecord(agentOutputs)[ALLOWANCE_CHARGE_KEY]);
  return typeof mark.at === 'string' && mark.at.length > 0;
}

/** agentOutputs'a isaret eklenmis kopyasi (diger anahtarlar korunur) */
export function withAllowanceCharge(agentOutputs: unknown, source: AllowanceChargeSource, at: Date): Record<string, unknown> {
  return { ...asRecord(agentOutputs), [ALLOWANCE_CHARGE_KEY]: { at: at.toISOString(), source } };
}

/** Sahiplenip kuyruga atmak icin okunan makale alanlari */
interface ClaimableArticle {
  id: string;
  siteId: string;
  topic: string;
  /** allowanceCharge isareti icin; tarama ve gecikmeli is satirin tum alanlarini okur */
  agentOutputs?: unknown;
  site: PublishApprovalSite & { publishTargets?: Array<{ id: string }> | null };
}

/** claimAndQueue sonucu */
type ClaimResult =
  | { outcome: 'queued'; job: Awaited<ReturnType<JobQueueService['enqueue']>> }
  | { outcome: 'already_claimed' }
  | { outcome: 'quota_exhausted' };

/** Takvim isinin sonucu (worker is kaydina yazilir) */
export type ScheduledDispatchResult =
  | { dispatched: true; articleId: string; generateJobId: string }
  | { skipped: true; reason: 'ARTICLE_MISSING' | 'ALREADY_CLAIMED' | 'AUTOPILOT_PAUSED' | 'QUOTA_EXHAUSTED'; status?: string };

/**
 * Uretim isi baslarken sahiplik karari (claimForGeneration). 'quota_exhausted': yazi
 * SCHEDULED idi ve makale hakki dolu; uretilmez, SCHEDULED kalir (tarama hak yenilenince alir).
 */
export type GenerationClaim = 'proceed' | 'already_claimed' | 'article_missing' | 'quota_exhausted';

/**
 * Uretim isinin atlama nedeni (worker is sonucuna yazar), sahiplik kararina gore.
 * NEDEN tek tablo: worker 'quota_exhausted'i 'ALREADY_CLAIMED' diye yaziyordu;
 * hakki dolu oldugu icin uretilmeyen yazi is kaydinda "baskasi aldi" gorunuyordu.
 */
export const GENERATION_CLAIM_SKIP_REASON: Readonly<Record<Exclude<GenerationClaim, 'proceed'>, 'ARTICLE_MISSING' | 'ALREADY_CLAIMED' | 'QUOTA_EXHAUSTED'>> = Object.freeze({
  article_missing: 'ARTICLE_MISSING',
  already_claimed: 'ALREADY_CLAIMED',
  quota_exhausted: 'QUOTA_EXHAUSTED',
});

/**
 * Article scheduler — icerik takvimi: onboarding'in tier-1 konulari
 * (scheduleInitialBatch), elle takvime eklenen konular (scheduleTopic) ve
 * takvim yazilarinin uretime alinmasi (processDueArticles, gecikmeli is).
 *
 * Makale hakki (ayrinti: dosya basindaki MAKALE HAKKI MUHASEBESI): takvim yazisi
 * aylik makale hakkindan uretime alindigi anda TEK kosullu UPDATE ile duser
 * (chargeArticle; sayac planin hakkindaysa artmaz, yazi SCHEDULED kalir ve hak
 * yenilenince — yeni ay ya da plan yukseltme — saatlik tarama alir). Deneme
 * hesabinda hak omur boyu 2 makale, ucretli planlarda her ay sifirlanir
 * (QuotaService.checkArticleQuota). Akisi durdurulmus sitenin yazisi uretilmez.
 * Onboarding'in ilk makalesi hemen uretilir: ucretli planda ucretsiz, deneme
 * hesabinda haktan duser. Takvime eklenen konu kalan haktan eklerken ayrilir
 * (scheduleTopic). Deneme hesabinin hakki asan takvim yazilari panelde kilitli
 * gorunur (plan-lock.ts lockedByPlan) ve plan yukseltilince uretilir.
 *
 * Slot algoritmasi (buildSlots, haftada iki yazi):
 *   #1 = simdi
 *   #2 = sonraki Pazartesi 10:00 (1-7 gun sonra)
 *   #3 = ayni haftanin Persembe 14:00'u (#2 + 3 gun)
 *   #4 = sonraki Pazartesi 10:00 (#3 + 4 gun); Persembe/Pazartesi diye surer
 *   Saatler API/worker surecinin yerel saat dilimindedir (setHours).
 *
 * GEO oncelikli — tier-1 konular ranker'dan AEO/GEO skoruna gore sirali
 * geliyor; ilk `count` tanesi alinir (onboarding: akis acikken 8, kapaliyken 3).
 */
@Injectable()
export class ArticleSchedulerService {
  private readonly log = new Logger(ArticleSchedulerService.name);

  // BullMQ jobId şeması — article başına unique, reschedule sırasında override için
  private static genJobId(articleId: string) {
    return scheduledGenerationJobId(articleId);
  }

  // scheduledAt'ten 15dk önce trigger et — yayın saatine kadar pipeline tamamlansın
  private static readonly LEAD_TIME_MS = 15 * 60 * 1000;

  constructor(
    private readonly prisma: PrismaService,
    private readonly jobQueue: JobQueueService,
    private readonly quota: QuotaService,
  ) {}

  /**
   * SCHEDULED bir article için BullMQ delayed job ayarla.
   * scheduledAt - 15dk anında çalışacak şekilde delay hesaplanır.
   * Aynı article için tekrar çağrılırsa eski job override edilir (reschedule).
   * scheduledAt geçmişteyse hemen kuyruğa atar.
   */
  private async scheduleArticleJob(article: { id: string; siteId: string; topic: string; scheduledAt: Date | null }) {
    if (!article.scheduledAt) return;
    const site = await this.prisma.site.findUniqueOrThrow({
      where: { id: article.siteId },
      include: { publishTargets: { where: { isActive: true, isDefault: true }, select: { id: true } } },
    });
    const triggerAt = article.scheduledAt.getTime() - ArticleSchedulerService.LEAD_TIME_MS;
    const delay = Math.max(0, triggerAt - Date.now());
    // Yalniz Tam otomatik + akis acikken onaysiz yayin (publish-approval.ts).
    // Is gecikmeli: worker ateslendiginde modu yeniden okur, arada Yari
    // otomatige gecildiyse yine yayinlamaz.
    const { autoPublish, targetIds } = automationPublishFields(site, site.publishTargets.map((t) => t.id));

    await this.jobQueue.enqueue({
      type: 'GENERATE_ARTICLE',
      userId: site.userId,
      siteId: article.siteId,
      jobId: ArticleSchedulerService.genJobId(article.id),
      delay,
      payload: {
        siteId: article.siteId,
        topic: article.topic,
        articleId: article.id,
        skipImages: false,
        autoPublish,
        targetIds,
      },
    });

    const fireTime = new Date(Date.now() + delay).toISOString();
    this.log.log(
      `[${article.siteId}] Article ${article.id} delayed job — fires at ${fireTime} (${Math.round(delay / 60000)}dk sonra, scheduledAt - 15dk)`,
    );
  }

  /**
   * Onboarding sonrasi cagrilir (worker ONBOARDING_CHAIN). Tier-1'in ilk
   * `count` konusunu (varsayilan 5) takvime yazar: ilki GENERATING olarak
   * hemen kuyruga girer, digerleri SCHEDULED kalir ve zamani gelince saatlik
   * tarama uretir (bu yazilar icin gecikmeli is kurulmaz). Ucretli planda ilk
   * yazi ucretsizdir (allowanceCharge 'onboarding_free'); deneme hesabinda ilk
   * yazi da makale hakkindan duser (toplam 2), hak doluysa uretilmez. Digerleri
   * tarama onlari uretime alirken makale hakkindan duser, hak doluysa SCHEDULED
   * bekler (deneme hesabinda panelde kilitli: plan-lock.ts).
   */
  async scheduleInitialBatch(siteId: string, opts: { count?: number } = {}) {
    const count = opts.count ?? 5;
    const site = await this.prisma.site.findUniqueOrThrow({
      where: { id: siteId },
      include: { user: { select: { plan: true } } },
    });

    // Son topic queue'yu al
    const queue = await this.prisma.topicQueue.findFirst({
      where: { siteId },
      orderBy: { generatedAt: 'desc' },
    });
    if (!queue) {
      this.log.warn(`[${siteId}] Topic queue yok, scheduling atlandi`);
      return { scheduled: 0, immediate: null };
    }

    const tier1: any[] = Array.isArray(queue.tier1Topics) ? (queue.tier1Topics as any[]) : [];
    if (tier1.length === 0) {
      this.log.warn(`[${siteId}] Tier-1 konu yok, scheduling atlandi`);
      return { scheduled: 0, immediate: null };
    }

    const picks = tier1.slice(0, count);
    const slots = this.buildSlots(picks.length);
    const isTrial = site.user.plan === 'TRIAL';

    let immediateArticleId: string | null = null;
    let scheduledCount = 0;

    for (let i = 0; i < picks.length; i++) {
      const t = picks[i];
      const topic = String(t.topic ?? t.title ?? t.slug ?? `Konu ${i + 1}`);
      const slug = `scheduled-${Date.now().toString(36)}-${i}`;
      const slot = slots[i];

      // Ilk yazi hemen uretilir. Ucretli planda ucretsiz (urun karari, 'onboarding_free').
      // Deneme hesabinda ucretsiz DEGIL: toplam 2 makalelik hakkin ilkidir ve tek
      // kosullu UPDATE ile once duser (chargeArticle). Hak doluysa (ornegin siteyi
      // silip yeniden ekleyen deneme hesabi) ilk yazi da uretilmez, takvimde kilitli
      // bekler (plan-lock.ts). NEDEN: eskiden ilk yazi her planda hak kontrolsuz
      // uretiliyordu; deneme hesabi 1 ucretsiz + 2 makale aliyor, siteyi silip
      // yeniden ekleyerek sinirsiz ucretsiz makale uretebiliyordu.
      let generateNow = false;
      let firstMark: AllowanceChargeSource | null = null;
      if (i === 0) {
        if (!isTrial) {
          generateNow = true;
          firstMark = 'onboarding_free';
        } else {
          let charged = false;
          try {
            charged = await this.chargeArticle(site.userId);
          } catch (err: any) {
            // Hak okunamadi: yazi takvimde bekler (vadesi simdi), saatlik tarama
            // hakki yeniden okuyup alir; zincir dusmez
            this.log.warn(`[${siteId}] Ilk yazinin makale hakki okunamadi, takvimde bekliyor: ${err?.message ?? err}`);
          }
          if (charged) {
            generateNow = true;
            firstMark = 'calendar';
          }
        }
      }

      try {
        let article: { id: string };
        try {
          article = await this.prisma.article.create({
            data: {
              siteId,
              topic,
              slug,
              title: topic,
              language: site.language ?? 'tr',
              status: generateNow ? ('GENERATING' as any) : ('SCHEDULED' as any),
              scheduledAt: slot,
              // Isaret: takili uretim supurucusu ilk yaziyi takvime geri koyarsa
              // (scheduledAt dolu) tarama yeniden alirken haktan DUSMESIN
              ...(firstMark ? { agentOutputs: withAllowanceCharge(null, firstMark, new Date()) as any } : {}),
            },
          });
        } catch (err) {
          // Yazi acilamadi: deneme hesabinin dusulen hakki geri verilir
          if (firstMark === 'calendar') await this.refundArticle(site.userId, `${siteId}:onboarding`);
          throw err;
        }

        if (generateNow) {
          await this.jobQueue.enqueue({
            type: 'GENERATE_ARTICLE',
            userId: site.userId,
            siteId,
            payload: {
              siteId,
              topic,
              articleId: article.id,
              skipImages: false,
              autoPublish: false, // hedef secimi kullaniciya kalir
            },
          });
          immediateArticleId = article.id;
          this.log.log(`[${siteId}] [1/${picks.length}] '${topic}' — hemen uretime alindi${firstMark === 'calendar' ? ' (deneme hakkindan dustu)' : ''}`);
        } else if (i === 0) {
          this.log.log(`[${siteId}] [1/${picks.length}] '${topic}' — deneme hesabinin makale hakki yok ya da okunamadi; uretilmedi, takvimde bekliyor (hak yoksa plan yukseltilene kadar kilitli)`);
        } else {
          this.log.log(`[${siteId}] [${i + 1}/${picks.length}] '${topic}' — ${slot.toISOString()} icin planlandi (saatlik tarama uretir; uretime alinirken makale hakkindan duser)`);
        }
        scheduledCount++;
      } catch (err: any) {
        this.log.warn(`[${siteId}] Schedule fail (${topic}): ${err.message}`);
      }
    }

    return { scheduled: scheduledCount, immediate: immediateArticleId, isTrial };
  }

  /**
   * Takvimdeki yaziyi ATOMIK olarak sahiplenir (SCHEDULED → GENERATING) ve
   * uretim isini kuyruga atar. Yazi artik SCHEDULED degilse null doner, hicbir
   * sey kuyruga girmez.
   *
   * NEDEN: ayni takvim yazisini iki yol uretebiliyordu — gecikmeli is
   * (gen:article:<id>, scheduledAt - 15 dk) ve saatlik tarama. Tarama yaziyi
   * kosulsuz GENERATING yapiyor, gecikmeli is duruma hic bakmiyordu; worker
   * doluyken ikisi de kuyruga girip ayni yaziyi iki kez uretiyordu (iki kat LLM
   * maliyeti, sonraki sonuc oncekinin uzerine yazar, Tam otomatikte iki yayin).
   * "Yalniz hala SCHEDULED ise guncelle" tek bir UPDATE'tir: es zamanli iki
   * cagridan yalniz biri count 1 alir (Prisma'nin iyimser eszamanlilik kalibi,
   * updateMany + count === 0 kontrolu; bkz. "Optimistic concurrency control",
   * https://www.prisma.io/docs/orm/v6/prisma-client/queries/transactions).
   *
   * Is kuyruga atilamazsa sahiplik birakilir (yazi SCHEDULED'a doner) ki sonraki
   * tarama yeniden denesin; eskiden yazi kalici olarak "Uretiliyor"da kaliyordu.
   *
   * Makale hakki uretime alirken duser (dosya basindaki MAKALE HAKKI MUHASEBESI). Sira:
   *  1. Hak: tek kosullu UPDATE (chargeArticle). Hak doluysa hicbir sey yazilmaz,
   *     yazi SCHEDULED kalir ('quota_exhausted'). Once hak dusulur ki en sik ret
   *     (hakki dolan kullanici) geri alinacak bir sahiplenme birakmasin.
   *  2. Sahiplenme + isaret (agentOutputs.allowanceCharge) TEK UPDATE'te: yarisi
   *     kaybeden (count 0) dustugu hakki geri verir; ayni yazi iki kez dusmez.
   *  3. Kuyruga atilamazsa sahiplik birakilir, agentOutputs eski haline doner ve
   *     hak geri verilir: uretilmeyen yazi haktan dusmus kalmaz.
   * Isaretli yazi (dustukten sonra SCHEDULED'a geri donmus) yeniden dusulmez.
   */
  private async claimAndQueue(a: ClaimableArticle, userId: string, limit?: number): Promise<ClaimResult> {
    const before = a.agentOutputs ?? null;
    const prepaid = hasAllowanceCharge(before);
    if (!prepaid && !(await this.chargeArticle(userId, limit))) return { outcome: 'quota_exhausted' };

    let claimed: boolean;
    try {
      const claim = await this.prisma.article.updateMany({
        where: { id: a.id, status: 'SCHEDULED' as any },
        data: {
          status: 'GENERATING' as any,
          ...(prepaid ? {} : { agentOutputs: withAllowanceCharge(before, 'calendar', new Date()) as any }),
        },
      });
      claimed = claim.count === 1;
    } catch (err) {
      if (!prepaid) await this.refundArticle(userId, a.id);
      throw err;
    }
    if (!claimed) {
      if (!prepaid) await this.refundArticle(userId, a.id);
      return { outcome: 'already_claimed' };
    }

    const defaultTargetIds = a.site.publishTargets?.map((t) => t.id) ?? [];
    const { autoPublish, targetIds } = automationPublishFields(a.site, defaultTargetIds);
    try {
      const job = await this.jobQueue.enqueue({
        type: 'GENERATE_ARTICLE',
        userId,
        siteId: a.siteId,
        payload: {
          siteId: a.siteId,
          topic: a.topic,
          articleId: a.id,
          skipImages: false,
          autoPublish,
          targetIds,
        },
      });
      return { outcome: 'queued', job };
    } catch (err) {
      await this.releaseClaim(a.id, prepaid ? undefined : { agentOutputs: before });
      if (!prepaid) await this.refundArticle(userId, a.id);
      throw err;
    }
  }

  /**
   * Makale hakkindan bir yazi dus — yalniz sayac planin hakkinin altindaysa (tek
   * kosullu UPDATE: `articlesUsedThisMonth < hak`). Dusulduyse true.
   *
   * NEDEN kosullu UPDATE: QuotaService.incrementArticleUsage kosulsuz artirir ve
   * cagiranlari once ayri bir okumayla denetler; ayni kullanicinin iki yazisini ayni
   * anda alan iki yol (saatlik tarama + gecikmeli takvim isi) ikisi de "hak var"
   * okuyup son hakki iki kez kullanabilirdi. Tek UPDATE'te kosul ve artis birlikte
   * calisir; es zamanli iki cagridan yalniz biri son hakki alir (claimAndQueue'daki
   * sahiplenmeyle ayni iyimser eszamanlilik kalibi). `limit` verilmezse ay basi
   * sifirlamasi ve plan hakki icin checkArticleQuota okunur (tarama kullanici basina
   * bir kez okuyup tavani verir).
   */
  private async chargeArticle(userId: string, limit?: number): Promise<boolean> {
    const max = limit ?? (await this.quota.checkArticleQuota(userId)).limit;
    const r = await this.prisma.user.updateMany({
      where: { id: userId, articlesUsedThisMonth: { lt: max } },
      data: { articlesUsedThisMonth: { increment: 1 } },
    });
    return r.count === 1;
  }

  /**
   * Uretime alinamayan yazinin dusulen hakkini geri ver (yarisi kaybeden sahiplenme ya
   * da kuyruga atilamayan is). Sayac 0'in altina inmez (arada ay basi sifirlamasi olduysa
   * yeni ayin sayaci eksiye dusmesin). Hata loglanir ve yutulur: geri verme basarisiz
   * olsa da cagiranin sonucu (hata ya da 'zaten alindi') degismez; sayac bir fazla kalir.
   */
  private async refundArticle(userId: string, articleId: string): Promise<void> {
    try {
      await this.prisma.user.updateMany({
        where: { id: userId, articlesUsedThisMonth: { gt: 0 } },
        data: { articlesUsedThisMonth: { decrement: 1 } },
      });
    } catch (err: any) {
      this.log.warn(`[${articleId}] Uretime alinamayan takvim yazisinin makale hakki geri verilemedi (${userId}): ${err?.message ?? err}`);
    }
  }

  /**
   * Sahipligi birak (GENERATING → SCHEDULED). `restore` verilirse agentOutputs da eski
   * haline doner: bu cagride konan hak isareti silinir (hak geri verildi).
   */
  private async releaseClaim(articleId: string, restore?: { agentOutputs: unknown }): Promise<void> {
    await this.prisma.article
      .updateMany({
        where: { id: articleId, status: 'GENERATING' as any },
        data: {
          status: 'SCHEDULED' as any,
          ...(restore ? { agentOutputs: restore.agentOutputs == null ? Prisma.DbNull : (restore.agentOutputs as any) } : {}),
        },
      })
      .catch(() => undefined);
  }

  /**
   * Takvimin gecikmeli isi (gen:article:<id>) ateslendiginde worker bunu cagirir.
   * Is kendisi URETMEZ: yaziyi saatlik taramayla AYNI atomik sahiplenmeyle alip
   * normal uretim isi olarak kuyruga atar. Boylece yeniden deneme ve yarida
   * kalan is (worker yeniden baslatma) her uretim isiyle ayni kurala tabi olur;
   * "bu yaziyi kim uretiyor" sorusu tek yerde (claimAndQueue) cevaplanir.
   * Yayin alanlari is verisinden degil sitenin GUNCEL modundan hesaplanir.
   * Makale hakki uretime alirken duser (claimAndQueue). Eklerken ayrilan hak
   * (scheduleTopic) bu arada kullanicinin kendi uretimlerine gitmis olabilir:
   * hak doluysa yazi uretilmez, SCHEDULED kalir ve hak yenilenince saatlik
   * tarama alir (QUOTA_EXHAUSTED). Eskiden burada hak hic denetlenmiyordu.
   */
  async dispatchScheduledArticle(articleId: unknown): Promise<ScheduledDispatchResult> {
    if (typeof articleId !== 'string' || !articleId) return { skipped: true, reason: 'ARTICLE_MISSING' };
    const a = await this.prisma.article.findUnique({
      where: { id: articleId },
      include: {
        site: { include: { publishTargets: { where: { isActive: true, isDefault: true }, select: { id: true } } } },
      },
    });
    if (!a) return { skipped: true, reason: 'ARTICLE_MISSING' };
    // Saatlik tarama ya da "Simdi uret" once aldiysa yazma bile yapilmaz
    if (a.status !== 'SCHEDULED') return { skipped: true, reason: 'ALREADY_CLAIMED', status: String(a.status) };
    // Durduruldu: yazi SCHEDULED kalir, akis acilinca saatlik tarama alir
    if (a.site.autopilot === false) return { skipped: true, reason: 'AUTOPILOT_PAUSED' };
    const r = await this.claimAndQueue(a, a.site.userId);
    if (r.outcome === 'quota_exhausted') {
      this.log.log(`[${a.siteId}] Takvim isi: ${a.id} makale hakki dolu oldugu icin uretilmedi; SCHEDULED kaldi (hak yenilenince saatlik tarama alir)`);
      return { skipped: true, reason: 'QUOTA_EXHAUSTED' };
    }
    if (r.outcome === 'already_claimed') return { skipped: true, reason: 'ALREADY_CLAIMED' };
    this.log.log(`[${a.siteId}] Takvim isi: ${a.id} sahiplenildi, uretim isi kuyrukta (${r.job.dbJobId})`);
    return { dispatched: true, articleId: a.id, generateJobId: r.job.dbJobId };
  }

  /**
   * Uretim isi (gecikmeli takvim isi DISINDAKI her GENERATE_ARTICLE) baslarken:
   * yazi hala SCHEDULED ise kuyruga atan sahiplenmemis demektir (sahiplik is
   * kuyruga atilamadigi icin birakildi ama is yine de kuyruga girmis olabilir).
   * O zaman once atomik olarak sahiplenilir; baskasi aldiysa is uretmeden doner.
   * Yazi SCHEDULED degilse kuyruga atan zaten GENERATING yapmistir ya da
   * yayindaki yazi yeniden yaziliyordur (pivot, kapali dongu): uretim surer.
   * Yeniden denemede yazi bu isin sahipliginde GENERATING'dir, yine surer.
   *
   * SCHEDULED yaziyi burada sahiplenmek onu uretime almaktir: makale hakki da
   * burada duser (kuyruga atan sahipligi birakirken hakki geri verdi ya da hic
   * dusmedi; "Simdi uret" hakki is kuyruga girdikten sonra dusurur). Hak doluysa
   * uretilmez, yazi SCHEDULED kalir ('quota_exhausted'). Isaretli yazi
   * (allowanceCharge) ikinci kez dusulmez.
   */
  async claimForGeneration(articleId: unknown): Promise<GenerationClaim> {
    // Yer tutucusuz is: pipeline yeni kayit acar
    if (typeof articleId !== 'string' || !articleId) return 'proceed';
    const a = await this.prisma.article.findUnique({
      where: { id: articleId },
      select: { status: true, agentOutputs: true, site: { select: { userId: true } } },
    });
    // Silinmis yaziya uretim: LLM maliyeti harcanir, sonunda kayit yok diye
    // hata verir ve is iki kez daha denenirdi
    if (!a) return 'article_missing';
    if (a.status !== 'SCHEDULED') return 'proceed';
    const userId = a.site?.userId;
    if (!userId) return 'article_missing';
    const prepaid = hasAllowanceCharge(a.agentOutputs);
    if (!prepaid && !(await this.chargeArticle(userId))) return 'quota_exhausted';
    let claimed: boolean;
    try {
      const claim = await this.prisma.article.updateMany({
        where: { id: articleId, status: 'SCHEDULED' as any },
        data: {
          status: 'GENERATING' as any,
          ...(prepaid ? {} : { agentOutputs: withAllowanceCharge(a.agentOutputs, 'calendar', new Date()) as any }),
        },
      });
      claimed = claim.count === 1;
    } catch (err) {
      if (!prepaid) await this.refundArticle(userId, articleId);
      throw err;
    }
    if (!claimed && !prepaid) await this.refundArticle(userId, articleId);
    return claimed ? 'proceed' : 'already_claimed';
  }

  /**
   * Worker'in saatlik PROCESS_SCHEDULED isi cagirir. scheduledAt - 15dk <= now
   * olan, akisi acik sitelerin SCHEDULED yazilarini uretime alir; her yazi
   * uretime alinirken makale hakkindan duser (claimAndQueue). Hak doluysa yazi
   * SCHEDULED kalir (skippedQuota) ve hak yenilenince (yeni ay ya da plan
   * yukseltme) alinir; ayni turda bir kullanicinin hakkindan fazla yazisi
   * alinmaz. Dustukten sonra geri donmus (isaretli) yazi haktan bagimsiz alinir,
   * ikinci kez dusmez. Site Tam otomatikte ve akis aciksa
   * (publish-approval.ts) uretim bitince varsayilan yayin hedefinde
   * yayinlanir; Yari otomatikte yazi READY_TO_PUBLISH'te onayi bekler.
   * Her yazi claimAndQueue ile atomik sahiplenilir: gecikmeli takvim isi ya da
   * "Simdi uret" ayni yaziyi once aldiysa alreadyClaimed sayilir, ikinci kez
   * uretilmez.
   *
   * Tarama sayfa sayfa ilerler (DUE_SCAN_LIMITS): en eski vadeli yazi once;
   * hakki dolu / hakki okunamayan kullanici ilk gorulmesinden sonra bu turun
   * sorgularina girmez, boylece engelli satirlar diger musterilerin yazilarini
   * bekletemez. skippedQuota yalniz bu turda GORULEN engelli satirlari sayar.
   */
  async processDueArticles(opts: { userId?: string } = {}): Promise<{ processed: number; skippedQuota: number; alreadyClaimed: number; failed: number }> {
    // Yalniz bu kullanicinin yazilari (plan yukseltme sonrasi tarama: scheduled-kick.ts);
    // verilmezse tum kullanicilar (saatlik is)
    const onlyUserId = typeof opts.userId === 'string' && opts.userId ? opts.userId : undefined;
    const now = new Date();
    // 15 dk onceden uret ki tam saat geldiginde yayina hazir olsun
    const threshold = new Date(now.getTime() + 15 * 60 * 1000);

    let processed = 0;
    let skippedQuota = 0;
    let alreadyClaimed = 0;
    let failed = 0;
    // Kullanici basina tek hak okumasi (ay basi sifirlamasi dahil): plan hakki
    // (tavan) ya da null = bu turda hakki dolu. Her yazi tavana karsi tek kosullu
    // UPDATE ile duser; UPDATE reddederse kullanici bu tur icin dolu sayilir.
    const limitByUser = new Map<string, number | null>();
    // Bu turda yazisi alinamayacak kullanicilar (hakki dolu ya da hakki
    // okunamadi): sonraki sorgular onlarin satirlarini hic getirmez
    const skipUsers = new Set<string>();
    // Hakki okunamayanlar: ayni sorgudaki diger yazilari icin hak yeniden sorulmaz
    const quotaUnreadable = new Set<string>();
    // Anahtar kumesi imleci: okunan son satir. Kuyruga atilamayip SCHEDULED'a
    // birakilan satir bu turda yeniden okunmaz (sonraki saat yeniden dener).
    let cursor: { scheduledAt: Date; id: string } | null = null;
    let batches = 0;
    let budgetHit: 'claims' | 'batches' | null = null;

    scan: while (true) {
      if (batches >= DUE_SCAN_LIMITS.maxBatches) {
        budgetHit = 'batches';
        break;
      }
      // Tek kullanicili taramada kullanicinin hakki doldu / okunamadi: baska satir yok
      if (onlyUserId && skipUsers.has(onlyUserId)) break;
      batches++;
      const due = await this.prisma.article.findMany({
        where: this.dueArticlesWhere(threshold, skipUsers, cursor, onlyUserId),
        include: {
          site: {
            include: {
              user: { select: { id: true } },
              publishTargets: { where: { isActive: true, isDefault: true }, select: { id: true } },
            },
          },
        },
        // id ikincil anahtar: onboarding slotlari (Pazartesi 10:00, Persembe 14:00)
        // bircok kullanicida ayni ana denk gelir; sira ve imlec ancak boyle tekil
        orderBy: [{ scheduledAt: 'asc' }, { id: 'asc' }],
        take: DUE_SCAN_LIMITS.batchSize,
      });
      if (due.length === 0) break;

      for (const a of due) {
        const u = a.site.user;
        // Hakki dustukten sonra takvime geri donmus yazi (isaretli): hak okunmaz,
        // yeniden dusmez — kullanicinin hakki simdi dolu olsa da uretilir
        const prepaid = hasAllowanceCharge(a.agentOutputs);
        let limit: number | null = null;
        if (!prepaid) {
          // Ayni sorgu, hakki okunamadan once okundu: kalan yazilari da bekler
          if (quotaUnreadable.has(u.id)) {
            failed++;
            continue;
          }
          try {
            limit = await this.scanUserLimit(u.id, limitByUser);
          } catch (err: any) {
            // Yazi SCHEDULED kalir; sonraki tarama yeniden dener
            failed++;
            quotaUnreadable.add(u.id);
            skipUsers.add(u.id);
            this.log.warn(`[${a.siteId}] Takvim yazisi ${a.id}: makale hakki okunamadi: ${err?.message ?? err}`);
            continue;
          }
          if (limit === null) {
            skippedQuota++;
            skipUsers.add(u.id);
            continue;
          }
        }
        try {
          const r = await this.claimAndQueue(a, u.id, prepaid ? undefined : (limit ?? undefined));
          if (r.outcome === 'queued') processed++;
          else if (r.outcome === 'already_claimed') alreadyClaimed++;
          else {
            // Son hak bu turda baska bir yaziya gitti: kullanicinin kalan yazilari bekler
            skippedQuota++;
            limitByUser.set(u.id, null);
            skipUsers.add(u.id);
          }
        } catch (err: any) {
          // Tek yazinin hatasi digerlerini durdurmaz; sahiplik birakildi, sonraki tarama yeniden dener
          failed++;
          this.log.warn(`[${a.siteId}] Takvim yazisi ${a.id} kuyruga atilamadi: ${err?.message ?? err}`);
        }
        if (processed >= DUE_SCAN_LIMITS.maxClaims) {
          budgetHit = 'claims';
          break scan;
        }
      }

      // Son sayfa: sorgu doldurulamadiysa vadeli baska satir yok
      if (due.length < DUE_SCAN_LIMITS.batchSize) break;
      const last = due[due.length - 1];
      // Vadeli satirin scheduledAt'i hep dolu (lte suzgeci); degilse imlec kurulamaz
      if (!(last.scheduledAt instanceof Date)) break;
      cursor = { scheduledAt: last.scheduledAt, id: last.id };
    }

    if (budgetHit) {
      // Kalan vadeli yazilar bir sonraki saatlik taramada alinir; sik gorulurse tavanlar gozden gecirilmeli
      this.log.warn(`[scheduler] Tarama tavani doldu (${budgetHit === 'claims' ? `${DUE_SCAN_LIMITS.maxClaims} yazi` : `${DUE_SCAN_LIMITS.maxBatches} sorgu`}); kalan vadeli yazilar sonraki taramada alinir`);
    }
    if (processed > 0 || skippedQuota > 0 || alreadyClaimed > 0 || failed > 0) {
      this.log.log(`[scheduler] ${processed} makale uretime alindi (yayin saatinden 15 dk once), ${skippedQuota} makale hakki dolu oldugu icin bekliyor, ${alreadyClaimed} zaten uretimde, ${failed} hata (${batches} sorgu)`);
    }
    return { processed, skippedQuota, alreadyClaimed, failed };
  }

  /**
   * Saatlik taramanin sorgu kosulu. Engelli kullanici listesi ve imlec yalniz
   * doluyken eklenir (ilk sorgu eskisiyle ayni kosulu tasir).
   */
  private dueArticlesWhere(threshold: Date, skipUsers: Set<string>, cursor: { scheduledAt: Date; id: string } | null, onlyUserId?: string) {
    return {
      status: 'SCHEDULED' as any,
      scheduledAt: { lte: threshold },
      // Durdurulmus akista takvim uretilmez (panel: "Yeni yazı üretilmiyor");
      // yazi SCHEDULED kalir, akis acilinca bir sonraki taramada alinir.
      // Demo sitesinin ornek takvim yazilari gostermelik (DEMO_SITE_URL).
      site: {
        autopilot: true,
        url: { not: DEMO_SITE_URL },
        ...(onlyUserId
          ? { userId: onlyUserId }
          : skipUsers.size > 0 ? { userId: { notIn: [...skipUsers] } } : {}),
      },
      // (scheduledAt, id) > imlec — okunan satira ayni turda donulmez
      ...(cursor
        ? {
            OR: [
              { scheduledAt: { gt: cursor.scheduledAt } },
              { scheduledAt: cursor.scheduledAt, id: { gt: cursor.id } },
            ],
          }
        : {}),
    };
  }

  /**
   * Saatlik taramada kullanicinin plan hakki (tavan) ya da hak doluysa null
   * (kullanici basina bir kez sorulur, `cache`). Yazi basina asil karar tavana
   * karsi tek kosullu UPDATE'tir (chargeArticle).
   *
   * NEDEN QuotaService: ay basi sifirlamasi (maybeResetMonthlyQuota) yalniz
   * checkArticleQuota icinde calisiyor. Tarama sayaci dogrudan okuyordu; gecen
   * ay sinira dayanmis ucretli musterinin takvim yazilari yeni ayda, kullanici
   * elle bir uretim yapip sayaci sifirlatana kadar "kota dolu" diye
   * atlaniyordu. Hak tablosu da artik elle uretimi kesen kuralla ayni
   * (QuotaService LIMITS; deneme hesabinda sifirlama yok, omur boyu 2).
   * (checkArticleQuota sifirlamadan sonra satiri yeniden okur; ayrica ikinci
   * soru gerekmez.)
   */
  private async scanUserLimit(userId: string, cache: Map<string, number | null>): Promise<number | null> {
    const cached = cache.get(userId);
    if (cached !== undefined) return cached;
    const { allowed, limit } = await this.quota.checkArticleQuota(userId);
    const value = allowed ? limit : null;
    cache.set(userId, value);
    return value;
  }

  /**
   * Tek bir Tier-1 konuyu manuel olarak takvime ekler (drag-drop).
   * Frontend'den scheduledAt + topic + slug + pillar gelir.
   */
  async scheduleTopic(siteId: string, args: { topic: string; scheduledAt: string; slug?: string; pillar?: string }) {
    const site = await this.prisma.site.findUniqueOrThrow({ where: { id: siteId } });
    const at = new Date(args.scheduledAt);
    // Eskiden duz Error → 500 (rescheduleArticle ile ayni 400)
    if (isNaN(at.getTime())) throw new BadRequestException('Geçersiz tarih (scheduledAt).');

    // Hak kontrolu (dosya basindaki MAKALE HAKKI MUHASEBESI): kapasite = hak -
    // dusulen (articlesUsedThisMonth) - hakki henuz dusulmemis bekleyenler. Uretimde ya
    // da onayda bekleyen yazi uretime alinirken dustu, kalan hak onu zaten iceriyor;
    // eskiden bir de bekleyen sayiliyordu (iki kez). Bekleyen yalniz isaretsiz SCHEDULED
    // yazilar, kullanicinin demo disi tum sitelerinde (hak hesap basina). Yayinlamak
    // yer acmaz: yazi hakkini uretime alinirken kullandi.
    const { allowed, remaining, limit } = await this.quota.checkArticleQuota(site.userId);
    if (!allowed) {
      // Eski metin her planda "makale/ay" diyordu; deneme hesabinin hakki ay
      // basi sifirlanmaz (QuotaService.maybeResetMonthlyQuota)
      throw new ForbiddenException(
        `Makale hakkın doldu (${limit} makale). Yeni yazıyı takvime eklemek için planını yükseltebilirsin.`,
      );
    }
    const waiting = await this.countUnchargedPending(site.userId);
    if (waiting >= remaining) {
      throw new ForbiddenException(
        `Kalan makale hakkın ${remaining}; hesabındaki tüm sitelerin takviminde üretime alınmayı bekleyen ${waiting} yazı var ve her biri üretime alınırken bu haktan düşecek. ` +
        'Yeni yazı eklemek için takvimden yazı çıkarabilir ya da planını yükseltebilirsin.',
      );
    }

    const slug = `scheduled-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    const article = await this.prisma.article.create({
      data: {
        siteId,
        topic: args.topic,
        slug,
        title: args.topic,
        pillar: args.pillar,
        language: site.language ?? 'tr',
        status: 'SCHEDULED' as any,
        scheduledAt: at,
      },
    });
    this.log.log(`[${siteId}] Konu takvime eklendi: '${args.topic}' @ ${at.toISOString()}`);

    // Delayed BullMQ job ayarla — saat geldiğinde otomatik tetiklenir (polling beklemez)
    await this.scheduleArticleJob({ id: article.id, siteId, topic: args.topic, scheduledAt: at });

    return article;
  }

  /**
   * Mevcut bir SCHEDULED makaleyi yeni saate tasi (drag-drop ile yer degistirme).
   *
   * KIRACI IZOLASYONU: siteId zorunlu, makale yalniz o sitede aranir. Controller
   * da once sahipligi dogruluyor (requireArticle); bu ikinci kat: servisi baska
   * bir yerden cagiran siteId'siz baska musterinin makalesini tasiyamasin
   * (DRAFT → SCHEDULED, kurbanin kotasindan uretim).
   */
  async rescheduleArticle(siteId: string, articleId: string, newScheduledAt: string) {
    const at = new Date(newScheduledAt);
    if (isNaN(at.getTime())) throw new BadRequestException('Geçersiz tarih (scheduledAt).');
    const a = await this.findSiteArticle(siteId, articleId);
    if (a.status !== 'SCHEDULED' && a.status !== 'DRAFT') {
      throw new BadRequestException('Yalnız takvimde bekleyen ya da taslak yazılar taşınabilir.');
    }
    const updated = await this.prisma.article.update({
      where: { id: a.id },
      data: { scheduledAt: at, status: 'SCHEDULED' as any },
    });

    // Delayed BullMQ job'ı yeni saate göre yeniden kur (eskisi otomatik silinir)
    await this.scheduleArticleJob({ id: updated.id, siteId: updated.siteId, topic: updated.topic, scheduledAt: at });

    return updated;
  }

  /**
   * Takvimden kaldir (article'i siler). siteId zorunlu — bkz. rescheduleArticle.
   */
  async unscheduleArticle(siteId: string, articleId: string) {
    const a = await this.findSiteArticle(siteId, articleId);
    if (a.status !== 'SCHEDULED') {
      throw new BadRequestException('Yalnız takvimde bekleyen yazılar takvimden kaldırılabilir.');
    }

    // Bekleyen BullMQ job'ını sil (silmezsek delayed job yine ateşler ama article yok → fail)
    await this.jobQueue.removeJob(ArticleSchedulerService.genJobId(a.id));

    // Kosullu silme: kontrol ile silme arasinda saatlik tarama yaziyi
    // GENERATING'e almis olabilir — uretimdeki yazi silinmez.
    const deleted = await this.prisma.article.deleteMany({ where: { id: a.id, siteId, status: 'SCHEDULED' as any } });
    if (deleted.count === 0) {
      throw new BadRequestException('Yazı az önce üretime alındı; takvimden kaldırılamadı.');
    }
    return { ok: true };
  }

  /**
   * Hakki henuz dusulmemis bekleyen yazi sayisi (unchargedPendingWhere; isaretliler
   * elenir). Isaret JSON icinde oldugu icin satirlar okunur: SCHEDULED yazilarin
   * agentOutputs'u neredeyse hep bos, okuma kucuk.
   */
  private async countUnchargedPending(userId: string): Promise<number> {
    const rows = await this.prisma.article.findMany({
      where: unchargedPendingWhere(userId),
      select: { agentOutputs: true },
    });
    return rows.filter((r) => !hasAllowanceCharge(r.agentOutputs)).length;
  }

  /** Makale bu sitede yoksa 404 (baska sitenin makalesinin varligi sizmaz) */
  private async findSiteArticle(siteId: string, articleId: string) {
    if (!siteId || !articleId) throw new NotFoundException('Makale bulunamadı');
    const a = await this.prisma.article.findFirst({ where: { id: articleId, siteId } });
    if (!a) throw new NotFoundException('Makale bulunamadı');
    return a;
  }

  /**
   * Site icin takvimde, uretimde ya da onayda bekleyen yeni yazilari listeler —
   * frontend takvimi besler (pendingNewArticleWhere). scheduleTopic'in saydigi
   * bekleyenler bu kumenin hakki henuz dusulmemis kismidir (isaretsiz SCHEDULED);
   * uretimde ya da onayda bekleyen yazi listede kalir ama hakkini uretime alinirken
   * kullandi. Sitedeki kopyasi kaldirilan ya da yeniden yazimi onay bekleyen
   * yayinlanmis yazi takvim ogesi degildir, takvimde gorunurse musteri onu takvimden
   * de cikaramazdi.
   */
  async listScheduledForSite(siteId: string) {
    const rows = await this.prisma.article.findMany({
      where: pendingNewArticleWhere(siteId),
      orderBy: { scheduledAt: 'asc' },
      select: {
        id: true,
        topic: true,
        title: true,
        slug: true,
        status: true,
        scheduledAt: true,
        createdAt: true,
        wordCount: true,
        editorScore: true,
      },
      take: 30,
    });
    // lockedByPlan: deneme hesabinin plan yukseltilene kadar uretilmeyecek yazisi (plan-lock.ts)
    if (!rows.some((r) => String(r.status) === 'SCHEDULED')) return rows.map((r) => withPlanLock(r, new Set()));
    const site = await this.prisma.site.findUnique({ where: { id: siteId }, select: { userId: true } }).catch(() => null);
    const locked = site ? await loadPlanLockedIds(this.prisma, this.quota, site.userId) : new Set<string>();
    return rows.map((r) => withPlanLock(r, locked));
  }

  // ────────────────────────────────────────────────────────
  //  Slot algoritmasi
  // ────────────────────────────────────────────────────────
  private buildSlots(count: number): Date[] {
    const slots: Date[] = [];
    const now = new Date();
    slots.push(now); // #1 = simdi

    // Sonraki Pazartesi 10:00
    let cursor = this.nextWeekday(now, 1, 10); // Pzt = 1, saat 10
    for (let i = 1; i < count; i++) {
      slots.push(new Date(cursor));
      // Sonraki slot: 3 gun sonra Per 14, sonra +4 gun Pzt 10, alternatif
      if (i % 2 === 1) {
        // Pzt 10 → Per 14 (3 gun + 4 saat)
        cursor = new Date(cursor.getTime() + 3 * 86400000);
        cursor.setHours(14, 0, 0, 0);
      } else {
        // Per 14 → Sonraki Pzt 10 (4 gun - 4 saat)
        cursor = new Date(cursor.getTime() + 4 * 86400000);
        cursor.setHours(10, 0, 0, 0);
      }
    }
    return slots;
  }

  /** Verilen gunden sonra ilk hafta gunu (1=Pzt, 4=Per) saat HH:00 */
  private nextWeekday(from: Date, weekday: number, hour: number): Date {
    const d = new Date(from);
    d.setHours(hour, 0, 0, 0);
    const currentDay = d.getDay() === 0 ? 7 : d.getDay(); // Pazar = 7
    let diff = weekday - currentDay;
    if (diff <= 0 || (diff === 0 && d.getTime() <= from.getTime())) diff += 7;
    d.setDate(d.getDate() + diff);
    return d;
  }
}
