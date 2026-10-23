import { createHash } from 'node:crypto';
import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { QuotaService } from '../billing/quota.service.js';
import {
  ARTICLE_SHORT_ENGINE, ASPECT_OF, DEFAULT_VIDEO_STYLE, DEFAULT_VIDEO_TEMPO, removeVideoFiles, VIDEO_COMPOSITION, VIDEO_REQUEST_LOCK_MS, VIDEO_STYLE_MESSAGE,
  VIDEO_STYLES, VIDEO_TEMPOS, type VideoFormat, type VideoStyle, type VideoTempo, type VideoType,
} from './article-video.config.js';
import { assertOwnSitePageUrl, PromoSourceError } from './promo-video-source.js';
import { extractSiteBrand, FALLBACK_BRAND_PRIMARY, normalizeHexColor } from './article-video-brand.js';
import { loadBrandKit } from './article-short-kit.js';
import { toVideoView, type ArticleVideoView } from './article-video-view.js';
import { VideoRenderQueue } from './video-render.queue.js';

export interface VideoRequester { id: string; role?: string }
export interface VideoRequestInput {
  /** verilmezse 'article' (eski istemciler) */
  type?: VideoType;
  /** type 'article' */
  articleId?: string;
  /** type 'product': sitenin kendi alan adindaki sayfa */
  pageUrl?: string;
  /** 'vertical' (varsayilan) | 'horizontal' (site ve urun) */
  format?: VideoFormat;
  /** 'normal' (varsayilan) | 'fast' (eski 15 sn) | 'slow' */
  tempo?: VideoTempo;
  /** gorsel stil; verilmezse 'classic' */
  style?: VideoStyle;
  /** #rrggbb; null = sablon rengi (RanksUp turuncusu); verilmezse sitenin rengi */
  primaryColor?: string | null;
  /** false = logo kullanma (bas harf monogrami) */
  useLogo?: boolean;
  brandName?: string | null;
}

/**
 * RanksUp Video — istek, listeleme, silme (API sureci). Render worker'da
 * (video-render.service.ts, 'video-render' kuyrugu).
 *
 * Uc tur: makale (yayindaki makaleden), site tanitimi (sitenin anasayfasi + marka profili), urun
 * tanitimi (sitenin KENDI alan adindaki bir sayfa). Hepsi ayni plan kapisi, ayni aylik hak, ayni
 * kuyruk ve ayni iade kurali.
 *
 * KAPI SIRASI (istekte): kimlik (AuthGuard) -> site sahipligi (SiteAccessGuard) -> plan
 * (@RequiresPlan('articleVideo'), istek sahibinin plani) -> burada: kaynak gecerli (makale bu
 * sitenin ve YAYINDA / urun adresi sitenin alan adinda) -> ayni kaynak icin suren video yok ->
 * site SAHIBININ aylik hakki (kosullu UPDATE) -> Video satiri -> kuyruk. Kuyruga eklenemezse satir FAILED olur ve hak geri verilir.
 * Deneme / Buyume planinda hicbir indirme, model cagrisi ya da render yapilmaz.
 */
@Injectable()
export class VideosService {
  private readonly log = new Logger(VideosService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly quota: QuotaService,
    private readonly queue: VideoRenderQueue,
  ) {}

  /** Yalniz bu ozelligin satirlari (eski Video Factory satirlari listelenmez) */
  private readonly engineWhere = { providerRaw: { path: '$.engine', equals: ARTICLE_SHORT_ENGINE } } as const;

  private async siteOwner(siteId: string) {
    const site = await this.prisma.site.findUnique({
      where: { id: siteId },
      select: { id: true, url: true, name: true, language: true, userId: true, user: { select: { id: true, plan: true, role: true } } },
    });
    if (!site) throw new NotFoundException('Site bulunamadı');
    return site;
  }

  /**
   * Plan kapisinin ikinci yarisi: guard ISTEK SAHIBININ planina bakar; hak ve maliyet site
   * SAHIBINE yazilir. Yonetici (ADMIN) baska birinin sitesinde istekte bulunursa sahibin plani
   * yine aranir (kilitli plana yonetici eliyle video uretilmez); sahibi ADMIN ise serbest.
   */
  private assertOwnerPlan(owner: { plan: string; role: string }) {
    if (owner.role === 'ADMIN') return;
    this.quota.assertPlanFeature(owner.plan, 'articleVideo');
  }

