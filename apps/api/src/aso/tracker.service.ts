import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service.js';
import { AsoScrapersService } from './scrapers.service.js';

/**
 * Daily rank tracker. Her takipli app + keyword için günde bir rank kontrolü yapar.
 */
@Injectable()
export class AsoTrackerService {
  private readonly log = new Logger(AsoTrackerService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly scrapers: AsoScrapersService,
  ) {}

  /**
   * Bir keyword için tek seferlik rank check + DB güncelle.
   */
  async checkRank(trackedAppKeywordId: string) {
    const kw = await this.prisma.trackedAppKeyword.findUniqueOrThrow({
      where: { id: trackedAppKeywordId },
      include: { trackedApp: true },
    });

    const appIdent = kw.store === 'IOS'
      ? kw.trackedApp.appStoreId
      : kw.trackedApp.playStoreId;

    if (!appIdent) {
      this.log.warn(`[${kw.id}] App identifier yok (${kw.store})`);
      return null;
    }

    const { rank, total } = await this.scrapers.findRank({
      term: kw.keyword,
      appIdent,
      country: kw.trackedApp.country,
      storeType: kw.store as 'IOS' | 'ANDROID',
      num: 100,
    });

    // Tarihsel kayıt
    await this.prisma.appRanking.create({
      data: {
        trackedAppKeywordId: kw.id,
        position: rank,
        totalResults: total,
      },
    });

    // Latest snapshot
    await this.prisma.trackedAppKeyword.update({
      where: { id: kw.id },
      data: {
        previousRank: kw.currentRank,
        currentRank: rank,
        bestRank: rank != null && (kw.bestRank == null || rank < kw.bestRank) ? rank : kw.bestRank,
        lastCheckedAt: new Date(),
      },
    });

    return { rank, total };
  }

  /** Bir app'in tüm keyword'leri için sıralı rank check (rate limit uyumlu). */
  async checkAllForApp(trackedAppId: string) {
    const keywords = await this.prisma.trackedAppKeyword.findMany({
      where: { trackedAppId, isActive: true },
    });

    let success = 0;
    let failed = 0;
    for (const kw of keywords) {
      try {
        await this.checkRank(kw.id);
        success++;
        await new Promise(r => setTimeout(r, 1500)); // rate limit
      } catch (err: any) {
        this.log.warn(`[${kw.id}] ${err.message}`);
        failed++;
      }
    }
    return { success, failed, total: keywords.length };
  }

  /** Cron — her gece 03:30'da tüm aktif app'lerin keyword'lerini check eder. */
  @Cron('30 3 * * *')
  async dailyRankCheck() {
    this.log.log('🕒 ASO daily rank tracking başlıyor');
    const apps = await this.prisma.trackedApp.findMany({
      where: { isActive: true },
      select: { id: true, name: true },
    });
    this.log.log(`${apps.length} app taranacak`);

    for (const app of apps) {
      try {
        const r = await this.checkAllForApp(app.id);
        this.log.log(`[${app.name}] ${r.success}/${r.total} rank güncellendi`);
        await new Promise(r => setTimeout(r, 5000)); // appler arası bekle
      } catch (err: any) {
        this.log.error(`[${app.id}] daily rank: ${err.message}`);
      }
    }
    this.log.log('✓ ASO daily rank tracking bitti');
  }
}
