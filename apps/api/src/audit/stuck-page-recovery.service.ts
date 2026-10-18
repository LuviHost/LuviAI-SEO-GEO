import { BadRequestException, Injectable, Logger, NotFoundException, Optional } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { SettingsService } from '../settings/settings.service.js';
import { WebhookNotifierService } from './webhook-notifier.service.js';
import { GeoRunnerService } from './geo-runner.service.js';
import { JobQueueService } from '../jobs/job-queue.service.js';
import { safeParseJson } from '../common/safe-json.js';
import { articleContentHash, liveEntries, targetLabel } from '../articles/republish-policy.js';
import {
  STUCK_ARTICLE_SELECT, STUCK_REPUBLISH_PHASE, autoRecoveryBlock, autoRecoveryBlockText, claimStuckPage, isStuckRepublishPayload,
  liveEntryAddressesUrl, planStuckRepublish, readStuckClaimLease, recentLiveWriteText, recentStuckLiveWrite, recoverableStuckStatuses,
  releaseAbandonedStuckClaim, releaseStaleStuckClaims, republishBlockText, rollbackStuckEntryFlags, stuckArticleLiveBlock,
  stuckArticleSkipReason, stuckProcessedSince, stuckRequestedAt,
  type RemoteEditSkip, type StuckArticleRow, type StuckClaimDeps, type StuckRepublishPayload, type StuckRepublishPlan,
} from './stuck-page-autopilot.js';
import {
  STUCK_AI_DISABLED, STUCK_AI_UNAVAILABLE, STUCK_ARTICLE_CHANGED_DURING_RECOVERY, STUCK_ARTICLE_EMPTY, STUCK_ARTICLE_NOT_FOUND,
  STUCK_EXTERNAL_PAGE_IN_ARTICLE_FLOW, STUCK_PAGE_NOT_FOUND, STUCK_PROCESSED_SINCE_REQUEST, STUCK_RECOVERY_NOT_FOUND, STUCK_REVERT_ALREADY_DONE,
  STUCK_REVERT_ARTICLE_CHANGED, STUCK_REVERT_EXTERNAL, STUCK_REVERT_STATE_CHANGED, stuckStatusSkipText,
} from './stuck-page-messages.js';
import { queueStuckRecoveries, type StuckBatchQueueResult } from './stuck-batch-result.js';

/** 30 gunluk etki olcumu (STUCK_PAGE_PERFORMANCE_CHECK) gecikmesi */
const PERFORMANCE_CHECK_DELAY_MS = 30 * 24 * 60 * 60 * 1000;

/** Yeniden yayinin hedefteki sonucu (yayinci PublishResult'inin kullanilan alanlari) */
export interface StuckRepublishTargetResult {
  targetId: string;
  targetType?: string;
  ok: boolean;
  error?: string;
  /** Kopya acmamak ya da musterinin metnini ezmemek icin BILEREK yapilmayan yazim (makine okunur) */
  skipped?: string;
  /** Basarili yazimda ne yapildi: updated / overwritten yerinde; recreated / created / exported degil */
  action?: string;
  /** Yazimdan sonra kopyanin adresi (WordPress'te yazinin canli baglantisi) */
  externalUrl?: string;
}

/**
 * Yeniden yayin fonksiyonu — worker PublisherService.publishArticle'i verir (AuditModule ArticlesModule'u import edemez: dongu).
 * skipped: yayinci kopya acmamak icin hedefi BILEREK atladi (cop kutusundaki
 * yazi, yeni kayit acan hedef, slug degisimi, sitede elle duzenlenmis yazi...)
 * — tekrar denemek sonucu degistirmez. Takili sayfa akisi yayinciya hicbir
 * zaman "musterinin duzenlemesini ez" (overwriteRemoteEdits) demez.
 * Ucuncu arguman yayinci secenekleri olarak AYNEN gecirilmeli
 * (PublisherService.publishArticle opts); STUCK_REPUBLISH_PUBLISH_OPTIONS'a bakin.
 */
export type StuckRepublishFn = (
  articleId: string,
  targetIds: string[],
  opts?: StuckRepublishPublishOptions,
) => Promise<StuckRepublishTargetResult[]>;

/** Takili sayfa yeniden yayininin yayinciya verdigi secenekler (publishArticle opts'un alt kumesi) */
export interface StuckRepublishPublishOptions {
  recreateMissing: false;
  /** Paylasilan sozlesme D2: takili sayfa akisi otomasyondur (kullanici acik secimi degil) */
  initiator: 'automation';
}

/**
 * Silinmis yaziyi YENIDEN ACMA (recreateMissing:false). NEDEN: yayinci yerinde
 * guncellenecek WordPress yazisini 404 ile bulamayinca varsayilan olarak yeni
 * yazi aciyordu ('recreated'); takili sayfa akisi bunu basarisiz sayiyor ama
 * musterinin sildigi yazi yine sitede yeniden olusuyordu. Simdi hicbir sey
 * yazilmaz; yayinci 'live_entry_missing' atlamasini Turkce nedenle doner,
 * asagidaki basarisizlik yolu (kalici atlama -> FAILED, metin geri) nedeni
 * sonuca tasir. Geri alma yayini da ayni cagriyla gider. initiator
 * 'automation' (D2): yayinci otomasyon yayininda silinen yaziyi zaten yeniden
 * acmaz; acik recreateMissing:false eski yayinci surumunde de ayni sonucu verir.
 */
export const STUCK_REPUBLISH_PUBLISH_OPTIONS: StuckRepublishPublishOptions = Object.freeze({ recreateMissing: false, initiator: 'automation' });

/** republish() sonucu (worker is kaydina yazilir) */
export interface StuckRepublishResult {
  ok: boolean;
  skipped?: boolean;
  /** DETECTED: duzenleme yayinlanmadi, oneri olarak kaydedildi (manual true) */
  status?: 'RECOVERED' | 'FAILED' | 'REVERTED' | 'DETECTED';
  reason?: string;
  manual?: boolean;
}

/** recover() sonucu (tekil uc ve worker is kaydi) */
export interface StuckRecoverResult {
  success: boolean;
  recoveryId?: string;
  editsCount?: number;
  reason?: string;
  needsRepublish?: boolean;
  articleId?: string;
  /**
   * Hicbir sey degismedi: otopilot kurali, sayfanin durumu (gozardi /
   * duzeltildi / islemde), yazinin onay bekleyen surumu (bunlarda yapay zeka
   * da cagrilmaz) ya da duzeltme hazirlanirken yazinin degismesi. reason
   * kullaniciya gosterilir (panel aynen gosterir).
   */
  skipped?: boolean;
  /**
   * true = oneri kaydedildi ama yazi DEGISTIRILMEDI ve yayinlanmadi: yazinin
   * yayin hedefi takili sayfayi yerinde guncelleyemiyor (reason nedenini soyler).
   * success false gelir; dis sayfa akisindaki ayni alan.
   */
  manual?: boolean;
}

/**
 * Yayinci bu iki nedenle yazmazsa duzenleme oneri olur (paylasilan sozlesme C2).
 * Metin yayincinin Turkce nedeni (error) yoksa kullanilir.
 */
const LIVE_EDIT_SKIPS: ReadonlyMap<string, string> = new Map([
  ['live_entry_edited', 'Yazı, RanksUp\'ın son yayınından sonra sitende elle düzenlenmiş; RanksUp senin değişikliklerinin üzerine yazmadı.'],
  ['live_entry_mismatch', 'Kayıtlı yazı kimliği artık sitende başka bir yazıyı gösteriyor; RanksUp hiçbir şey yazmadı.'],
]);

/** Yerinde yazim sayilan yayin sonuclari (yayinci PublishAction) */
const IN_PLACE_ACTIONS: ReadonlySet<string> = new Set(['updated', 'overwritten']);

/** Ikinci asama geri alinirken gereken: yayindan onceki publishedTo ve yayin sonuclari */
interface StuckPublishRollback {
  snapshot: unknown;
  results: StuckRepublishTargetResult[];
}

/** Isaret geri alma yaziminin kosullu deneme sayisi (yayincinin commitArticleState'i gibi) */
const ENTRY_ROLLBACK_ATTEMPTS = 3;

interface ProposedEdit {
  type: 'sentence_replace' | 'paragraph_add' | 'alttext_update';
  before?: string;
  after: string;
  reason: string;
  entityAdded?: string;
}

interface LlmRecoveryProposal {
  diagnosis: string;
  edits: ProposedEdit[];
  entitiesAdded: string[];
  paragraphAdded: string | null;
  entityScoreEstimate: number;
}

