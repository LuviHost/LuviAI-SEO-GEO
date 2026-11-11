import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { NO_AUTO_ARTICLE_PLANS, articleOfferPlan, planHasArticles } from '../billing/plans.js';
import { JobQueueService } from '../jobs/job-queue.service.js';
import { QuotaService } from '../billing/quota.service.js';
import { autoPublishEnabled } from './publish-approval.js';
import { countUnchargedPendingArticles, hasAllowanceCharge, withAllowanceCharge } from './article-scheduler.service.js';
import { activeLiveWriteBlock, lastLiveWriteAt, liveEntries, republishModeForType, targetLabel } from './republish-policy.js';
import { rejectedRewriteAt } from './live-rewrite.js';
// Yayindaki yazinin TUM canli kopyalari yerinde guncellenebilir mi: takili sayfa
// akisiyla ayni kural (hedef basina karar republish-policy.ts decideRepublish)
import { planArticleRepublish, type RepublishBlock, type RepublishTargetRow } from '../audit/stuck-page-autopilot.js';

/**
 * Pivot planinin engelleri: takili sayfa planinin engelleri (RepublishBlock) ve
 *  - live_copy_pending: yeni metni alacak canli kopyalardan biri "elle guncelleme
 *    bekliyor" (manualUpdatePending): RanksUp'in son yayini oraya yazilmadi
 *    (WordPress'te degismis, kimlik tutmuyor ya da acik listede secilmemis).
 */
export type PivotPlanBlock = RepublishBlock | 'live_copy_pending';

export type PivotRewritePlan =
  | { kind: 'republish'; targetIds: string[]; targetTypes: string[] }
  | { kind: 'proposal'; block: PivotPlanBlock; labels: string[] };

/**
 * Otomatik yeniden yazim icin canli kopya plani. Takili sayfa planiyla
 * (planArticleRepublish) ayni kural, tek fark disa aktarim kayitlari: Markdown
 * ZIP canli siteye dokunmaz, yeniden uretilmesi kopya acmaz (decideRepublish
 * 'export', engel degil). WordPress'te yayindaki yazinin bir de ZIP'i
 * alinmissa pivot WordPress'i gunceller. Yazinin YALNIZ disa aktarim kaydi
 * varsa yeni metin hicbir canli sayfaya ulasamaz: engel (create_only).
 *
 * Yeni metni alacak kopyalardan biri "elle guncelleme bekliyor" ise yeniden yazim
 * baslamaz (live_copy_pending; takili sayfa planindaki live_copy_edited'in
 * karsiligi). NEDEN (S4): atlanan yayin kopyanin son yazim anini ilerletmez; yazi
 * her hafta bekleme suresinden cikiyor, 5 ajanli LLM yeniden yazimi kosuyor, yayin
 * yine atlaniyordu (Yari otomatikte her hafta yeni bir "onayini bekliyor" e-postasi).
 * Isaret "Elle güncelledim", "bu kaydi unut" ya da o kopyaya basarili yazimla kalkar.
 */
export function pivotRewritePlan(input: { publishedTo: unknown; targets: RepublishTargetRow[]; slug?: string | null }): PivotRewritePlan {
  const byId = new Map(input.targets.map((t) => [t.id, t]));
  const typeOf = (e: { targetId: string; targetType?: unknown }) => byId.get(e.targetId)?.type ?? e.targetType;
  const entries = liveEntries(input.publishedTo);
  const sitewide = entries.filter((e) => republishModeForType(typeOf(e)) !== 'export');
  if (entries.length > 0 && sitewide.length === 0) {
    return { kind: 'proposal', block: 'create_only', labels: [...new Set(entries.map((e) => targetLabel(typeOf(e))))] };
  }
  const plan = planArticleRepublish({ publishedTo: sitewide, targets: input.targets, slug: input.slug });
  if (plan.kind !== 'republish') return plan;
  const pending = sitewide.filter((e) => plan.targetIds.includes(e.targetId) && e.manualUpdatePending === true);
  if (pending.length > 0) {
    return { kind: 'proposal', block: 'live_copy_pending', labels: [...new Set(pending.map((e) => targetLabel(typeOf(e))))] };
  }
  return plan;
}

