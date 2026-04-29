import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { MetaAdsClientService } from './meta-ads-client.service.js';

/**
 * Auto-Boost — son 7 gunde organik olarak yuksek etkilesim alan Facebook page
 * post'larini Meta Page Post Insights ile tespit eder, ortalamadan 2x ustte
 * olani 50 TL ile 7 gunluk boost'a aldirir.
 *
 * Direkt resmi Meta Marketing API entegrasyonu (Faz 11.3).
 */
@Injectable()
export class AutoBoostService {
  private readonly log = new Logger(AutoBoostService.name);
  private readonly DEFAULT_BOOST_BUDGET = 50; // TL/gun
  private readonly DEFAULT_BOOST_DAYS = 7;

  constructor(
    private readonly prisma: PrismaService,
    private readonly meta: MetaAdsClientService,
  ) {}

  async findAndBoost(): Promise<{ siteScanned: number; boosted: number }> {
    const sites = await this.prisma.site.findMany({
      where: { adsAutopilot: true } as any,
    });

    let boosted = 0;

    for (const site of sites) {
      try {
        const site_: any = site;
        if (!site_.metaAdsAccessToken || !site_.metaAdsAccountId) continue;
        const pageId: string | undefined = site_.metaPageId ?? undefined;
        if (!pageId) continue;

        const last7d = new Date(Date.now() - 7 * 86400000);
        const posts = await this.prisma.socialPost.findMany({
          where: {
            article: { siteId: site.id },
            status: 'PUBLISHED' as any,
            channel: { type: 'FACEBOOK' as any },
            publishedAt: { gte: last7d },
          },
          take: 30,
        });
        if (posts.length === 0) continue;

        // Bu hafta zaten boost edildi mi?
        const alreadyBoosted = posts.some((p: any) => (p.metadata as any)?.boosted === true);
        if (alreadyBoosted) continue;

        // Her post icin insights cek
        const candidates: any[] = [];
        for (const p of posts) {
          if (!p.externalId) continue;
          const insights = await this.meta.getPagePostInsights(site.id, p.externalId);
          if (!insights || insights.reach < 100) continue; // gurultuyu ele
          candidates.push({ post: p, insights });
        }
        if (candidates.length === 0) continue;

        // Ortalamadan 2x uzerinde olanlari bul
        const avgRate = candidates.reduce((a, c) => a + c.insights.engagementRate, 0) / candidates.length;
        const winners = candidates.filter((c) => c.insights.engagementRate > avgRate * 2);
        if (winners.length === 0) continue;

        winners.sort((a, b) => b.insights.engagementRate - a.insights.engagementRate);
        const top = winners[0];

        // Boost
        const result = await this.meta.boostPagePost(site.id, {
          pageId,
          postId: top.post.externalId,
          dailyBudgetTRY: this.DEFAULT_BOOST_BUDGET,
          days: this.DEFAULT_BOOST_DAYS,
          countries: ['TR'],
        });

        if (result.ok) {
          await this.prisma.socialPost.update({
            where: { id: top.post.id },
            data: {
              metadata: {
                ...((top.post.metadata as any) ?? {}),
                boosted: true,
                boostedAt: new Date().toISOString(),
                boostBudget: this.DEFAULT_BOOST_BUDGET,
                boostDays: this.DEFAULT_BOOST_DAYS,
                boostCampaignId: result.campaignId,
                boostReason: `${(top.insights.engagementRate / avgRate).toFixed(1)}x avg engagement`,
              } as any,
            },
          });
          boosted++;
          this.log.log(`[${site.id}] Auto-boost: post ${top.post.externalId}, ${this.DEFAULT_BOOST_BUDGET} TL × ${this.DEFAULT_BOOST_DAYS}g, campaign ${result.campaignId}`);
        } else {
          this.log.warn(`[${site.id}] Boost fail: ${result.error}`);
        }
      } catch (err: any) {
        this.log.warn(`[${site.id}] auto-boost fail: ${err.message}`);
      }
    }

    this.log.log(`Auto-boost: ${sites.length} site tarandi, ${boosted} post boost edildi`);
    return { siteScanned: sites.length, boosted };
  }
}
