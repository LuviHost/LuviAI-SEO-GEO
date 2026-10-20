import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { JobQueueService } from '../jobs/job-queue.service.js';
import { autoPublishEnabled } from './publish-approval.js';
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
 */

/** Bekleme suresi: son canli yazimdan ya da reddedilen / engellenen denemeden bu kadar gun sonra */
export const PIVOT_COOLDOWN_DAYS = 30;
/** Aday okuma penceresi: bekleme suresindekiler elendikten sonra ilk PIVOT_SCAN_LIMIT incelenir */
export const PIVOT_CANDIDATE_WINDOW = 200;
/** Site basina incelenen yazi sayisi (eskisi gibi) */
export const PIVOT_SCAN_LIMIT = 50;
/** scanAllSites sonucunda tasinan engelli yazi ayrintisi tavani (is sonucu kucuk kalsin) */
const BLOCKED_DETAIL_CAP = 100;

export type PivotBlock = PivotPlanBlock | 'recent_rejected_rewrite' | 'recent_live_write_blocked' | 'not_published' | 'trial_plan';

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
  }
}

@Injectable()
export class ContentPivotService {
  private readonly log = new Logger(ContentPivotService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jobQueue: JobQueueService,
  ) {}

  async scanAllSites(): Promise<{
    scanned: number;
    flagged: number;
    queued: number;
    /** Ek alan: yeniden yazilmak istenip canli kopyalari yeni metni alamadigi icin baslatilmayanlar */
    blocked: number;
    blockedDetails: Array<PivotBlocked & { siteId: string }>;
  }> {
    const sites = await this.prisma.site.findMany({
      where: {
        status: { in: ['ACTIVE', 'AUDIT_COMPLETE'] as any[] },
        // Deneme hesabi taranmaz: yeniden yazim 5 ajanli LLM hattidir ve makale
        // hakkindan dusmez; deneme hesabi yapay zekayla toplam 2 makale uretir
        // (QuotaService LIMITS.TRIAL), fazlasina LLM harcanmaz. Eskiden 30 gunluk
        // deneme yazilari her hafta yeniden yazilabiliyordu.
        user: { plan: { not: 'TRIAL' as any } },
      },
      select: { id: true, userId: true, autopilot: true, publishApprovalMode: true },
    });

    let scanned = 0;
    let flagged = 0;
    let queued = 0;
    let blocked = 0;
    const blockedDetails: Array<PivotBlocked & { siteId: string }> = [];

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
              } as any,
            });
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

      // 1) Yuksek impression dusuk CTR — meta yeniden yaz
      if (impressions > 500 && ctr < 0.02) {
        hits.push({
          article: a,
          reason: `Imp=${impressions}, CTR=${(ctr * 100).toFixed(1)}% (cok dusuk) — meta_title + meta_description yenile`,
          severity: 'medium',
        });
        continue;
      }

      // 2) Position 4-15 — on-page guclendirme (FAQ + schema)
      if (position >= 4 && position <= 15 && impressions > 100) {
        hits.push({
          article: a,
          reason: `Position=${position.toFixed(1)} (1.sayfa esiginde) — FAQ ekle + schema'yi gozden gecir`,
          severity: 'low',
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
        const pillar = articles.find((a) => !hitIds.has(a.id) && planOf(a).kind === 'republish')
          ?? articles.find((a) => !hitIds.has(a.id));
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
   */
  async automatedRewriteBlock(articleId: string): Promise<{ block: PivotBlock; blockReason: string } | null> {
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
