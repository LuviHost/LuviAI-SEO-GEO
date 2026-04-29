import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { AdsMcpClientService } from './mcp-client.service.js';

/**
 * A/B Test Manager — bir kampanyada N farkli ad copy varyanti calistirildiysa
 * ilk 7 gun istatistiksel anlamli kazanani secip digerlerini pause eder.
 *
 * Karar kriterleri:
 *   - Min 100 impression / varyant (yeterli veri)
 *   - CTR'de en az 0.3 puan fark (gercekten anlamli)
 *   - Conversion rate (varsa) onceligi
 *
 * Otopilot ON ise her gun cron tarafindan tetiklenir.
 */
@Injectable()
export class AbTestManagerService {
  private readonly log = new Logger(AbTestManagerService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly mcp: AdsMcpClientService,
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
          // 7+ gun aktif olanlari incele
        },
      });

      for (const c of campaigns) {
        analyzed++;
        try {
          const cmd = `${c.platform === 'google_ads' ? 'Google Ads' : 'Meta Ads'} kampanyasi ${c.externalId} icindeki tum ad varyantlarinin metriklerini getir. Format:
[
  { "adId": "...", "headline": "...", "impressions": N, "clicks": N, "ctr": F, "conversions": N, "convRate": F }
]
En az 100 impression alanlari listele.`;

          const result = await this.mcp.runMcpCommand(site.id, cmd);
          if (!result.ok) continue;

          const ads = this.parseAdsArray(result.output);
          if (!ads || ads.length < 2) continue;

          // Yeterli veri olanlari filtrele
          const eligible = ads.filter((a) => a.impressions >= 100);
          if (eligible.length < 2) continue;

          // Winner sec — once conversion rate, sonra CTR
          const sorted = eligible.sort((a, b) => {
            const aScore = (a.convRate ?? 0) * 100 + a.ctr;
            const bScore = (b.convRate ?? 0) * 100 + b.ctr;
            return bScore - aScore;
          });
          const winner = sorted[0];
          const losers = sorted.slice(1);

          // Anlamli farki kontrol et
          const significantDiff = (winner.ctr - losers[0].ctr) > 0.003; // 0.3 puan
          if (!significantDiff) continue;

          // Loser'lari pause
          for (const loser of losers) {
            await this.mcp.runMcpCommand(site.id, `Ad ${loser.adId} pause et — A/B test kaybetti (CTR ${(loser.ctr * 100).toFixed(2)}% vs winner ${(winner.ctr * 100).toFixed(2)}%).`);
            pausedAds++;
          }

          winnersChosen++;
          this.log.log(`[${c.id}] A/B winner: ad ${winner.adId} (CTR ${(winner.ctr * 100).toFixed(2)}%), ${losers.length} loser pause`);

          // History'ye yaz
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

  private parseAdsArray(text: string): any[] | null {
    try {
      const match = text.match(/\[[\s\S]*?\]/);
      if (!match) return null;
      return JSON.parse(match[0]);
    } catch {
      return null;
    }
  }
}