/**
 * Stuck Page Recovery — On-page.ai Recipe 1 esleyicisi.
 *
 * Akis:
 *   1. Otopilot kurali (plan / akis / Tam otomatik), sayfanin durumu (otopilot
 *      yalniz "Tespit edildi", kullanici "Basarisiz" da) ve yazinin durumu:
 *      kayittaki metin canlida olmali (onay bekleyen yeniden yazim varsa
 *      duzenleme onu onaysiz yayinlardi). Engel varsa HICBIR SEY degismez,
 *      yapay zeka cagrilmaz.
 *   2. Plan (planStuckRepublish): yazinin yayinda oldugu hedefler TAKILI
 *      ADRESI yerinde guncelleyebiliyor mu? Otopilot hayirsa hicbir sey yapmaz.
 *   3. Sayfa RECOVERING'e ATOMIK gecer (izinli durumdan); gecemezse baska bir
 *      is ya da karar (gozardi, duzeltildi) araya girmistir — hicbir sey yapilmaz.
 *   4. GSC top sorgular + Claude ile cumle-seviye edit onerisi, edit'leri uygula.
 *   5a. Plan oneriyse: ONERI kaydedilir, yazi degismez, sayfa "Tespit edildi"de.
 *   5b. Degilse: govde KOSULLU yazilir (yapay zeka cagrisi surerken yazi
 *       degistiyse ezilmez), QA durumu sifirlanir, kayit acilir, sayfa
 *       RECOVERING kalir ve ikinci asama (phase 'republish') kuyruga girer.
 *   6. republish(): worker yaziyi yalniz o hedeflere yeniden yayinlar; sayfa
 *      ANCAK takili adres YERINDE guncellenince RECOVERED olur, webhook ve 30
 *      gunluk olcum o zaman kurulur.
 *
 * NEDEN: eskiden sayfa yayin kuyruga atilir atilmaz RECOVERED oluyordu ve
 * yayin varsayilan hedefe gidiyordu. CMS adaptorleri yalniz YENI yazi actigi
 * icin WordPress'te ikinci bir kopya (/yazi-2/) yayinlaniyor, takili adres hic
 * degismiyor, QA durumu sifirlanmadigi icin LLM'in ekledigi metin kalite
 * kapisindan gecmeden yayinlaniyordu.
 *
 * Revert: yalniz yayina alinmis son duzeltme ve yalniz yazinin metni hala o
 * duzeltmenin yayinladigi metinse; bodyMdBefore geri yuklenir ve ayni yerinde
 * yeniden yayin asamasiyla yayinlanir.
 */
