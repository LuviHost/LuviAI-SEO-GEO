import type { Prisma } from '@prisma/client';
import { asaStateKeys, promptLocalKeys } from './unscoped-kv-keys.js';
import { whereProblem } from './scoped-where.js';

/**
 * Kalici hesap silme plani — sirali, tekrar calistirilabilir (idempotent) adimlar.
 *
 * NEDEN VERITABANI CASCADE'INE GUVENILMIYOR: semada her iliski onDelete tasiyor
 * ama uretim tablolarinin bir kismi migration ile degil `db push` ile kuruldu
 * ve migration'larin bir kismi FK'yi hic yazmiyor (orn. api_keys,
 * gsc_ai_visibility_snapshots). ai_citation_snapshots / ai_citation_runs /
 * ai_referrer_hits / ai_crawler_hits / usage_events / testimonials ise
 * semada bile iliskisiz (siteId/userId duz kolon). Yalniz `user.delete`e
 * guvenmek ya yetim satir birakir ya da RESTRICT bir FK'ye takilir.
 * Bu yuzden her tablo yapraktan koke ACIKCA silinir; en sonda site ve kullanici.
 *
 * SIRA KURALLARI:
 *  1. Once muhasebe kayitlari kisiden KOPARILIR (silinmez): VUK md. 253 (5 yil)
 *     ve TTK md. 82 (10 yil) defter/belge saklama yukumlulugu. FK SetNull da
 *     ayni isi yapar; acik adim, FK eksik/eski olsa bile kaydi korur.
 *  2. Baska kullanicilara ait satirlardaki referanslar NULL'lanir.
 *  3. Icerik yapraktan koke silinir (cocuk -> ebeveyn).
 *  4. En son site ve kullanici.
 * Islem yarida kesilirse ertesi gun ayni plan bastan calisir; silinmis satirlar
 * 0 sayilir, kalanlar silinir (account-purge.cron.ts).
 */

/** Plan adimlarinin kullandigi Prisma yuzeyi (PrismaService de, transaction istemcisi de uyar) */
export type PurgeDb = Prisma.TransactionClient;

export interface PurgeIds {
  userId: string;
  email: string;
  siteIds: string[];
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
  subscriberIds: string[];
  affiliateId: string | null;
  affiliateRefCode: string | null;
}

export interface PurgeStep {
  /** Prisma model adi (kapsam testi semayla karsilastirir) */
  model: string;
  /** detach: satir kalir, kullanici/site referansi NULL olur; delete: satir silinir */
  kind: 'detach' | 'delete';
  run: (db: PurgeDb) => Promise<{ count: number }>;
}

const ids = (list: string[]) => ({ in: list });

