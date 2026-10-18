import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { JobQueueService } from '../jobs/job-queue.service.js';
import { QuotaService } from '../billing/quota.service.js';
import { PipelineService } from './pipeline.service.js';
import { automationPublishFields } from './publish-approval.js';
import { scheduledGenerationJobId } from './article-scheduler.service.js';
import {
  agentOutputsWithoutLiveWriteBlocked, articleContentHash, liveEntries, liveEntryFor, withoutManualUpdateFlag,
} from './republish-policy.js';

/** Yayin kaydi uclarinin dondugu bicim (paylasilan sozlesme) */
export interface PublishedEntryActionResult {
  ok: true;
  status: string;
  publishedTo: unknown[];
}

export const PUBLISHED_ENTRY_NOT_FOUND = 'Bu yayın hedefinde yazının yayın kaydı bulunamadı.';
export const PUBLISHED_ENTRY_CONFLICT = 'Yazı az önce değişti (örneğin bir yayın tamamlandı); sayfayı yenileyip tekrar deneyin.';

/**
 * "Simdi uret" ile uretime alinabilen durumlar: takvimde bekleyen, taslak ya da
 * basarisiz/revizyonda kalmis yazi. GENERATING / EDITING zaten uretimde (ikinci
 * istek ayni yaziyi iki kez uretirdi). READY_TO_PUBLISH / PUBLISHED / ARCHIVED
 * bitmis icerik: bu uc onlari yeniden uretip uzerine yazmak icin degil (yayindaki
 * yazinin govdesi ve slug'i degisirdi). Panel dugmesi yalniz takvim satirinda.
 */
const TRIGGERABLE_STATUSES = new Set(['SCHEDULED', 'DRAFT', 'FAILED', 'REVIZE_NEEDED']);

/**
 * "Simdi uret" yayindaki yaziyi (bilinen canli kopyasi olan) yeniden uretmez.
 *
 * NEDEN (K11): sahiplenme yaziyi GENERATING yapar ve uretim isi hata verirse
 * worker GENERATING / EDITING yaziyi FAILED'a ceker; GENERATING'de takili
 * kalani supurucu FAILED yapar (generating-sweeper.ts), uretim kapaliysa
 * SCHEDULED'a doner. Kapali dongude REVIZE alan yayindaki yazi boylece eski
 * hali sitede dururken "başarısız" ya da takvimde gorunuyordu. Yayindaki
 * yazinin yeniden yazimi kendi akislarindan (icerik pivotu, kapali dongu
 * guncellemesi) gelir; onlar yaziyi GENERATING yapmaz ve basarisiz yazim
 * yaziyi FAILED etmez. Panel dugmesi zaten yalniz takvim satirinda.
 */
export const TRIGGER_NOW_LIVE_REFUSED =
  'Bu yazının önceki hâli sitende yayında. "Şimdi üret" yayındaki bir yazıyı yeniden üretmez: üretim sürerken ya da başarısız olursa yazı panelde yayından düşmüş görünürdü. Yazıdaki güncel metni yayınlamak için yazının sayfasındaki "Yayınla" düğmesini kullanabilirsin.';

@Injectable()
export class ArticlesService {
  private readonly log = new Logger(ArticlesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jobQueue: JobQueueService,
    private readonly quota: QuotaService,
    private readonly pipeline: PipelineService,
  ) {}

  list(siteId: string, status?: string) {
    return this.prisma.article.findMany({
      where: { siteId, ...(status ? { status: status as any } : {}) },
      orderBy: { createdAt: 'desc' },
    });
  }

  findOne(id: string, siteId?: string) {
    return this.prisma.article.findFirst({
      where: { id, ...(siteId ? { siteId } : {}) },
    });
  }

