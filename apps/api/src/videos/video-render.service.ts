import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { mkdir } from 'node:fs/promises';
import { PrismaService } from '../prisma/prisma.service.js';
import { QuotaService } from '../billing/quota.service.js';
import { LLMProviderService } from '../llm/llm-provider.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { acquireCronLock } from '../common/cron-lock.js';
import {
  ARTICLE_SHORT_ENGINE, removeVideoFiles, VIDEO_COMPOSITION, VIDEO_RENDER_TIMEOUT_MS, VIDEO_STUCK_HARD_MS, VIDEO_STUCK_MS, VIDEO_WATERMARK, videoFiles, videoStyleOf, videoTempoOf,
  type VideoFormat, type VideoStyle, type VideoTempo, type VideoType,
} from './article-video.config.js';
import { applyBrandOverrides, extractSiteBrand, raceSignal, type SiteBrand } from './article-video-brand.js';
import { buildPromoCopy, buildVideoCopy, VideoCopyError, type CopyResult, type PromoCopyResult } from './article-video-copy.js';
import { publishedArticleUrl, shortArticleFromRow, sourcePathOf } from './article-video-source.js';
import {
  assertOwnSitePageUrl, buildPromoSource, extractPromoPage, fetchOwnPage, fetchProductImage, profileFromBrain, PromoSourceError,
  type PromoFetchDeps,
} from './promo-video-source.js';
import {
  loadBrandKit, loadCopyKit, loadExtractKit, loadPromoCopyKit, loadRenderKit,
  type ArticleShortProps, type PromoSource, type PromoType, type PromoVideoProps, type RenderKit, type ShortArticle,
} from './article-short-kit.js';
import { QueueTimeoutError, VideoRenderQueue } from './video-render.queue.js';

/** Kullaniciya gosterilecek (Turkce) hata — errorMsg'a yazilir */
export class VideoRenderError extends Error {
  constructor(public readonly userMessage: string, detail?: string) {
    super(detail ?? userMessage);
  }
}

const GENERIC_FAILURE = 'Video oluşturulurken beklenmeyen bir sorun oldu; video hakkın iade edildi. Tekrar deneyebilirsin.';
const TIMEOUT_FAILURE = 'Video zamanında üretilemedi; video hakkın iade edildi. Tekrar deneyebilirsin.';
/** 'footage' stilinin stok klipleri sunucuda yok (render/article-short.mjs StyleAssetError) */
export const STYLE_ASSETS_FAILURE = 'Bu video stili için gereken görüntü dosyaları sunucuda hazır değil; video hakkın iade edildi. Başka bir stille tekrar deneyebilirsin.';
/** Zaman asiminda iptal edilen isin (Chrome/ffmpeg kapanisi, gecici dosya silme) toparlanmasi icin beklenen en fazla sure */
const ABORT_GRACE_MS = 20_000;

/** Hata -> kullanici metni. Bilinmeyen hatanin ic ayrintisi (yol, yigin) kullaniciya gosterilmez. */
export function userMessageOf(err: unknown): string {
  if (err instanceof VideoRenderError || err instanceof VideoCopyError || err instanceof PromoSourceError) return err.userMessage;
  if ((err as any)?.code === 'VIDEO_STYLE_ASSETS_MISSING') return STYLE_ASSETS_FAILURE;
  const msg = String((err as any)?.message ?? '');
  if (/Failed to launch|shared librar|libnss3|libgbm|Could not find Chrome|browser/i.test(msg)) {
    return 'Video sunucusunda tarayıcı başlatılamadı; video hakkın iade edildi. Ekibimiz bilgilendirildi, daha sonra tekrar dene.';
  }
  if (/ENOSPC/.test(msg)) return 'Video sunucusunda yer kalmadı; video hakkın iade edildi. Daha sonra tekrar dene.';
  return GENERIC_FAILURE;
}

/**
 * Render oncesi sablon props'u: metin + marka + kaynak yolu + tempo + stil. tempo ve stil HER ZAMAN acik
 * gonderilir: Remotion defaultProps'u 'normal' / 'classic'; alan eksik kalsa eski kayit yanlis tempoyla cikardi.
 */