/**
 * Content Pivot — yayinlanmis makalelerden 30 gun gectikten sonra
 * performansa gore aksiyon kararlari verir:
 *
 *   1. Position 4-15 arasinda → on-page guclendirme (FAQ ekle, schema gozden gecir)
 *   2. CTR < 2%, impression > 500 → meta_title + meta_description yeniden yaz
 *   3. AI citation snapshot'larda 14 gundur alinti yok → makale yeniden yaz (revize cikti)
 *   4. Position > 30 ve impression > 100 → tamamen yeniden yaz (yeni angle)
 *
 * Cron: haftada 1 (Pazartesi 02:00 UTC, AI citation snapshot'tan once)
 *
 * VERI KAYNAGI (18.10.2026 dogrulandi): Article.performanceMetrics'i yalniz
 * gunluk GSC senkronu yazar (analytics.service updateArticleMetrics; site
 * Search Console'a bagli olmali). Deger TEK GUNUN sayilaridir (gunun ilk 50
 * sayfasi) ve makale URL'nin son parcasi slug'a esitse eslesir; dosya tabanli
 * hedeflerin (FTP/SFTP/cPanel) "<slug>.html" adresi eslesmez, o sitelerde
 * GSC kurallari tetiklenmez. AI atif kurali en az 7 OLCULEN GUN ister; olcum
 * haftada bir kullanici tetikli oldugundan su an tetiklenmez. Musteri
 * metinleri (faq, compare, about) bu kosullarla yazildi.
 *
 * YENIDEN YAZIM KAPILARI (otomatik yeniden yazim LLM butcesi harcar ve canli
 * yaziya dokunur):
 *  - Bekleme suresi SON canli yazimdan sayilir (lastLiveWriteAt ?? publishedAt).
 *    Yerinde guncelleme publishedAt'i ilerletmez (ilk yayin tarihi); eskiden
 *    tek bekleme "publishedAt 30 gunden eski" idi ve ayni canli yazi her hafta
 *    yeniden yazilirdi.
 *  - Yazinin TUM canli kopyalari yeni metni alabilmeli (pivotRewritePlan):
 *    yalniz yeni kayit acan hedef, kaydi adreslenemeyen WordPress yazisi,
 *    slug'i degismis dosya, silinmis / pasif hedef ya da hedefi kayitli
 *    olmayan yayin varsa yeniden yazim BASLAMAZ — yeni metin canliya
 *    ulasamazdi; tarama sonucunda nedeniyle raporlanir (blocked).
 *  - Yeni metni alacak canli kopyalardan biri "elle guncelleme bekliyor" ise
 *    (pivotRewritePlan live_copy_pending) yeniden yazim BASLAMAZ.
 *  - Son otomatik yeniden yazim editorden gecmediyse (pipeline kaydi ezmez,
 *    agentOutputs.rejectedRewrite yazar) 30 gun tekrar denenmez.
 *  - Son otomatik yayin hicbir canli kopyaya yazamadiysa (yayinci
 *    agentOutputs.liveWriteBlocked yazar; S4) ve o zamandan beri bir canli kopyaya
 *    yazilmadiysa 30 gun tekrar denenmez.
 *  - Ayni yazi ayni taramada bir kez isaretlenir (GSC kurali + AI kurali cift is acmaz).
 *
 * MAKALE HAKKI (sahip karari 11.11.2026): otomatik yeniden yazim, uretilen her makale
 * gibi aylik makale hakkindan BIR yazi duser. NEDEN: yeniden yazim butun 5 ajanli hatti
 * kosturur ama haktan dusmuyordu ve aylik tavani yoktu (yalniz yazi basina bekleme
 * suresi); cok eski yazisi olan hesap ayda onlarca ucretli yeniden yazimi bedavaya
 * tetikleyebiliyordu. Kurallar:
 *  - Hak, tarama isi kuyruga atarken tek kosullu UPDATE ile duser (chargeRewrite;
 *    article-scheduler chargeArticle ile ayni kalip). Sira taramanin sirasidir: kalan
 *    hakki listedeki ilk yazilar alir.
 *  - Hak dolduysa yeniden yazim BASLAMAZ, sonucta 'quota_exhausted' ile raporlanir.
 *    Bu bir deneme sayilmaz (hicbir bekleme kaydi yazilmaz): hak yenilenince sonraki
 *    haftalik tarama ayni yaziyi yeniden alir.
 *  - TAKVIME AYRILAN HAK KULLANILMAZ (bagimsiz inceleme, 11.11.2026): musterinin takvime
 *    ekledigi, hakki henuz dusulmemis yazilar kalan haktan ayrilmistir (takvim ekleme bunu
 *    sayar: article-scheduler scheduleTopic). Yeniden yazim yalniz ayrilmamis hakki kullanir;
 *    yoksa Pazartesi taramasi son 4 hakki alir, musterinin takvimdeki 4 konusu "hak doldu"
 *    diye ay sonuna kadar bekler ve "Üret" de 403 verirdi. Engel 'allowance_reserved'.
 *  - Dusus izi is verisindedir (allowanceCharge 'auto_rewrite'; yazi yayinda kaldigi
 *    icin agentOutputs'a yazilmaz — kapali dongu guncellemesiyle ayni tasiyici,
 *    allowance-refund.ts refundJobAllowanceCharge). Yeni surum cikmazsa hak TAM BIR KEZ
 *    geri verilir: is kuyruga girmedi (burada), worker isi atladi / on denetim engelledi
 *    / editorden gecmedi ve canli yazi korundu (worker, rewriteLeftNoNewVersion), hat son
 *    denemede hata verdi (worker catch).
 *  - Worker izsiz otomatik yeniden yazim isini kosturmaz (automatedRewriteBlock
 *    'allowance_not_charged'): hak dusulmeden kuyruga girmis is bedava LLM harcamasin.
 *  - ADMIN icin ayri muafiyet yok: makale hakki kodu (QuotaService.checkArticleQuota)
 *    rol ayirmaz.
 *
 * AYLIK AI BUTCESI (11.11.2026): sahibin aylik AI butcesi doluysa (QuotaService.aiBudgetBlock)
 * yeniden yazim BASLAMAZ ve hak dusmez ('budget_exhausted'). NEDEN burada da bakiliyor: uretim
 * hatti butcesi dolu sahibin yazisini zaten yazmaz (pipeline settleBudgetBlocked) ve worker
 * hakki geri verir; tarama bunu bilmezse her hafta hak dusup is acar, hat reddeder, hak iade
 * edilir. Hak dolu engeli gibi deneme sayilmaz (bekleme kaydi yazilmaz): butce yenilenince
 * sonraki haftalik tarama ayni yaziyi alir. Butce okunamazsa tarama durmaz (karar hatta kalir).
 */