/** Silinecek kimlikleri toplar. Iliski filtresi yerine kimlik listesi: MySQL'de en ongorulebilir sorgu. */
export async function collectPurgeIds(db: PurgeDb, user: { id: string; email: string }): Promise<PurgeIds> {
  const pick = (rows: { id: string }[]) => rows.map((r) => r.id);
  const userId = user.id;
  const siteIds = pick(await db.site.findMany({ where: { userId }, select: { id: true } }));
  const trackedAppIds = pick(await db.trackedApp.findMany({ where: { siteId: ids(siteIds) }, select: { id: true } }));
  const trackedAppKeywordIds = pick(await db.trackedAppKeyword.findMany({ where: { trackedAppId: ids(trackedAppIds) }, select: { id: true } }));
  const asaAccountIds = pick(await db.asaAccount.findMany({ where: { siteId: ids(siteIds) }, select: { id: true } }));
  const asaCampaignIds = pick(await db.asaCampaign.findMany({ where: { accountId: ids(asaAccountIds) }, select: { id: true } }));
  const asaAdGroupIds = pick(await db.asaAdGroup.findMany({ where: { campaignId: ids(asaCampaignIds) }, select: { id: true } }));
  const ascAccountIds = pick(await db.ascAccount.findMany({ where: { siteId: ids(siteIds) }, select: { id: true } }));
  const ascAppIds = pick(await db.ascApp.findMany({ where: { accountId: ids(ascAccountIds) }, select: { id: true } }));
  const sdkConfigIds = pick(await db.sdkAppConfig.findMany({ where: { siteId: ids(siteIds) }, select: { id: true } }));
  const socialChannelIds = pick(await db.socialChannel.findMany({ where: { siteId: ids(siteIds) }, select: { id: true } }));
  const stuckPageIds = pick(await db.stuckPage.findMany({ where: { siteId: ids(siteIds) }, select: { id: true } }));
  const geoPromptIds = pick(await db.geoPrompt.findMany({
    where: { OR: [{ siteId: ids(siteIds) }, { trackedAppId: ids(trackedAppIds) }] },
    select: { id: true },
  }));
  // Kendi sitelerindeki tum sohbetler + baska sitelerde bu kullanicinin actigi sohbetler
  const chatConversationIds = pick(await db.chatConversation.findMany({
    where: { OR: [{ siteId: ids(siteIds) }, { userId }] },
    select: { id: true },
  }));
  // Landing'deki AI gorunurluk testi aboneligi: kayitla eslesen ya da ayni e-posta
  const subscriberIds = pick(await db.publicCitationSubscriber.findMany({
    where: { OR: [{ signupUserId: userId }, { email: user.email }] },
    select: { id: true },
  }));
  const affiliate = await db.affiliate.findUnique({ where: { userId }, select: { id: true, refCode: true } });
  return {
    userId,
    email: user.email,
    siteIds,
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
    subscriberIds,
    affiliateId: affiliate?.id ?? null,
    affiliateRefCode: affiliate?.refCode ?? null,
  };
}