  async queueGeneration(siteId: string, topic: string, targetIds?: string[]) {
    const site = await this.prisma.site.findUniqueOrThrow({ where: { id: siteId } });

    // Quota check (yetersizse 403 fırlatır)
    await this.quota.enforceArticleQuota(site.userId);

    // Placeholder Article (GENERATING) — pipeline tamamlandiginda bu kayit doldurulur.
    // Boylece "Uret" tiklanir tiklanmaz makale "Hazirlaniyor" rozetiyle listede gorunur.
    const placeholderSlug = `generating-${Date.now().toString(36)}`;
    const article = await this.prisma.article.create({
      data: {
        siteId,
        topic,
        slug: placeholderSlug,
        title: topic,
        status: 'GENERATING' as any,
        language: site.language ?? 'tr',
      },
    });

    const explicitPublish = !!targetIds?.length;
    const job = await this.jobQueue.enqueue({
      type: 'GENERATE_ARTICLE',
      userId: site.userId,
      siteId,
      payload: {
        siteId,
        topic,
        articleId: article.id,
        targetIds,
        autoPublish: explicitPublish,
        // Hedef secip "uret ve yayinla" diyen ACIK istek onayin kendisidir.
        // Worker autoPublish'i tek basina otomasyon istegi sayar ve Yari
        // otomatikte (varsayilan) onaya birakir (publish-approval.ts); bu bayrak
        // olmadan acik istek de onay bekliyordu. Panel ve MCP hedef gondermez
        // (web api.generateArticle yalniz konu, MCP create_article hedefsiz).
        ...(explicitPublish ? { publishApproved: true } : {}),
      },
    });

    // Quota'yı artır (job kuyruğa girdi sayılır)
    await this.quota.incrementArticleUsage(site.userId);

    return { ...job, articleId: article.id };
  }

  /**
   * Senkron pipeline (run-now) — quota guard'li wrapper.
   * Onboarding/dashboard "Üret" akışı buraya düşer.
   */
  async runPipelineNow(args: { siteId: string; topic: string; skipImages?: boolean; maxRevize?: number }) {
    const site = await this.prisma.site.findUniqueOrThrow({ where: { id: args.siteId } });

    // 1) Quota guard — yetersizse 403
    await this.quota.enforceArticleQuota(site.userId);

    // 2) Pipeline çalıştır
    const result = await this.pipeline.runPipeline({
      siteId: args.siteId,
      topic: args.topic,
      skipImages: args.skipImages ?? true,
      maxRevize: args.maxRevize ?? 1,
    });

    // 3) Başarılı tamamlandıysa sayacı artır
    await this.quota.incrementArticleUsage(site.userId);

    return result;
  }