export function buildArticleShortProps(copy: CopyResult, brand: SiteBrand, article: ShortArticle, tempo: VideoTempo = 'fast', style: VideoStyle = 'classic'): ArticleShortProps {
  const s = copy.script;
  return {
    hook: s.hook,
    ...(s.hookSub ? { hookSub: s.hookSub } : {}),
    // Bos dize BILEREK gonderilir: Remotion inputProps'u kompozisyonun defaultProps'uyla
    // birlestirir; alan hic yoksa sablonun ornek ust etiketi ("Örnek içerik") videoya sizar
    kicker: s.kicker ?? '',
    points: s.points.map((p) => (p.detail ? { title: p.title, detail: p.detail } : { title: p.title })),
    cta: { label: s.cta.label, domain: s.cta.domain, ...(s.cta.url ? { url: s.cta.url } : {}) },
    brand: {
      name: brand.name,
      domain: brand.domain || article.domain,
      ...(brand.primary ? { primary: brand.primary } : {}),
      ...(brand.logoDataUri ? { logoUrl: brand.logoDataUri } : {}),
    },
    sourcePath: sourcePathOf(article.url, article.domain),
    muted: false,
    watermark: VIDEO_WATERMARK,
    tempo,
    style,
  };
}

/**
 * Tanitim videosu props'u: metin + marka (+ urunde gorsel ve YALNIZ dogrulanmis fiyat). Istege
 * bagli alanlar bos dizeyle gonderilir (Remotion defaultProps birlestirmesi ornek metni sizdirmasin).
 */
export function buildPromoProps(
  copy: PromoCopyResult,
  brand: SiteBrand,
  source: PromoSource,
  extra: { image?: string | null; price?: string | null; tempo?: VideoTempo; style?: VideoStyle } = {},
): PromoVideoProps {
  const s = copy.script;
  return {
    hook: s.hook,
    hookSub: s.hookSub ?? '',
    kicker: s.kicker ?? '',
    points: s.points.map((p) => (p.detail ? { title: p.title, detail: p.detail } : { title: p.title })),
    cta: { label: s.cta.label, domain: s.cta.domain, ...(s.cta.url ? { url: s.cta.url } : {}) },
    brand: {
      name: brand.name,
      domain: brand.domain || source.domain,
      ...(brand.primary ? { primary: brand.primary } : {}),
      ...(brand.logoDataUri ? { logoUrl: brand.logoDataUri } : {}),
    },
    image: extra.image ?? '',
    price: extra.price ?? '',
    muted: false,
    watermark: VIDEO_WATERMARK,
    tempo: extra.tempo ?? 'fast',
    style: extra.style ?? 'classic',
  };
}

export interface RenderDeps {
  renderKit: () => Promise<RenderKit>;
  brand: typeof extractSiteBrand;
}

/**
 * RanksUp Video — worker tarafi: 'video-render' kuyrugunun isini isler (apps/worker,
 * eszamanlilik 1). API surecinde yalniz supurucu cron'u calisir (cift-calisma kilidiyle).
 *
 * process(videoId):
 *  1) Sahiplen: PENDING|GENERATING -> GENERATING (kosullu UPDATE). Satir yoksa (silinmis) ya
 *     da READY/FAILED ise is atlanir — ayni video iki kez islenmez.
 *  2) Makale DB'den (yayinda olmali) YA DA tanitimda sitenin kendi sayfasi (anasayfa / urun
 *     sayfasi; alan adi disina yonlendirme yok, ayristirma is parcaciginda), marka sitenin
 *     anasayfasindan (SSRF korumali), metin Haiku 5.5 + zorunlu koruyucu, olmazsa cikarimsal.
 *     Urunde gorsel safe-fetch + sharp, fiyat yalniz iki kaynakla dogrulanmissa.
 *  3) Remotion render (paket bir kez kurulur, surecte yeniden kullanilir), loudnorm, poster ->
 *     apps/api/public/videos/<siteId>/<videoId>.{mp4,jpg} (nginx /videos/).
 *  4) READY + boyut/sure; bildirim. Herhangi bir hata -> markFailed: FAILED + Turkce hata +
 *     hak iadesi (YALNIZ durum gecisini yapan cagri iade eder: cift iade yok).
 */
@Injectable()
export class VideoRenderService {
  private readonly log = new Logger(VideoRenderService.name);
  /** Testte sahte render / marka verilir; uretimde apps/video modulleri */
  deps: RenderDeps = { renderKit: loadRenderKit, brand: extractSiteBrand };
  /** Tanitim videolarinin indirme / ayristirma kancalari (testte sahte; uretimde safe-fetch + is parcacigi) */
  promoDeps: PromoFetchDeps = {};
  /** Tek isin toplam suresi (testte kisaltilir) */
  timeoutMs = VIDEO_RENDER_TIMEOUT_MS;
  abortGraceMs = ABORT_GRACE_MS;

