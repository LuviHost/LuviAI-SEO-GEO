import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service.js';
import { AnalyticsService } from './analytics.service.js';

/**
 * Daily GSC snapshot — her gece 02:00 UTC çalışır.
 * Her aktif siteyi tarar, gscRefreshToken varsa yeni snapshot kaydeder.
 */
@Injectable()
export class AnalyticsCron {
  private readonly log = new Logger(AnalyticsCron.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly analytics: AnalyticsService,
  ) {}

  @Cron(CronExpression.EVERY_DAY_AT_2AM)
  async dailySnapshot() {
    this.log.log('🕑 Daily snapshot başlıyor');
    const sites = await this.prisma.site.findMany({
      where: {
        status: 'ACTIVE',
        gscRefreshToken: { not: null },
      },
      select: { id: true, name: true },
    });

    this.log.log(`${sites.length} aktif site taranacak`);

    let success = 0;
    let failed = 0;

    for (const site of sites) {
      try {
        await this.analytics.captureSnapshot(site.id, undefined, { silent: true });
        success++;
        // Rate limit yememek için 2 sn ara
        await new Promise(r => setTimeout(r, 2000));
      } catch (err: any) {
        this.log.error(`[${site.id}] ${err.message}`);
        failed++;
      }
    }

    this.log.log(`✓ Snapshot bitti: ${success} başarılı, ${failed} başarısız`);
  }
}
