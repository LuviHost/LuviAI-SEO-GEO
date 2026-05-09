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
}
