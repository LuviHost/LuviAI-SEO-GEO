import { Injectable, Logger, ForbiddenException, BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { JobQueueService } from '../jobs/job-queue.service.js';
import { QuotaService } from '../billing/quota.service.js';
import { automationPublishFields, type PublishApprovalSite } from './publish-approval.js';

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

/** Sahiplenip kuyruga atmak icin okunan makale alanlari */
interface ClaimableArticle {
  id: string;
  siteId: string;
  topic: string;
  site: PublishApprovalSite & { publishTargets?: Array<{ id: string }> | null };
}

/** Takvim isinin sonucu (worker is kaydina yazilir) */
export type ScheduledDispatchResult =
  | { dispatched: true; articleId: string; generateJobId: string }
  | { skipped: true; reason: 'ARTICLE_MISSING' | 'ALREADY_CLAIMED' | 'AUTOPILOT_PAUSED'; status?: string };

/** Uretim isi baslarken sahiplik karari (claimForGeneration) */
export type GenerationClaim = 'proceed' | 'already_claimed' | 'article_missing';

/**
 * Article scheduler — icerik takvimi: onboarding'in tier-1 konulari
 * (scheduleInitialBatch), elle takvime eklenen konular (scheduleTopic) ve
 * takvim yazilarinin uretime alinmasi (processDueArticles, gecikmeli is).
 *
 * Makale hakki: takvim uretimi aylik makale hakkindan DUSMEZ. Sayac
 * (articlesUsedThisMonth) yalniz kullanicinin kendi baslattigi uretimlerde
 * artar — QuotaService.incrementArticleUsage cagiranlari: Uret
 * (queueGeneration), run-now, Simdi uret (triggerNow), MCP create_article ve
 * icerik firsati. Saatlik tarama yalniz bu sayac planin hakkini doldurduysa
 * bekler (deneme hesabinda omur boyu 2 makale, ucretli planlarda her ay
 * sifirlanir; QuotaService.checkArticleQuota) ve akisi durdurulmus sitenin
 * yazisini uretmez. Onboarding'in ilk makalesi her planda hemen uretilir.
 * Elle takvime eklenen konunun hakki eklerken denetlenir (scheduleTopic);
 * gecikmeli isi uretim aninda hakka bakmaz (dispatchScheduledArticle).
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
   * tarama uretir (bu yazilar icin gecikmeli is kurulmaz). Hicbiri makale
   * hakkindan dusmez.
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

      try {
        const article = await this.prisma.article.create({
          data: {
            siteId,
            topic,
            slug,
            title: topic,
            language: site.language ?? 'tr',
            status: i === 0 ? ('GENERATING' as any) : ('SCHEDULED' as any),
            scheduledAt: slot,
          },
        });

        if (i === 0) {
          // Ilk makale her planda hemen uretilir: hak kontrolu yok, sayac da
          // artmaz (incrementArticleUsage yalniz kullanicinin kendi uretimlerinde)
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
          this.log.log(`[${siteId}] [1/${picks.length}] '${topic}' — hemen uretime alindi`);
        } else {
          this.log.log(`[${siteId}] [${i + 1}/${picks.length}] '${topic}' — ${slot.toISOString()} icin planlandi (saatlik tarama uretir; makale hakkindan dusmez)`);
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
   */
  private async claimAndQueue(a: ClaimableArticle, userId: string) {
    const claim = await this.prisma.article.updateMany({
      where: { id: a.id, status: 'SCHEDULED' as any },
      data: { status: 'GENERATING' as any },
    });
    if (claim.count !== 1) return null;
    const defaultTargetIds = a.site.publishTargets?.map((t) => t.id) ?? [];
    const { autoPublish, targetIds } = automationPublishFields(a.site, defaultTargetIds);
    try {
      return await this.jobQueue.enqueue({
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
    } catch (err) {
      await this.prisma.article
        .updateMany({ where: { id: a.id, status: 'GENERATING' as any }, data: { status: 'SCHEDULED' as any } })
        .catch(() => undefined);
      throw err;
    }
  }

  /**
   * Takvimin gecikmeli isi (gen:article:<id>) ateslendiginde worker bunu cagirir.
   * Is kendisi URETMEZ: yaziyi saatlik taramayla AYNI atomik sahiplenmeyle alip
   * normal uretim isi olarak kuyruga atar. Boylece yeniden deneme ve yarida
   * kalan is (worker yeniden baslatma) her uretim isiyle ayni kurala tabi olur;
   * "bu yaziyi kim uretiyor" sorusu tek yerde (claimAndQueue) cevaplanir.
   * Yayin alanlari is verisinden degil sitenin GUNCEL modundan hesaplanir.
   * Hak kontrolu yok (eski davranis korunur): gecikmeli is yalniz elle takvime
   * eklenen konuda kurulur ve hak o anda denetlendi (scheduleTopic: kalan hak
   * + takvimde bekleyenler); takvim uretimi hakka sayilmaz.
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
    const job = await this.claimAndQueue(a, a.site.userId);
    if (!job) return { skipped: true, reason: 'ALREADY_CLAIMED' };
    this.log.log(`[${a.siteId}] Takvim isi: ${a.id} sahiplenildi, uretim isi kuyrukta (${job.dbJobId})`);
    return { dispatched: true, articleId: a.id, generateJobId: job.dbJobId };
  }

  /**
   * Uretim isi (gecikmeli takvim isi DISINDAKI her GENERATE_ARTICLE) baslarken:
   * yazi hala SCHEDULED ise kuyruga atan sahiplenmemis demektir (sahiplik is
   * kuyruga atilamadigi icin birakildi ama is yine de kuyruga girmis olabilir).
   * O zaman once atomik olarak sahiplenilir; baskasi aldiysa is uretmeden doner.
   * Yazi SCHEDULED degilse kuyruga atan zaten GENERATING yapmistir ya da
   * yayindaki yazi yeniden yaziliyordur (pivot, kapali dongu): uretim surer.
   * Yeniden denemede yazi bu isin sahipliginde GENERATING'dir, yine surer.
   */
  async claimForGeneration(articleId: unknown): Promise<GenerationClaim> {
    // Yer tutucusuz is: pipeline yeni kayit acar
    if (typeof articleId !== 'string' || !articleId) return 'proceed';
    const a = await this.prisma.article.findUnique({ where: { id: articleId }, select: { status: true } });
    // Silinmis yaziya uretim: LLM maliyeti harcanir, sonunda kayit yok diye
    // hata verir ve is iki kez daha denenirdi
    if (!a) return 'article_missing';
    if (a.status !== 'SCHEDULED') return 'proceed';
    const claim = await this.prisma.article.updateMany({
      where: { id: articleId, status: 'SCHEDULED' as any },
      data: { status: 'GENERATING' as any },
    });
    return claim.count === 1 ? 'proceed' : 'already_claimed';
  }

  /**
   * Worker'in saatlik PROCESS_SCHEDULED isi cagirir. scheduledAt - 15dk <= now
   * olan, akisi acik sitelerin SCHEDULED yazilarini uretime alir; kullanicinin
   * kendi uretimleri makale hakkini doldurduysa yazi SCHEDULED kalir
   * (skippedQuota) ve hak yenilenince (yeni ay ya da plan yukseltme) alinir.
   * Uretim hakka sayilmaz. Site Tam otomatikte ve akis aciksa
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
  async processDueArticles(): Promise<{ processed: number; skippedQuota: number; alreadyClaimed: number; failed: number }> {
    const now = new Date();
    // 15 dk onceden uret ki tam saat geldiginde yayina hazir olsun
    const threshold = new Date(now.getTime() + 15 * 60 * 1000);

    let processed = 0;
    let skippedQuota = 0;
    let alreadyClaimed = 0;
    let failed = 0;
    // Kullanici basina tek hak kontrolu: tarama sayaci artirmaz, ayni turdaki
    // yazilari icin yanit degismez
    const quotaByUser = new Map<string, boolean>();
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
      batches++;
      const due = await this.prisma.article.findMany({
        where: this.dueArticlesWhere(threshold, skipUsers, cursor),
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
        // Ayni sorgu, hakki okunamadan once okundu: kalan yazilari da bekler
        if (quotaUnreadable.has(u.id)) {
          failed++;
          continue;
        }
        let allowed: boolean;
        try {
          allowed = await this.scanQuotaAllowed(u.id, quotaByUser);
        } catch (err: any) {
          // Yazi SCHEDULED kalir; sonraki tarama yeniden dener
          failed++;
          quotaUnreadable.add(u.id);
          skipUsers.add(u.id);
          this.log.warn(`[${a.siteId}] Takvim yazisi ${a.id}: makale hakki okunamadi: ${err?.message ?? err}`);
          continue;
        }
        if (!allowed) {
          skippedQuota++;
          skipUsers.add(u.id);
          continue;
        }
        try {
          const job = await this.claimAndQueue(a, u.id);
          if (job) processed++;
          else alreadyClaimed++;
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
  private dueArticlesWhere(threshold: Date, skipUsers: Set<string>, cursor: { scheduledAt: Date; id: string } | null) {
    return {
      status: 'SCHEDULED' as any,
      scheduledAt: { lte: threshold },
      // Durdurulmus akista takvim uretilmez (panel: "Yeni yazı üretilmiyor");
      // yazi SCHEDULED kalir, akis acilinca bir sonraki taramada alinir.
      // Demo sitesinin ornek takvim yazilari gostermelik (DEMO_SITE_URL).
      site: {
        autopilot: true,
        url: { not: DEMO_SITE_URL },
        ...(skipUsers.size > 0 ? { userId: { notIn: [...skipUsers] } } : {}),
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
   * Saatlik taramada kullanicinin makale hakki yetiyor mu (kullanici basina
   * bir kez sorulur, `cache`).
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
  private async scanQuotaAllowed(userId: string, cache: Map<string, boolean>): Promise<boolean> {
    const cached = cache.get(userId);
    if (cached !== undefined) return cached;
    const { allowed } = await this.quota.checkArticleQuota(userId);
    cache.set(userId, allowed);
    return allowed;
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

    // Hak kontrolu: articlesUsedThisMonth yalniz kullanicinin kendi baslattigi
    // uretimleri sayar, takvim uretimi saymaz (eski yorum tersini soyluyordu).
    // Bu yuzden takvimde, uretimde ya da onayda bekleyen yazilar ayrica sayilip
    // kalan hakla karsilastirilir; yayinlanan ya da takvimden cikan yazi yer acar.
    const { allowed, remaining, limit } = await this.quota.checkArticleQuota(site.userId);
    const pendingCount = await this.prisma.article.count({
      where: {
        siteId,
        status: { in: ['SCHEDULED', 'GENERATING', 'EDITING', 'READY_TO_PUBLISH'] as any },
      },
    });
    if (!allowed) {
      // Eski metin her planda "makale/ay" diyordu; deneme hesabinin hakki ay
      // basi sifirlanmaz (QuotaService.maybeResetMonthlyQuota)
      throw new ForbiddenException(
        `Makale hakkın doldu (${limit} makale). Yeni yazıyı takvime eklemek için planını yükseltebilirsin.`,
      );
    }
    if (pendingCount >= remaining) {
      throw new ForbiddenException(
        `Kalan makale hakkın ${remaining}; takvimde, üretimde ya da onayda bekleyen ${pendingCount} yazı var. ` +
        'Yeni yazı eklemek için bekleyen yazıları yayınla ya da takvimden çıkar; daha fazlası için planını yükseltebilirsin.',
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

  /** Makale bu sitede yoksa 404 (baska sitenin makalesinin varligi sizmaz) */
  private async findSiteArticle(siteId: string, articleId: string) {
    if (!siteId || !articleId) throw new NotFoundException('Makale bulunamadı');
    const a = await this.prisma.article.findFirst({ where: { id: articleId, siteId } });
    if (!a) throw new NotFoundException('Makale bulunamadı');
    return a;
  }

  /**
   * Site icin scheduled article'leri liste — frontend takvimi besler.
   */
  async listScheduledForSite(siteId: string) {
    return this.prisma.article.findMany({
      where: {
        siteId,
        status: { in: ['SCHEDULED', 'GENERATING', 'EDITING', 'READY_TO_PUBLISH'] as any },
      },
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