@Injectable()
export class StuckPageRecoveryService {
  private readonly log = new Logger(StuckPageRecoveryService.name);
  private readonly anthropic = process.env.ANTHROPIC_API_KEY
    ? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
    : null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly webhook: WebhookNotifierService,
    private readonly jobs: JobQueueService,
    private readonly geo: GeoRunnerService,
    // SettingsModule @Global: AI_GLOBAL_DISABLED. Istege bagli — testler ve eski
    // kurulumlar dort argumanla kurar; yoksa yapay zeka kapali sayilmaz
    @Optional() private readonly settings?: SettingsService,
  ) {}

  /**
   * opts.jobId: STUCK_PAGE_RECOVER isinin BullMQ kimligi (worker verir; senkron
   * tekil uc vermez) — sahiplenme kirasina yazilir, ayni is yeniden teslim
   * edilirse sayfayi devralir. opts.requestedAt: isin kuyruga alindigi an (ISO):
   * sayfa o andan sonra baska bir yoldan islendiyse yapay zeka cagrilmaz.
   */
  async recover(stuckPageId: string, opts: { triggeredBy: string; jobId?: string; requestedAt?: string }): Promise<StuckRecoverResult> {
    let stuckPage = await this.prisma.stuckPage.findUnique({
      where: { id: stuckPageId },
    });
    if (!stuckPage) throw new NotFoundException(STUCK_PAGE_NOT_FOUND);
    if (!stuckPage.articleId) throw new BadRequestException(STUCK_EXTERNAL_PAGE_IN_ARTICLE_FLOW);
    const articleId = stuckPage.articleId;
    const autopilot = opts.triggeredBy === 'autopilot';
    const skip = (reason: string): StuckRecoverResult => {
      this.log.log(`[${stuckPageId}] Kurtarma atlandi (${opts.triggeredBy}): ${reason}`);
      return { success: false, skipped: true, reason };
    };

    // SAHIPSIZ SAHIPLENME: onceki is sayfayi sahiplenip oldu (dagitimda worker
    // yeniden basladi, API istegi kesildi). Ayni BullMQ isi yeniden teslim
    // edildiyse ya da kira suresi dolduysa ve sayfanin canli isi yoksa sayfa
    // onceki durumuna birakilir (yarim kalan duzenleme geri alinir), sonra
    // normal akisla devam edilir. Eskiden yeniden teslim "zaten suruyor" deyip
    // atliyor, sayfa sonsuza kadar "Çalışıyor" kaliyordu. Otopilot kuralindan
    // ONCE: arada Yari otomatige gecilmis olsa da olu isin sahiplenmesi birakilir.
    if (String(stuckPage.status) === 'RECOVERING') {
      const released = await releaseAbandonedStuckClaim(this.claimDeps(), stuckPage, { jobId: opts.jobId });
      if (released) {
        const fresh = await this.prisma.stuckPage.findUnique({ where: { id: stuckPageId } });
        if (!fresh) throw new NotFoundException(STUCK_PAGE_NOT_FOUND);
        stuckPage = fresh;
      }
    }

    // OTOPILOT: kurtarma yaziyi degistirip ONAYSIZ yeniden yayinlar. Yalniz
    // plani kapsayan, akisi acik ve Tam otomatik sitede (stuck-page-autopilot.ts).
    // Haftalik tarama zaten suzuyor; burada IS KOSARKEN yeniden bakilir —
    // arada Yari otomatige gecen musterinin yazisi yayinlanmaz. LLM cagrisindan
    // ve her degisiklikten ONCE: engellenen is hicbir sey degistirmez.
    // Kullanicinin "AI Duzelt"i (manual) bu kurala tabi degil: yayini o istedi.
    if (autopilot) {
      const site = await this.prisma.site.findUnique({
        where: { id: stuckPage.siteId },
        select: { autopilot: true, publishApprovalMode: true, user: { select: { plan: true } } },
      });
      const block = site ? autoRecoveryBlock(site) : 'paused';
      if (block) return skip(autoRecoveryBlockText(block));
    }

    // DURUM: is kuyrukta beklerken musteri sayfayi "Gozardi" etmis, elle
    // duzeltmis ya da baska bir is calisiyor olabilir. Eskiden durum hic
    // okunmuyordu: kuyruktaki otopilot isi gozardi kararini eziyor, duzeltilmis
    // sayfaya ikinci bir AI turu yigiyordu (ilk tur bir daha geri alinamiyordu).
    const allowed = recoverableStuckStatuses(opts.triggeredBy);
    if (!allowed.includes(stuckPage.status)) return skip(stuckStatusSkipText(stuckPage.status, autopilot));

    // Kuyruktaki is calismadan once sayfa baska yoldan islendiyse (tekil "AI
    // Düzelt", ayni sayfanin onceki isi) ikinci GEO + Sonnet turu yapilmaz
    const requestedAt = stuckRequestedAt(opts.requestedAt);
    if (requestedAt && await this.processedSinceRequest(stuckPage, requestedAt, opts.jobId)) return skip(STUCK_PROCESSED_SINCE_REQUEST);

    // Yonetici yapay zeka islemlerini kapattiysa (AI_GLOBAL_DISABLED) hicbir sey
    // degismez; eskiden yalniz worker bakiyordu, senkron "AI Düzelt" bakmiyordu
    if (await this.aiDisabled()) return skip(STUCK_AI_DISABLED);

    const [article, targets] = await Promise.all([
      this.prisma.article.findUnique({ where: { id: articleId }, select: { ...STUCK_ARTICLE_SELECT, bodyHtml: true } }),
      this.prisma.publishTarget.findMany({ where: { siteId: stuckPage.siteId }, select: { id: true, type: true, isActive: true } }),
    ]);
    // Yeniden yayin nereye? Yazinin yayinda oldugu her hedef yerinde
    // guncelleyebilmeli ve kopyalardan biri TAKILI ADRES olmali; degilse
    // duzenleme yalniz oneri olur. Otopilot bu durumda LLM'i hic cagirmaz.
    const plan = article ? planStuckRepublish({ publishedTo: article.publishedTo, targets, slug: article.slug, url: stuckPage.url }) : null;
    // Ucuz denetimler (toplu onarim kuyruga almadan once AYNISINI uygular):
    // yazi yok; kopya cop kutusunda / hedefte yok (oneri de uretilmez — musteri
    // kaldirdi); kayittaki metin canlida degil (bekleyen surum, kopyaya
    // yazilamamis son metin, yayinlanmamis degisiklik); govde bos
    const pre = stuckArticleSkipReason(article as StuckArticleRow | null, plan);
    if (pre || !article || !plan) return skip(pre ?? STUCK_ARTICLE_NOT_FOUND);
    if (autopilot) {
      // Olcum penceresinde yayinlanan yazinin GSC verisi eski metnin: bayat
      // veriyle ikinci bir otomatik duzenleme yapilmaz (stuck-page-autopilot.ts)
      const recent = recentStuckLiveWrite(article, new Date());
      if (recent) return skip(recentLiveWriteText(recent));
      if (plan.kind === 'proposal') return skip(republishBlockText(plan, 'autopilot'));
    }
    if (!this.anthropic) throw new BadRequestException(STUCK_AI_UNAVAILABLE);
    const bodyMdBefore = article.bodyMd ?? '';
    const bodyHtmlBefore = article.bodyHtml ?? '';
    if (!bodyMdBefore.trim()) return skip(STUCK_ARTICLE_EMPTY);

    // ATOMIK sahiplenme: yalniz okunan durumdan RECOVERING'e (updatedAt =
    // sahiplenme ani) + kira (stuck-page-autopilot.ts claimStuckPage). Iki is
    // (kuyruktaki otopilot + "AI Duzelt", ya da tekrarlanan toplu istek) ayni
    // anda gelirse yalniz biri gecer; digeri yapay zeka cagirmadan atlar.
    const claimedAt = await claimStuckPage(this.claimDeps(), { stuckPageId, from: stuckPage, jobId: opts.jobId });
    if (!claimedAt) {
      const current = await this.prisma.stuckPage.findUnique({ where: { id: stuckPageId }, select: { status: true } });
      return skip(stuckStatusSkipText(current?.status, autopilot));
    }

    // Govde degistiyse ve sonraki adimlardan biri patlarsa metin geri alinir:
    // canliya gitmeyecek bir duzenleme yazida kalmasin
    let bodyChange: { before: string; after: string } | null = null;
    // Bu turun duzeltme kaydi (ikinci asama kuyruga girene kadar): hata olursa silinir
    let pendingRecoveryId: string | null = null;
    try {
      // Detect aninda kaydedilen top sorgular (varsa)
      const topQueries: string[] = Array.isArray(stuckPage.topQueries)
        ? (stuckPage.topQueries as string[])
        : [];

      // ENH#1: GEO scan re-validation — recovery oncesi gercek skor
      const geoBefore = await this.geo.runAudit(stuckPage.url).catch(() => null);
      const geoScoreBefore = geoBefore?.score ?? null;

      // LLM gap analizi + edit onerisi
      const proposal = await this.proposeEdits({
        article,
        bodyMd: bodyMdBefore,
        targetKeywords: topQueries,
        currentPosition: stuckPage.position,
        impressions: stuckPage.impressions,
        ctr: stuckPage.ctr,
      });

      if (!proposal || proposal.edits.length === 0) {
        await this.markFailed(stuckPageId);
        return { success: false, reason: 'AI bu sayfa için değişiklik önerisi üretemedi.' };
      }

      // Edit'leri uygula
      const { bodyMdAfter, appliedEdits, skippedEdits } = this.applyEdits(
        bodyMdBefore,
        proposal.edits,
        proposal.paragraphAdded,
      );

      if (appliedEdits.length === 0) {
        await this.markFailed(stuckPageId);
        return { success: false, reason: 'Önerilen cümlelerin hiçbiri yazıda birebir bulunamadı; değişiklik yapılmadı.' };
      }

      // ENH#1: edits sonrasi GEO rescan. Cikan icerikten direkt deger okumak
      // 24-48 saat sonra yansir (publish sonrasi), ama Auriti scan icin
      // raw bodyMd da yeterli. Yine de URL'den fetch dener (publish'tan sonra olur).
      // Burada hemen rescan yapmak GEO icin manasiz cunku publish henuz olmadi.
      // Performance check job'unda 30 gun sonra rescan da yapilir.
      const recoveryData = {
        stuckPageId,
        bodyMdBefore,
        bodyMdAfter,
        bodyHtmlBefore,
        bodyHtmlAfter: null,
        edits: appliedEdits as any,
        entitiesAdded: proposal.entitiesAdded as any,
        paragraphAdded: proposal.paragraphAdded ?? null,
        entityScoreAfter: proposal.entityScoreEstimate,
        scorePassedComp: proposal.entityScoreEstimate >= 70,
        llmModel: 'claude-sonnet-5',
        appliedBy: opts.triggeredBy,
        // ENH#1
        geoScoreBefore,
        // ENH#4 — recovery anindaki pozisyon (referans icin)
        positionBefore: stuckPage.position,
        ctrBefore: stuckPage.ctr,
      };

      if (plan.kind === 'proposal') {
        // Yazinin yayin hedefi takili sayfayi yerinde guncelleyemiyor. Oneri
        // denetim kaydinda (oncesi/sonrasi metin + cumle degisiklikleri) durur;
        // yazi degismez, yayin kuyruga girmez, sayfa "Tespit edildi"de kalir.
        // Webhook ve 30 gunluk olcum YOK — canlida olculecek bir degisiklik
        // yapilmadi (dis sayfa akisiyla ayni kural).
        const recovery = await this.prisma.stuckPageRecovery.create({ data: recoveryData as any });
        await this.prisma.stuckPage.updateMany({ where: { id: stuckPageId, status: 'RECOVERING' }, data: { status: 'DETECTED' } });
        this.log.log(`[${stuckPageId}] Recovery: ${appliedEdits.length} oneri kaydedildi, yazi degistirilmedi (${plan.block})`);
        return {
          success: false,
          manual: true,
          recoveryId: recovery.id,
          editsCount: appliedEdits.length,
          reason: republishBlockText(plan, 'proposal'),
        };
      }

      // Ikinci asama isi site sahibine baglanir: sahip yoksa hicbir sey yazilmaz
      const site = await this.prisma.site.findUnique({
        where: { id: stuckPage.siteId },
        select: { userId: true },
      });
      if (!site?.userId) throw new NotFoundException('Site bulunamadı; yeniden yayın kuyruğa alınamadı.');

      // Recovery kaydi GOVDEDEN ONCE (yayin ikinci asamada — sayfa o basarilinca
      // RECOVERED olur). NEDEN: is govde yazimindan sonra olurse (dagitim)
      // sahipsiz sahiplenmeyi birakan, duzenlemeyi bu kayittan geri alir;
      // kayit sonra acilsaydi yazida izsiz, canliya gitmeyecek bir metin kalirdi.
      const recovery = await this.prisma.stuckPageRecovery.create({ data: recoveryData as any });
      pendingRecoveryId = recovery.id;

      // Article guncelle (bodyHtml yayinci yayinda yeniler). QA durumu sifirlanir:
      // yayinci QA'yi yalniz qaStatus bossa kosuyor; eski PASS ile LLM'in ekledigi
      // metin (kaynaksiz istatistik vb.) kalite kapisindan gecmeden yayinlaniyordu.
      // KOSULLU: yapay zeka cagrisi surerken yazi degistiyse (onaylanan yeniden
      // yazim, capraz link, elle duzenleme) o metin ezilmez — duzenleme eski
      // metne gore hazirlandi.
      const written = await this.prisma.article.updateMany({
        where: { id: articleId, bodyMd: bodyMdBefore, status: 'PUBLISHED' },
        data: { bodyMd: bodyMdAfter, qaStatus: null, qaReport: Prisma.DbNull },
      });
      if (written.count !== 1) {
        await this.prisma.stuckPageRecovery.delete({ where: { id: recovery.id } }).catch(() => undefined);
        pendingRecoveryId = null;
        // Sahiplenmeden onceki durum ve zamani (FAILED'in bekleme suresi korunur)
        await this.prisma.stuckPage.updateMany({
          where: { id: stuckPageId, status: 'RECOVERING' },
          data: { status: stuckPage.status, ...(stuckPage.updatedAt instanceof Date ? { updatedAt: stuckPage.updatedAt } : {}) },
        });
        return skip(STUCK_ARTICLE_CHANGED_DURING_RECOVERY);
      }
      bodyChange = { before: bodyMdBefore, after: bodyMdAfter };

      // ENH#1: StuckPage'e entityScoreBefore yaz (UI'da gosterim icin).
      // updatedAt sahiplenme aninda KALIR: kiranin yasi ondan olculur
      if (geoScoreBefore !== null) {
        await this.prisma.stuckPage.update({
          where: { id: stuckPageId },
          data: { entityScoreBefore: geoScoreBefore, updatedAt: claimedAt },
        });
      }

      // Sayfa RECOVERING kalir. Eskiden burada RECOVERED yapilip yayin kuyruga
      // atiliyordu: yayin hic olmasa da (hedef hatasi, QA engeli) panel
      // "Düzeltildi" diyor, dedektor bu adresi bir daha ele almiyordu.
      const payload: StuckRepublishPayload = {
        phase: STUCK_REPUBLISH_PHASE, stuckPageId, recoveryId: recovery.id, articleId, mode: 'recover',
        expectedContentHash: articleContentHash({ ...article, bodyMd: bodyMdAfter }),
      };
      try {
        await this.jobs.enqueue({ type: 'STUCK_PAGE_RECOVER', userId: site.userId, siteId: stuckPage.siteId, payload });
        // Kayit artik ikinci asamanin: hata olsa da bu tur silmez
        pendingRecoveryId = null;
      } catch (e: any) {
        // Yayin kuyruga girmedi: duzenleme canliya hic gitmeyecek — metin geri
        // alinir, kayit silinir, sayfa FAILED (kullanici yeniden deneyebilir)
        this.log.warn(`[${stuckPageId}] Yeniden yayin kuyruga alinamadi: ${e?.message ?? e}`);
        await this.restoreBody(articleId, bodyMdAfter, bodyMdBefore);
        bodyChange = null;
        await this.prisma.stuckPageRecovery.delete({ where: { id: recovery.id } }).catch(() => undefined);
        pendingRecoveryId = null;
        await this.markFailed(stuckPageId);
        return { success: false, reason: 'Yeniden yayın kuyruğa alınamadı; yazı değiştirilmedi. Biraz sonra tekrar dene.' };
      }

      this.log.log(
        `[${stuckPageId}] Recovery: ${appliedEdits.length} edit uygulandi (${skippedEdits.length} skipped), ${proposal.entitiesAdded.length} entity, paragraph=${proposal.paragraphAdded ? 'EVET' : 'HAYIR'} — yerinde yeniden yayin kuyrukta (${plan.targetTypes.join(', ')})`,
      );

      return {
        success: true,
        recoveryId: recovery.id,
        editsCount: appliedEdits.length,
        needsRepublish: true,
        articleId,
      };
    } catch (err: any) {
      if (bodyChange) await this.restoreBody(articleId, bodyChange.after, bodyChange.before).catch(() => undefined);
      // Ikinci asamaya gecmemis kayit "Son onarım" diye kalmasin
      if (pendingRecoveryId) await this.prisma.stuckPageRecovery.delete({ where: { id: pendingRecoveryId } }).catch(() => undefined);
      await this.markFailed(stuckPageId).catch(() => undefined);
      this.log.error(`[${stuckPageId}] Recovery hata: ${err.message}`);
      throw err;
    }
  }

  /** Sahiplenme / kira / canli is denetimi bagimliliklari (stuck-page-autopilot.ts) */
  private claimDeps(): StuckClaimDeps {
    return { prisma: this.prisma, jobs: this.jobs, log: this.log };
  }

  /** Yonetici yapay zeka islemlerini kapatti mi (AppSetting AI_GLOBAL_DISABLED) */
  private async aiDisabled(): Promise<boolean> {
    if (!this.settings) return false;
    return this.settings.getBoolean('AI_GLOBAL_DISABLED').catch(() => false);
  }

  /**
   * Sayfa, isin kuyruga alindigi andan sonra islendi mi (stuckProcessedSince)?
   * Ayni BullMQ isinin onceki denemesi (son sahiplenme bu isin) sayfayi FAILED
   * yaptiysa yeniden deneme engellenmez: BullMQ'nun hata sonrasi yeniden denemesi.
   */
  private async processedSinceRequest(stuckPage: { id: string; status: unknown; updatedAt?: unknown }, since: Date, jobId?: string): Promise<boolean> {
    if (!(await stuckProcessedSince(this.prisma, stuckPage, since))) return false;
    if (jobId) {
      const lease = await readStuckClaimLease(this.claimDeps(), stuckPage.id);
      if (lease?.jobId === jobId) return false;
    }
    return true;
  }

  /**
   * Sitenin kira suresi dolmus, isi olmayan RECOVERING satirlarini birakir
   * (takili sayfa listesi acilinca; haftalik tarama ayni kurali uygular).
   * Donen: birakilan satir sayisi. En iyi caba: hata listelemeyi engellemez.
   */
  async releaseStaleClaims(siteId: string): Promise<number> {
    return releaseStaleStuckClaims({ prisma: this.prisma, jobs: this.jobs, log: this.log }, siteId).catch((err: any) => {
      this.log.warn(`[${siteId}] Sahipsiz sahiplenmeler birakilamadi: ${err?.message ?? err}`);
      return 0;
    });
  }

  /**
   * Recovery'yi geri al — bodyMdBefore geri yuklenir, ayni yerinde yeniden
   * yayin asamasiyla (mode 'revert') yayinlanir.
   *
   * KIRACI IZOLASYONU: siteId zorunlu.
   * Bu metot bir makalenin govdesini onceki haline dondurur. siteId ile
   * kisitlanmazsa saldirgan kendi sitesinin URL'i altinda baskasinin
   * recoveryId'sini gecirip o musterinin yayindaki makalesini degistirebilirdi.
   *
   * Yalniz YAYINA ALINMIS son duzeltme ve YALNIZ yazinin metni hala o
   * duzeltmenin yayinladigi metinse geri alinir. NEDEN: geri alma kosulsuz
   * bodyMdBefore yaziyordu; duzeltmeden sonra yazi degistiyse (onaylanan
   * yeniden yazim, capraz link, snippet) o degisiklikler hem kayittan hem
   * canli sayfadan siliniyordu, "Geri Al" dugmesi ise suresiz gorunuyordu.
   * Yazim da KOSULLU (tiklama ile yazim arasindaki degisiklik ezilmez); geri
   * alma yayinlanamazsa yazi tiklamadan onceki metne doner — o metin kosul
   * geregi tam olarak bodyMdAfter'dir. Yazinin hedefi takili sayfayi yerinde
   * guncelleyemiyorsa hicbir sey degismez.
   */
  async revert(
    siteId: string,
    recoveryId: string,
    userId: string,
  ): Promise<{ needsRepublish: boolean; articleId: string }> {
    const recovery = await this.prisma.stuckPageRecovery.findFirst({
      where: { id: recoveryId, stuckPage: { siteId } },
      include: { stuckPage: true },
    });
    if (!recovery) throw new NotFoundException(STUCK_RECOVERY_NOT_FOUND);
    if (recovery.revertedAt) throw new BadRequestException(STUCK_REVERT_ALREADY_DONE);
    if (!recovery.stuckPage.articleId) throw new BadRequestException(STUCK_REVERT_EXTERNAL);
    const articleId = recovery.stuckPage.articleId;
    if (String(recovery.stuckPage.status) !== 'RECOVERED') {
      throw new BadRequestException('Yalnız yayına alınmış bir düzeltme geri alınabilir; bu kayıt bir öneri ya da tamamlanmamış bir deneme.');
    }
    const latest = await this.prisma.stuckPageRecovery.findFirst({
      where: { stuckPageId: recovery.stuckPageId },
      orderBy: { appliedAt: 'desc' },
      select: { id: true },
    });
    if (latest && latest.id !== recoveryId) {
      throw new BadRequestException('Yalnız bu sayfanın son düzeltmesi geri alınabilir.');
    }
    const article = await this.prisma.article.findUnique({ where: { id: articleId }, select: STUCK_ARTICLE_SELECT });
    if (!article) throw new NotFoundException(STUCK_ARTICLE_NOT_FOUND);
    const after = recovery.bodyMdAfter ?? '';
    if ((article.bodyMd ?? '') !== after) throw new BadRequestException(STUCK_REVERT_ARTICLE_CHANGED);
    // Geri alma yazinin TUM kaydini yeniden yayinlar: kayitta yayinlanmamis bir
    // surum (onay bekleyen baslik / meta) varsa o da onaysiz canliya cikardi
    const liveBlock = stuckArticleLiveBlock(article as StuckArticleRow);
    if (liveBlock) throw new BadRequestException(liveBlock);
    const plan = await this.republishPlan(siteId, article, recovery.stuckPage.url);
    if (plan.kind !== 'republish') throw new BadRequestException(republishBlockText(plan, 'revert'));
    const site = await this.prisma.site.findUnique({
      where: { id: recovery.stuckPage.siteId },
      select: { userId: true },
    });
    if (!site?.userId) throw new NotFoundException('Site bulunamadı.');
    const restored = recovery.bodyMdBefore ?? '';

    // Sayfa durumu ATOMIK: arada baska bir karar ya da geri alma gelmisse durulur
    const moved = await this.prisma.stuckPage.updateMany({
      where: { id: recovery.stuckPageId, status: 'RECOVERED' },
      data: { status: 'REVERTED' },
    });
    if (moved.count !== 1) throw new BadRequestException(STUCK_REVERT_STATE_CHANGED);
    // bodyHtml'e dokunulmaz: yayinci yayin basarilinca yeniler. Yayin olmazsa
    // panel onizlemesi canlidaki (duzeltilmis) metinle tutarli kalir.
    const written = await this.prisma.article.updateMany({
      where: { id: articleId, bodyMd: after, status: 'PUBLISHED' },
      data: { bodyMd: restored, qaStatus: null, qaReport: Prisma.DbNull },
    });
    if (written.count !== 1) {
      await this.prisma.stuckPage.updateMany({ where: { id: recovery.stuckPageId, status: 'REVERTED' }, data: { status: 'RECOVERED' } });
      throw new BadRequestException(STUCK_REVERT_ARTICLE_CHANGED);
    }
    await this.prisma.stuckPageRecovery.update({
      where: { id: recoveryId },
      data: { revertedAt: new Date(), revertedBy: userId },
    });

    const payload: StuckRepublishPayload = { phase: STUCK_REPUBLISH_PHASE, stuckPageId: recovery.stuckPageId, recoveryId, articleId, mode: 'revert' };
    try {
      await this.jobs.enqueue({ type: 'STUCK_PAGE_RECOVER', userId: site.userId, siteId: recovery.stuckPage.siteId, payload });
    } catch (e: any) {
      // Eski metin canliya gitmeyecek: geri alma geri alinir (yazi ve durum tiklamadan onceki hali)
      this.log.warn(`[${recoveryId}] Geri alma yayini kuyruga alinamadi: ${e?.message ?? e}`);
      await this.undoRevert(recovery.id, recovery.stuckPageId, articleId, restored, after);
      throw new BadRequestException('Geri alma yayını kuyruğa alınamadı; hiçbir şey değiştirilmedi. Biraz sonra tekrar dene.');
    }

    this.log.log(`[${recoveryId}] Revert uygulandi (user=${userId}) — yerinde yeniden yayin kuyrukta`);
    return { needsRepublish: true, articleId };
  }

  /**
   * Toplu onarim (POST stuck-pages/recover-batch): her uygun sayfa icin bir
   * STUCK_PAGE_RECOVER isi kuyruga girer, cevap HEMEN doner (paylasilan
   * sozlesme C4; ayrinti stuck-batch-result.ts).
   */
  async queueBatch(siteId: string, stuckPageIds: unknown[], triggeredBy: string, max: number): Promise<StuckBatchQueueResult> {
    return queueStuckRecoveries({
      prisma: this.prisma,
      jobs: this.jobs,
      log: this.log,
      // Is kosunca atlanacak sayfa kuyruga girmesin (paylasilan sozlesme D4):
      // anahtar yok ya da yonetici yapay zekayi kapatti
      aiBlock: async () => (!this.anthropic ? STUCK_AI_UNAVAILABLE : (await this.aiDisabled()) ? STUCK_AI_DISABLED : null),
    }, { siteId, stuckPageIds, triggeredBy, max });
  }

  /**
   * Ikinci asama (worker, STUCK_PAGE_RECOVER phase 'republish'): duzenlenen ya
   * da geri alinan makaleyi YALNIZ yerinde guncelleyen hedeflere yeniden
   * yayinlar ve sonucu sayfaya yazar.
   *  - recover: her hedef YERINDE yazildiysa (updated / overwritten) ve
   *    yazilan kopyalardan biri takili adresse RECOVERED + webhook + 30 gunluk
   *    olcum. Yayinci kaydi yeni kayit olarak yeniden actiysa (recreated)
   *    takili adres duzelmedi: FAILED.
   *  - revert: sayfa zaten REVERTED; basarisizsa geri alma geri alinir.
   * Musteri yaziyi sitede duzenlemisse ya da kayitli kimlik baska yaziyi
   * gosteriyorsa (yayinci live_entry_edited / live_entry_mismatch) hicbir sey
   * yazilmaz: duzenleme ONERI olur, metin geri alinir.
   * Gecici hata ve eksik yayin son deneme degilse firlatilir (BullMQ yeniden
   * dener; yerinde yazan hedeflerde tekrar yayin zararsizdir). QA engeli kalicidir.
   * Hedef karari ve yazinin durumu yayindan HEMEN once yeniden denetlenir.
   */
  async republish(payload: unknown, publish: StuckRepublishFn, opts: { finalAttempt: boolean }): Promise<StuckRepublishResult> {
    if (!isStuckRepublishPayload(payload)) return { ok: false, skipped: true, reason: 'INVALID_PAYLOAD' };
    const { stuckPageId, recoveryId, articleId, mode } = payload;
    const recovery = await this.prisma.stuckPageRecovery.findUnique({
      where: { id: recoveryId },
      include: { stuckPage: true },
    });
    if (!recovery || recovery.stuckPageId !== stuckPageId || recovery.stuckPage.articleId !== articleId) {
      return { ok: false, skipped: true, reason: 'STUCK_RECOVERY_NOT_FOUND' };
    }
    const sp = recovery.stuckPage;
    const latest = await this.prisma.stuckPageRecovery.findFirst({
      where: { stuckPageId },
      orderBy: { appliedAt: 'desc' },
      select: { id: true },
    });

    if (mode === 'recover') {
      // Sonra acilan bir kurtarma bu kaydin yerini aldi: metin artik onun
      if (latest?.id !== recoveryId) return { ok: false, skipped: true, reason: 'SUPERSEDED' };
      // Ayni is daha once tamamlandi (worker durup is yeniden kostu): dokunma
      if (String(sp.status) === 'RECOVERED' && !recovery.revertedAt) return { ok: true, skipped: true, status: 'RECOVERED', reason: 'ALREADY_DONE' };
      if (String(sp.status) !== 'RECOVERING' || recovery.revertedAt) {
        // Bu arada sayfa gozardi edildi ya da durumu degisti: duzenleme yayinlanmaz,
        // canliya gitmeyen metin geri alinir
        await this.restoreBody(articleId, recovery.bodyMdAfter ?? '', recovery.bodyMdBefore ?? '');
        await this.prisma.stuckPageRecovery.delete({ where: { id: recoveryId } }).catch(() => undefined);
        this.log.log(`[${stuckPageId}] Yeniden yayin atlandi: sayfa durumu ${sp.status}`);
        return { ok: false, skipped: true, reason: 'STATE_CHANGED' };
      }
    } else if (!recovery.revertedAt || String(sp.status) !== 'REVERTED' || latest?.id !== recoveryId) {
      return { ok: false, skipped: true, reason: 'STATE_CHANGED' };
    }

    // YAZI bu arada degisti mi? Yayinci kayitta ne varsa yayinlar: iki asama
    // arasinda onay bekleyen bir yeniden yazim kaydi ezdiyse (ya da geri
    // almadan sonra metin degistiyse) o metin "duzeltme" diye canliya cikardi.
    const article = await this.prisma.article.findUnique({ where: { id: articleId }, select: STUCK_ARTICLE_SELECT });
    const expectedBody = (mode === 'recover' ? recovery.bodyMdAfter : recovery.bodyMdBefore) ?? '';
    const unchanged = !!article
      && String(article.status) === 'PUBLISHED'
      && (article.bodyMd ?? '') === expectedBody
      && (mode !== 'recover' || typeof payload.expectedContentHash !== 'string' || articleContentHash(article) === payload.expectedContentHash);
    if (!article || !unchanged) {
      if (mode === 'recover') {
        await this.restoreBody(articleId, recovery.bodyMdAfter ?? '', recovery.bodyMdBefore ?? '');
        await this.prisma.stuckPageRecovery.delete({ where: { id: recoveryId } }).catch(() => undefined);
        await this.prisma.stuckPage.updateMany({ where: { id: stuckPageId, status: 'RECOVERING' }, data: { status: 'DETECTED' } });
      } else {
        await this.undoRevert(recoveryId, stuckPageId, articleId, recovery.bodyMdBefore ?? '', recovery.bodyMdAfter ?? '');
      }
      this.log.warn(`[${stuckPageId}] Yeniden yayin atlandi: yazi iki asama arasinda degisti (${mode})`);
      return { ok: false, skipped: true, reason: 'ARTICLE_CHANGED' };
    }

    const plan = await this.republishPlan(sp.siteId, article, sp.url);
    if (plan.kind !== 'republish') {
      return this.republishFailed(payload, recovery, { anyLive: false, reason: republishBlockText(plan, mode === 'revert' ? 'revert' : 'republish') });
    }

    // Yayindan ONCEKI yayin kayitlari: yayin geri alinirsa (metin onceki haline
    // doner) yayincinin atilan metne gore koydugu isaretler buna dondurulur
    const snapshot: unknown = article.publishedTo ?? null;
    let results: StuckRepublishTargetResult[];
    try {
      results = await publish(articleId, plan.targetIds, STUCK_REPUBLISH_PUBLISH_OPTIONS);
    } catch (err: any) {
      const msg = String(err?.message ?? err);
      // QA engeli tekrar denemeyle degismez (duzenlenen metin kaliteden gecmedi)
      const qaBlocked = msg.startsWith('QA_BLOCKED');
      if (!qaBlocked && !opts.finalAttempt) throw err;
      return this.republishFailed(payload, recovery, {
        anyLive: false,
        reason: qaBlocked ? `Düzenlenen metin yayın öncesi kalite kontrolünden geçmedi: ${msg.replace(/^QA_BLOCKED:\s*/, '')}` : `Yeniden yayın başarısız: ${msg}`,
      }, { snapshot, results: [] });
    }

    const list = (Array.isArray(results) ? results : [])
      .filter((r): r is StuckRepublishTargetResult => !!r && typeof r === 'object')
      // Plan disindaki hedefin "secilmedi" sonucu (yalniz disa aktarim olabilir —
      // plan yazinin canli tum kopyalarini kapsar; D1) takili sayfanin sonucu degil
      .filter((r) => plan.targetIds.includes(r.targetId) || r.skipped !== 'live_target_not_selected');
    const rollback = { snapshot, results: list };
    const written = list.filter((r) => r.ok);
    // Yalniz YERINDE yazim duzeltme sayilir: updated (WordPress) / overwritten
    // (dosya hedefleri). 'recreated' = kayit hedefte silinmisti, yayinci yeni
    // kayit acti; takili adres degismedi. Eylemi bilinmeyen sonuc da sayilmaz.
    const inPlace = written.filter((r) => typeof r.action === 'string' && IN_PLACE_ACTIONS.has(r.action));
    const inPlaceIds = new Set(inPlace.map((r) => r.targetId));
    const allInPlace = plan.targetIds.every((id) => inPlaceIds.has(id));
    const typeById = new Map(plan.targetIds.map((id, i) => [id, plan.targetTypes[i]] as const));
    const entryById = new Map(liveEntries(article.publishedTo).map((e) => [e.targetId, e] as const));
    // Yazimdan sonraki adres takili adres mi (WordPress'te yazinin canli baglantisi;
    // dosya hedefinde yazilan yol — hedef ayari arada degistiyse baska dosyadir)
    const reachedStuckUrl = inPlace.some((r) => {
      const address = typeof r.externalUrl === 'string' && r.externalUrl ? { externalUrl: r.externalUrl } : entryById.get(r.targetId);
      return liveEntryAddressesUrl(address, r.targetType ?? typeById.get(r.targetId), sp.url);
    });
    if (allInPlace && reachedStuckUrl) return this.republishSucceeded(payload, recovery);

    // Musterinin sitedeki duzenlemesi ya da kimligi baska yaziyi gosteren kayit:
    // hicbir sey yazilmadiysa duzenleme oneri olur (paylasilan sozlesme C2)
    const liveEdit = list.find((r) => !r.ok && typeof r.skipped === 'string' && LIVE_EDIT_SKIPS.has(r.skipped));
    if (written.length === 0 && liveEdit) return this.republishAsProposal(payload, recovery, liveEdit, rollback);

    const notInPlace = written.filter((r) => !inPlaceIds.has(r.targetId));
    if (notInPlace.length > 0) {
      // Yazildi ama yerinde degil: yeniden denemek yeni kopya acar — kalici
      return this.republishFailed(payload, recovery, { anyLive: true, reason: notInPlaceText(notInPlace) }, rollback);
    }
    if (allInPlace) {
      return this.republishFailed(payload, recovery, {
        anyLive: true,
        reason: `Yeniden yayın takılı adrese değil başka bir adrese yazıldı (${inPlace.map((r) => r.externalUrl ?? resultTargetName(r)).join(', ')}); takılı sayfa düzeltilmedi.`,
      }, rollback);
    }

    const failed = list.filter((r) => !r.ok);
    const detail = failed
      .map((r) => `${resultTargetName(r)}: ${r.error ?? 'yazılamadı'}`)
      .join(' · ') || 'yayın hedefi sonuç döndürmedi';
    // Yayinci hedefi bilerek atladiysa (cop kutusundaki WordPress yazisi, yeni
    // kayit acan hedef, slug degisimi) durum kalicidir: BullMQ'nun yeniden
    // denemesi ayni sonucu verir, sayfa yalniz gec FAILED olurdu
    const permanent = failed.some((r) => typeof r.skipped === 'string' && r.skipped !== '');
    // Yerinde yazan hedeflerde tekrar yayin zararsiz: eksik kalan hedef icin yeniden dene
    if (!opts.finalAttempt && !permanent) throw new Error(`Yeniden yayin tamamlanamadi (${detail}); yeniden denenecek`);
    return this.republishFailed(payload, recovery, { anyLive: written.length > 0, reason: `Yeniden yayın tamamlanamadı: ${detail}` }, rollback);
  }

  // ─────────────────────────────────────────────────────────────
  //  Yeniden yayin yardimcilari
  // ─────────────────────────────────────────────────────────────

  /**
   * Yazinin yayinda oldugu hedeflere ve TAKILI ADRESE gore yerinde yeniden
   * yayin karari (stuck-page-autopilot.ts planStuckRepublish). slug: yol
   * tabanli hedefte slug degistiyse yeniden yayin yeni sayfa acar.
   */
  private async republishPlan(siteId: string, article: { publishedTo?: unknown; slug?: string | null }, url: string): Promise<StuckRepublishPlan> {
    const targets = await this.prisma.publishTarget.findMany({ where: { siteId }, select: { id: true, type: true, isActive: true } });
    return planStuckRepublish({ publishedTo: article.publishedTo ?? null, targets, slug: article.slug ?? null, url });
  }

  /**
   * Sayfa RECOVERING → FAILED. Kosullu: bu arada baska bir karar (gozardi)
   * verildiyse ezilmez. updatedAt ACIKCA yazilir: haftalik tarama basarisiz
   * denemeden sonraki bekleme suresini bu andan sayar (stuck-page-autopilot.ts
   * hasRecentFailure). Prisma sema belgesi (@updatedAt: "If you do not supply a
   * time yourself, Prisma Client will automatically set the value") degerin
   * elle verilebildigini soyler ama updateMany'den soz etmez; uretilen istemci
   * tipinde StuckPageUpdateManyMutationInput.updatedAt alani var.
   */
  private async markFailed(stuckPageId: string): Promise<void> {
    await this.prisma.stuckPage.updateMany({
      where: { id: stuckPageId, status: 'RECOVERING' },
      data: { status: 'FAILED', updatedAt: new Date() },
    });
  }

  /**
   * Canliya gitmeyen metni geri al — YALNIZ yazi hala bizim yazdigimiz
   * metinse (kullanici bu arada elle duzenlediyse onun metni ezilmez).
   * QA durumu yeniden sifirlanir: kayitli sonuc artik baska metne ait.
   */
  private async restoreBody(articleId: string, expected: string, restoreTo: string): Promise<boolean> {
    const r = await this.prisma.article.updateMany({
      where: { id: articleId, bodyMd: expected },
      data: { bodyMd: restoreTo, qaStatus: null, qaReport: Prisma.DbNull },
    });
    if (r.count !== 1) this.log.warn(`[${articleId}] Metin geri alinmadi: yazi bu arada degismis`);
    return r.count === 1;
  }

  /** Geri alma yayinlanamadi: yazi ve durum geri almadan onceki hale doner */
  private async undoRevert(recoveryId: string, stuckPageId: string, articleId: string, restored: string, previousBody: string): Promise<void> {
    await this.restoreBody(articleId, restored, previousBody);
    await this.prisma.stuckPageRecovery.update({ where: { id: recoveryId }, data: { revertedAt: null, revertedBy: null } });
    await this.prisma.stuckPage.updateMany({ where: { id: stuckPageId, status: 'REVERTED' }, data: { status: 'RECOVERED' } });
  }

  /**
   * Geri alinan ikinci asama: yayincinin bu yayinda YAZILMAYAN kopyalara atilan
   * metne gore koydugu isaretleri (manualUpdatePending / Since,
   * remoteModifiedAt) yayindan onceki haline dondurur; kopya sitede degismis ya
   * da kimligi baska yaziyi gosterir bulunduysa kayda remoteEditSkip yazar
   * (kural ve gerekce: stuck-page-autopilot.ts rollbackStuckEntryFlags).
   * Yazim KOSULLU (okunan updatedAt — yayinci ve mark-updated / unut uclariyla
   * ayni iyimser kilit): araya giren bir yayinin kaydi ezilmez; yarisirsa
   * yeniden okunup denenir, hep yarisirsa birakilir ve loglanir.
   */
  private async rollbackEntryFlags(articleId: string, rollback: StuckPublishRollback): Promise<void> {
    const writtenTargetIds = new Set(rollback.results.filter((r) => r.ok).map((r) => r.targetId));
    const remoteEdits = new Map<string, RemoteEditSkip>();
    for (const r of rollback.results) {
      if (!r.ok && (r.skipped === 'live_entry_edited' || r.skipped === 'live_entry_mismatch')) remoteEdits.set(r.targetId, r.skipped);
    }
    try {
      for (let attempt = 1; attempt <= ENTRY_ROLLBACK_ATTEMPTS; attempt++) {
        const fresh = await this.prisma.article.findUnique({ where: { id: articleId }, select: { publishedTo: true, updatedAt: true } });
        // updatedAt yoksa kosullu yazim kurulamaz (kosulsuz yazim araya giren yayini ezerdi)
        if (!fresh || !(fresh.updatedAt instanceof Date)) return;
        const next = rollbackStuckEntryFlags({ current: fresh.publishedTo, snapshot: rollback.snapshot, writtenTargetIds, remoteEdits, now: new Date().toISOString() });
        if (!next.changed) return;
        const r = await this.prisma.article.updateMany({
          where: { id: articleId, updatedAt: fresh.updatedAt },
          data: { publishedTo: next.publishedTo as any, updatedAt: new Date() },
        });
        if (r.count === 1) return;
      }
      this.log.warn(`[${articleId}] Yayin isaretleri geri alinamadi: yazi ust uste degisti`);
    } catch (err: any) {
      this.log.warn(`[${articleId}] Yayin isaretleri geri alinamadi: ${err?.message ?? err}`);
    }
  }

  private async republishSucceeded(payload: StuckRepublishPayload, recovery: any): Promise<StuckRepublishResult> {
    const sp = recovery.stuckPage;
    if (payload.mode === 'revert') {
      this.log.log(`[${payload.recoveryId}] Geri alinan metin yeniden yayinlandi`);
      return { ok: true, status: 'REVERTED' };
    }
    // Kosullu: bu arada baska bir karar (gozardi) verildiyse ezilmez
    const moved = await this.prisma.stuckPage.updateMany({
      where: { id: payload.stuckPageId, status: 'RECOVERING' },
      data: { status: 'RECOVERED' },
    });
    if (moved.count !== 1) {
      this.log.warn(`[${payload.stuckPageId}] Yayin tamam ama sayfa durumu degismis; RECOVERED yazilmadi`);
      return { ok: true, skipped: true, reason: 'STATE_CHANGED' };
    }
    const edits = Array.isArray(recovery.edits) ? recovery.edits.length : 0;
    const entities: unknown[] = Array.isArray(recovery.entitiesAdded) ? recovery.entitiesAdded : [];
    const site = await this.prisma.site.findUnique({ where: { id: sp.siteId }, select: { name: true, userId: true } });
    await this.webhook.notify({
      siteId: sp.siteId,
      siteName: site?.name ?? '',
      event: 'stuck_page_recovered',
      title: `Takılı sayfa düzeltildi: ${sp.title ?? sp.url}`,
      message: `${edits} cümle iyileştirildi, ${entities.length} kavram eklendi ve sayfa yeniden yayınlandı. Önceki sıra: #${Math.round(sp.position)}. Etkisi 30 gün sonra otomatik ölçülür.`,
      url: sp.url,
      meta: { recoveryId: payload.recoveryId, entitiesAdded: entities },
    }).catch(() => null);
    if (site?.userId) {
      // ENH#4: 30 gun sonra performans olcumu — yalniz canliya giden duzeltme olculur
      await this.jobs.enqueue({
        type: 'STUCK_PAGE_PERFORMANCE_CHECK',
        userId: site.userId,
        siteId: sp.siteId,
        payload: { recoveryId: payload.recoveryId },
        delay: PERFORMANCE_CHECK_DELAY_MS,
        jobId: `stuck-perf-${payload.recoveryId}`,
      }).catch((e: any) => this.log.warn(`Performance check enqueue hatasi: ${e.message}`));
    }
    this.log.log(`[${payload.stuckPageId}] Recovery yayinda: sayfa RECOVERED`);
    return { ok: true, status: 'RECOVERED' };
  }

  /**
   * Yayinci hicbir sey yazmadi cunku musteri yaziyi sitede duzenlemis ya da
   * kayitli kimlik baska yaziyi gosteriyor. RanksUp musterinin metnini ezmez:
   *  - recover: metin geri alinir, kayit ONERI olarak kalir (silinmez), sayfa
   *    "Tespit edildi"ye doner — panel o kaydi "Öneri" gosterir.
   *  - revert: geri alma geri alinir, duzeltme yerinde kalir.
   * Yeniden denenmez: sonuc musteri yaziyi degistirene kadar ayni.
   */
  private async republishAsProposal(
    payload: StuckRepublishPayload,
    recovery: any,
    result: StuckRepublishTargetResult,
    rollback: StuckPublishRollback,
  ): Promise<StuckRepublishResult> {
    const cause = (typeof result.error === 'string' && result.error.trim()) || LIVE_EDIT_SKIPS.get(result.skipped ?? '') || '';
    if (payload.mode === 'revert') {
      await this.undoRevert(payload.recoveryId, payload.stuckPageId, payload.articleId, recovery.bodyMdBefore ?? '', recovery.bodyMdAfter ?? '');
      // Metin duzeltmeye dondu: yayincinin geri alinan (eski) metne gore koydugu isaretler de doner
      await this.rollbackEntryFlags(payload.articleId, rollback);
      this.log.warn(`[${payload.recoveryId}] Geri alma yayinlanmadi (${result.skipped}); duzeltme yerinde kaldi`);
      return { ok: false, status: 'FAILED', reason: `${cause} Geri alma uygulanmadı; düzeltme yerinde kaldı.` };
    }
    await this.restoreBody(payload.articleId, recovery.bodyMdAfter ?? '', recovery.bodyMdBefore ?? '');
    // Metin duzenlemeden onceki haline dondu: kopya hala RanksUp'in son yazdigi
    // metinle ayni izde; "eski surum yayinda" isareti yanlis olurdu (rollbackStuckEntryFlags)
    await this.rollbackEntryFlags(payload.articleId, rollback);
    await this.prisma.stuckPage.updateMany({ where: { id: payload.stuckPageId, status: 'RECOVERING' }, data: { status: 'DETECTED' } });
    this.log.warn(`[${payload.stuckPageId}] Duzenleme yayinlanmadi (${result.skipped}); oneri olarak kaydedildi`);
    return {
      ok: false,
      manual: true,
      status: 'DETECTED',
      reason: `${cause} Düzenleme öneri olarak kaydedildi, yazı değiştirilmedi; önerileri Takılı Sayfalar ekranında Detay'dan görüp sitendeki yazıya elle uygulayabilirsin.`,
    };
  }

  private async republishFailed(
    payload: StuckRepublishPayload,
    recovery: any,
    outcome: { anyLive: boolean; reason: string },
    rollback?: StuckPublishRollback,
  ): Promise<StuckRepublishResult> {
    if (payload.mode === 'revert') {
      if (!outcome.anyLive) {
        // Eski metin canliya hic gitmedi: panel yine canlidaki duzeltmeyi gostersin.
        // Geri alma yalniz yazi bodyMdAfter iken yapilir (revert): tiklamadan onceki metin budur
        await this.undoRevert(payload.recoveryId, payload.stuckPageId, payload.articleId, recovery.bodyMdBefore ?? '', recovery.bodyMdAfter ?? '');
        if (rollback) await this.rollbackEntryFlags(payload.articleId, rollback);
        this.log.warn(`[${payload.recoveryId}] Geri alma yayinlanamadi, duzeltme yerinde kaldi: ${outcome.reason}`);
        return { ok: false, status: 'FAILED', reason: outcome.reason };
      }
      this.log.warn(`[${payload.recoveryId}] Geri alma kismen yayinlandi: ${outcome.reason}`);
      return { ok: false, status: 'REVERTED', reason: outcome.reason };
    }
    if (!outcome.anyLive) {
      // Duzenleme hicbir hedefe gitmedi: metin geri alinir, kayit silinir (uygulanmamis
      // bir duzeltme "Son onarım" diye gorunmesin); kullanici yeniden deneyebilir.
      // Yayincinin atilan metne gore koydugu isaretler de yayindan onceki haline doner
      await this.restoreBody(payload.articleId, recovery.bodyMdAfter ?? '', recovery.bodyMdBefore ?? '');
      if (rollback) await this.rollbackEntryFlags(payload.articleId, rollback);
      await this.prisma.stuckPageRecovery.delete({ where: { id: payload.recoveryId } }).catch(() => undefined);
    }
    await this.markFailed(payload.stuckPageId);
    this.log.warn(`[${payload.stuckPageId}] Recovery yayinlanamadi (FAILED): ${outcome.reason}`);
    return { ok: false, status: 'FAILED', reason: outcome.reason };
  }

  // ─────────────────────────────────────────────────────────────
  //  LLM gap analizi + edit onerisi
  // ─────────────────────────────────────────────────────────────
  private async proposeEdits(input: {
    article: any;
    bodyMd: string;
    targetKeywords: string[];
    currentPosition: number;
    impressions: number;
    ctr: number;
  }): Promise<LlmRecoveryProposal | null> {
    if (!this.anthropic) return null;

    // Body cok uzunsa ilk ~12K karakter (token tasarrufu)
    const bodyTrimmed = input.bodyMd.length > 12000
      ? input.bodyMd.slice(0, 12000) + '\n\n[...truncated...]'
      : input.bodyMd;

    const targetsBlock = input.targetKeywords.length > 0
      ? input.targetKeywords.map((k) => `- ${k}`).join('\n')
      : '(GSC verisi yok — makale konusundan cikar)';

    const systemPrompt = `Sen Turkce SEO uzmanisin. Yayinda olan bir makale Google'da #${Math.round(input.currentPosition)}. siradadir — ilk sayfada ama top 3 degil. Gorevin:

1. Makaleyi okumak, eksik entity (KDV beyani, e-fatura, mali musavir gibi konuyla ilgili anahtar kavramlar) ve "thin section" tespit etmek
2. CUMLE-SEVIYESINDE oneri vermek — paragrafin tamamini yeniden yazma, sadece eksik kelimeleri DOGAL bicimde mevcut cumlelere ekle
3. Maksimum 1 yeni kisa paragraf onerebilirsin (sadece icerik gercekten thin ise)
4. Baslik, slug, H1, H2'lere DOKUNMA
5. Insani yaziyi koru — robotik ekleme yapma
6. JSON dondur, baska metin ekleme

Onerilerini Turkce yaz. Marka sesini koru.`;

    const userPrompt = `# Makale bilgileri
Baslik: ${input.article.title}
Mevcut pozisyon: #${Math.round(input.currentPosition)} (Google ilk sayfa, top 3 disi)
Son 30 gun: ${input.impressions} gosterim, CTR %${(input.ctr * 100).toFixed(2)}

# Hedef anahtar kelimeler (GSC top sorgular)
${targetsBlock}

# Makale govdesi (Markdown)
${bodyTrimmed}

# Cikti formati (STRICT JSON, baska metin yok)
{
  "diagnosis": "Bu sayfa neden stuck oldugunun 1-2 cumle ozet (entity gap mi, thin content mi, vs)",
  "edits": [
    {
      "type": "sentence_replace",
      "before": "ORJINAL CUMLE (makaleden BIREBIR kopyala)",
      "after": "EKSIK ENTITY DOGAL EKLENMIS YENI CUMLE",
      "reason": "Neden bu degisiklik (eklenen entity ile birlikte)",
      "entityAdded": "eklenen anahtar kavram"
    }
  ],
  "entitiesAdded": ["eklenen", "entity'ler", "listesi"],
  "paragraphAdded": null veya "Eger thin section varsa eklenen tek paragraf (max 80 kelime)",
  "entityScoreEstimate": 0-100 (degisikliklerden sonra tahmini entity skoru)
}

ONEMLI:
- "before" alani makaleden BIREBIR kopya olmali (kelime kelime). Aksi halde uygulanamaz.
- En fazla 6 edit oner. Asiri optimization zarar verir.
- "Highly Related Words" / "important entities" yoksa edits[] bos olabilir, bunu net soyle.`;

    try {
      const resp = await this.anthropic.messages.create({
        model: 'claude-sonnet-5',
        max_tokens: 4000,
        system: systemPrompt,
        messages: [{ role: 'user', content: userPrompt }],
      });

      const text = resp.content
        .filter((b: any) => b.type === 'text')
        .map((b: any) => b.text)
        .join('');
      const match = text.match(/\{[\s\S]*\}/);
      if (!match) {
        this.log.warn('LLM JSON cikti bulamadi');
        return null;
      }
      const parsed = safeParseJson(match[0]);
      if (!parsed || !Array.isArray(parsed.edits)) {
        this.log.warn('LLM cikti gecersiz format');
        return null;
      }
      return parsed as LlmRecoveryProposal;
    } catch (err: any) {
      this.log.error(`LLM hata: ${err.message}`);
      return null;
    }
  }

  // ─────────────────────────────────────────────────────────────
  //  Edit uygulama — find/replace + optional paragraph append
  // ─────────────────────────────────────────────────────────────
  private applyEdits(
    bodyMd: string,
    edits: ProposedEdit[],
    paragraphAdded: string | null,
  ): { bodyMdAfter: string; appliedEdits: ProposedEdit[]; skippedEdits: ProposedEdit[] } {
    let current = bodyMd;
    const applied: ProposedEdit[] = [];
    const skipped: ProposedEdit[] = [];

    for (const edit of edits) {
      if (edit.type !== 'sentence_replace' || !edit.before) {
        skipped.push(edit);
        continue;
      }
      if (!current.includes(edit.before)) {
        // LLM birebir kopya alamamis — atla
        skipped.push(edit);
        continue;
      }
      current = current.replace(edit.before, edit.after);
      applied.push(edit);
    }

    if (paragraphAdded && paragraphAdded.trim()) {
      // Sonuna ekle (sade — daha akilli yerlestirme Faz 2'de)
      current = current.trimEnd() + '\n\n' + paragraphAdded.trim() + '\n';
    }

    return { bodyMdAfter: current, appliedEdits: applied, skippedEdits: skipped };
  }

}