  /**
   * Mevcut bir SCHEDULED article'ı (veya boş gövdeli herhangi bir article'ı)
   * şimdi üretime al. Cron'u beklemeden manuel tetikler.
   *
   * Sahiplenme ATOMIK (yalniz okunan durum hala gecerliyse GENERATING): eskiden
   * kosulsuz yaziliyordu; cift tiklama, ya da yazi o an takvim isi / saatlik
   * tarama tarafindan uretilirken basilan "Simdi uret" ayni yaziyi ikinci kez
   * uretime sokuyor ve kotadan iki kez dusuyordu.
   */
  async triggerNow(siteId: string, articleId: string) {
    const article = await this.prisma.article.findFirst({
      where: { id: articleId, siteId },
      include: { site: { include: { user: { select: { id: true } }, publishTargets: { where: { isActive: true, isDefault: true }, select: { id: true } } } } },
    });
    if (!article) throw new NotFoundException('Makale bulunamadi');
    const previousStatus = String(article.status);
    if (!TRIGGERABLE_STATUSES.has(previousStatus)) {
      throw new BadRequestException(
        previousStatus === 'GENERATING' || previousStatus === 'EDITING'
          ? 'Bu yazı zaten üretiliyor.'
          : 'Bu yazı zaten üretildi. "Şimdi üret" yalnız takvimde bekleyen ya da başarısız yazılar içindir.',
      );
    }
    // Yayindaki yazi (cop kutusundakiler haric bilinen canli kopyasi var): sahiplenme
    // yok, kota denetlenmez, is kuyruga atilmaz (TRIGGER_NOW_LIVE_REFUSED)
    if (liveEntries((article as { publishedTo?: unknown }).publishedTo).length > 0) {
      throw new BadRequestException(TRIGGER_NOW_LIVE_REFUSED);
    }

    // Quota guard
    await this.quota.enforceArticleQuota(article.site.user.id);

    // Okuma ile yazma arasinda saatlik tarama / takvim isi yaziyi almis olabilir
    const claim = await this.prisma.article.updateMany({
      where: { id: article.id, siteId, status: previousStatus as any },
      data: { status: 'GENERATING' as any },
    });
    if (claim.count !== 1) throw new BadRequestException('Bu yazı az önce üretime alındı.');

    const defaultTargetIds: string[] = (article.site as any).publishTargets?.map((t: any) => t.id) ?? [];
    // Takvim isiyle ayni kural: yalniz Tam otomatik + akis acikken yayin istenir;
    // worker karari is kosarken yeniden verir (publish-approval.ts)
    const { autoPublish, targetIds } = automationPublishFields(article.site, defaultTargetIds);

    let job: Awaited<ReturnType<JobQueueService['enqueue']>>;
    try {
      job = await this.jobQueue.enqueue({
        type: 'GENERATE_ARTICLE',
        userId: article.site.user.id,
        siteId,
        payload: {
          siteId,
          topic: article.topic,
          articleId: article.id,
          skipImages: false,
          autoPublish,
          targetIds,
        },
      });
    } catch (err) {
      // Kuyruga girmedi: sahiplik birakilir, yazi eski durumuna doner (kota dusulmez)
      await this.prisma.article
        .updateMany({ where: { id: article.id, status: 'GENERATING' as any }, data: { status: previousStatus as any } })
        .catch(() => undefined);
      throw err;
    }

    // Takvimin gecikmeli isi artik gereksiz: ateslense de yazi SCHEDULED olmadigi
    // icin sahiplenemez ve bos doner; kuyrugu temiz tutmak icin silinir (en iyi caba)
    await this.jobQueue.removeJob(scheduledGenerationJobId(article.id)).catch(() => false);

    await this.quota.incrementArticleUsage(article.site.user.id);

    return { ...job, articleId: article.id };
  }

  /**
   * PUBLISH_ARTICLE isini kuyruga atar. opts.overwriteRemoteEdits (C1):
   * kullanicinin acik onayi; is verisine aynen girer, worker yayinciya
   * secenek olarak verir (WordPress'te degismis yazinin ustune yazilir).
   * Otomasyonun kuyruga attigi yayin isleri bu alani tasimaz.
   *
   * initiator 'user' (paylasilan sozlesme D2): bu is kullanicinin acik yayin
   * istegidir; yayinci silinen yaziyi yalniz boyle bir yayinda ve yalniz adi
   * verilen hedefte yeniden olusturur. PUBLISH_ARTICLE'i yalniz bu uc kuyruga
   * atar (panel, API anahtari; MCP yayin araci yok). Alan eklenmeden once kuyruga
   * girmis eski isler de buradan geldi: worker o isleri de 'user' sayar.
   */
  async queuePublish(siteId: string, articleId: string, targetIds: string[], opts: { overrideQa?: boolean; overwriteRemoteEdits?: boolean } = {}) {
    const article = await this.prisma.article.findFirst({
      where: { id: articleId, siteId },
      include: { site: true },
    });
    if (!article) {
      throw new NotFoundException('Makale bulunamadi');
    }
    // QA Gate on kontrolu — BLOCKED makale kuyruga bile girmesin ki kullanici
    // hatayi job log'unda degil, tikladigi anda gorsun. (qaStatus null ise
    // engelleme yok; worker yayin aninda kosar.)
    if (!opts.overrideQa && (article as any).qaStatus === 'BLOCKED') {
      const blockers: any[] = Array.isArray(((article as any).qaReport as any)?.blockers)
        ? ((article as any).qaReport as any).blockers
        : [];
      throw new BadRequestException(
        `Yayin engellendi — QA blocker: ${blockers.slice(0, 3).map((b) => b.detail).join(' | ') || 'detay icin QA raporuna bak'}`,
      );
    }
    return this.jobQueue.enqueue({
      type: 'PUBLISH_ARTICLE',
      userId: article.site.userId,
      siteId: article.siteId,
      payload: { articleId, targetIds, overrideQa: !!opts.overrideQa, overwriteRemoteEdits: opts.overwriteRemoteEdits === true, initiator: 'user' },
    });
  }