export function purgeSteps(x: PurgeIds): PurgeStep[] {
  const { userId, email } = x;
  const site = ids(x.siteIds);
  const bySite = { siteId: site };
  const steps: PurgeStep[] = [
    // ── 1. Muhasebe: kayit kalir, kisi baglantisi kopar ─────────────────
    { model: 'Invoice', kind: 'detach', run: (db) => db.invoice.updateMany({ where: { userId }, data: { userId: null } }) },
    { model: 'VideoCreditPurchase', kind: 'detach', run: (db) => db.videoCreditPurchase.updateMany({ where: { userId }, data: { userId: null } }) },
    // Platformun kendi LLM maliyet kaydi: toplamlar bozulmasin, kisi baglantisi gitsin
    { model: 'TokenUsageRecord', kind: 'detach', run: (db) => db.tokenUsageRecord.updateMany({ where: { userId }, data: { userId: null } }) },
    { model: 'TokenUsageRecord', kind: 'detach', run: (db) => db.tokenUsageRecord.updateMany({ where: bySite, data: { siteId: null } }) },

    // ── 2. Baska kullanicilarin satirlarindaki referanslar ──────────────
    { model: 'Job', kind: 'detach', run: (db) => db.job.updateMany({ where: { siteId: site, userId: { not: userId } }, data: { siteId: null } }) },
    { model: 'SocialMediaAsset', kind: 'detach', run: (db) => db.socialMediaAsset.updateMany({ where: { siteId: site, userId: { not: userId } }, data: { siteId: null } }) },
    // Bu kullanicinin BASKA sitelerde calistirdigi rapor/duzeltme/uretim (yonetici vb.): kayit sahibine aittir, kim bilgisi silinir
    { model: 'SiteReport', kind: 'detach', run: (db) => db.siteReport.updateMany({ where: { userId, siteId: { notIn: x.siteIds } }, data: { userId: null } }) },
    { model: 'AppliedFix', kind: 'detach', run: (db) => db.appliedFix.updateMany({ where: { userId, siteId: { notIn: x.siteIds } }, data: { userId: null } }) },
    { model: 'StudioAsset', kind: 'detach', run: (db) => db.studioAsset.updateMany({ where: { userId, siteId: { notIn: x.siteIds } }, data: { userId: null } }) },
    // Ajans musterileri ayri hesaplardir — silinmez, yalniz ajans baglantisi kalkar
    { model: 'User', kind: 'detach', run: (db) => db.user.updateMany({ where: { parentAgencyId: userId }, data: { parentAgencyId: null } }) },
  ];
  if (x.affiliateRefCode) {
    // refCode ad/e-postadan uretiliyor (affiliate.service generateRefCode) — davet ettigi kullanicilardaki izi de kisisel veri
    const refCode = x.affiliateRefCode;
    steps.push({ model: 'User', kind: 'detach', run: (db) => db.user.updateMany({ where: { referredByCode: refCode }, data: { referredByCode: null } }) });
  }

  steps.push(
    // ── 3. Site icerigi — yapraktan koke ─────────────────────────────────
    { model: 'AppRanking', kind: 'delete', run: (db) => db.appRanking.deleteMany({ where: { trackedAppKeywordId: ids(x.trackedAppKeywordIds) } }) },
    { model: 'TrackedAppKeyword', kind: 'delete', run: (db) => db.trackedAppKeyword.deleteMany({ where: { trackedAppId: ids(x.trackedAppIds) } }) },
    { model: 'AppReview', kind: 'delete', run: (db) => db.appReview.deleteMany({ where: { trackedAppId: ids(x.trackedAppIds) } }) },
    { model: 'GeoPromptRun', kind: 'delete', run: (db) => db.geoPromptRun.deleteMany({ where: { OR: [bySite, { promptId: ids(x.geoPromptIds) }] } }) },
    { model: 'GeoFanoutQuery', kind: 'delete', run: (db) => db.geoFanoutQuery.deleteMany({ where: { OR: [bySite, { promptId: ids(x.geoPromptIds) }] } }) },
    // Prompt Lab yerel sonucu (sitenin telefonu/adresi) anahtarinda kullanici ya
    // da site kimligi tasimaz; asagidaki "icerir" kv adimi onu yakalamaz.
    // Prompt satirlarindan ONCE: yarida kalan tur ertesi gun prompt kimliklerini
    // yeniden toplayabilsin (prompt silindikten sonra anahtar sahipsiz kalirdi).
    { model: 'KvStore', kind: 'delete', run: (db) => db.kvStore.deleteMany({ where: { key: ids(promptLocalKeys(x.geoPromptIds)) } }) },
    { model: 'GeoPrompt', kind: 'delete', run: (db) => db.geoPrompt.deleteMany({ where: { id: ids(x.geoPromptIds) } }) },
    { model: 'TrackedApp', kind: 'delete', run: (db) => db.trackedApp.deleteMany({ where: bySite }) },
    { model: 'AsaKeywordBid', kind: 'delete', run: (db) => db.asaKeywordBid.deleteMany({ where: { adGroupId: ids(x.asaAdGroupIds) } }) },
    { model: 'AsaAdGroup', kind: 'delete', run: (db) => db.asaAdGroup.deleteMany({ where: { campaignId: ids(x.asaCampaignIds) } }) },
    { model: 'AsaPerformanceDaily', kind: 'delete', run: (db) => db.asaPerformanceDaily.deleteMany({ where: { campaignId: ids(x.asaCampaignIds) } }) },
    { model: 'AsaCampaign', kind: 'delete', run: (db) => db.asaCampaign.deleteMany({ where: { accountId: ids(x.asaAccountIds) } }) },
    // ASA durum anahtarlari (secilen reklam hesabi kimligi vb.) yalniz ASA hesap kimligi tasir ve suresi yok;
    // hesap satirindan ONCE: yarida kalan tur ertesi gun kimlikleri yeniden toplayabilsin
    { model: 'KvStore', kind: 'delete', run: (db) => db.kvStore.deleteMany({ where: { key: ids(asaStateKeys(x.asaAccountIds)) } }) },
    { model: 'AsaAccount', kind: 'delete', run: (db) => db.asaAccount.deleteMany({ where: bySite }) },
    { model: 'AscReleaseAlert', kind: 'delete', run: (db) => db.ascReleaseAlert.deleteMany({ where: { appId: ids(x.ascAppIds) } }) },
    { model: 'AscRelease', kind: 'delete', run: (db) => db.ascRelease.deleteMany({ where: { appId: ids(x.ascAppIds) } }) },
    { model: 'AscApp', kind: 'delete', run: (db) => db.ascApp.deleteMany({ where: { accountId: ids(x.ascAccountIds) } }) },
    { model: 'AscAccount', kind: 'delete', run: (db) => db.ascAccount.deleteMany({ where: bySite }) },
    { model: 'SdkEvent', kind: 'delete', run: (db) => db.sdkEvent.deleteMany({ where: { configId: ids(x.sdkConfigIds) } }) },
    { model: 'SdkAppConfig', kind: 'delete', run: (db) => db.sdkAppConfig.deleteMany({ where: bySite }) },
    { model: 'SocialPost', kind: 'delete', run: (db) => db.socialPost.deleteMany({ where: { channelId: ids(x.socialChannelIds) } }) },
    { model: 'SocialRecurringSlot', kind: 'delete', run: (db) => db.socialRecurringSlot.deleteMany({ where: { channelId: ids(x.socialChannelIds) } }) },
    { model: 'SocialChannel', kind: 'delete', run: (db) => db.socialChannel.deleteMany({ where: bySite }) },
    { model: 'StuckPageRecovery', kind: 'delete', run: (db) => db.stuckPageRecovery.deleteMany({ where: { stuckPageId: ids(x.stuckPageIds) } }) },
    { model: 'StuckPage', kind: 'delete', run: (db) => db.stuckPage.deleteMany({ where: bySite }) },
    { model: 'ChatMessage', kind: 'delete', run: (db) => db.chatMessage.deleteMany({ where: { conversationId: ids(x.chatConversationIds) } }) },
    { model: 'ChatConversation', kind: 'delete', run: (db) => db.chatConversation.deleteMany({ where: { id: ids(x.chatConversationIds) } }) },
    { model: 'ContentOpportunity', kind: 'delete', run: (db) => db.contentOpportunity.deleteMany({ where: bySite }) },
    { model: 'CommunityOpportunity', kind: 'delete', run: (db) => db.communityOpportunity.deleteMany({ where: bySite }) },
    { model: 'ActionPlanItem', kind: 'delete', run: (db) => db.actionPlanItem.deleteMany({ where: bySite }) },
    { model: 'AgentReadinessScan', kind: 'delete', run: (db) => db.agentReadinessScan.deleteMany({ where: bySite }) },
    { model: 'ProductRadarSnapshot', kind: 'delete', run: (db) => db.productRadarSnapshot.deleteMany({ where: bySite }) },
    { model: 'CrawlerHitEvent', kind: 'delete', run: (db) => db.crawlerHitEvent.deleteMany({ where: bySite }) },
    { model: 'SiteReport', kind: 'delete', run: (db) => db.siteReport.deleteMany({ where: bySite }) },
    { model: 'AppliedFix', kind: 'delete', run: (db) => db.appliedFix.deleteMany({ where: bySite }) },
    { model: 'SiteImage', kind: 'delete', run: (db) => db.siteImage.deleteMany({ where: bySite }) },
    // Google Isletme Profili: place_id + sifreli OAuth refresh token (site gidince Google erisimi de gitmeli)
    { model: 'SiteGbp', kind: 'delete', run: (db) => db.siteGbp.deleteMany({ where: bySite }) },
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
    { model: 'Audit', kind: 'delete', run: (db) => db.audit.deleteMany({ where: bySite }) },
    { model: 'TopicQueue', kind: 'delete', run: (db) => db.topicQueue.deleteMany({ where: bySite }) },
    { model: 'PublishTarget', kind: 'delete', run: (db) => db.publishTarget.deleteMany({ where: bySite }) },
    { model: 'SiteAiProviderKey', kind: 'delete', run: (db) => db.siteAiProviderKey.deleteMany({ where: bySite }) },
    { model: 'Brain', kind: 'delete', run: (db) => db.brain.deleteMany({ where: bySite }) },
    // Makaleler en sonda: StuckPage/SocialPost/Video/ContentOpportunity onlara bagli (SetNull)
    { model: 'Article', kind: 'delete', run: (db) => db.article.deleteMany({ where: bySite }) },
    { model: 'UsageEvent', kind: 'delete', run: (db) => db.usageEvent.deleteMany({ where: { OR: [{ userId }, bySite] } }) },
    { model: 'Testimonial', kind: 'delete', run: (db) => db.testimonial.deleteMany({ where: { OR: [{ userId }, bySite] } }) },

    // ── 4. Kullanici duzeyi ──────────────────────────────────────────────
    { model: 'SocialMediaAsset', kind: 'delete', run: (db) => db.socialMediaAsset.deleteMany({ where: { userId } }) },
    { model: 'Notification', kind: 'delete', run: (db) => db.notification.deleteMany({ where: { userId } }) },
    { model: 'Job', kind: 'delete', run: (db) => db.job.deleteMany({ where: { userId } }) },
    { model: 'ApiKey', kind: 'delete', run: (db) => db.apiKey.deleteMany({ where: { userId } }) },
    { model: 'Session', kind: 'delete', run: (db) => db.session.deleteMany({ where: { userId } }) },
    { model: 'Account', kind: 'delete', run: (db) => db.account.deleteMany({ where: { userId } }) },
    { model: 'EmailLog', kind: 'delete', run: (db) => db.emailLog.deleteMany({ where: { OR: [{ userId }, { to: email }] } }) },
    { model: 'PublicCitationEmailLog', kind: 'delete', run: (db) => db.publicCitationEmailLog.deleteMany({ where: { subscriberId: ids(x.subscriberIds) } }) },
    { model: 'PublicCitationSubscriber', kind: 'delete', run: (db) => db.publicCitationSubscriber.deleteMany({ where: { id: ids(x.subscriberIds) } }) },
  );
  if (x.affiliateId) {
    const affiliateId = x.affiliateId;
    // Bu kisinin ortaklik hesabi ve onun davet kayitlari. NOT: BASKA ortaklarin bu
    // kisiyi davet ettigi kayitlar (referredUserId) o ortagin komisyon gecmisidir —
    // kalir; kimlik artik hicbir kullaniciya cozulmez.
    steps.push({ model: 'AffiliateReferral', kind: 'delete', run: (db) => db.affiliateReferral.deleteMany({ where: { affiliateId } }) });
  }
  steps.push(
    { model: 'Affiliate', kind: 'delete', run: (db) => db.affiliate.deleteMany({ where: { userId } }) },
    // Kota/maliyet sayaclari, onizleme, erisim durumu gibi kayitlar anahtarinda kullanici ya da
    // site kimligi tasir. Kimliksiz kisa omurlu kayitlari (OAuth state, ASC plani) gunluk kv
    // temizligi (common/kv-sweep.cron.ts) suresi dolunca siler; kimliksiz kalici olanlar yukarida.
    {
      model: 'KvStore',
      kind: 'delete',
      run: (db) => db.kvStore.deleteMany({ where: { OR: [userId, ...x.siteIds].map((id) => ({ key: { contains: id } })) } }),
    },
    // Ajans davetleri: `agency-invite:<sahip>:<e-posta>` (agency.service inviteClient)
    {
      model: 'VerificationToken',
      kind: 'delete',
      run: (db) => db.verificationToken.deleteMany({
        where: { OR: [{ identifier: { contains: userId } }, { identifier: email }, { identifier: { endsWith: `:${email}` } }] },
      }),
    },

    // ── 5. Kok ───────────────────────────────────────────────────────────
    { model: 'Site', kind: 'delete', run: (db) => db.site.deleteMany({ where: { userId } }) },
    { model: 'User', kind: 'delete', run: (db) => db.user.deleteMany({ where: { id: userId } }) },
  );
  return steps;
}