  async list(siteId: string): Promise<ArticleVideoView[]> {
    const rows = await this.prisma.video.findMany({
      where: { siteId, ...this.engineWhere },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    return rows.map((r) => toVideoView(r as any));
  }

  async get(siteId: string, id: string): Promise<ArticleVideoView> {
    const row = await this.prisma.video.findFirst({ where: { id, siteId, ...this.engineWhere } });
    if (!row) throw new NotFoundException('Video bulunamadı');
    return toVideoView(row as any);
  }

  /** Panel: sahibin bu ayki video hakki + ozellik acik mi (kilitli onizleme icin) */
  async quotaFor(siteId: string) {
    const site = await this.siteOwner(siteId);
    const q = await this.quota.checkVideoQuota(site.userId);
    const allowed = site.user.role === 'ADMIN' || q.limit > 0;
    return { allowed, used: q.used, limit: q.limit, remaining: q.remaining, unlimited: q.unlimited };
  }

  /**
   * Diyalog icin marka onizlemesi (ad, renk, logo). Model cagrisi yok; anasayfa ve logo
   * SSRF korumali indirilir. Plan kapisi controller'da + sahibin plani burada.
   * Guvenilmeyen HTML/CSS ayristirmasi bu surecin olay dongusunde DEGIL: extractSiteBrand onu
   * worker_thread'de sert sure siniriyla calistirir (brand-sandbox.ts); tum cikarim 30 sn ile sinirli.
   */
  async brandPreview(siteId: string) {
    const site = await this.siteOwner(siteId);
    this.assertOwnerPlan(site.user);
    const brand = await extractSiteBrand(site, { kit: await loadBrandKit() });
    return {
      name: brand.name,
      domain: brand.domain,
      primary: brand.primary,
      colorSource: brand.colorSource,
      fallbackPrimary: FALLBACK_BRAND_PRIMARY,
      logoDataUri: brand.logoDataUri,
      notes: brand.notes,
    };
  }

  /**
   * Ayni kaynak icin es zamanli iki istegi (cift tiklama, iki sekme) tek SQL'le ayiran kisa
   * omurlu kilit. KvStore.key birincil anahtar: ikinci create unique hatasiyla duser. Suresi
   * gecmis kilit (surec cokmus) silinip bir kez daha denenir. Anahtar (site, tur, kaynak) basina;
   * makalede eskisiyle ayni (`video-istek:<makale>`).
   */
  private async acquireRequestLock(key: string): Promise<string | null> {
    const create = () => this.prisma.kvStore.create({
      data: { key, value: String(process.pid), expiresAt: new Date(Date.now() + VIDEO_REQUEST_LOCK_MS) },
    });
    try {
      await create();
      return key;
    } catch {
      const stale = await this.prisma.kvStore.deleteMany({ where: { key, expiresAt: { lt: new Date() } } }).catch(() => ({ count: 0 }));
      if (stale.count !== 1) return null;
      try {
        await create();
        return key;
      } catch {
        return null;
      }
    }
  }

  /**
   * Istegin kaynagi: tur, bicim, Remotion sablonu, baslik, kilit anahtari, ayni kaynagin suren
   * videosunu bulan kural. Girdi hatasi -> 400 (Turkce), makale yok -> 404, yayinda degil -> 409.
   * Hicbir ag istegi yok: urun adresinin alan adi denetimi yalniz metin uzerinde (asil indirme
   * worker'da, yonlendirmeler dahil yeniden denetlenir).
   */
  private async resolveSource(site: { id: string; url: string; name: string }, input: VideoRequestInput) {
    const type: VideoType = input.type ?? 'article';
    const format: VideoFormat = input.format ?? 'vertical';
    // DTO dogrular; servis dogrudan cagrilirsa (testler, ileride MCP) da ayni kural
    if (input.tempo !== undefined && !(VIDEO_TEMPOS as readonly string[]).includes(input.tempo)) throw new BadRequestException("tempo 'fast', 'normal' ya da 'slow' olmalı.");
    if (input.style !== undefined && !(VIDEO_STYLES as readonly string[]).includes(input.style)) throw new BadRequestException(VIDEO_STYLE_MESSAGE);
    const template = VIDEO_COMPOSITION[type]?.[format];
    if (!template) throw new BadRequestException('Makale videosu yalnız dikey (9:16) biçimde üretilir.');

    if (type === 'article') {
      if (input.pageUrl !== undefined) throw new BadRequestException('Makale videosunda sayfa adresi verilmez.');
      if (!input.articleId) throw new BadRequestException('Makale seçilmedi.');
      const article = await this.prisma.article.findFirst({
        where: { id: input.articleId, siteId: site.id },
        select: { id: true, title: true, status: true, language: true },
      });
      if (!article) throw new NotFoundException('Makale bulunamadı');
      if (article.status !== 'PUBLISHED') {
        throw new ConflictException('Yalnız yayındaki makaleden video üretilebilir. Makaleyi yayınladıktan sonra tekrar dene.');
      }
      return {
        type, format, template,
        articleId: article.id as string | null,
        title: String(article.title ?? 'Makale videosu').slice(0, 180),
        language: String(article.language ?? 'tr').slice(0, 8),
        sourceUrl: null as string | null,
        sourceKey: `article:${article.id}`,
        lockKey: `video-istek:${article.id}`,
        busy: 'Bu makale için video isteği zaten işleniyor. Birkaç saniye sonra listeyi yenile.',
        running: 'Bu makalenin videosu zaten hazırlanıyor. Hazır olunca Videolar sayfasında görünür.',
      };
    }

    if (input.articleId !== undefined) throw new BadRequestException('Tanıtım videosunda makale seçilmez.');
    if (type === 'site') {
      if (input.pageUrl !== undefined) throw new BadRequestException('Site tanıtımı sitenin ana sayfasından üretilir; sayfa adresi verilmez.');
      return {
        type, format, template,
        articleId: null,
        title: `${site.name || hostLabel(site.url)} — site tanıtımı`.slice(0, 180),
        language: null as string | null,
        sourceUrl: site.url,
        sourceKey: `site:${format}`,
        lockKey: `video-istek:${site.id}:site`,
        busy: 'Site tanıtım videosu isteği zaten işleniyor. Birkaç saniye sonra listeyi yenile.',
        running: 'Bu biçimde bir site tanıtım videosu zaten hazırlanıyor. Hazır olunca Videolar sayfasında görünür.',
      };
    }

    let pageUrl: string;
    try {
      pageUrl = assertOwnSitePageUrl(input.pageUrl, site.url);
    } catch (err) {
      if (err instanceof PromoSourceError) throw new BadRequestException(err.userMessage);
      throw err;
    }
    const digest = createHash('sha256').update(pageUrl).digest('hex').slice(0, 24);
    return {
      type, format, template,
      articleId: null,
      title: `Ürün tanıtımı — ${hostLabel(pageUrl, true)}`.slice(0, 180),
      language: null as string | null,
      sourceUrl: pageUrl,
      sourceKey: `product:${format}:${digest}`,
      lockKey: `video-istek:${site.id}:product:${digest}`,
      busy: 'Bu sayfa için video isteği zaten işleniyor. Birkaç saniye sonra listeyi yenile.',
      running: 'Bu sayfanın bu biçimdeki videosu zaten hazırlanıyor. Hazır olunca Videolar sayfasında görünür.',
    };
  }

  async request(siteId: string, requester: VideoRequester, input: VideoRequestInput): Promise<{ video: ArticleVideoView; remaining: number; limit: number }> {
    const site = await this.siteOwner(siteId);
    this.assertOwnerPlan(site.user);
    const src = await this.resolveSource(site, input);

    const lock = await this.acquireRequestLock(src.lockKey);
    if (!lock) throw new ConflictException(src.busy);
    try {
      if (src.articleId) {
        const running = await this.prisma.video.findFirst({
          where: { articleId: src.articleId, status: { in: ['PENDING', 'GENERATING'] }, ...this.engineWhere },
          select: { id: true },
        });
        if (running) throw new ConflictException(src.running);
      } else {
        // Ayni kaynak + bicim icin suren tanitim videosu (JSON alanini JS'te karsilastir: sitenin
        // suren videolari bir avuc; providerRaw yolunda ikinci JSON filtresi gerekmez)
        const rows = await this.prisma.video.findMany({
          where: { siteId, status: { in: ['PENDING', 'GENERATING'] }, ...this.engineWhere },
          select: { id: true, status: true, providerRaw: true },
          take: 50,
        });
        const running = rows.some((r: any) => ['PENDING', 'GENERATING'].includes(r.status) && (r.providerRaw as any)?.sourceKey === src.sourceKey);
        if (running) throw new ConflictException(src.running);
      }

      // Hak dus (kosullu UPDATE) — dolu ise 403, sayac degismez. Uc tur ayni aylik haktan duser.
      const charge = await this.quota.consumeVideoAllowance(site.userId);

      const request = {
        primaryColor: input.primaryColor === null ? null : normalizeHexColor(input.primaryColor) ?? undefined,
        useLogo: input.useLogo !== false,
        brandName: typeof input.brandName === 'string' ? input.brandName.replace(/\s+/g, ' ').trim().slice(0, 60) || undefined : undefined,
      };
      let video;
      try {
        video = await this.prisma.video.create({
          data: {
            siteId,
            articleId: src.articleId,
            title: src.title,
            provider: 'SLIDESHOW',
            status: 'PENDING',
            aspectRatio: ASPECT_OF[src.format],
            language: String(src.language ?? site.language ?? 'tr').slice(0, 8),
            providerRaw: {
              engine: ARTICLE_SHORT_ENGINE,
              template: src.template,
              videoType: src.type,
              format: src.format,
              // Tempo kayitta durur: worker ayni tempoyla render eder (eski kayitta yok -> 'fast')
              tempo: input.tempo ?? DEFAULT_VIDEO_TEMPO,
              // Stil de kayitta: worker ayni stille render eder (eski kayitta yok -> 'classic')
              style: input.style ?? DEFAULT_VIDEO_STYLE,
              ...(src.sourceUrl ? { sourceUrl: src.sourceUrl } : {}),
              sourceKey: src.sourceKey,
              request,
              charged: charge.charged,
              chargedUserId: site.userId,
              requestedBy: requester.id,
            },
          },
        });
      } catch (err) {
        if (charge.charged) await this.quota.refundVideoAllowance(site.userId, new Date());
        throw err;
      }

      try {
        const jobId = await this.queue.add(video.id);
        video = await this.prisma.video.update({ where: { id: video.id }, data: { jobId } });
      } catch (err: any) {
        this.log.error(`[${siteId}] video ${video.id} kuyruga eklenemedi: ${err?.message ?? err}`);
        const failed = await this.prisma.video.updateMany({
          where: { id: video.id, status: 'PENDING' },
          data: { status: 'FAILED', errorMsg: 'Video sıraya alınamadı; hakkın iade edildi. Biraz sonra tekrar dene.', completedAt: new Date() },
        });
        if (failed.count === 1 && charge.charged) await this.quota.refundVideoAllowance(site.userId, video.createdAt);
        throw new ServiceUnavailableException('Video sıraya alınamadı; hakkın iade edildi. Biraz sonra tekrar dene.');
      }
      return { video: toVideoView(video as any), remaining: charge.remaining, limit: charge.limit };
    } finally {
      await this.prisma.kvStore.deleteMany({ where: { key: lock } }).catch(() => undefined);
    }
  }

  /**
   * Sil. Kuyrukta bekleyen (PENDING) video: is kuyruktan cikarilir, satir silinir, hak iade
   * edilir (hicbir sey uretilmedi). Uretimdeki (GENERATING) video silinemez — bitince silinir.
   * Hazir / basarisiz video: dosyalar ve satir silinir (hazir videonun hakki iade edilmez).
   */
  async remove(siteId: string, id: string): Promise<{ ok: true; refunded: boolean }> {
    const row = await this.prisma.video.findFirst({ where: { id, siteId, ...this.engineWhere } });
    if (!row) throw new NotFoundException('Video bulunamadı');
    if (row.status === 'GENERATING') {
      throw new ConflictException('Video şu an üretiliyor; bitince silebilirsin.');
    }
    let refunded = false;
    if (row.status === 'PENDING') {
      await this.queue.remove(row.id).catch(() => false);
      // Kosullu silme: worker isi tam bu anda aldiysa (GENERATING) silinmez, iade de yapilmaz
      const del = await this.prisma.video.deleteMany({ where: { id: row.id, status: 'PENDING' } });
      if (del.count !== 1) throw new ConflictException('Video şu an üretiliyor; bitince silebilirsin.');
      const raw = (row.providerRaw ?? {}) as Record<string, any>;
      if (raw.charged === true && typeof raw.chargedUserId === 'string') {
        refunded = await this.quota.refundVideoAllowance(raw.chargedUserId, row.createdAt);
      }
      return { ok: true, refunded };
    }
    // mp4 + poster + cokmus render'in yarim dosyalari (<id>.mp4.part*)
    await removeVideoFiles(siteId, row.id);
    await this.prisma.video.deleteMany({ where: { id: row.id } });
    return { ok: true, refunded };
  }
}

/** Basliklar icin okunur adres: alan adi (+ yol) */
function hostLabel(url: string, withPath = false): string {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, '');
    return withPath ? `${host}${u.pathname === '/' ? '' : u.pathname}`.slice(0, 140) : host;
  } catch {
    return String(url).slice(0, 140);
  }
}