  /**
   * Musteri, RanksUp'in yerinde guncelleyemedigi canli kopyayi (yalniz yeni kayit
   * acan hedef, adreslenemeyen kayit, pasif hedef...) KENDI panelinden guncel
   * metinle guncelledigini bildirir: kaydin "elle guncelleme bekliyor" isareti
   * (manualUpdatePending / manualUpdatePendingSince) kalkar.
   *
   * Kayda o anki metnin izi (contentHash) ve manualUpdatedAt yazilir; updatedAt
   * (son canli yazim) da ilerler. NEDEN: sonraki yayinlar "hedefteki metin eski
   * mi" kararini bu izle verir (degismemis yazi tekrar isaretlenmez); site
   * haritasi lastmod'u ve icerik pivotunun bekleme suresi sayfanin degistigi
   * ani gorur. Isaretsiz kayitta degisiklik yapilmaz (ayni istek iki kez gelse
   * de tarihler ilerlemez).
   *
   * Kayittaki hedef damgasi (remoteModifiedAt) SILINIR. NEDEN: damga RanksUp'in
   * son yaziminin yanitindaki WordPress modified_gmt'sidir; musterinin elle
   * yapistirmasi WordPress'te bu damgayi ilerletti. Damga kalsaydi yerinde
   * guncelleme (packages/adapters wordpress-post-ref.ts wordPressEditedSince)
   * WordPress'in damgasini onunla saniye duzeyinde karsilastirir ve RanksUp'in
   * sonraki HER guncellemesi 'live_entry_edited' diye atlanirdi. Damga yokken
   * karsilastirma kaydin son yazim anina (lastWriteAt = buradaki updatedAt,
   * yani isaretleme ani) WP_CLOCK_SKEW_TOLERANCE_MS saat payiyla doner:
   * isaretlemeden ONCE yapilan yapistirma bilinen degisikliktir, sonraki
   * duzenleme yine korunur. Sonraki basarili yazim yeni damgayi kaydeder.
   *
   * Otomatik yazim engeli (agentOutputs.liveWriteBlocked, S4) da kalkar: musteri
   * kopyayi guncel metne getirdi; icerik pivotunun 30 gunluk beklemesinin gerekcesi
   * ("yeni metin kopyaya ulasamiyor") artik gecerli degil.
   *
   * Takili sayfa geri alma isareti (remoteEditSkip / remoteEditSeenAt,
   * stuck-page-autopilot.ts rollbackStuckEntryFlags) da SILINIR. NEDEN (inceleme
   * S2'nin yan etkisi): isaret "kopya sitede RanksUp disinda degisti, otomatik
   * duzeltme ona yazmasin" der ve eskiden yalniz o hedefe basarili bir yazimla
   * kalkiyordu. Musteri guncel metni yapistirip "Elle güncelledim" dediginde
   * kopya artik RanksUp'in metnini tasir; isaret kalsaydi takili sayfa
   * otopilotu o sayfada kapali kalir, "AI Düzelt" de "RanksUp'ın son yayınından
   * sonra sitende değiştirilmiş" diyerek yalniz oneri uretirdi. Elle
   * guncelleme isareti olmayan kayitta (erken donus) geri alma isareti yerinde
   * kalir: musteri o durumda bir metin yapistirmayi onaylamadi.
   */
  async markPublishedEntryUpdated(siteId: string, articleId: string, targetId: string): Promise<PublishedEntryActionResult> {
    const article = await this.requireArticleForEntries(siteId, articleId);
    const entries = Array.isArray(article.publishedTo) ? (article.publishedTo as unknown[]) : [];
    const entry = liveEntryFor(entries, targetId);
    if (!entry) throw new NotFoundException(PUBLISHED_ENTRY_NOT_FOUND);
    if (entry.manualUpdatePending !== true) return { ok: true, status: String(article.status), publishedTo: entries };

    const now = new Date().toISOString();
    const updated: { [key: string]: unknown } = { ...withoutManualUpdateFlag(entry), updatedAt: now, manualUpdatedAt: now, contentHash: articleContentHash(article) };
    delete updated.remoteModifiedAt;
    delete updated.remoteEditSkip;
    delete updated.remoteEditSeenAt;
    const next = entries.map((e) => (e === entry ? updated : e));
    await this.writeEntries(article, { publishedTo: next, agentOutputs: agentOutputsWithoutLiveWriteBlocked(article.agentOutputs) });
    this.log.log(`[${articleId}] ${targetId} hedefindeki kopya müşteri tarafından elle güncellendi (işaret kaldırıldı)`);
    return { ok: true, status: String(article.status), publishedTo: next };
  }