  constructor(
    private readonly prisma: PrismaService,
    private readonly quota: QuotaService,
    private readonly llm: LLMProviderService,
    private readonly notifications: NotificationsService,
    private readonly queue: VideoRenderQueue,
  ) {}

  async process(videoId: string): Promise<{ status: 'ready' | 'failed' | 'skipped'; reason?: string }> {
    const claim = await this.prisma.video.updateMany({
      where: { id: videoId, status: { in: ['PENDING', 'GENERATING'] } },
      data: { status: 'GENERATING', startedAt: new Date(), errorMsg: null },
    });
    if (claim.count !== 1) return { status: 'skipped', reason: 'video yok ya da islenmis' };

    const video = await this.prisma.video.findUnique({
      where: { id: videoId },
      include: {
        article: { select: { id: true, title: true, status: true, language: true, category: true, metaDescription: true, bodyMd: true, bodyHtml: true, publishedTo: true } },
        site: { select: { id: true, url: true, name: true, language: true, niche: true, customNiche: true, userId: true, user: { select: { id: true, deletionRequestedAt: true } } } },
      },
    });
    if (!video) return { status: 'skipped', reason: 'video silindi' };
    const raw = (video.providerRaw ?? {}) as Record<string, any>;
    const files = videoFiles(video.siteId, video.id);
    const t0 = Date.now();

    // TOPLAM SURE: kuyruk eszamanliligi 1 — takilan tek is herkesi bekletir. Sure dolunca sinyal
    // kesilir: marka indirmeleri birakilir, Remotion Chrome'u ve ffmpeg oldurulur (render kiti
    // signal'i dinler), is FAILED + tek iade olur.
    const ac = new AbortController();
    const timer = setTimeout(
      () => ac.abort(new VideoRenderError(TIMEOUT_FAILURE, `toplam sure asildi (${Math.round(this.timeoutMs / 1000)} sn)`)),
      this.timeoutMs,
    );
    const signal = ac.signal;
    const work = this.run(video, raw, files, t0, signal);
    try {
      return await raceSignal(work, signal);
    } catch (err: any) {
      // Hata (ya da zaman asimi): hala calisan adimlar varsa durdur ve toparlanmalarini kisa
      // sure bekle — oldurulen Chrome/ffmpeg'in gecici dosyalari silinsin, sonraki is yarismasin
      if (!signal.aborted) ac.abort(err);
      await Promise.race([work.catch(() => undefined), new Promise((r) => setTimeout(r, this.abortGraceMs).unref?.())]);
      this.log.error(`[${video.siteId}] video ${videoId} basarisiz: ${err?.message ?? err}`);
      await removeVideoFiles(video.siteId, video.id);
      await this.markFailed(videoId, userMessageOf(err), String(err?.message ?? err).slice(0, 1000));
      return { status: 'failed', reason: userMessageOf(err) };
    } finally {
      clearTimeout(timer);
    }
  }