/**
 * Bekleme suresi: son canli yazimdan ya da reddedilen / engellenen denemeden bu kadar gun sonra.
 * 30 → 60 (08.11.2026 kanit denetimi): Google baslik/icerik degisikliginin etkisinin "gunler ya da haftalar"
 * surdugunu ve iyi giden sayfada radikal degisiklik yapilmamasini soyluyor; ayni sayfayi ayda bir bastan
 * yazmak etkiyi olcmeden yeniden degistirmek demekti.
 */
export const PIVOT_COOLDOWN_DAYS = 60;

/**
 * Google'da ilk 15'te gorunen yazi BASTAN YENIDEN YAZILMAZ (08.11.2026 kanit denetimi).
 * NEDEN: pivot yaziyi ayni konuyla bastan uretiyor (meta degil, tum govde). Google: "we recommend avoiding
 * making radical changes if your page is already performing well" (debugging-search-traffic-drops). Ilk
 * 15'teki yazinin kucuk iyilestirmesi Takili Sayfalar akisinin isi (en cok 6 cumle + 1 paragraf, 30 gun
 * bekleme, 30 gun sonra etki olcumu).
 */
export const PIVOT_SIRALANAN_UST_SINIR = 15;
export function siralananYazi(metrics: unknown): boolean {
  const m = (metrics ?? {}) as { position?: unknown; impressions?: unknown };
  const position = Number(m.position ?? 0);
  const impressions = Number(m.impressions ?? 0);
  return impressions > 0 && position >= 1 && position <= PIVOT_SIRALANAN_UST_SINIR;
}
/** Aday okuma penceresi: bekleme suresindekiler elendikten sonra ilk PIVOT_SCAN_LIMIT incelenir */
export const PIVOT_CANDIDATE_WINDOW = 200;
/** Site basina incelenen yazi sayisi (eskisi gibi) */
export const PIVOT_SCAN_LIMIT = 50;
/** scanAllSites sonucunda tasinan engelli yazi ayrintisi tavani (is sonucu kucuk kalsin) */
const BLOCKED_DETAIL_CAP = 100;

export type PivotBlock =
  | PivotPlanBlock | 'recent_rejected_rewrite' | 'recent_live_write_blocked' | 'not_published' | 'trial_plan' | 'no_article_plan'
  /** Bu ayki makale hakki dolu: yeniden yazim baslamadi, hak yenilenince sonraki tarama alir (11.11.2026) */
  | 'quota_exhausted'
  /** Is verisinde hak dusus izi yok (hak dusulmeden kuyruga girmis is): worker kosturmaz */
  | 'allowance_not_charged'
  /** Sahibin aylik AI butcesi dolu: yeniden yazim baslamadi, hak dusmedi; butce yenilenince sonraki tarama alir (11.11.2026) */
  | 'budget_exhausted'
  /** Kalan makale hakki takvimde bekleyen yazilara ayrili: yeniden yazim o hakki kullanmaz (11.11.2026) */
  | 'allowance_reserved';

/** Otomatik yazim engelinin bekleme suresinde mi (yoksa null); kaydin ani ve atlanan hedeflerin adlari */
function recentLiveWriteBlock(agentOutputs: unknown, publishedTo: unknown, cutoff: Date): { at: Date; labels: string[] } | null {
  const block = activeLiveWriteBlock(agentOutputs, publishedTo);
  if (!block || block.at.getTime() <= cutoff.getTime()) return null;
  return { at: block.at, labels: [...new Set(block.reasons.map((r) => targetLabel(r.targetType)))] };
}

export interface PivotFlag {
  articleId: string;
  reason: string;
  pivotTopic: string;
  severity: 'low' | 'medium' | 'high';
}

/** Yeniden yazilmak istenen ama yazilmayan yazi: neden (Turkce) ile */
export interface PivotBlocked {
  articleId: string;
  /** Pivotun yeniden yazmak istemesinin nedeni (kural) */
  reason: string;
  block: PivotBlock;
  /** Neden baslatilmadi (Turkce) */
  blockReason: string;
}

