import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma, AppStore, KeywordSource } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { AsoScrapersService } from './scrapers.service.js';
import { AsoKeywordService } from './keyword.service.js';
import { AsoTrackerService } from './tracker.service.js';
import { AsoReviewsService } from './reviews.service.js';
import { AsoAiAgentService } from './ai-agent.service.js';

export interface ConnectAppDto {
  siteId: string;
  appStoreId?: string;
  playStoreId?: string;
  country?: string;
}

@Injectable()
export class AsoService {
  private readonly log = new Logger(AsoService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly scrapers: AsoScrapersService,
    private readonly keywords: AsoKeywordService,
    private readonly tracker: AsoTrackerService,
    private readonly reviews: AsoReviewsService,
    private readonly aiAgent: AsoAiAgentService,
  ) {}

  // ─────────────────────────────────────────────
  //  App search — name → store result list
  // ─────────────────────────────────────────────

  /**
   * Hem App Store hem Play Store'da arar.
   * URL parse fallback: kullanıcı URL yapıştırırsa, ID/package'ı çıkarır + tek app döner.
   */
  async searchApps(opts: {
    term: string;
    store?: 'IOS' | 'ANDROID' | 'BOTH';
    country?: string;
  }) {
    const term = opts.term.trim();
    if (!term) return { results: [] as any[] };

    // URL detection
    const urlInfo = this.parseAppUrl(term);
    if (urlInfo) {
      const country = opts.country ?? urlInfo.country ?? 'tr';
      const app: any = urlInfo.store === 'IOS'
        ? await this.scrapers.getIosApp({ id: urlInfo.id, country })
        : await this.scrapers.getAndroidApp({ appId: urlInfo.id, country });
      if (!app) return { results: [], parsedUrl: urlInfo };
      return {
        parsedUrl: urlInfo,
        results: [{
          id: urlInfo.id,
          store: urlInfo.store,
          name: app.title,
          developer: app.developer,
          icon: app.icon,
          rating: app.score ?? null,
          reviewCount: app.reviews ?? null,
          category: app.primaryGenre ?? app.genre ?? null,
        }],
      };
    }

    // Regular search
    const country = opts.country ?? 'tr';
    const store = opts.store ?? 'BOTH';
    const promises: Promise<any[]>[] = [];

    if (store === 'IOS' || store === 'BOTH') {
      promises.push(
        this.scrapers.iosSearch({ term, country, num: 15 })
          .then(arr => arr.map((a: any) => ({
            id: String(a.id ?? a.appId),
            store: 'IOS' as const,
            name: a.title,
            developer: a.developer,
            icon: a.icon,
            rating: a.score ?? null,
            reviewCount: a.reviews ?? null,
            category: a.primaryGenre ?? null,
          })))
          .catch(() => [])
      );
    }
    if (store === 'ANDROID' || store === 'BOTH') {
      promises.push(
        this.scrapers.androidSearch({ term, country, num: 15 })
          .then(arr => arr.map((a: any) => ({
            id: a.appId,
            store: 'ANDROID' as const,
            name: a.title,
            developer: a.developer,
            icon: a.icon,
            rating: a.score ?? null,
            reviewCount: a.reviews ?? null,
            category: a.genre ?? null,
          })))
          .catch(() => [])
      );
    }

    const results = (await Promise.all(promises)).flat();
    return { results };
  }