  private async run(
    video: any,
    raw: Record<string, any>,
    files: ReturnType<typeof videoFiles>,
    t0: number,
    signal: AbortSignal,
  ): Promise<{ status: 'ready' | 'skipped'; reason?: string }> {
    const videoId = video.id as string;
    if (video.site.user?.deletionRequestedAt) throw new VideoRenderError('Hesap için silme talebi var; video üretilmedi.');
    const type: VideoType = raw.videoType === 'site' || raw.videoType === 'product' ? raw.videoType : 'article';
    const format: VideoFormat = raw.format === 'horizontal' ? 'horizontal' : 'vertical';
    const compositionId = VIDEO_COMPOSITION[type][format];
    if (!compositionId) throw new VideoRenderError(GENERIC_FAILURE, `gecersiz tur/bicim: ${type}/${format}`);
    // Istekte kaydedilen tempo; alan yoksa (bu ozellikten onceki is) eski sabit izgara
    const tempo = videoTempoOf(raw);
    // Istekte kaydedilen stil; alan yoksa / liste disiysa bugunku tasarim (render hatti ayrica izin listesiyle dogrular)
    const style = videoStyleOf(raw);
    // Stilin dosyalari (footage stok klipleri) EN BASTA: eksikse metin modeli ve marka indirmesi hic calismaz,
    // is FAILED + iade (LLM maliyeti yok). Render hatti render'dan once ayrica denetler.
    const kit = await this.deps.renderKit();
    kit.assertStyleAssets?.(style);

    const job = type === 'article' ? await this.prepareArticle(video, raw, tempo, style, signal) : await this.preparePromo(video, raw, type, tempo, style, signal);
    signal.throwIfAborted();

    await mkdir(files.dir, { recursive: true });
    const result = await kit.renderArticleShort({ props: job.props, compositionId, outFile: files.mp4, posterFile: files.poster, concurrency: kit.renderConcurrency(), signal });
    // Sure tam bu anda dolduysa READY yazilmaz (markFailed zaten yazmis / yazacak)
    signal.throwIfAborted();

    const p = job.props;
    const brand = job.brand;
    const copy = job.copy;
    const done = await this.prisma.video.updateMany({
      where: { id: videoId, status: 'GENERATING' },
      data: {
        status: 'READY',
        ...(job.title ? { title: job.title.slice(0, 180) } : {}),
        videoUrl: files.videoUrl,
        thumbnailUrl: files.posterUrl,
        fileSize: result.bytes,
        durationSec: Math.round(result.durationSec),
        scriptText: JSON.stringify({ hook: p.hook, hookSub: p.hookSub || null, kicker: p.kicker || null, points: p.points, cta: p.cta, ...('price' in p && p.price ? { price: p.price } : {}) }),
        costUsd: copy.costUsd,
        completedAt: new Date(),
        errorMsg: null,
        providerRaw: {
          ...raw,
          engine: ARTICLE_SHORT_ENGINE,
          template: compositionId,
          brand: { name: brand.name, domain: brand.domain, primary: brand.primary, colorSource: brand.colorSource, hasLogo: !!brand.logoDataUri, logoSource: brand.logoSource, notes: brand.notes },
          copy: { strategy: copy.strategy, llmRejected: copy.llmRejected ?? null, warnings: copy.check.warnings, novelRatio: copy.check.novelRatio, evidence: copy.script.evidence.slice(0, 12) },
          render: { ...result, totalSec: Number(((Date.now() - t0) / 1000).toFixed(1)) },
          pageUrl: job.pageUrl,
          ...(job.source ? { source: job.source } : {}),
        } as any,
      },
    });
    if (done.count !== 1) {
      // Video render sirasinda silindi (ya da FAILED yazildi): dosya sahipsiz kalmasin
      await removeVideoFiles(video.siteId, videoId);
      return { status: 'skipped', reason: 'render sirasinda silindi' };
    }
    this.log.log(`[${video.siteId}] video ${videoId} hazir — ${type}/${format}/${tempo}/${style}, ${copy.strategy}, ${Math.round(result.durationSec)} sn video, ${(result.bytes / 1048576).toFixed(1)} MB, ${((Date.now() - t0) / 1000).toFixed(1)} sn`);
    await this.notify(video.site.userId, video.siteId, 'Videon hazır', job.readyText(Math.round(result.durationSec)));
    return { status: 'ready' };
  }

  /** Makale videosu: makale DB'den, marka anasayfadan, metin Haiku + koruyucu (degismedi) */
  private async prepareArticle(video: any, raw: Record<string, any>, tempo: VideoTempo, style: VideoStyle, signal: AbortSignal) {
    const a = video.article;
    if (!a) throw new VideoRenderError('Makale silinmiş; video üretilemedi. Video hakkın iade edildi.');
    if (a.status !== 'PUBLISHED') throw new VideoRenderError('Makale artık yayında değil; video üretilemedi. Video hakkın iade edildi.');

    const pageUrl = publishedArticleUrl(a.publishedTo, video.site.url) ?? video.site.url;
    const article = shortArticleFromRow(await loadExtractKit(), a, pageUrl);
    if (!article) throw new VideoRenderError('Makalenin metni bulunamadı; video üretilemedi. Video hakkın iade edildi.');

    const brand = applyBrandOverrides(await this.deps.brand(video.site, { kit: await loadBrandKit(), signal }), raw.request);
    signal.throwIfAborted();

    const userId = video.site.userId;
    const copy: CopyResult = await buildVideoCopy(article, { userId, siteId: video.siteId, videoId: video.id }, {
      kit: await loadCopyKit(),
      chat: (req) => this.llm.chat(req),
      budgetBlocked: async () => (await this.quota.checkAiCostBudget(userId)).hardBlock,
    });
    return {
      props: buildArticleShortProps(copy, brand, article, tempo, style) as ArticleShortProps | PromoVideoProps,
      brand,
      copy: copy as CopyResult | PromoCopyResult,
      pageUrl,
      title: null as string | null,
      source: null as Record<string, unknown> | null,
      readyText: (sec: number) => `“${video.title}” makalesinin ${sec} saniyelik videosu hazır.`,
    };
  }