  /**
   * Musteri yazinin bu hedefteki kopyasini SILDI: yayin kaydi kaldirilir, o
   * hedefe sonraki yayin yeni kayit acar (republish-policy.ts decideRepublish:
   * canli kayit yok → publish_new). Kacis yolu: yalniz yeni kayit acan hedefte
   * yaziyi elle silen musteri, kayit "yayinda" dedigi icin yeniden
   * yayinlayamiyordu.
   *
   * Baska canli kayit kalmazsa ve yazi PUBLISHED ise durum READY_TO_PUBLISH olur.
   * NEDEN: RanksUp'in bildigi hicbir yerde yayinda degil — PUBLISHED yanlis
   * olurdu ve PUBLISHED okuyan her yer (site haritasi, llms-full, KPI'lar,
   * raporlar, icerik pivotu) olmayan bir sayfayi saymaya devam ederdi.
   * READY_TO_PUBLISH metni bitmis, yayini musterinin kararina birakan durumdur:
   * panel yayinlamayi sunar, "onayini bekliyor" adiminda gorunur ve hicbir
   * otomasyon onu kendiliginden yayinlamaz (otomatik yayin yalniz uretim isinin
   * sonunda). DRAFT metni bitmemis sayardi, ARCHIVED yaziyi gizlerdi. Ilk yayin
   * tarihi (publishedAt) gecmis kaydi olarak kalir; yeniden yayinda yeni kayit
   * acildigi icin yayinci onu yeniler. Diger durumlar (REVIZE_NEEDED, uretimde)
   * degismez. llms-full.txt yeniden uretilir (en iyi caba): silinen adres AI
   * tarayicilarina haftalik yenilemeye kadar gosterilmesin.
   *
   * Otomatik yazim engeli (agentOutputs.liveWriteBlocked, S4) da kalkar: engeli
   * doguran kopya(lar)la ilgili karari musteri verdi; icerik pivotu kalan canli
   * kopyalara gore yeniden karar verir (onlar yeni metni alamiyorsa planin kendi
   * engelleri ve "elle guncelleme bekliyor" isareti yine durdurur).
   */
  async forgetPublishedEntry(siteId: string, articleId: string, targetId: string): Promise<PublishedEntryActionResult> {
    const article = await this.requireArticleForEntries(siteId, articleId);
    const entries = Array.isArray(article.publishedTo) ? (article.publishedTo as unknown[]) : [];
    const remaining = entries.filter((e) => !(e && typeof e === 'object' && (e as { targetId?: unknown }).targetId === targetId));
    if (remaining.length === entries.length) throw new NotFoundException(PUBLISHED_ENTRY_NOT_FOUND);

    const previousStatus = String(article.status);
    const status = previousStatus === 'PUBLISHED' && liveEntries(remaining).length === 0 ? 'READY_TO_PUBLISH' : previousStatus;
    await this.writeEntries(article, {
      publishedTo: remaining,
      ...(status !== previousStatus ? { status } : {}),
      agentOutputs: agentOutputsWithoutLiveWriteBlocked(article.agentOutputs),
    });
    this.log.log(`[${articleId}] ${targetId} hedefindeki yayın kaydı unutuldu${status !== previousStatus ? `; durum ${status}` : ''}`);

    await this.jobQueue
      .enqueue({ type: 'LLMS_FULL_BUILD', userId: article.site.userId, siteId, payload: { siteId } })
      .catch((err: any) => this.log.warn(`[${articleId}] llms-full yeniden üretimi kuyruğa alınamadı: ${err?.message ?? err}`));
    return { ok: true, status, publishedTo: remaining };
  }

