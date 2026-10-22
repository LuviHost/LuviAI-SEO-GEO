/**
 * YAYIN ONAYI — Site.publishApprovalMode'un tek okuma noktasi.
 *
 * NEDEN VAR: panel varsayilan modu "Yari otomatik: her yazi yayinlanmadan
 * once onayini bekler" diye anlatiyor (schema.prisma varsayilani
 * 'manual_approve'), ama mod hicbir yerde okunmuyordu. Zamanlayici varsayilan
 * yayin hedefi varsa autoPublish:true koyuyor, icerik pivotu autoPublish:true
 * gonderiyor, takili sayfa otopilotu yaziyi onaysiz yeniden yayinliyordu.
 * Yari otomatikteki musterinin yazilari onayi beklenmeden canliya cikiyordu.
 *
 * Kural: OTOMASYON (zamanlayici, "Simdi uret", pivot, takili sayfa otopilotu)
 * yalniz site Tam otomatikteyse VE otomatik akis aciksa yayinlar. Panel uc
 * durumu boyle gosterir (web site-overview-dashboard AutopilotControl): akis
 * kapali → "Durduruldu", acik + auto_publish → "Tam otomatik", aksi halde
 * "Yari otomatik". Durduruldu'da kayitli mod auto_publish kalsa da panel onu
 * Tam otomatik gostermez; burada da yayinlanmaz.
 *
 * Mevcut onay akisi (degismedi): yazi READY_TO_PUBLISH'te kalir, pipeline
 * "onayini bekliyor" e-postasini atar (pipeline.service notifyArticleReady),
 * panel "N yazi onayini bekliyor" adimini gosterir, kullanici yazinin
 * sayfasindan yayinlar (POST /sites/:siteId/articles/:id/publish →
 * PUBLISH_ARTICLE).
 */

export const AUTO_PUBLISH_MODE = 'auto_publish';

/**
 * Yeni sitenin varsayilan modu: Yari otomatik (her yazi onayini bekler). Sahip karari
 * (21.10.2026) her plan icin. Sema varsayilani da bu; SitesService.create yine de acikca
 * yazar ki sema varsayilani degisse bile yeni siteler onaysiz yayinla baslamasin.
 */
export const DEFAULT_PUBLISH_APPROVAL_MODE = 'manual_approve';

/** Kararin okudugu site alanlari (Prisma Site satirinin alt kumesi) */
export interface PublishApprovalSite {
  publishApprovalMode?: string | null;
  autopilot?: boolean | null;
}

/**
 * Otomasyon bu sitede onaysiz yayinlayabilir mi?
 * Alan secilmemisse (undefined) HAYIR: onaysiz yayin geri alinamaz bir dis
 * yazma, belirsizlikte guvenli yon onay beklemektir.
 */
export function autoPublishEnabled(site: PublishApprovalSite | null | undefined): boolean {
  return site?.autopilot === true && site.publishApprovalMode === AUTO_PUBLISH_MODE;
}

/**
 * Otomasyonun kuyruga attigi GENERATE_ARTICLE isinin yayin alanlari.
 * Yari otomatik / Durduruldu'da varsayilan hedef olsa bile autoPublish false;
 * hedefler yine yazilir (is kaydinda gorunsun), yayin onaya kalir.
 */
export function automationPublishFields(
  site: PublishApprovalSite | null | undefined,
  defaultTargetIds: string[],
): { autoPublish: boolean; targetIds: string[] } {
  return { autoPublish: autoPublishEnabled(site) && defaultTargetIds.length > 0, targetIds: defaultTargetIds };
}

export type GeneratedArticlePublishDecision =
  /** user_approved: hedefleri kullanicinin sectigi istek; auto_publish: site su an Tam otomatik */
  | { publish: true; reason: 'user_approved' | 'auto_publish'; targetIds: string[] }
  | { publish: false; reason: 'not_requested' | 'manual_approve' | 'paused' | 'site_missing' };

/** Worker GENERATE_ARTICLE is verisindeki yayin alanlari */
export interface GenerateJobPublishInput {
  siteId: string;
  autoPublish?: unknown;
  /** Kullanici hedef secip yayini ACIKCA istedi (onayin kendisi) — otomasyon bunu koymaz */
  publishApproved?: unknown;
  targetIds?: unknown;
}