  /**
   * URL'den iOS app id veya Android package çıkarır.
   * Desteklenen formatlar:
   * - https://apps.apple.com/tr/app/luvihost/id6444904356
   * - https://apps.apple.com/app/id6444904356
   * - https://play.google.com/store/apps/details?id=com.example.app
   */
  parseAppUrl(input: string): { store: 'IOS' | 'ANDROID'; id: string; country?: string } | null {
    const s = input.trim();
    if (!s.includes('://')) return null;
    try {
      const url = new URL(s);
      const host = url.hostname.toLowerCase();
      if (host.includes('apple.com')) {
        const m = url.pathname.match(/\/id(\d+)/);
        if (m) {
          const cc = url.pathname.match(/^\/([a-z]{2})\//);
          return { store: 'IOS', id: m[1], country: cc ? cc[1] : undefined };
        }
      }
      if (host.includes('play.google.com')) {
        const id = url.searchParams.get('id');
        if (id) {
          const gl = url.searchParams.get('gl');
          return { store: 'ANDROID', id, country: gl ? gl.toLowerCase() : undefined };
        }
      }
    } catch {
      // ignore
    }
    return null;
  }

  // ─────────────────────────────────────────────
  //  App connect / list / delete
  // ─────────────────────────────────────────────

  async connectApp(dto: ConnectAppDto) {
    if (!dto.appStoreId && !dto.playStoreId) {
      throw new BadRequestException('App Store ID veya Play Store ID gerekli');
    }

    // Metadata fetch
    const country = dto.country ?? 'tr';
    const ios = dto.appStoreId
      ? await this.scrapers.getIosApp({ id: dto.appStoreId, country })
      : null;
    const android = dto.playStoreId
      ? await this.scrapers.getAndroidApp({ appId: dto.playStoreId, country })
      : null;

    if (!ios && !android) {
      throw new BadRequestException('App store\'larında bulunamadı. ID veya country yanlış olabilir.');
    }

    const name = ios?.title ?? android?.title ?? 'Unknown App';
    const developer = ios?.developer ?? android?.developer ?? null;
    const category = ios?.primaryGenre ?? android?.genre ?? null;
    const iconUrl = ios?.icon ?? android?.icon ?? null;

    const tracked = await this.prisma.trackedApp.upsert({
      where: {
        siteId_appStoreId_playStoreId_country: {
          siteId: dto.siteId,
          appStoreId: dto.appStoreId ?? '',
          playStoreId: dto.playStoreId ?? '',
          country,
        },
      },
      create: {
        siteId: dto.siteId,
        appStoreId: dto.appStoreId ?? null,
        playStoreId: dto.playStoreId ?? null,
        country,
        name,
        developer,
        category,
        iconUrl,
        metadata: { ios, android } as any,
        lastFetchedAt: new Date(),
        iosRating: ios?.score ?? null,
        iosReviewCount: ios?.reviews ?? null,
        androidRating: android?.score ?? null,
        androidReviewCount: android?.reviews ?? null,
      },
      update: {
        name,
        developer,
        category,
        iconUrl,
        metadata: { ios, android } as any,
        lastFetchedAt: new Date(),
        iosRating: ios?.score ?? null,
        iosReviewCount: ios?.reviews ?? null,
        androidRating: android?.score ?? null,
        androidReviewCount: android?.reviews ?? null,
      },
    });

    return tracked;
  }

  async listApps(siteId: string) {
    return this.prisma.trackedApp.findMany({
      where: { siteId },
      orderBy: { createdAt: 'desc' },
      include: {
        _count: { select: { keywords: true, reviews: true } },
      },
    });
  }

  async getApp(trackedAppId: string) {
    const app = await this.prisma.trackedApp.findUnique({
      where: { id: trackedAppId },
      include: {
        keywords: {
          orderBy: { currentRank: 'asc' },
          take: 200,
        },
        _count: { select: { reviews: true } },
      },
    });
    if (!app) throw new NotFoundException('App bulunamadı');
    return app;
  }

  async deleteApp(trackedAppId: string) {
    await this.prisma.trackedApp.delete({ where: { id: trackedAppId } });
    return { ok: true };
  }

  async refreshMetadata(trackedAppId: string) {
    const app = await this.prisma.trackedApp.findUniqueOrThrow({
      where: { id: trackedAppId },
    });
    return this.connectApp({
      siteId: app.siteId,
      appStoreId: app.appStoreId ?? undefined,
      playStoreId: app.playStoreId ?? undefined,
      country: app.country,
    });
  }

  // ─────────────────────────────────────────────
  //  Keyword management
  // ─────────────────────────────────────────────

  async addKeyword(opts: {
    trackedAppId: string;
    keyword: string;
    store: AppStore;
    source?: KeywordSource;
  }) {
    const app = await this.prisma.trackedApp.findUniqueOrThrow({
      where: { id: opts.trackedAppId },
    });

    // aso-v2 ile skor
    const scores = await this.keywords.scoreKeyword({
      keyword: opts.keyword,
      store: opts.store as 'IOS' | 'ANDROID',
      country: app.country,
    });

    return this.prisma.trackedAppKeyword.upsert({
      where: {
        trackedAppId_keyword_store: {
          trackedAppId: opts.trackedAppId,
          keyword: opts.keyword,
          store: opts.store,
        },
      },
      create: {
        trackedAppId: opts.trackedAppId,
        keyword: opts.keyword,
        store: opts.store,
        source: opts.source ?? 'MANUAL',
        popularity: scores.popularity,
        difficulty: scores.difficulty,
        traffic: scores.traffic,
      },
      update: {
        popularity: scores.popularity,
        difficulty: scores.difficulty,
        traffic: scores.traffic,
      },
    });
  }

  async addKeywordsBulk(opts: {
    trackedAppId: string;
    keywords: string[];
    store: AppStore;
    source?: KeywordSource;
  }) {
    const created: any[] = [];
    for (const kw of opts.keywords) {
      try {
        const k = await this.addKeyword({
          trackedAppId: opts.trackedAppId,
          keyword: kw,
          store: opts.store,
          source: opts.source,
        });
        created.push(k);
      } catch (err: any) {
        this.log.warn(`Keyword "${kw}": ${err.message}`);
      }
    }
    return { count: created.length };
  }

  async removeKeyword(keywordId: string) {
    await this.prisma.trackedAppKeyword.delete({ where: { id: keywordId } });
    return { ok: true };
  }

  /** Mevcut keyword'lerin skorunu yeniden hesapla (aso-v2 score parsing fix sonrası).  */
  async refreshScoresForApp(trackedAppId: string) {
    const app = await this.prisma.trackedApp.findUniqueOrThrow({
      where: { id: trackedAppId },
    });
    const keywords = await this.prisma.trackedAppKeyword.findMany({
      where: { trackedAppId, isActive: true },
    });
    let updated = 0;
    for (const kw of keywords) {
      try {
        const s = await this.keywords.scoreKeyword({
          keyword: kw.keyword,
          store: kw.store as 'IOS' | 'ANDROID',
          country: app.country,
        });
        await this.prisma.trackedAppKeyword.update({
          where: { id: kw.id },
          data: {
            popularity: s.popularity,
            difficulty: s.difficulty,
            traffic: s.traffic,
          },
        });
        updated++;
        await new Promise(r => setTimeout(r, 600)); // rate limit
      } catch (err: any) {
        this.log.warn(`[${kw.id}] score refresh: ${err.message}`);
      }
    }
    return { ok: true, updated, total: keywords.length };
  }

  async getKeywordHistory(keywordId: string, days = 30) {
    const since = new Date(Date.now() - days * 86400000);
    return this.prisma.appRanking.findMany({
      where: { trackedAppKeywordId: keywordId, checkedAt: { gte: since } },
      orderBy: { checkedAt: 'asc' },
    });
  }

  // ─────────────────────────────────────────────
  //  Forwarding to sub-services
  // ─────────────────────────────────────────────

  checkRank(keywordId: string) {
    return this.tracker.checkRank(keywordId);
  }

  checkAllRanks(trackedAppId: string) {
    return this.tracker.checkAllForApp(trackedAppId);
  }

  fetchReviews(trackedAppId: string, opts?: { limit?: number; analyzeSentiment?: boolean }) {
    return this.reviews.fetchAndAnalyze(trackedAppId, opts);
  }

  getReviewStats(trackedAppId: string) {
    return this.reviews.getReviewStats(trackedAppId);
  }

  discoverCompetitors(trackedAppId: string) {
    return this.prisma.trackedApp.findUniqueOrThrow({ where: { id: trackedAppId } })
      .then(app => this.aiAgent.discoverCompetitors({
        appStoreId: app.appStoreId ?? undefined,
        playStoreId: app.playStoreId ?? undefined,
        country: app.country,
      }));
  }

  async aiKeywordResearch(opts: {
    trackedAppId: string;
    competitorAppIds?: Array<{ appId: string; store: 'IOS' | 'ANDROID' }>;
    locale?: 'tr' | 'en';
  }) {
    const app = await this.prisma.trackedApp.findUniqueOrThrow({
      where: { id: opts.trackedAppId },
    });

    // Eğer rakip verilmediyse otomatik bul
    let competitors = opts.competitorAppIds;
    if (!competitors || competitors.length === 0) {
      const discovered = await this.discoverCompetitors(opts.trackedAppId);
      competitors = discovered.slice(0, 5).map(c => ({
        appId: c.appId,
        store: c.store,
      }));
    }

    const meta: any = app.metadata ?? {};
    const description =
      meta.ios?.description ??
      meta.android?.description ??
      '';

    return this.aiAgent.autonomousKeywordResearch({
      appName: app.name,
      appDescription: description,
      category: app.category ?? undefined,
      competitorAppIds: competitors,
      country: app.country,
      targetLocale: opts.locale ?? 'tr',
    });
  }

  async optimizeMetadata(opts: {
    trackedAppId: string;
    targetKeywords: string[];
    store: 'IOS' | 'ANDROID';
    locale?: 'tr' | 'en';
  }) {
    const app = await this.prisma.trackedApp.findUniqueOrThrow({
      where: { id: opts.trackedAppId },
    });
    const meta: any = app.metadata ?? {};
    const source = opts.store === 'IOS' ? meta.ios : meta.android;
    if (!source) throw new BadRequestException(`${opts.store} metadata bu app için yok`);

    return this.aiAgent.optimizeMetadata({
      currentTitle: source.title ?? '',
      currentSubtitle: source.subtitle,
      currentDescription: source.description ?? '',
      targetKeywords: opts.targetKeywords,
      locale: opts.locale ?? 'tr',
      store: opts.store,
    });
  }

  // ─────────────────────────────────────────────
  //  ASO Audit — mevcut metadata vs best practices
  // ─────────────────────────────────────────────

  async auditMetadata(trackedAppId: string) {
    const app = await this.prisma.trackedApp.findUniqueOrThrow({
      where: { id: trackedAppId },
    });
    const meta: any = app.metadata ?? {};
    const ios = meta.ios ?? null;
    const android = meta.android ?? null;

    type Severity = 'ok' | 'warning' | 'error' | 'info';
    type Finding = {
      severity: Severity;
      store: 'IOS' | 'ANDROID' | 'BOTH';
      field: string;
      label: string;
      current: string | number | null;
      message?: string;
      recommendation?: string;
      docsUrl?: string;
    };

    const findings: Finding[] = [];

    // ─── iOS ───
    if (ios) {
      // Title (30 char limit)
      const title = (ios.title ?? '').toString();
      const titleLen = title.length;
      if (titleLen === 0) {
        findings.push({ severity: 'error', store: 'IOS', field: 'title', label: 'App Name (Title)', current: title, message: 'Title boş', recommendation: 'En kritik alan — 30 char limit, ana keyword içersin.' });
      } else if (titleLen < 15) {
        findings.push({ severity: 'warning', store: 'IOS', field: 'title', label: 'App Name (Title)', current: `${titleLen}/30 char`, message: 'Title çok kısa — keyword kapasitesi kullanılmıyor', recommendation: '30 char limitini olabildiğince doldur. Örn: "PlanIn: Etkinlik Planlama" (28 char).' });
      } else if (titleLen > 30) {
        findings.push({ severity: 'error', store: 'IOS', field: 'title', label: 'App Name (Title)', current: `${titleLen}/30 char`, message: 'Title 30 karakter limitini aşıyor — Apple kabul etmez', recommendation: '30 char altına indir.' });
      } else {
        findings.push({ severity: 'ok', store: 'IOS', field: 'title', label: 'App Name (Title)', current: `${titleLen}/30 char` });
      }

      // Subtitle (30 char)
      const subtitle = (ios.subtitle ?? '').toString();
      const subLen = subtitle.length;
      if (subLen === 0) {
        findings.push({ severity: 'error', store: 'IOS', field: 'subtitle', label: 'Subtitle', current: '', message: 'Subtitle boş — büyük keyword fırsatı kaçıyor', recommendation: 'İkinci en güçlü ranking sinyali. 30 char limitini doldur, title\'da geçmeyen 2-3 kelime ekle.' });
      } else if (subLen < 15) {
        findings.push({ severity: 'warning', store: 'IOS', field: 'subtitle', label: 'Subtitle', current: `${subLen}/30 char`, message: 'Subtitle çok kısa', recommendation: '30 char\'ı doldur, destekleyici keyword ekle.' });
      } else {
        findings.push({ severity: 'ok', store: 'IOS', field: 'subtitle', label: 'Subtitle', current: `${subLen}/30 char` });
      }

      // Description (4000 char) — iOS'ta INDEXLENMEZ ama conversion için kritik
      const desc = (ios.description ?? '').toString();
      const descLen = desc.length;
      if (descLen === 0) {
        findings.push({ severity: 'error', store: 'IOS', field: 'description', label: 'Description', current: 0, message: 'Description boş', recommendation: 'Conversion için kritik. İlk 250 char\'da CTA + ana fayda yaz (Apple "More" diyene kadar bunu gösterir).' });
      } else if (descLen < 500) {
        findings.push({ severity: 'warning', store: 'IOS', field: 'description', label: 'Description', current: `${descLen}/4000 char`, message: 'Description çok kısa — conversion düşürür', recommendation: '1500-3000 char hedefle. İlk 250 char hook + CTA, devamı feature listesi + sosyal kanıt.' });
      } else {
        findings.push({ severity: 'ok', store: 'IOS', field: 'description', label: 'Description', current: `${descLen}/4000 char` });
      }

      // Promotional Text (170 char) — kolay update edilebilir
      const promo = (ios.releaseNotes ?? '').toString();
      if (!promo) {
        findings.push({ severity: 'info', store: 'IOS', field: 'promo', label: 'Promotional Text', current: '', message: 'Promotional text boş', recommendation: '170 char, app review GEREKMEZ — yeni release notes / kampanya için kolay araç.' });
      }

      // Reviews & Ratings
      const reviewCount = ios.reviews ?? app.iosReviewCount ?? 0;
      const rating = ios.score ?? app.iosRating ?? 0;
      if (reviewCount === 0) {
        findings.push({ severity: 'error', store: 'IOS', field: 'reviews', label: 'Reviews', current: 0, message: 'Hiç review yok', recommendation: 'SKStoreReviewRequest API ile (3 kez/yıl limit) prompt göster. Pre-prompt survey ekle.' });
      } else if (reviewCount < 10) {
        findings.push({ severity: 'warning', store: 'IOS', field: 'reviews', label: 'Reviews', current: `${reviewCount} review`, message: 'Review sayısı düşük', recommendation: 'Algoritma için kritik. Onboarding\'in 3-5. günü prompt en iyi sonuç verir.' });
      } else {
        findings.push({ severity: 'ok', store: 'IOS', field: 'reviews', label: 'Reviews', current: `${reviewCount} review · ${rating.toFixed?.(1) ?? rating}⭐` });
      }
      if (rating > 0 && rating < 4.0 && reviewCount >= 5) {
        findings.push({ severity: 'warning', store: 'IOS', field: 'rating', label: 'Rating', current: `${rating.toFixed?.(1) ?? rating}⭐`, message: 'Rating 4.0 altında', recommendation: 'Negatif review\'lara HEAR framework ile yanıt ver. Kritik bug\'ları çöz.' });
      }

      // Screenshots
      const screenshotCount = (ios.screenshots ?? []).length;
      if (screenshotCount === 0) {
        findings.push({ severity: 'error', store: 'IOS', field: 'screenshots', label: 'Screenshots', current: 0, message: 'Screenshot yok' });
      } else if (screenshotCount < 5) {
        findings.push({ severity: 'warning', store: 'IOS', field: 'screenshots', label: 'Screenshots', current: `${screenshotCount}/10`, message: 'Az screenshot', recommendation: '10 slot\'u doldur. İlk 3 slot tarama oranı en yüksek — en güçlü hook\'ları başa.' });
      } else {
        findings.push({ severity: 'ok', store: 'IOS', field: 'screenshots', label: 'Screenshots', current: `${screenshotCount}/10` });
      }

      // App Preview Video
      const videoCount = (ios.appPreviewVideos ?? []).length;
      if (videoCount === 0) {
        findings.push({ severity: 'info', store: 'IOS', field: 'video', label: 'App Preview Video', current: 0, message: 'App preview video yok', recommendation: '15 sn dikey video (3 adet localized). Conversion %20-30 artırır.' });
      }

      // Category
      const cat = ios.primaryGenre ?? '';
      if (!cat) {
        findings.push({ severity: 'warning', store: 'IOS', field: 'category', label: 'Category', current: '', message: 'Kategori belirsiz' });
      } else {
        findings.push({ severity: 'ok', store: 'IOS', field: 'category', label: 'Category', current: cat });
      }
    }

    // ─── Android ───
    if (android) {
      // Title (50 char)
      const title = (android.title ?? '').toString();
      const titleLen = title.length;
      if (titleLen === 0) {
        findings.push({ severity: 'error', store: 'ANDROID', field: 'title', label: 'Title', current: 0, message: 'Title boş' });
      } else if (titleLen < 25) {
        findings.push({ severity: 'warning', store: 'ANDROID', field: 'title', label: 'Title', current: `${titleLen}/50 char`, message: 'Title kısa — Play 50 char limit veriyor, kullan', recommendation: '25-50 char hedefle. Brand + 1-2 keyword.' });
      } else {
        findings.push({ severity: 'ok', store: 'ANDROID', field: 'title', label: 'Title', current: `${titleLen}/50 char` });
      }

      // Short Description (80 char)
      const summary = (android.summary ?? '').toString();
      const sumLen = summary.length;
      if (sumLen === 0) {
        findings.push({ severity: 'error', store: 'ANDROID', field: 'shortDesc', label: 'Short Description', current: 0, message: 'Short description boş', recommendation: '80 char, kullanıcı genişletmeden önce gördüğü. Aksiyon fiili + USP.' });
      } else if (sumLen < 50) {
        findings.push({ severity: 'warning', store: 'ANDROID', field: 'shortDesc', label: 'Short Description', current: `${sumLen}/80 char`, message: 'Short desc kısa', recommendation: '80 char\'ı doldur, anahtar keyword ekle.' });
      } else {
        findings.push({ severity: 'ok', store: 'ANDROID', field: 'shortDesc', label: 'Short Description', current: `${sumLen}/80 char` });
      }

      // Long Description (4000) — Play TAMAMINI indexler
      const desc = (android.description ?? '').toString();
      const descLen = desc.length;
      if (descLen === 0) {
        findings.push({ severity: 'error', store: 'ANDROID', field: 'description', label: 'Long Description', current: 0, message: 'Long description boş — Play\'in en kritik alanı', recommendation: 'Play algoritması TÜM long description\'ı indexler. iOS\'tan FARKLI! En az 2500 char yaz.' });
      } else if (descLen < 1500) {
        findings.push({ severity: 'warning', store: 'ANDROID', field: 'description', label: 'Long Description', current: `${descLen}/4000 char`, message: 'Long description kısa — ranking için fırsat kaçıyor', recommendation: 'Play TÜM long desc\'i indexler. 2500-4000 char yaz, hedef keyword\'ler doğal şekilde 3-5 kez geçsin.' });
      } else {
        findings.push({ severity: 'ok', store: 'ANDROID', field: 'description', label: 'Long Description', current: `${descLen}/4000 char` });
      }

      // Reviews
      const reviewCount = android.reviews ?? app.androidReviewCount ?? 0;
      const rating = android.score ?? app.androidRating ?? 0;
      if (reviewCount < 10) {
        findings.push({ severity: 'warning', store: 'ANDROID', field: 'reviews', label: 'Reviews', current: `${reviewCount} review`, message: 'Review sayısı düşük', recommendation: 'Play In-App Review API ile prompt göster (5 kez/yıl limit).' });
      } else {
        findings.push({ severity: 'ok', store: 'ANDROID', field: 'reviews', label: 'Reviews', current: `${reviewCount} review · ${rating.toFixed?.(1) ?? rating}⭐` });
      }

      // Screenshots
      const screenshotCount = (android.screenshots ?? []).length;
      if (screenshotCount < 4) {
        findings.push({ severity: 'warning', store: 'ANDROID', field: 'screenshots', label: 'Screenshots', current: `${screenshotCount}/8`, message: 'Az screenshot' });
      } else {
        findings.push({ severity: 'ok', store: 'ANDROID', field: 'screenshots', label: 'Screenshots', current: `${screenshotCount}/8` });
      }

      // Feature graphic
      if (!android.headerImage) {
        findings.push({ severity: 'warning', store: 'ANDROID', field: 'featureGraphic', label: 'Feature Graphic', current: '', message: 'Feature graphic yok', recommendation: '1024x500 image. Play store öne çıkarma için kritik.' });
      }

      // Video
      if (!android.video) {
        findings.push({ severity: 'info', store: 'ANDROID', field: 'video', label: 'Video', current: '', message: 'YouTube videosu yok', recommendation: '30 sn YouTube videosu — conversion %15-25 artırır.' });
      }
    }

    // Summary
    const summary = {
      ok: findings.filter(f => f.severity === 'ok').length,
      warning: findings.filter(f => f.severity === 'warning').length,
      error: findings.filter(f => f.severity === 'error').length,
      info: findings.filter(f => f.severity === 'info').length,
    };
    const total = summary.ok + summary.warning + summary.error;
    const score = total > 0 ? Math.round((summary.ok / total) * 100) : 0;
    const grade = score >= 90 ? 'A+' : score >= 80 ? 'A' : score >= 70 ? 'B' : score >= 60 ? 'C' : score >= 50 ? 'D' : 'F';

    return {
      score,
      grade,
      summary,
      findings,
      currentMetadata: {
        ios: ios ? {
          title: ios.title,
          subtitle: ios.subtitle,
          description: ios.description,
          releaseNotes: ios.releaseNotes,
          screenshots: ios.screenshots ?? [],
          icon: ios.icon,
          rating: ios.score,
          reviews: ios.reviews,
          category: ios.primaryGenre,
          version: ios.version,
        } : null,
        android: android ? {
          title: android.title,
          summary: android.summary,
          description: android.description,
          screenshots: android.screenshots ?? [],
          icon: android.icon,
          headerImage: android.headerImage,
          video: android.video,
          rating: android.score,
          reviews: android.reviews,
          category: android.genre,
          version: android.version,
        } : null,
      },
    };
  }
}