/** Otomatik yeniden yazim neden baslatilmadi (Turkce; is sonucu ve log) */
export function pivotBlockText(block: PivotBlock, labels: string[] = [], at?: Date | null): string {
  const where = labels.join(', ') || 'yayın hedefi';
  switch (block) {
    case 'create_only':
      return `Yazının yayında olduğu hedef (${where}) mevcut yazıyı yerinde güncelleyemiyor; yeni metin yayındaki sayfaya ulaşamayacağı için otomatik yeniden yazım başlatılmadı.`;
    case 'unaddressable':
      return `Yazının yayında olduğu hedefte (${where}) mevcut yazının kimliği ya da adresi kayıtlı değil; yeni metin yerinde güncellenemeyeceği için otomatik yeniden yazım başlatılmadı.`;
    case 'slug_changed':
      return `Yazının adresi ilk yayından sonra değişmiş; ${where} hedefindeki sayfa yeni metinle güncellenemeyeceği için otomatik yeniden yazım başlatılmadı.`;
    case 'target_missing':
      return `Yazının yayında olduğu yayın hedeflerinden biri (${where}) silinmiş ya da pasif; oradaki kopya güncellenemeyeceği için otomatik yeniden yazım başlatılmadı.`;
    case 'unknown_location':
      return 'Yazının hangi yayın hedefinde yayında olduğu kayıtlı değil; yeni metin yanlış yerde yeni bir sayfa açabileceği için otomatik yeniden yazım başlatılmadı.';
    case 'live_copy_pending':
      return `Yazının yayında olduğu hedefteki kopya (${where}) elle güncelleme bekliyor: RanksUp'ın son yayını oraya yazılmadı (kopya orada değiştirilmiş, kayıtlı kimlik bu yazıya ait değil ya da yayında o hedef seçilmemiş olabilir). Kopyanın durumu netleşmeden (yazının sayfasından yeniden yayın ya da "Elle güncelledim") otomatik yeniden yazım başlatılmadı.`;
    case 'recent_rejected_rewrite':
      return `Son otomatik yeniden yazım${at ? ` (${at.toISOString().slice(0, 10)})` : ''} editör kontrolünden geçmedi, yayındaki metin korundu; yeni deneme ${PIVOT_COOLDOWN_DAYS} gün sonra.`;
    case 'recent_live_write_blocked':
      return `Son otomatik yayın${at ? ` (${at.toISOString().slice(0, 10)})` : ''} yazının canlı kopyalarına (${where}) yazılamadı ve o zamandan beri bir kopyaya yazılmadı; engel sürerken yeni bir yeniden yazım da yayına ulaşmayacağı için otomatik yeniden yazım ${PIVOT_COOLDOWN_DAYS} gün denenmez.`;
    case 'not_published':
      return 'Yazı artık yayında değil; otomatik yeniden yazım başlatılmadı.';
    case 'trial_plan':
      return 'Ücretsiz deneme hesabında otomatik yeniden yazım yapılmaz (denemede yapay zekâ toplam 2 makale üretir); planını yükselttiğinde başlar.';
    case 'no_article_plan':
      return `Bu pakette makale üretimi yok; otomatik yeniden yazım ${articleOfferPlan().name_tr} ve üzeri planlarda çalışır.`;
    case 'quota_exhausted':
      return 'Bu ayki makale hakkın doldu; otomatik yeniden yazım da makale hakkından bir makale düştüğü için başlatılmadı. Hak yeni ayda ya da planını yükselttiğinde yenilenir; yazı sonraki haftalık taramada yeniden değerlendirilir.';
    case 'allowance_not_charged':
      return 'Bu otomatik yeniden yazım işi için makale hakkı düşülmemiş; iş çalıştırılmadı. Yazı sonraki haftalık taramada yeniden değerlendirilir.';
    case 'allowance_reserved':
      return 'Kalan makale hakkın takvimde üretilmeyi bekleyen yazılarına ayrılı; otomatik yeniden yazım o hakkı kullanmaz. Hak yeni ayda ya da planını yükselttiğinde yenilenir; yazı sonraki haftalık taramada yeniden değerlendirilir.';
    case 'budget_exhausted':
      return 'Aylık AI kullanım bütçen doldu; otomatik yeniden yazım başlatılmadı ve makale hakkından düşülmedi. Bütçe yeni ayın başında sıfırlanır; yazı sonraki haftalık taramada yeniden değerlendirilir.';
  }
}

/**
 * Otomatik yeniden yazim isi YENI SURUM CIKARMADAN mi dondu (worker GENERATE_ARTICLE sonucu):
 * is atlandi (skipped: uretim kapali, yazi silinmis, on denetim engelledi) ya da editorden
 * gecmedi ve canli yazi korundu (liveKept; AI kapaliyken sahte hat da buraya duser).
 * Worker bu durumda taramada dusulen makale hakkini geri verir (dosya basi MAKALE HAKKI).
 * Kullanicinin baslattigi isler (automatedRewrite yok) burada HIC true donmez: onlarin
 * iadesi kendi yollarindadir (allowance-refund.ts), davranislari degismedi.
 * Hata ile biten is buraya gelmez (sonuc yok); son denemenin iadesi worker'in catch'inde.
 */
export function rewriteLeftNoNewVersion(jobData: unknown, result: unknown): boolean {
  if ((jobData as { automatedRewrite?: unknown } | null | undefined)?.automatedRewrite !== true) return false;
  const r = result as { skipped?: unknown; liveKept?: unknown } | null | undefined;
  return r?.skipped === true || r?.liveKept === true;
}

@Injectable()
export class ContentPivotService {
  private readonly log = new Logger(ContentPivotService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jobQueue: JobQueueService,
    private readonly quota: QuotaService,
  ) {}