type SiteApprovalReader = {
  site: { findUnique(args: { where: { id: string }; select: { autopilot: true; publishApprovalMode: true } }): Promise<PublishApprovalSite | null> };
};

/**
 * Uretim bitince yazi yayinlansin mi? Karar IS KOSARKEN verilir, kuyruga
 * girerken degil: takvimdeki gecikmeli isler haftalar sonra ateslenir ve
 * kuyrukta bu duzeltmeden onceki kurala gore autoPublish:true yazilmis isler
 * de var. Arada Yari otomatige gecen ya da akisi durduran musterinin yazisi
 * yayinlanmaz.
 *
 * Otomasyon yayininda hedefler is verisinden DEGIL yayin anindaki guncel
 * hedeflerden gelir (bos dizi → PublisherService secer, republish-policy.ts
 * selectPublishTargets): yazi hic yayinlanmadiysa varsayilan + aktif hedefler,
 * zaten yayindaysa (pivot, kapali dongu) yayinda oldugu AKTIF hedefler — yayindan
 * sonra degisen varsayilan hedefe ikinci kopya acilmaz. Is kuyruga girdikten
 * sonra kapatilan hedefe yayin yapilmaz.
 */
export async function decideGeneratedArticlePublish(
  prisma: SiteApprovalReader,
  job: GenerateJobPublishInput,
): Promise<GeneratedArticlePublishDecision> {
  if (job.autoPublish !== true) return { publish: false, reason: 'not_requested' };
  if (job.publishApproved === true) {
    const targetIds = Array.isArray(job.targetIds) ? job.targetIds.filter((t): t is string => typeof t === 'string') : [];
    return { publish: true, reason: 'user_approved', targetIds };
  }
  const site = await prisma.site.findUnique({
    where: { id: job.siteId },
    select: { autopilot: true, publishApprovalMode: true },
  });
  if (!site) return { publish: false, reason: 'site_missing' };
  if (site.autopilot !== true) return { publish: false, reason: 'paused' };
  if (!autoPublishEnabled(site)) return { publish: false, reason: 'manual_approve' };
  return { publish: true, reason: 'auto_publish', targetIds: [] };
}

type ScheduledArticleReader = {
  article: {
    findUnique(args: {
      where: { id: string };
      select: { status: true; site: { select: { autopilot: true } } };
    }): Promise<{ status: string; site: { autopilot: boolean | null } | null } | null>;
  };
};

/**
 * Takvim isi ateslendiginde site "Durduruldu" mu? Oyleyse uretim YAPILMAZ:
 * panel bu durumu "Otomatik akış kapalı. Yeni yazı üretilmiyor" diye anlatiyor,
 * ama gecikmeli takvim isleri ve saatlik tarama akisa hic bakmadan uretiyordu.
 * Yazi SCHEDULED kalir; akis acilinca saatlik tarama (processDueArticles) alir.
 *
 * Takvim isi = yazi is basladiginda hala SCHEDULED. Kullanicinin "Simdi uret"i,
 * "Uret", onboarding'in ilk yazisi ve saatlik tarama yaziyi kuyruga atmadan once
 * GENERATING yapar — acik kullanici istekleri durdurmadan etkilenmez.
 * Akis bilgisi yoksa uretilir (eski davranis): uretim dis yazma degildir.
 */
export async function scheduledGenerationPaused(
  prisma: ScheduledArticleReader,
  job: { articleId?: unknown },
): Promise<boolean> {
  if (typeof job.articleId !== 'string' || !job.articleId) return false;
  const article = await prisma.article.findUnique({
    where: { id: job.articleId },
    select: { status: true, site: { select: { autopilot: true } } },
  });
  return article?.status === 'SCHEDULED' && article.site?.autopilot === false;
}

/** Is sonucuna / loga yazilan kisa Turkce aciklama */
export const PUBLISH_SKIP_TEXT: Record<Exclude<GeneratedArticlePublishDecision['reason'], 'user_approved' | 'auto_publish'>, string> = {
  not_requested: 'Otomatik yayın istenmedi; yazı onayını bekliyor.',
  manual_approve: 'Site Yarı otomatik modda; yazı yayınlanmadı, onayını bekliyor.',
  paused: 'Otomatik akış durdurulmuş; yazı yayınlanmadı, onayını bekliyor.',
  site_missing: 'Site bulunamadı; yazı yayınlanmadı.',
};