/**
 * Kullaniciya/siteye bagli olup plan disinda kalan modeller ve nedeni.
 * Kapsam testi (account-purge.spec.ts) semadaki her bagli modelin ya planda ya
 * burada olmasini ister — yeni tablo eklenip burada unutulursa test kirilir.
 */
export const PURGE_EXEMPT: Record<string, string> = {};

// ── Calistirmadan once guvenlik denetimi ──────────────────────────────────
//
// NEDEN: plan tek transaction olmadan, geri alinamaz ~80 toplu silme/guncelleme
// calistirir. Bir adimin filtresi bos ({}) ya da undefined kalirsa (ornegin bir
// kimlik listesi eksik geldiyse) Prisma tum musterilerin satirlarini secer; bir
// adim yanlis tabloya yazarsa etiketlendigi tablo hic silinmez. Adimlar once
// gercek veritabanina DOKUNMADAN kaydedilir ve denetlenir; tek sorun bile varsa
// hicbir sey silinmeden durulur (hesap ertesi gun tekrar denenir, hata loglanir).

/** Bir plan adiminin yapacagi veritabani cagrisi (kayit, calistirma degil) */
export interface RecordedPurgeCall {
  /** Adimin plandaki sirasi */
  step: number;
  model: string;
  kind: PurgeStep['kind'];
  /** Cagrinin gittigi Prisma erisimcisi (db.<accessor>) */
  accessor: string;
  method: string;
  args: any;
}