/**
 * Musteriye giden nedenlerde hedefin okunur adi: ham tur kodu ('WORDPRESS_REST')
 * panelde ve is sonucunda anlamsiz; republish-policy'deki etiket kullanilir.
 */
function resultTargetName(r: StuckRepublishTargetResult): string {
  return r.targetType ? targetLabel(r.targetType) : String(r.targetId ?? 'bilinmeyen hedef');
}

/** Yayinci eylem kodunun Turkce karsiligi (neden metinleri icin) */
function actionText(action: unknown): string {
  switch (action) {
    case 'updated': return 'yerinde güncellendi';
    case 'overwritten': return 'üzerine yazıldı';
    case 'created': return 'yeni kayıt açıldı';
    case 'recreated': return 'yeniden oluşturuldu';
    case 'exported': return 'dışa aktarıldı';
    default: return 'sonuç bilinmiyor';
  }
}

/** Yazildi ama yerinde degil (yayinci yeni kayit acti ya da eylemi bilinmiyor): kullaniciya neden */
function notInPlaceText(results: StuckRepublishTargetResult[]): string {
  const recreated = results.filter((r) => r.action === 'recreated');
  if (recreated.length > 0) {
    const where = recreated.map((r) => r.externalUrl ?? resultTargetName(r)).join(', ');
    return `Takılı sayfanın yazısı yayın hedefinde bulunamadı (silinmiş olabilir); yayıncı yazıyı yeni bir kayıt olarak yeniden oluşturdu (${where}). Takılı adres yerinde düzeltilmedi; sitende yinelenen bir kopya olup olmadığını kontrol et.`;
  }
  const where = results.map((r) => `${resultTargetName(r)}: ${actionText(r.action)}`).join(', ');
  return `Yeniden yayın takılı sayfayı yerinde güncellemedi (${where}); takılı adres düzeltilmedi.`;
}