  async scanAllSites(): Promise<{
    scanned: number;
    /** Yeniden yazimi baslatilabilecek yazilar (akis kapali sitede kuyruga girmez) */
    flagged: number;
    queued: number;
    /**
     * Ek alan: yeniden yazilmak istenip baslatilmayanlar — canli kopyalari yeni metni
     * alamiyor, bekleme suresinde ya da (akis acik sitede) bu ayki makale hakki / aylik
     * AI butcesi dolu.
     */
    blocked: number;
    blockedDetails: Array<PivotBlocked & { siteId: string }>;
  }> {
    const sites = await this.prisma.site.findMany({
      where: {
        status: { in: ['ACTIVE', 'AUDIT_COMPLETE'] as any[] },
        // Deneme hesabi taranmaz: denemede otomasyon makale uretmez (trial-policy.ts);
        // hesap yapay zekayla toplam 2 makaleyi kendi baslatir (QuotaService LIMITS.TRIAL),
        // otomatik yeniden yazim o hakki kullanicinin haberi olmadan harcamasin. Eskiden
        // 30 gunluk deneme yazilari her hafta yeniden yazilabiliyordu.
        // 11.11.2026 (uc paket): makale uretimi olmayan plan (Baslangic) da taranmaz —
        // plans.ts NO_AUTO_ARTICLE_PLANS (deneme + aylik makale hakki olmayan planlar).
        user: { plan: { notIn: NO_AUTO_ARTICLE_PLANS as any[] } },
      },
      select: { id: true, userId: true, autopilot: true, publishApprovalMode: true },
    });

    let scanned = 0;
    let flagged = 0;
    let queued = 0;
    let blocked = 0;
    const blockedDetails: Array<PivotBlocked & { siteId: string }> = [];
    // Kullanici basina tek hak okumasi (ay basi sifirlamasi dahil): plan hakki (tavan)
    // ya da null = bu taramada hakki dolu. Hak hesap basina: ayni kullanicinin sonraki
    // sitelerindeki yazilar da ayni tavana karsi duser.
    const limitByUser = new Map<string, number | null>();
    // Kalan hakki takvimde bekleyen yazilara ayrili kullanicilar (chargeRewrite doldurur)
    const hakkiAyrilmis = new Set<string>();
    // Kullanici basina tek butce okumasi: true = aylik AI butcesi dolu (dosya basi AYLIK AI BUTCESI)
    const butceByUser = new Map<string, boolean>();

    for (const site of sites) {
      try {
        const r = await this.scanSite(site.id);
        scanned += r.scanned;
        flagged += r.flagged.length;
        blocked += r.blocked.length;
        for (const b of r.blocked) {
          this.log.log(`[${site.id}] pivot: ${b.articleId} yeniden yazılmadı (${b.block}) — ${b.blockReason}`);
          if (blockedDetails.length < BLOCKED_DETAIL_CAP) blockedDetails.push({ siteId: site.id, ...b });
        }
        // Otopilot ON ise pivot'lari otomatik kuyruga at
        if ((site as any).autopilot) {
          // Yeniden yazilan yazi yalniz Tam otomatikte onaysiz yayinlanir.
          // Yari otomatikte (varsayilan) READY_TO_PUBLISH'te kalir: pipeline
          // "onayini bekliyor" e-postasini atar, kullanici yazinin sayfasindan
          // yayinlar (publish-approval.ts). Eskiden her zaman true'ydu.
          const autoPublish = autoPublishEnabled(site);
          for (const f of r.flagged) {
            // Aylik AI butcesi: doluysa hak dusulmeden once durur (dosya basi AYLIK AI BUTCESI)
            let butceDolu = butceByUser.get(site.userId);
            if (butceDolu === undefined) {
              butceDolu = (await this.quota.aiBudgetBlock(site.userId)) !== null;
              butceByUser.set(site.userId, butceDolu);
            }
            if (butceDolu) {
              const b: PivotBlocked = { articleId: f.articleId, reason: f.reason, block: 'budget_exhausted', blockReason: pivotBlockText('budget_exhausted') };
              flagged--;
              blocked++;
              this.log.log(`[${site.id}] pivot: ${b.articleId} yeniden yazılmadı (${b.block}) — ${b.blockReason}`);
              if (blockedDetails.length < BLOCKED_DETAIL_CAP) blockedDetails.push({ siteId: site.id, ...b });
              continue;
            }
            // Makale hakki: yeniden yazim bir makale sayilir (dosya basi MAKALE HAKKI).
            // Hak dolduysa is acilmaz; engel olarak raporlanir ve hicbir bekleme kaydi
            // yazilmaz (sonraki tarama, hak yenilendiyse, ayni yaziyi yeniden alir).
            if (!(await this.chargeRewrite(site.userId, limitByUser, hakkiAyrilmis))) {
              const block: PivotBlock = hakkiAyrilmis.has(site.userId) ? 'allowance_reserved' : 'quota_exhausted';
              const b: PivotBlocked = { articleId: f.articleId, reason: f.reason, block, blockReason: pivotBlockText(block) };
              flagged--;
              blocked++;
              this.log.log(`[${site.id}] pivot: ${b.articleId} yeniden yazılmadı (${b.block}) — ${b.blockReason}`);
              if (blockedDetails.length < BLOCKED_DETAIL_CAP) blockedDetails.push({ siteId: site.id, ...b });
              continue;
            }
            try {
              await this.jobQueue.enqueue({
                type: 'GENERATE_ARTICLE',
                userId: site.userId,
                siteId: site.id,
                payload: {
                  siteId: site.id,
                  topic: f.pivotTopic,
                  articleId: f.articleId, // var olan kayit overwrite
                  skipImages: true,
                  autoPublish,
                  pivotReason: f.reason,
                  // OTOMATIK yeniden yazim: editor PASS vermezse pipeline yayindaki
                  // kaydi ezmez; worker uretimden once canli kopyalari yeniden denetler.
                  // Kullanicinin baslattigi akislar (kapali dongu, "Şimdi üret") koymaz.
                  automatedRewrite: true,
                  // Hakkin dusus izi (allowanceCharge): yeni surum cikmazsa worker hakki
                  // bu iz uzerinden TAM BIR KEZ geri verir (allowance-refund.ts)
                  ...withAllowanceCharge(null, 'auto_rewrite', new Date()),
                } as any,
              });
            } catch (err) {
              // Is kuyruga girmedi: dusulen hak geri verilir (uretilmeyen yazi haktan
              // dusmus kalmasin). Hata sitenin taramasini eskisi gibi keser (asagidaki catch).
              await this.quota.refundArticleAllowance(site.userId);
              throw err;
            }
            queued++;
          }
        }
      } catch (err: any) {
        this.log.warn(`[${site.id}] pivot scan fail: ${err.message}`);
      }
    }

    this.log.log(`Content pivot: ${sites.length} site, ${scanned} makale incelendi, ${flagged} flag, ${queued} kuyruga eklendi, ${blocked} yeniden yazilamaz`);
    return { scanned, flagged, queued, blocked, blockedDetails };
  }

