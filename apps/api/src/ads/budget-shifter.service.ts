import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { AdsClientService } from './ads-client.service.js';

/**
 * Cross-Platform Budget Shifter — Google ile Meta arasinda butce kaydirir.
 *
 * Strateji:
 *   - Iki platform da ACTIVE ve performanceCheckedAt yakinsa karsilastir
 *   - ROAS farki > 50% ise kazanan platforma %20 butce kaydir
 *   - Toplam butce sabit kalir (yalnizca dagiitim degisir)
 *
 * Otopilot ON sitelerde her gece bir tetikleinr.
 */
@Injectable()
export class BudgetShifterService {
  private readonly log = new Logger(BudgetShifterService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly adsClient: AdsClientService,
  ) {}

  async shiftBudgets(): Promise<{ pairsAnalyzed: number; shifts: number }> {
    const sites = await this.prisma.site.findMany({
      where: { adsAutopilot: true } as any,
    });

    let pairsAnalyzed = 0;
    let shifts = 0;

    for (const site of sites) {
      // Ayni objective'e sahip Google + Meta ciftleri bul
      const campaigns = await this.prisma.adCampaign.findMany({
        where: { siteId: site.id, status: 'ACTIVE' },
      });

      const byObjective: Record<string, any[]> = {};
      for (const c of campaigns) {
        if (!byObjective[c.objective]) byObjective[c.objective] = [];
        byObjective[c.objective].push(c);
      }

      for (const [objective, group] of Object.entries(byObjective)) {
        const google = group.find((c: any) => c.platform === 'google_ads');
        const meta = group.find((c: any) => c.platform === 'meta_ads');
        if (!google || !meta) continue;
        if (google.spend < 100 || meta.spend < 100) continue; // yetersiz veri
        pairsAnalyzed++;

        const gRoas = google.roas;
        const mRoas = meta.roas;
        if (gRoas === 0 || mRoas === 0) continue;

        // Kazanan en az 1.5x daha iyi olmali
        const ratio = Math.max(gRoas, mRoas) / Math.min(gRoas, mRoas);
        if (ratio < 1.5) continue;

        const winner = gRoas > mRoas ? google : meta;
        const loser = gRoas > mRoas ? meta : google;
        const shiftAmount = Number(loser.budgetAmount) * 0.2;
        const newWinnerBudget = Number(winner.budgetAmount) + shiftAmount;
        const newLoserBudget = Number(loser.budgetAmount) - shiftAmount;

        // Direkt API ile butce guncelle
        if (winner.externalId) {
          await this.adsClient.updateBudget(site.id, winner.platform as any, winner.externalId, newWinnerBudget).catch(() => {});
        }
        if (loser.externalId) {
          await this.adsClient.updateBudget(site.id, loser.platform as any, loser.externalId, newLoserBudget).catch(() => {});
        }

        // DB
        await this.prisma.adCampaign.update({
          where: { id: winner.id },
          data: { budgetAmount: newWinnerBudget },
        });
        await this.prisma.adCampaign.update({
          where: { id: loser.id },
          data: { budgetAmount: newLoserBudget },
        });

        shifts++;
        this.log.log(`[${site.id}] Budget shift: ${shiftAmount.toFixed(0)} TL ${loser.platform} → ${winner.platform} (ROAS ${loser.roas.toFixed(1)}→${winner.roas.toFixed(1)})`);
      }
    }

    this.log.log(`Budget shifter: ${pairsAnalyzed} cift, ${shifts} kaydirma`);
    return { pairsAnalyzed, shifts };
  }
}