/**
 * Adimlari kayit tutan sahte istemciyle calistirir. Adimlar yalniz
 * `db.<model>.<yontem>(args)` cagirip sonucunu dondurdugu icin yan etkisizdir.
 */
export async function recordPurgeCalls(steps: PurgeStep[]): Promise<RecordedPurgeCall[]> {
  const out: RecordedPurgeCall[] = [];
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    const db = new Proxy({}, {
      get: (_t, accessor) => new Proxy({}, {
        get: (_t2, method) => async (args: unknown) => {
          out.push({ step: i, model: step.model, kind: step.kind, accessor: String(accessor), method: String(method), args });
          return { count: 0 };
        },
      }),
    }) as unknown as PurgeDb;
    await step.run(db);
  }
  return out;
}

/** Silinen hesaba ait kimlikler — her filtre bunlardan birine daraltilmali */
export function purgeScopeTokens(x: PurgeIds): string[] {
  const lists = [
    x.siteIds, x.trackedAppIds, x.trackedAppKeywordIds, x.asaAccountIds, x.asaCampaignIds, x.asaAdGroupIds,
    x.ascAccountIds, x.ascAppIds, x.sdkConfigIds, x.socialChannelIds, x.stuckPageIds, x.geoPromptIds,
    x.chatConversationIds, x.subscriberIds,
  ];
  return [x.userId, x.email, x.affiliateId, x.affiliateRefCode, ...lists.flat()]
    .filter((t): t is string => typeof t === 'string' && t.trim().length > 0);
}