  /**
   * Site / urun tanitim videosu. Kaynak sitenin KENDI sayfasi (urun adresi alan adi disina,
   * yonlendirmeyle bile, cikamaz), ayristirma is parcaciginda, marka profili DB'den (Brain),
   * metin Haiku + koruyucu (sayi kumesi yalniz sitenin metni), urun gorseli safe-fetch + sharp,
   * fiyat yalniz iki kaynakla dogrulanmissa ve sayi korumasindan gecerse.
   */
  private async preparePromo(video: any, raw: Record<string, any>, type: PromoType, tempo: VideoTempo, style: VideoStyle, signal: AbortSignal) {
    const siteUrl = String(video.site.url);
    let pageUrl: string;
    try {
      // Istekte denetlendi; kayit sonradan degismis olabilir (site adresi duzenlendi) — yeniden
      pageUrl = type === 'site' ? new URL(siteUrl).toString() : assertOwnSitePageUrl(raw.sourceUrl, siteUrl);
    } catch (err) {
      if (err instanceof PromoSourceError) throw new VideoRenderError(`${err.userMessage} Video hakkın iade edildi.`, err.message);
      throw new VideoRenderError('Sitenin adresi okunamadı; video üretilemedi. Video hakkın iade edildi.');
    }
    const deps = this.promoDeps;
    const page = await raceSignal(fetchOwnPage(pageUrl, siteUrl, deps), signal);
    const extracted = await raceSignal(extractPromoPage(page.text, page.url, type, deps), signal);
    signal.throwIfAborted();

    // Marka: site tanitiminda anasayfa zaten elde — ikinci kez indirilmez
    const brand = applyBrandOverrides(
      await this.deps.brand(video.site, { kit: await loadBrandKit(), signal, ...(type === 'site' ? { page } : {}) }),
      raw.request,
    );
    signal.throwIfAborted();

    const brain = type === 'site'
      ? await this.prisma.brain.findUnique({ where: { siteId: video.siteId }, select: { brandVoice: true, sitePages: true } }).catch(() => null)
      : null;
    const source = buildPromoSource(extracted, { type, siteUrl, siteLanguage: video.site.language, profile: profileFromBrain(video.site, brain) });

    const userId = video.site.userId;
    const copyKit = await loadPromoCopyKit();
    const copy = await buildPromoCopy(source, { userId, siteId: video.siteId, videoId: video.id }, {
      kit: copyKit,
      chat: (req) => this.llm.chat(req),
      budgetBlocked: async () => (await this.quota.checkAiCostBudget(userId)).hardBlock,
    });
    signal.throwIfAborted();

    const notes: string[] = [];
    const image = type === 'product' ? await raceSignal(fetchProductImage(extracted.images, deps, notes), signal) : null;
    if (type === 'product' && !image) notes.push('urun gorseli yok — marka karosu kullanildi');
    // Fiyat: iki kaynak (page.mjs verifyPrice) + gosterilecek yazim sayi korumasindan gecer
    const priceOk = type === 'product' && extracted.price.verified && copyKit.verifyPriceText(extracted.price.display, source);
    const price = priceOk ? extracted.price.display! : null;

    const name = type === 'product' ? (extracted.product?.name || copy.script.hook).replace(/\s+/g, ' ').trim() : null;
    return {
      props: buildPromoProps(copy, brand, source, { image: image?.dataUri ?? null, price, tempo, style }) as ArticleShortProps | PromoVideoProps,
      brand,
      copy: copy as CopyResult | PromoCopyResult,
      pageUrl: page.url,
      title: type === 'product' && name ? name : null,
      source: {
        url: page.url,
        lang: source.lang,
        price: { shown: !!price, verified: extracted.price.verified, sources: extracted.price.sources, reason: extracted.price.reason ?? null },
        image: image ? { source: image.source.slice(0, 500), width: image.width, height: image.height } : null,
        profile: source.profile ? { niche: source.profile.niche, pages: source.profile.pages.length } : null,
        notes: notes.slice(0, 8),
      } as Record<string, unknown>,
      readyText: (sec: number) => (type === 'site'
        ? `${brand.name} site tanıtım videosu (${sec} sn) hazır.`
        : `“${(name ?? video.title).slice(0, 120)}” ürün tanıtım videosu (${sec} sn) hazır.`),
    };
  }

