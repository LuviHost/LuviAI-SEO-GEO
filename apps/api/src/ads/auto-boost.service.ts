import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { AdsMcpClientService } from './mcp-client.service.js';

/**
 * Auto-Boost — son 7 gunde organik olarak yuksek etkilesim alan sosyal
 * post'lari (PUBLISHED SocialPost) tespit edip Meta uzerinden $50 ile
 * "boosted post" olarak yayinlatir.
 *
 * Algoritma:
 *   - PUBLISHED postlardan engagement_rate > avg * 2 olanlari sec
 *   - Maksimum 1 / hafta / site (overspend onlemek)
 *   - Otopilot ON ise haftalik cron tetikler
 */
@Injectable()
export class AutoBoostService {
  private readonly log = new Logger(AutoBoostService.name);
  private readonly DEFAULT_BOOST_BUDGET = 50; // TL

  constructor(
    private readonly prisma: PrismaService,
    private readonly mcp: AdsMcpClientService,
  ) {}

  async findAndBoost(): Promise<{ siteScanned: number; boosted: number }> {
    const sites = await this.prisma.site.findMany({
      where: { adsAutopilot: true } as any,
    });

    let boosted = 0;

    for (const site of sites) {
      try {
        // Son 7 gun PUBLISHED postlari getir, engagement metric MCP'den
        const last7d = new Date(Date.now() - 7 * 86400000);
        const posts = await this.prisma.socialPost.findMany({
          where: {
            article: { siteId: site.id },
            status: 'PUBLISHED' as any,
            publishedAt: { gte: last7d },
          },
          take: 30,
        });

        if (posts.length === 0) continue;

        // Bu hafta zaten boost atildi mi? metadata flag ile kontrol
        const alreadyBoosted = posts.some((p: any) => (p.metadata as any)?.boosted === true);
        if (alreadyBoosted) continue;

        // MCP'den her post icin engagement cek
        const candidates: any[] = [];
        for (const p of posts) {
          if (!p.externalId) continue;
          const cmd = `Meta Ads — Page post ${p.externalId}'in son 7 gunluk metriklerini getir. Format: {"impressions":N,"reach":N,"engagement":N,"shares":N,"comments":N}`;
          const r = await this.mcp.runMcpCommand(site.id, cmd);
          if (!r.ok) continue;
          const metrics = this.parseJson(r.output);
          if (!metrics) continue;
          const engagementRate = (metrics.engagement ?? 0) / Math.max(1, metrics.reach ?? 1);
          candidates.push({ post: p, metrics, engagementRate });
        }

        if (candidates.length === 0) continue;

        // Ortalamadan 2x daha iyi olan
        const avgRate = candidates.reduce((a, c) => a + c.engagementRate, 0) / candidates.length;
        const winners = candidates.filter((c) => c.engagementRate > avgRate * 2);
        if (winners.length === 0) continue;

        // En iyiyi sec
        winners.sort((a, b) => b.engagementRate - a.engagementRate);
        const top = winners[0];

        // Boost komutu
        const boostCmd = `Meta Ads — page post ${top.post.externalId}'i ${this.DEFAULT_BOOST_BUDGET} TL butceyle 7 gunluk boost et. Audience: lookalike of engaged users. Bu post organik olarak ${(top.engagementRate * 100).toFixed(2)}% engagement aldi (ortalamadan ${(top.engagementRate / avgRate).toFixed(1)}x daha iyi).`;
        const result = await this.mcp.runMcpCommand(site.id, boostCmd);

        if (result.ok) {
          // SocialPost metadata'sina boost flag'i yaz
          await this.prisma.socialPost.update({
            where: { id: top.post.id },
            data: {
              metadata: {
                ...((top.post.metadata as any) ?? {}),
                boosted: true,
                boostedAt: new Date().toISOString(),
                boostBudget: this.DEFAULT_BOOST_BUDGET,
                boostReason: `${(top.engagementRate / avgRate).toFixed(1)}x avg engagement`,
              } as any,
            },
          });
          boosted++;
          this.log.log(`[${site.id}] Auto-boost: post ${top.post.externalId}, ${this.DEFAULT_BOOST_BUDGET} TL`);
        }
      } catch (err: any) {
        this.log.warn(`[${site.id}] auto-boost fail: ${err.message}`);
      }
    }

    this.log.log(`Auto-boost: ${sites.length} site tarandi, ${boosted} post boost edildi`);
    return { siteScanned: sites.length, boosted };
  }

  private parseJson(text: string): any | null {
    try {
      const match = text.match(/\{[\s\S]*?\}/);
      if (!match) return null;
      return JSON.parse(match[0]);
    } catch {
      return null;
    }
  }
}