  /**
   * Otomatik yeniden yazim icin makale hakkindan BIR yazi dus — yalniz sayac planin
   * hakkinin altindaysa (tek kosullu UPDATE: `articlesUsedThisMonth < hak`). Dusulduyse true.
   *
   * article-scheduler chargeArticle ile AYNI kalip: kosul ve artis tek SQL'de calisir,
   * ayni kullanicinin son hakkini ayni anda isteyen iki yol (bu tarama + saatlik takvim
   * taramasi + kullanicinin "Üret"i) birlikte gecemez. Tavan kullanici basina bir kez
   * okunur (checkArticleQuota ay basi sifirlamasini da yapar); UPDATE reddederse kullanici
   * bu taramanin geri kalaninda dolu sayilir (sonraki yazilari icin sorgu atilmaz).
   * Hak okunamazsa hata firlar: sitenin taramasi kesilir, hicbir is acilmaz (takvim
   * taramasi gibi kapali taraf — okunamayan hakla LLM harcanmaz), sonraki hafta yeniden denenir.
   *
   * Tavan, planin hakkindan TAKVIMDE BEKLEYEN (hakki henuz dusulmemis) yazilar dusulerek
   * hesaplanir (dosya basi: takvime ayrilan hak kullanilmaz). Kalan hak tumuyle ayriliysa
   * kullanici `reserved` kumesine yazilir: cagiran engeli 'allowance_reserved' diye raporlar.
   */
  private async chargeRewrite(userId: string, limits: Map<string, number | null>, reserved: Set<string>): Promise<boolean> {
    let limit = limits.get(userId);
    if (limit === undefined) {
      const q = await this.quota.checkArticleQuota(userId);
      const waiting = q.allowed ? await countUnchargedPendingArticles(this.prisma as any, userId) : 0;
      limit = q.allowed ? q.limit - waiting : null;
      // Ayrilan yazi varsa bu taramada tavana carpmak "hak doldu" degil "kalan hak ayrili"dir
      if (waiting > 0) reserved.add(userId);
      limits.set(userId, limit);
    }
    if (limit === null) return false;
    const r = await this.prisma.user.updateMany({
      where: { id: userId, articlesUsedThisMonth: { lt: limit } },
      data: { articlesUsedThisMonth: { increment: 1 } },
    });
    if (r.count === 1) return true;
    limits.set(userId, null);
    return false;
  }

