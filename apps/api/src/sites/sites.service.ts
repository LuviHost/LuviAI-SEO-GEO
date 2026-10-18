import { ConflictException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { JobQueueService } from '../jobs/job-queue.service.js';
import { QuotaService } from '../billing/quota.service.js';
import { CreateSiteDto, UpdateSiteDto } from './sites.dto.js';
import { assertSiteUrlAllowed, parseSiteUrlInput, type PublicResolver } from './site-url-policy.js';
import { crawlAccessKey, readCrawlAccess, type CrawlAccessRecord } from './crawl-access.js';
import { asaStateKeys, promptLocalKeys } from '../me/unscoped-kv-keys.js';

/**
 * Site satirindaki sirlar — API cevabina ASLA cikmamali.
 * Yeni bir sir alani eklenirse buraya da eklenmeli.
 *
 * TIP ACIKCA YAZILI (Prisma.SiteOmit) — bu SART.
 * Once `as const` ile yazilmisti ve icinde SEMADA OLMAYAN bir alan vardi
 * (metaAccessToken; dogrusu metaAdsAccessToken). TypeScript bunu yakalamadi
 * cunku fazla-ozellik kontrolu yalnizca satir ici nesne literaline uygulanir,
 * degiskene DEGIL. Sonuc: tsc temiz gecti ama Prisma calisma aninda dogrulama
 * hatasi atti, site listesi 500 dondu ve panel "Henuz site eklenmemis" gosterdi
 * (sayac baska bir uctan geldigi icin 11 yaziyordu — hata bu yuzden sessiz kaldi).
 * Tip yazili oldugunda yanlis alan adi DERLEME hatasi verir.
 */
export const SITE_SECRET_FIELDS: Prisma.SiteOmit = {
  ingestSecret: true,
  gscRefreshToken: true,
  gaRefreshToken: true,
  googleAdsRefreshToken: true,
  metaAdsAccessToken: true,
  // Slack/Discord gelen webhook adresi tasiyici bir sirdir: adresi bilen o
  // kanala RanksUp adina mesaj atabilir. Panel bu alani okumuyor.
  notifyWebhookUrl: true,
};

type RequestingUser = { id: string; role: 'USER' | 'ADMIN' | 'AGENCY_OWNER' };

/**
 * URL'leri tek standarda sokar (mukerrer site kontrolu icin).
 *  - lowercase host
 *  - trailing slash temizlenir
 *  - query/fragment atilir
 *  - protokol bos gelirse https zorlanir
 */
export function normalizeSiteUrl(raw: string): string {
  if (!raw) throw new Error('URL bos olamaz');
  let candidate = raw.trim();
  if (!/^https?:\/\//i.test(candidate)) candidate = `https://${candidate}`;
  const u = new URL(candidate);
  u.protocol = u.protocol.toLowerCase();
  u.hostname = u.hostname.toLowerCase();
  u.search = '';
  u.hash = '';
  let pathname = u.pathname.replace(/\/+$/, '');
  if (!pathname) pathname = '';
  return `${u.protocol}//${u.hostname}${pathname}`;
}

@Injectable()
export class SitesService {
  private readonly log = new Logger(SitesService.name);

  /** Yalnizca test: gercek DNS yerine sahte cozumleyici. Uretimde bos → assertResolvesPublic. */
  urlResolver?: PublicResolver;

  constructor(
    private readonly prisma: PrismaService,
    private readonly jobQueue: JobQueueService,
    private readonly quota: QuotaService,
  ) {}

  async create(userId: string, dto: CreateSiteDto) {
    // Plan site kotasi. enforceSiteQuota yazildigindan beri hicbir yerden
    // cagrilmiyordu — herkes sinirsiz site acabiliyordu, oysa fiyat karti
    // 2/5/15/50 satiyor. Duplicate kontrolunden ONCE, cunku kota asilmissa
    // istegin devami zaten anlamsiz.
    await this.quota.enforceSiteQuota(userId);

    // SSRF: deneme hesabi kart istemiyor; ic agdaki bir adres "site" diye
    // kaydedilirse tarayici, platform tespiti ve envanter oraya istek atardi.
    // Site bir alan adi olmali (IP yok), 80/443, simdi herkese acik adrese
    // cozulmeli. Asil koruma yine her istekteki baglanti ani denetimi.
    const checked = await assertSiteUrlAllowed(dto.url, this.urlResolver);
    const normalizedUrl = normalizeSiteUrl(checked.toString());

    const duplicate = await this.prisma.site.findFirst({
      where: { userId, url: normalizedUrl },
      select: { id: true },
    });
    if (duplicate) {
      throw new ConflictException('Bu site zaten ekli.');
    }

    let site;
    try {
      // Yeni satirda sir alanlari bos; yine de cevap ayni kuralla doner
      site = await this.prisma.site.create({
        data: { ...dto, url: normalizedUrl, userId },
        omit: SITE_SECRET_FIELDS,
      });
    } catch (err: any) {
      // Prisma unique constraint (race condition guard'i)
      if (err?.code === 'P2002') {
        throw new ConflictException('Bu site zaten ekli.');
      }
      throw err;
    }
    // Wow-moment: brain → audit → topics → 1.makale tek job
    await this.jobQueue.enqueue({
      type: 'ONBOARDING_CHAIN',
      userId: site.userId,
      siteId: site.id,
      payload: { siteId: site.id },
      priority: 10, // yüksek öncelik
    });
    return site;
  }

  list(user: RequestingUser) {
    const where = user.role === 'ADMIN' ? {} : { userId: user.id };
    // SIRLAR CEVABA SIZMASIN.
    // Site satiri ingestSecret (canli crawler HMAC siri) ve saglayici
    // refresh token'lari tasiyor. Select/omit olmadan bu alanlar API
    // cevabinda donuyordu; salt-okunur bir API anahtari (sites:read) sirri
    // okuyup sahte ingest imzalayabilirdi — yani okuma yetkisi sessizce
    // yazma kabiliyetine donusuyordu.
    return this.prisma.site.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      omit: SITE_SECRET_FIELDS,
    });
  }

  async findOne(id: string, user: RequestingUser) {
    const site = await this.prisma.site.findUnique({
      where: { id },
      include: { brain: true },
      omit: SITE_SECRET_FIELDS,
    });
    if (!site) throw new NotFoundException();
    if (user.role !== 'ADMIN' && site.userId !== user.id) {
      throw new ForbiddenException('Bu site sana ait degil');
    }
    return site;
  }

  async update(id: string, dto: UpdateSiteDto, user: RequestingUser) {
    await this.assertOwnership(id, user);
    // UpdateSiteDto bugun url tasimiyor (ValidationPipe forbidNonWhitelisted
    // fazlasini reddeder). Ileride eklenirse ya da bir ic cagri url gecirirse
    // kayit anindaki ayni denetimden gecmeden yazilmasin.
    const data: Record<string, unknown> = { ...dto };
    const rawUrl = (dto as { url?: unknown }).url;
    if (rawUrl !== undefined) {
      const checked = await assertSiteUrlAllowed(rawUrl, this.urlResolver);
      data.url = normalizeSiteUrl(checked.toString());
    }
    // Sirlar (ingestSecret, saglayici token'lari) guncelleme cevabinda donmez —
    // eskiden PATCH /sites/:id tam satiri donuyordu
    return this.prisma.site.update({ where: { id }, data: data as Prisma.SiteUpdateInput, omit: SITE_SECRET_FIELDS });
  }

  async remove(id: string, user: RequestingUser) {
    await this.assertOwnership(id, user);
    // Tek transaction: site ya tum verisiyle gider ya hicbir sey degismez.
    // Plan ve neden DB cascade'ine guvenilmedigi: dosya sonunda siteRemovalSteps.
    const { deleted, queuedBullJobIds } = await this.prisma
      .$transaction(async (tx) => {
        const ids = await collectSiteRemovalIds(tx, id);
        for (const step of siteRemovalSteps(ids)) await step.run(tx);
        // Sirlar (ingestSecret, saglayici token'lari) silme cevabinda da donmez
        const row = await tx.site.delete({ where: { id }, omit: SITE_SECRET_FIELDS });
        return { deleted: row, queuedBullJobIds: ids.queuedBullJobIds };
      }, SITE_REMOVAL_TX)
      .catch((err) => {
        // Es zamanli ikinci silme istegi (cift tiklama): site artik yok
        if (err?.code === 'P2025') throw new NotFoundException();
        throw err;
      });
    // Kuyruk karsiliklari commit sonrasi, en iyi caba: kalan olursa worker iptal edilmis isi calistirmaz
    for (const jobId of queuedBullJobIds) await this.jobQueue.removeJob(jobId).catch(() => false);
    this.log.log(`[${id}] Site ve bağlı veriler silindi (${user.id}); ${queuedBullJobIds.length} kuyruk işi iptal edildi`);
    return deleted;
  }

  /**
   * Son tarama denemesinde anasayfa okunamadiysa nedeni ve cozumu (yoksa null).
   * Panel "Erisim engellendi" durumunu buradan gosterir. Okuma hata atmaz.
   */
  getCrawlAccess(siteId: string): Promise<CrawlAccessRecord | null> {
    return readCrawlAccess(this.prisma, siteId);
  }

  // ──────────────────────────────────────────────────────────
  //  Sprint Onboarding — wizard helpers
  // ──────────────────────────────────────────────────────────

  /**
   * Frequency stringini cron expression'a cevir.
   * - daily          → '0 H * * *'           (her gun saat H)
   * - three_per_week → '0 H * * 1,3,5'       (Pzt/Çrş/Cum saat H)
   * - weekly         → '0 H * * 1'           (Pzt saat H)
   */
  private frequencyToCron(frequency: string, hour: number): string {
    const h = Math.max(0, Math.min(23, hour | 0));
    switch (frequency) {
      case 'daily':          return `0 ${h} * * *`;
      case 'three_per_week': return `0 ${h} * * 1,3,5`;
      case 'weekly':
      default:               return `0 ${h} * * 1`;
    }
  }

  /** Onboarding wizard'ı tamamla (son adım 'Kaydet' butonu) */
  async completeOnboarding(siteId: string, user: RequestingUser) {
    const site = await this.assertOwnership(siteId, user);

    // autoGenerationCron'u frequency + hour'dan turetsin
    const cron = this.frequencyToCron(
      (site as any).autoGenerationFrequency ?? 'weekly',
      (site as any).autoGenerationHour ?? 9,
    );

    // Yayin hedefi var mi kontrol et — yoksa autopilot'u kapat (uretsek de yayinlayamayiz)
    const targetCount = await this.prisma.publishTarget.count({ where: { siteId } });

    return this.prisma.site.update({
      where: { id: siteId },
      data: {
        onboardingStep: 7,
        onboardingCompletedAt: new Date(),
        autoGenerationEnabled: targetCount > 0,
        autoGenerationCron: cron,
        autopilot: targetCount > 0, // yayın hedefi yoksa otopilot baslamasin
        status: 'ACTIVE' as any,
      },
      // Onboarding "Kaydet" cevabi da tam satiri (sirlar dahil) donuyordu
      omit: SITE_SECRET_FIELDS,
    });
  }

  async regenerateBrain(siteId: string, user: RequestingUser) {
    const site = await this.assertOwnership(siteId, user);
    return this.jobQueue.enqueue({
      type: 'BRAIN_GENERATE',
      userId: site.userId,
      siteId,
      payload: { siteId, forceRegenerate: true },
    });
  }

  async listCompetitors(siteId: string, user: RequestingUser) {
    await this.assertOwnership(siteId, user);
    const brain = await this.prisma.brain.findUnique({ where: { siteId } });
    if (!brain) return [];
    return Array.isArray(brain.competitors) ? brain.competitors : [];
  }

  async setCompetitors(
    siteId: string,
    competitors: Array<{ name: string; url: string; strengths?: string[]; weaknesses?: string[] }>,
    user: RequestingUser,
  ) {
    await this.assertOwnership(siteId, user);
    const brain = await this.prisma.brain.findUnique({ where: { siteId } });
    if (!brain) {
      throw new NotFoundException('Brain henuz olusturulmadi. Once site analizini bekle.');
    }
    // URL normalize + duplicate at
    const seen = new Set<string>();
    const cleaned: Array<{ name: string; url: string; strengths?: string[]; weaknesses?: string[] }> = [];
    for (const c of competitors) {
      if (!c?.url || !c?.name) continue;
      let url: string;
      try {
        // Site adresiyle ayni sekil kurali: IP, port, ic ag adresi rakip olamaz
        url = normalizeSiteUrl(parseSiteUrlInput(c.url).toString());
      } catch {
        continue;
      }
      if (seen.has(url)) continue;
      seen.add(url);
      cleaned.push({
        name: String(c.name).trim().slice(0, 100),
        url,
        strengths: Array.isArray(c.strengths) ? c.strengths.slice(0, 5) : undefined,
        weaknesses: Array.isArray(c.weaknesses) ? c.weaknesses.slice(0, 5) : undefined,
      });
    }
    await this.prisma.brain.update({
      where: { siteId },
      data: { competitors: cleaned as any, generatedBy: 'hybrid' },
    });
    return cleaned;
  }

  private async assertOwnership(siteId: string, user: RequestingUser) {
    const site = await this.prisma.site.findUnique({ where: { id: siteId } });
    if (!site) throw new NotFoundException();
    if (user.role !== 'ADMIN' && site.userId !== user.id) {
      throw new ForbiddenException('Bu site sana ait degil');
    }
    return site;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
//  Site silme plani — yetim satir birakmadan, tek transaction
// ─────────────────────────────────────────────────────────────────────────────
//
// NEDEN DB CASCADE'INE GUVENILMIYOR (kalici hesap silmeyle ayni gerekce,
// me/account-purge.plan.ts): ai_citation_snapshots, ai_citation_runs,
// ai_referrer_hits, ai_crawler_hits, usage_events ve testimonials semada
// siteId'ye iliskisiz (FK yok); geo_fanout_queries / geo_prompt_runs siteId
// tasir ama yalniz prompt uzerinden baglidir. Uretim tablolarinin bir kismi
// `db push` ile kuruldu, elle yazilmis bazi migration'lar FK'yi hic yazmadi
// (orn. ai_citation_runs). Eski tek satirlik `site.delete` bu satirlari yetim
// birakiyordu: silinen sitenin olcumleri ve bot/ziyaretci kayitlari tabloda
// kaliyordu. Burada siteye bagli her tablo yapraktan koke ACIKCA temizlenir;
// site satiri en son, ayni transaction icinde silinir.
//
// Silinmeyip yalniz site baglantisi koparilanlar (semadaki SetNull ile ayni):
// is gecmisi (Job), platformun LLM maliyet kaydi (TokenUsageRecord),
// kullanicinin medya kutuphanesi (SocialMediaAsset) ve kullanicinin RanksUp
// yorumu (Testimonial — yonetici onayiyla sitede yayinda olabilir; bir siteyi
// silmek yorumu geri cekmek degildir, hesap silme ise onu da siler).
// Kapsam testi (site-removal.spec.ts) semadaki her siteye bagli modelin
// planda ya da SITE_REMOVAL_EXEMPT'te olmasini ister.

/** Plan adimlarinin kullandigi Prisma yuzeyi (transaction istemcisi) */
export type SiteRemovalDb = Prisma.TransactionClient;

export interface SiteRemovalIds {
  siteId: string;
  trackedAppIds: string[];
  trackedAppKeywordIds: string[];
  asaAccountIds: string[];
  asaCampaignIds: string[];
  asaAdGroupIds: string[];
  ascAccountIds: string[];
  ascAppIds: string[];
  sdkConfigIds: string[];
  socialChannelIds: string[];
  stuckPageIds: string[];
  geoPromptIds: string[];
  chatConversationIds: string[];
  /** Iptal edilen kuyruk islerinin BullMQ kimlikleri — commit sonrasi kuyruktan da silinir */
  queuedBullJobIds: string[];
}

export interface SiteRemovalStep {
  /** Prisma model adi (kapsam testi semayla karsilastirir) */
  model: string;
  /** detach: satir kalir, site referansi NULL olur ya da kuyruktaki is iptal edilir; delete: satir silinir */
  kind: 'detach' | 'delete';
  run: (db: SiteRemovalDb) => Promise<{ count: number }>;
}

/**
 * Prisma'nin varsayilan 5 sn'lik transaction suresi buyuk bir sitede (on
 * binlerce siralama / bot olayi satiri) yetmez; zaman asiminda her sey geri
 * alinir ve site silinemezdi.
 */
export const SITE_REMOVAL_TX: { maxWait: number; timeout: number } = { maxWait: 10_000, timeout: 120_000 };

/**
 * Plan disinda birakilan siteye bagli modeller ve nedeni. Kapsam testi semadaki
 * her bagli modelin ya planda ya burada olmasini ister.
 */
export const SITE_REMOVAL_EXEMPT: Record<string, string> = {};

const idIn = (list: string[]) => ({ in: list });

/**
 * kv_store anahtarlari site kimligini tasir (crawl-access:<id>, site-nap:<id>,
 * autofix-preview:<id>:..., crawler-err:<id>:..., cite-notif:<id>:...). Kimlik
 * cuid (25 karakter) oldugu icin "icerir" filtresi baska siteye dokunmaz; elle
 * eklenmis kisa bir kimlikte alakasiz anahtarlari da silebilecegi icin yalniz
 * bilinen erisim kaydi silinir.
 */
function siteKvFilter(siteId: string): Prisma.KvStoreWhereInput {
  return siteId.length >= 20 ? { key: { contains: siteId } } : { key: crawlAccessKey(siteId) };
}

/** Silinecek alt kayit kimlikleri. Iliski filtresi yerine kimlik listesi: MySQL'de en ongorulebilir sorgu. */
export async function collectSiteRemovalIds(db: SiteRemovalDb, siteId: string): Promise<SiteRemovalIds> {
  const pick = (rows: { id: string }[]) => rows.map((r) => r.id);
  const bySite = { siteId };
  const trackedAppIds = pick(await db.trackedApp.findMany({ where: bySite, select: { id: true } }));
  const trackedAppKeywordIds = pick(await db.trackedAppKeyword.findMany({ where: { trackedAppId: idIn(trackedAppIds) }, select: { id: true } }));
  const asaAccountIds = pick(await db.asaAccount.findMany({ where: bySite, select: { id: true } }));
  const asaCampaignIds = pick(await db.asaCampaign.findMany({ where: { accountId: idIn(asaAccountIds) }, select: { id: true } }));
  const asaAdGroupIds = pick(await db.asaAdGroup.findMany({ where: { campaignId: idIn(asaCampaignIds) }, select: { id: true } }));
  const ascAccountIds = pick(await db.ascAccount.findMany({ where: bySite, select: { id: true } }));
  const ascAppIds = pick(await db.ascApp.findMany({ where: { accountId: idIn(ascAccountIds) }, select: { id: true } }));
  const sdkConfigIds = pick(await db.sdkAppConfig.findMany({ where: bySite, select: { id: true } }));
  const socialChannelIds = pick(await db.socialChannel.findMany({ where: bySite, select: { id: true } }));
  const stuckPageIds = pick(await db.stuckPage.findMany({ where: bySite, select: { id: true } }));
  // App Prompt Lab prompt'lari uygulama uzerinden de baglanir
  const geoPromptIds = pick(await db.geoPrompt.findMany({
    where: { OR: [bySite, { trackedAppId: idIn(trackedAppIds) }] },
    select: { id: true },
  }));
  const chatConversationIds = pick(await db.chatConversation.findMany({ where: bySite, select: { id: true } }));
  const queued = await db.job.findMany({ where: { siteId, status: 'QUEUED', bullJobId: { not: null } }, select: { bullJobId: true } });
  return {
    siteId,
    trackedAppIds,
    trackedAppKeywordIds,
    asaAccountIds,
    asaCampaignIds,
    asaAdGroupIds,
    ascAccountIds,
    ascAppIds,
    sdkConfigIds,
    socialChannelIds,
    stuckPageIds,
    geoPromptIds,
    chatConversationIds,
    queuedBullJobIds: queued.map((j) => j.bullJobId).filter((jobId): jobId is string => !!jobId),
  };
}

/** Sirali, tekrar calistirilabilir adimlar — cocuk tablo ebeveyninden once. Site satiri plan disinda, en son. */
export function siteRemovalSteps(x: SiteRemovalIds): SiteRemovalStep[] {
  const { siteId } = x;
  const bySite = { siteId };
  return [
    // ── 1. Kayit kalir, site baglantisi kopar ────────────────────────────
    // Kuyrukta bekleyen is once iptal edilir (baglanti koptuktan sonra secilemezdi)
    { model: 'Job', kind: 'detach', run: (db) => db.job.updateMany({ where: { siteId, status: 'QUEUED' }, data: { status: 'CANCELED' } }) },
    { model: 'Job', kind: 'detach', run: (db) => db.job.updateMany({ where: bySite, data: { siteId: null } }) },
    { model: 'TokenUsageRecord', kind: 'detach', run: (db) => db.tokenUsageRecord.updateMany({ where: bySite, data: { siteId: null } }) },
    { model: 'SocialMediaAsset', kind: 'detach', run: (db) => db.socialMediaAsset.updateMany({ where: bySite, data: { siteId: null } }) },
    { model: 'Testimonial', kind: 'detach', run: (db) => db.testimonial.updateMany({ where: bySite, data: { siteId: null } }) },

    // ── 2. Site icerigi — yapraktan koke ────────────────────────────────
    { model: 'AppRanking', kind: 'delete', run: (db) => db.appRanking.deleteMany({ where: { trackedAppKeywordId: idIn(x.trackedAppKeywordIds) } }) },
    { model: 'TrackedAppKeyword', kind: 'delete', run: (db) => db.trackedAppKeyword.deleteMany({ where: { trackedAppId: idIn(x.trackedAppIds) } }) },
    { model: 'AppReview', kind: 'delete', run: (db) => db.appReview.deleteMany({ where: { trackedAppId: idIn(x.trackedAppIds) } }) },
    { model: 'GeoPromptRun', kind: 'delete', run: (db) => db.geoPromptRun.deleteMany({ where: { OR: [bySite, { promptId: idIn(x.geoPromptIds) }] } }) },
    { model: 'GeoFanoutQuery', kind: 'delete', run: (db) => db.geoFanoutQuery.deleteMany({ where: { OR: [bySite, { promptId: idIn(x.geoPromptIds) }] } }) },
    // Prompt Lab yerel sonucu (sitenin telefonu/adresi) anahtarinda site kimligi
    // tasimaz (prompt-local:<promptId>); sondaki siteKvFilter onu yakalamaz
    { model: 'KvStore', kind: 'delete', run: (db) => db.kvStore.deleteMany({ where: { key: idIn(promptLocalKeys(x.geoPromptIds)) } }) },
    { model: 'GeoPrompt', kind: 'delete', run: (db) => db.geoPrompt.deleteMany({ where: { OR: [bySite, { id: idIn(x.geoPromptIds) }] } }) },
    { model: 'TrackedApp', kind: 'delete', run: (db) => db.trackedApp.deleteMany({ where: bySite }) },
    { model: 'AsaKeywordBid', kind: 'delete', run: (db) => db.asaKeywordBid.deleteMany({ where: { adGroupId: idIn(x.asaAdGroupIds) } }) },
    { model: 'AsaAdGroup', kind: 'delete', run: (db) => db.asaAdGroup.deleteMany({ where: { campaignId: idIn(x.asaCampaignIds) } }) },
    { model: 'AsaPerformanceDaily', kind: 'delete', run: (db) => db.asaPerformanceDaily.deleteMany({ where: { campaignId: idIn(x.asaCampaignIds) } }) },
    { model: 'AsaCampaign', kind: 'delete', run: (db) => db.asaCampaign.deleteMany({ where: { accountId: idIn(x.asaAccountIds) } }) },
    // ASA durum anahtarlari (secilen reklam hesabi kimligi vb.) yalniz ASA hesap kimligi tasir, suresi yok
    { model: 'KvStore', kind: 'delete', run: (db) => db.kvStore.deleteMany({ where: { key: idIn(asaStateKeys(x.asaAccountIds)) } }) },
    { model: 'AsaAccount', kind: 'delete', run: (db) => db.asaAccount.deleteMany({ where: bySite }) },
    { model: 'AscReleaseAlert', kind: 'delete', run: (db) => db.ascReleaseAlert.deleteMany({ where: { appId: idIn(x.ascAppIds) } }) },
    { model: 'AscRelease', kind: 'delete', run: (db) => db.ascRelease.deleteMany({ where: { appId: idIn(x.ascAppIds) } }) },
    { model: 'AscApp', kind: 'delete', run: (db) => db.ascApp.deleteMany({ where: { accountId: idIn(x.ascAccountIds) } }) },
    { model: 'AscAccount', kind: 'delete', run: (db) => db.ascAccount.deleteMany({ where: bySite }) },
    { model: 'SdkEvent', kind: 'delete', run: (db) => db.sdkEvent.deleteMany({ where: { configId: idIn(x.sdkConfigIds) } }) },
    { model: 'SdkAppConfig', kind: 'delete', run: (db) => db.sdkAppConfig.deleteMany({ where: bySite }) },
    { model: 'SocialPost', kind: 'delete', run: (db) => db.socialPost.deleteMany({ where: { channelId: idIn(x.socialChannelIds) } }) },
    { model: 'SocialRecurringSlot', kind: 'delete', run: (db) => db.socialRecurringSlot.deleteMany({ where: { channelId: idIn(x.socialChannelIds) } }) },
    { model: 'SocialChannel', kind: 'delete', run: (db) => db.socialChannel.deleteMany({ where: bySite }) },
    { model: 'StuckPageRecovery', kind: 'delete', run: (db) => db.stuckPageRecovery.deleteMany({ where: { stuckPageId: idIn(x.stuckPageIds) } }) },
    { model: 'StuckPage', kind: 'delete', run: (db) => db.stuckPage.deleteMany({ where: bySite }) },
    { model: 'ChatMessage', kind: 'delete', run: (db) => db.chatMessage.deleteMany({ where: { conversationId: idIn(x.chatConversationIds) } }) },
    { model: 'ChatConversation', kind: 'delete', run: (db) => db.chatConversation.deleteMany({ where: bySite }) },
    { model: 'ContentOpportunity', kind: 'delete', run: (db) => db.contentOpportunity.deleteMany({ where: bySite }) },
    { model: 'CommunityOpportunity', kind: 'delete', run: (db) => db.communityOpportunity.deleteMany({ where: bySite }) },
    { model: 'ActionPlanItem', kind: 'delete', run: (db) => db.actionPlanItem.deleteMany({ where: bySite }) },
    { model: 'AgentReadinessScan', kind: 'delete', run: (db) => db.agentReadinessScan.deleteMany({ where: bySite }) },
    { model: 'ProductRadarSnapshot', kind: 'delete', run: (db) => db.productRadarSnapshot.deleteMany({ where: bySite }) },
    { model: 'CrawlerHitEvent', kind: 'delete', run: (db) => db.crawlerHitEvent.deleteMany({ where: bySite }) },
    { model: 'SiteReport', kind: 'delete', run: (db) => db.siteReport.deleteMany({ where: bySite }) },
    { model: 'AppliedFix', kind: 'delete', run: (db) => db.appliedFix.deleteMany({ where: bySite }) },
    { model: 'SiteImage', kind: 'delete', run: (db) => db.siteImage.deleteMany({ where: bySite }) },
    { model: 'StudioAsset', kind: 'delete', run: (db) => db.studioAsset.deleteMany({ where: bySite }) },
    { model: 'Video', kind: 'delete', run: (db) => db.video.deleteMany({ where: bySite }) },
    { model: 'AdsAudit', kind: 'delete', run: (db) => db.adsAudit.deleteMany({ where: bySite }) },
    { model: 'AdCampaign', kind: 'delete', run: (db) => db.adCampaign.deleteMany({ where: bySite }) },
    { model: 'AnalyticsSnapshot', kind: 'delete', run: (db) => db.analyticsSnapshot.deleteMany({ where: bySite }) },
    { model: 'GscAiVisibilitySnapshot', kind: 'delete', run: (db) => db.gscAiVisibilitySnapshot.deleteMany({ where: bySite }) },
    // Semada iliskisiz (duz siteId) — site silinince kendiliginden gitmezler
    { model: 'AiCitationSnapshot', kind: 'delete', run: (db) => db.aiCitationSnapshot.deleteMany({ where: bySite }) },
    { model: 'AiCitationRun', kind: 'delete', run: (db) => db.aiCitationRun.deleteMany({ where: bySite }) },
    { model: 'AiReferrerHit', kind: 'delete', run: (db) => db.aiReferrerHit.deleteMany({ where: bySite }) },
    { model: 'AiCrawlerHit', kind: 'delete', run: (db) => db.aiCrawlerHit.deleteMany({ where: bySite }) },
    { model: 'UsageEvent', kind: 'delete', run: (db) => db.usageEvent.deleteMany({ where: bySite }) },
    { model: 'Audit', kind: 'delete', run: (db) => db.audit.deleteMany({ where: bySite }) },
    { model: 'TopicQueue', kind: 'delete', run: (db) => db.topicQueue.deleteMany({ where: bySite }) },
    { model: 'PublishTarget', kind: 'delete', run: (db) => db.publishTarget.deleteMany({ where: bySite }) },
    { model: 'SiteAiProviderKey', kind: 'delete', run: (db) => db.siteAiProviderKey.deleteMany({ where: bySite }) },
    { model: 'Brain', kind: 'delete', run: (db) => db.brain.deleteMany({ where: bySite }) },
    // Makaleler en sonda: StuckPage/SocialPost/Video/ContentOpportunity onlara bagli (SetNull)
    { model: 'Article', kind: 'delete', run: (db) => db.article.deleteMany({ where: bySite }) },

    // ── 3. Gecici kayitlar (erisim durumu, NAP, onizleme, bildirim kilitleri) ──
    { model: 'KvStore', kind: 'delete', run: (db) => db.kvStore.deleteMany({ where: siteKvFilter(siteId) }) },
  ];
}
