import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { AdsClientService } from './ads-client.service.js';

/**
 * A/B Test Manager — kampanya icindeki ad varyantlarinin son 7 gunluk
 * performansini karsilastirir, kazanani belirler, kalanlari pause eder.
 *
 * Karar kriterleri:
 *   - Min 100 impression / varyant (yeterli veri)
 *   - CTR'de en az 0.3 puan fark (gercekten anlamli)
 *   - Conversion rate (varsa) onceligi
 *
 * Direkt resmi API entegrasyonu (Faz 11.3).
 */
@Injectable()
export class AbTestManagerService {
  private readonly log = new Logger(AbTestManagerService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly adsClient: AdsClientService,
  ) {}

  async pickWinners(): Promise<{ analyzed: number; winnersChosen: number; pausedAds: number }> {
    const sites = await this.prisma.site.findMany({
      where: { adsAutopilot: true } as any,
    });

    let analyzed = 0;
    let winnersChosen = 0;
    let pausedAds = 0;

    for (const site of sites) {
      const oneWeekAgo = new Date(Date.now() - 7 * 86400000);
      const campaigns = await this.prisma.adCampaign.findMany({
        where: {
          siteId: site.id,
          status: 'ACTIVE',
          startDate: { lte: oneWeekAgo },
        },
      });

      for (const c of campaigns) {
        if (!c.externalId) continue;
        analyzed++;
        try {
          const ads = await this.adsClient.getAdVariants(site.id, c.platform as any, c.externalId);
          if (!ads || ads.length < 2) continue;

          const eligible = ads.filter((a: any) => a.impressions >= 100);
          if (eligible.length < 2) continue;

          // Skor — once conversion rate, sonra CTR
          const sorted = [...eligible].sort((a: any, b: any) => {
            const aScore = (a.convRate ?? 0) * 100 + a.ctr;
            const bScore = (b.convRate ?? 0) * 100 + b.ctr;
            return bScore - aScore;
          });
          const winner = sorted[0];
          const losers = sorted.slice(1);

          // Anlamli farki kontrol et (CTR >= 0.3 puan, yani 0.003 absolute)
          const significantDiff = (winner.ctr - losers[0].ctr) > 0.003;
          if (!significantDiff) continue;

          // Loser'lari pause
          for (const loser of losers) {
            const target = c.platform === 'google_ads' ? loser.resourceName : loser.adId;
            if (!target) continue;
            const r = await this.adsClient.setAdStatus(site.id, c.platform as any, target, true).catch(() => ({ ok: false }));
            if (r.ok) pausedAds++;
          }

          winnersChosen++;
          this.log.log(`[${c.id}] A/B winner: ad ${winner.adId} (CTR ${(winner.ctr * 100).toFixed(2)}%), ${losers.length} loser pause`);

          const history: any[] = Array.isArray(c.autopilotActions) ? (c.autopilotActions as any[]) : [];
          history.push({
            time: new Date().toISOString(),
            action: 'ab-test-winner',
            winnerAdId: winner.adId,
            winnerCtr: winner.ctr,
            pausedCount: losers.length,
          });
          await this.prisma.adCampaign.update({
            where: { id: c.id },
            data: { autopilotActions: history.slice(-20) as any },
          });
        } catch (err: any) {
          this.log.warn(`[${c.id}] A/B fail: ${err.message}`);
        }
      }
    }

    this.log.log(`A/B test analyzer: ${analyzed} kampanya, ${winnersChosen} winner, ${pausedAds} ad pause`);
    return { analyzed, winnersChosen, pausedAds };
  }
}