  /**
   * Tek bir site icin pivot taramasi.
   */
  async scanSite(siteId: string): Promise<{
    scanned: number;
    flagged: PivotFlag[];
    /** Ek alan: kural tetiklendi ama yeniden yazim baslatilmayacak yazilar (neden ile) */
    blocked: PivotBlocked[];
  }> {
    const cutoff = new Date(Date.now() - PIVOT_COOLDOWN_DAYS * 86400000);
    // publishedAt <= cutoff ON SUZGEC: son canli yazim ilk yayindan eski olamaz,
    // ilk yayini yeni yazi zaten bekleme suresinde. Asil bekleme asagida, son
    // canli yazimdan (publishedTo updatedAt) — JSON icinde, sorguda suzulemiyor;
    // pencere bekleyenler elendikten sonra da PIVOT_SCAN_LIMIT aday birakabilsin
    // diye genis okunur (govde / ajan ciktilari okunmaz).
    const candidates = await this.prisma.article.findMany({
      where: {
        siteId,
        status: 'PUBLISHED' as any,
        publishedAt: { lte: cutoff },
      },
      select: {
        id: true,
        slug: true,
        topic: true,
        title: true,
        publishedAt: true,
        publishedTo: true,
        performanceMetrics: true,
        performanceCheckedAt: true,
      },
      take: PIVOT_CANDIDATE_WINDOW,
    });
    const articles = candidates
      .filter((a) => {
        const last = lastLiveWriteAt(a.publishedTo) ?? a.publishedAt;
        return !last || last.getTime() <= cutoff.getTime();
      })
      .slice(0, PIVOT_SCAN_LIMIT);

    // Canli kopyalarin hedefleri: yazi basina karar icin bir kez okunur (kimlik bilgisi okunmaz)
    const targets: RepublishTargetRow[] = articles.length > 0
      ? await this.prisma.publishTarget.findMany({ where: { siteId }, select: { id: true, type: true, isActive: true } })
      : [];
    const planOf = (a: (typeof articles)[number]) => pivotRewritePlan({ publishedTo: a.publishedTo, targets, slug: a.slug });

    const hits: Array<{ article: (typeof articles)[number]; reason: string; severity: PivotFlag['severity'] }> = [];

    for (const a of articles) {
      const metrics: any = a.performanceMetrics ?? {};
      const impressions = Number(metrics.impressions ?? 0);
      const clicks = Number(metrics.clicks ?? 0);
      const ctr = impressions > 0 ? clicks / impressions : 0;
      const position = Number(metrics.position ?? 0);

      // Ilk 15'teki yazi bastan yazilmaz (bkz. siralananYazi); eskiden kural 1 ve 2 tam da bunlari yeniden
      // uretiyordu. Kucuk iyilestirme Takili Sayfalar'da.
      if (siralananYazi(metrics)) continue;

      // 1) Yuksek impression dusuk CTR (ilk 15 disinda)
      if (impressions > 500 && ctr < 0.02) {
        hits.push({
          article: a,
          reason: `Imp=${impressions}, CTR=${(ctr * 100).toFixed(1)}% (cok dusuk) — meta_title + meta_description yenile`,
          severity: 'medium',
        });
        continue;
      }

      // 3) Position > 30 ama imp > 100 — tamamen yeni angle
      if (position > 30 && impressions > 100) {
        hits.push({
          article: a,
          reason: `Position=${position.toFixed(1)} (cok gerilerde) — yeni angle ile tamamen yeniden yaz`,
          severity: 'high',
        });
        continue;
      }
    }

    // 4) AI citation drop kontrol — son 14 gun her gun yok ise flag
    const since = new Date(Date.now() - 14 * 86400000);
    since.setHours(0, 0, 0, 0);
    const recentSnapshots = await this.prisma.aiCitationSnapshot.findMany({
      where: { siteId, date: { gte: since } },
      select: { date: true, score: true, citedCount: true },
    });
    // score=null "markasiz sorgu olculemedi" demek — 0 sayilirsa hic
    // olculmemis site "14 gundur sifir" diye yuksek oncelikli yeniden-yazma
    // bayragi yer. Karar yalniz GERCEKTEN skorlanmis gunlerden verilir.
    const scoredSnapshots = recentSnapshots.filter((s) => s.score !== null);
    // Esik OLCULEN GUN sayisidir, satir degil: snapshot (site, gun, SAGLAYICI)
    // basina bir satir, tek olcum 6 saglayiciyla 6 satir yazar. Satir sayilinca
    // iki haftalik olcum (12 satir) ">= 7" kosulunu sagliyor, iki veri
    // noktasiyla "14 gundur sifir" denip rastgele bir eski makale yeniden
    // yaziliyordu (Tam otomatikte yeniden yayinlaniyordu). Gunluk otomatik
    // olcum kapaliyken (haftada bir kullanici tetikli) kural tetiklenmez.
    const scoredDays = new Set(scoredSnapshots.map((s) => new Date(s.date).toISOString().slice(0, 10)));
    if (scoredDays.size >= 7) {
      const totalCited = scoredSnapshots.reduce((a, s) => a + s.citedCount, 0);
      const avgScore = scoredSnapshots.reduce((a, s) => a + (s.score as number), 0) / scoredSnapshots.length;
      if (totalCited === 0 && avgScore < 20) {
        // Tum site icin "AI gorunurluk dusuk" flag — pillar makaleye pivot.
        // Pillar: canli kopyalari yeni metni alabilen ilk yazi; zaten bir GSC
        // kuraliyla isaretli yazi ikinci kez is almaz (eskiden articles[0] hem
        // GSC hem AI kuraliyla iki ayri yeniden yazim isi aliyordu).
        const hitIds = new Set(hits.map((h) => h.article.id));
        // Google'da ilk 15'teki yazi AI gorunurlugu icin de bastan yazilmaz (Google sirasini riske atmayalim)
        const aday = (a: (typeof articles)[number]) => !hitIds.has(a.id) && !siralananYazi(a.performanceMetrics);
        const pillar = articles.find((a) => aday(a) && planOf(a).kind === 'republish')
          ?? articles.find((a) => aday(a));
        if (pillar) {
          hits.push({
            article: pillar,
            reason: `AI citation 14 gundur sifir, ortalama skor ${avgScore.toFixed(0)}/100 — pillar makaleyi GEO odakli yeniden yaz`,
            severity: 'high',
          });
        }
      }
    }

    const flagged: PivotFlag[] = [];
    const blocked: PivotBlocked[] = [];
    for (const h of hits) {
      const plan = planOf(h.article);
      if (plan.kind === 'proposal') {
        blocked.push({ articleId: h.article.id, reason: h.reason, block: plan.block, blockReason: pivotBlockText(plan.block, plan.labels) });
        continue;
      }
      flagged.push({ articleId: h.article.id, reason: h.reason, pivotTopic: h.article.topic, severity: h.severity });
    }

    // Son otomatik yeniden yazim editorden gecmediyse ya da son otomatik yayin
    // hicbir canli kopyaya yazamadiysa (S4) bekleme suresi dolmadan tekrar
    // denenmez. Ajan ciktilari agir: yalniz isaretli birkac yazi icin okunur.
    if (flagged.length > 0) {
      const rows = await this.prisma.article.findMany({
        where: { id: { in: flagged.map((f) => f.articleId) } },
        select: { id: true, agentOutputs: true },
      });
      const outputsOf = new Map(rows.map((r) => [r.id, r.agentOutputs]));
      const publishedToOf = new Map(articles.map((a) => [a.id, a.publishedTo]));
      for (let i = flagged.length - 1; i >= 0; i--) {
        const id = flagged[i].articleId;
        const rejectedAt = rejectedRewriteAt(outputsOf.get(id));
        if (rejectedAt && rejectedAt.getTime() > cutoff.getTime()) {
          const [f] = flagged.splice(i, 1);
          blocked.push({ articleId: f.articleId, reason: f.reason, block: 'recent_rejected_rewrite', blockReason: pivotBlockText('recent_rejected_rewrite', [], rejectedAt) });
          continue;
        }
        const writeBlock = recentLiveWriteBlock(outputsOf.get(id), publishedToOf.get(id), cutoff);
        if (writeBlock) {
          const [f] = flagged.splice(i, 1);
          blocked.push({ articleId: f.articleId, reason: f.reason, block: 'recent_live_write_blocked', blockReason: pivotBlockText('recent_live_write_blocked', writeBlock.labels, writeBlock.at) });
        }
      }
    }

    return { scanned: articles.length, flagged, blocked };
  }