/**
 * Kaydedilmis cagrilarin sorunlari (yoksa bos liste):
 *  - her adim TAM BIR cagri yapar;
 *  - cagri etiketlendigi modelin tablosuna gider ve yontemi turune uyar
 *    (delete -> deleteMany, detach -> updateMany);
 *  - filtre bicimi ve kapsami: bkz. scoped-where.ts whereProblem.
 */
export function purgeCallProblems(steps: PurgeStep[], calls: RecordedPurgeCall[], tokens: string[]): string[] {
  const problems: string[] = [];
  steps.forEach((s, i) => {
    const n = calls.filter((c) => c.step === i).length;
    if (n !== 1) problems.push(`#${i} ${s.model}: ${n} çağrı (tam 1 bekleniyor)`);
  });
  for (const c of calls) {
    const label = `#${c.step} ${c.model}`;
    const accessor = c.model[0].toLowerCase() + c.model.slice(1);
    if (c.accessor !== accessor) problems.push(`${label}: ${c.accessor} tablosuna yazıyor (${accessor} bekleniyor)`);
    const method = c.kind === 'delete' ? 'deleteMany' : 'updateMany';
    if (c.method !== method) problems.push(`${label}: ${c.method} (${method} bekleniyor)`);
    const where = whereProblem(c.args?.where, tokens);
    if (where) problems.push(`${label}: ${where}`);
  }
  return problems;
}

/** Plani kaydedip denetler; sorun yoksa bos liste */
export async function purgePlanProblems(steps: PurgeStep[], x: PurgeIds): Promise<string[]> {
  return purgeCallProblems(steps, await recordPurgeCalls(steps), purgeScopeTokens(x));
}