  /**
   * FAILED + hak iadesi. Durum gecisi kosullu (yalniz PENDING|GENERATING'den): ayni videoyu
   * ikinci kez basarisiz sayan cagri (worker 'failed' olayi, supurucu) iade YAPMAZ.
   */
  async markFailed(videoId: string, userMessage: string, detail?: string): Promise<boolean> {
    const row = await this.prisma.video.findUnique({ where: { id: videoId }, select: { id: true, siteId: true, title: true, createdAt: true, providerRaw: true } });
    if (!row) return false;
    const raw = (row.providerRaw ?? {}) as Record<string, any>;
    const r = await this.prisma.video.updateMany({
      where: { id: videoId, status: { in: ['PENDING', 'GENERATING'] } },
      data: {
        status: 'FAILED',
        errorMsg: userMessage.slice(0, 500),
        completedAt: new Date(),
        providerRaw: { ...raw, errorDetail: detail ? detail.slice(0, 1000) : null } as any,
      },
    });
    if (r.count !== 1) return false;
    // Cokmus render'in yarim dosyalari (<id>.mp4.part*) herkese acik dizinde kalmasin
    await removeVideoFiles(row.siteId, row.id);
    let refunded = false;
    if (raw.charged === true && typeof raw.chargedUserId === 'string') {
      refunded = await this.quota.refundVideoAllowance(raw.chargedUserId, row.createdAt);
    }
    if (typeof raw.chargedUserId === 'string') {
      await this.notify(raw.chargedUserId, row.siteId, 'Video üretilemedi', `“${row.title}”: ${userMessage}`);
    }
    this.log.warn(`video ${videoId} FAILED${refunded ? ' (hak iade edildi)' : ''}: ${detail ?? userMessage}`);
    return true;
  }

  private async notify(userId: string, siteId: string, title: string, body: string) {
    await this.notifications.create({
      userId,
      type: 'SYSTEM',
      title,
      body: body.slice(0, 500),
      link: `/sites/${siteId}/videos`,
      refKind: 'video',
      channels: ['inapp'],
    }).catch((e: any) => this.log.warn(`Video bildirimi yazilamadi: ${e?.message ?? e}`));
  }

  /**
   * Takili video supurucusu (saatte bir, API + worker'da cift-calisma kilidiyle). Worker
   * cokup is kaybolursa (stalled -> failed, Redis kaybi) video GENERATING/PENDING'de takili
   * kalir ve hak geri donmez; bu tur onlari FAILED yapar ve hakki iade eder.
   */
  @Cron('23 * * * *')
  async sweepStuckCron() {
    if (!(await acquireCronLock(this.prisma, 'video-stuck-sweep', 'hourly'))) return;
    await this.sweepStuck().catch((e: any) => this.log.warn(`Video supurucusu: ${e?.message ?? e}`));
  }

  async sweepStuck(now: Date = new Date()): Promise<number> {
    const rows = await this.prisma.video.findMany({
      where: {
        status: { in: ['PENDING', 'GENERATING'] },
        updatedAt: { lt: new Date(now.getTime() - VIDEO_STUCK_MS) },
        providerRaw: { path: '$.engine', equals: ARTICLE_SHORT_ENGINE },
      },
      select: { id: true, updatedAt: true },
      take: 200,
    });
    let failed = 0;
    // Redis yanit vermiyorsa (state zaman asimi) kalan satirlar icin tekrar 10'ar sn beklenmez
    let redisDown = false;
    for (const r of rows) {
      const state = redisDown
        ? 'unknown'
        : await this.queue.state(r.id).catch((e: unknown) => {
          if (e instanceof QueueTimeoutError) redisDown = true;
          return 'unknown';
        });
      const live = ['waiting', 'active', 'delayed', 'prioritized', 'waiting-children'].includes(state);
      const hard = now.getTime() - r.updatedAt.getTime() > VIDEO_STUCK_HARD_MS;
      if (live && !hard) continue;
      if (await this.markFailed(r.id, 'Video zamanında üretilemedi; video hakkın iade edildi. Tekrar deneyebilirsin.', `supurucu: kuyruk durumu ${state}`)) failed++;
    }
    return failed;
  }
}