  /**
   * Worker, otomatik yeniden yazim isini (automatedRewrite) kosmadan once
   * cagirir: tarama ile is arasinda yazi yayindan kalkmis, hedefi silinmis ya
   * da pasiflestirilmis, bir kopyasi "elle guncelleme bekliyor" olmus ya da ayni
   * yazinin onceki otomatik yayini engellenmis olabilir (isler tekillestirilmez:
   * ikinci is ilkinin engellenen yayinindan sonra kosabilir). Yeniden yazim
   * baslayamazsa nedeni, aksi halde null. LLM butcesi harcanmadan doner.
   *
   * @param jobData Worker isin verisini (job.data) gecirir: otomatik yeniden yazim makale
   *   hakkindan duser ve izi is verisindedir (dosya basi MAKALE HAKKI). Iz yoksa is
   *   kosmaz ('allowance_not_charged') — bu kural devreye girmeden once kuyruga girmis
   *   ya da hak dusmeden acilmis bir is 5 ajanli hatti bedavaya kosturmasin. Verilmezse
   *   (worker disi cagri) iz denetlenmez.
   */
  async automatedRewriteBlock(articleId: string, jobData?: unknown): Promise<{ block: PivotBlock; blockReason: string } | null> {
    if (jobData !== undefined && !hasAllowanceCharge(jobData)) {
      return { block: 'allowance_not_charged', blockReason: pivotBlockText('allowance_not_charged') };
    }
    const a = await this.prisma.article.findUnique({
      where: { id: articleId },
      select: { siteId: true, slug: true, status: true, publishedTo: true, agentOutputs: true, site: { select: { user: { select: { plan: true } } } } },
    });
    if (!a || String(a.status) !== 'PUBLISHED') return { block: 'not_published', blockReason: pivotBlockText('not_published') };
    // Is kuyruga girdikten sonra plan deneme hesabina dusmus olabilir (iptal, odeme
    // alinamadi): tarama artik almaz, kuyruktaki is de LLM harcamaz
    if (String((a as { site?: { user?: { plan?: unknown } | null } | null }).site?.user?.plan ?? '') === 'TRIAL') {
      return { block: 'trial_plan', blockReason: pivotBlockText('trial_plan') };
    }
    // Makale uretimi olmayan plana (Baslangic) dusmus hesap: kuyruktaki is de LLM harcamaz
    if (!planHasArticles(String((a as { site?: { user?: { plan?: unknown } | null } | null }).site?.user?.plan ?? ''))) {
      return { block: 'no_article_plan', blockReason: pivotBlockText('no_article_plan') };
    }
    const targets = await this.prisma.publishTarget.findMany({ where: { siteId: a.siteId }, select: { id: true, type: true, isActive: true } });
    const plan = pivotRewritePlan({ publishedTo: a.publishedTo, targets, slug: a.slug });
    if (plan.kind !== 'republish') return { block: plan.block, blockReason: pivotBlockText(plan.block, plan.labels) };
    const cutoff = new Date(Date.now() - PIVOT_COOLDOWN_DAYS * 86400000);
    const writeBlock = recentLiveWriteBlock(a.agentOutputs, a.publishedTo, cutoff);
    return writeBlock
      ? { block: 'recent_live_write_blocked', blockReason: pivotBlockText('recent_live_write_blocked', writeBlock.labels, writeBlock.at) }
      : null;
  }
}