  /**
   * Yayin kaydi uclari icin makale: bu siteye ait olmali ve kimlik BIREBIR ayni
   * (harmanlama esitligi yetmez, common/site-id.ts). Baska sitenin makalesinin
   * varligi sizmaz (404).
   */
  private async requireArticleForEntries(siteId: string, articleId: string) {
    const article = await this.prisma.article.findFirst({
      where: { id: articleId, siteId },
      select: {
        id: true, siteId: true, status: true, publishedTo: true, updatedAt: true,
        title: true, metaTitle: true, metaDescription: true, bodyMd: true,
        // Otomatik yazim engeli kaydi (liveWriteBlocked) temizlenirken geri kalan aynen yazilir
        agentOutputs: true,
        site: { select: { userId: true } },
      },
    });
    if (!article || article.id !== articleId || article.siteId !== siteId) throw new NotFoundException('Makale bulunamadı');
    return article;
  }

  /**
   * publishedTo (ve gerekirse durum / ajan ciktilari) yazimi — iyimser kilit:
   * okunan updatedAt degistiyse (arada yayin bitti, baska bir istek yazdi)
   * yazilmaz, 409. Kosulsuz yazim, araya giren yayinin kaydini eski listeyle
   * ezerdi. updatedAt acikca yazilir: kilit Prisma'nin updateMany davranisina
   * dayanmaz. agentOutputs null ise yazilmaz (degisiklik yok).
   */
  private async writeEntries(
    article: { id: string; siteId: string; updatedAt: Date },
    data: { publishedTo: unknown[]; status?: string; agentOutputs?: Record<string, unknown> | null },
  ): Promise<void> {
    const r = await this.prisma.article.updateMany({
      where: { id: article.id, siteId: article.siteId, updatedAt: article.updatedAt },
      data: {
        publishedTo: data.publishedTo as any,
        ...(data.status ? { status: data.status as any } : {}),
        ...(data.agentOutputs ? { agentOutputs: data.agentOutputs as any } : {}),
        updatedAt: new Date(),
      },
    });
    if (r.count !== 1) throw new ConflictException(PUBLISHED_ENTRY_CONFLICT);
  }

  /**
   * Article'in social pre-plan listesini set eder. Article PUBLISHED olunca
   * SocialAutoDraftService bu liste'yi kullanir.
   */
  async setSocialPrePlan(siteId: string, articleId: string, channelIds: string[] | null) {
    const article = await this.prisma.article.findFirst({
      where: { id: articleId, siteId },
      select: { id: true },
    });
    if (!article) throw new Error('Article bulunamadi');
    return this.prisma.article.update({
      where: { id: articleId },
      data: { socialPrePlanChannelIds: (channelIds ?? null) as any },
      select: { id: true, socialPrePlanChannelIds: true },
    });
  }
}
