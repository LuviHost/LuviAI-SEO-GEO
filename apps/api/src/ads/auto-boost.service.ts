import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { MetaAdsClientService } from './meta-ads-client.service.js';

/** Tutar reklam hesabinin para birimindedir: TL hesapta 50 TL, USD hesapta 50 USD */
export const AUTO_BOOST_DAILY_BUDGET = 50;
export const AUTO_BOOST_DAYS = 7;

/**
 * Auto-Boost — son 7 gunde RanksUp'in sitenin makaleleri icin Facebook
 * sayfasinda PAYLASTIGI gonderilerden (SocialPost: articleId bu siteye bagli,
 * kanal FACEBOOK_PAGE, durum PUBLISHED) ortalamanin 2 katindan fazla
 * etkilesim alani, Meta reklam hesabinda gunluk 50 (hesabin para birimiyle),
 * 7 gunluk yeni bir kampanyayla one cikarir. Site basina haftada en fazla bir
 * gonderi. Sayfada elle paylasilan gonderiler aday OLMAZ.
 *
 * DURUM: sosyal paylasim 0db5a1c'de kaldirildi; SocialPost yazan kod yok, bu
 * yuzden su an aday cikmaz. Kanal filtresi eskiden 'FACEBOOK' idi — semada
 * boyle bir SocialChannelType yok (FACEBOOK_PAGE), Prisma sorguyu her turda
 * reddediyordu. Duzeltme davranisi degistirmez: yeni gonderi olmadigi icin
 * yine bos doner; paylasim geri gelirse panelde anlatildigi gibi calisir.
 *
 * Direkt resmi Meta Marketing API entegrasyonu (Faz 11.3).
 */
@Injectable()
export class AutoBoostService {
  private readonly log = new Logger(AutoBoostService.name);

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
            // Yalniz RanksUp'in bu sitenin makalesi icin paylastigi gonderi
            article: { siteId: site.id },
            status: 'PUBLISHED',
            channel: { type: 'FACEBOOK_PAGE' },
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
          dailyBudget: AUTO_BOOST_DAILY_BUDGET,
          days: AUTO_BOOST_DAYS,
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
                boostBudget: AUTO_BOOST_DAILY_BUDGET,
                boostCurrency: result.currency ?? null,
                boostDays: AUTO_BOOST_DAYS,
                boostCampaignId: result.campaignId,
                boostReason: `${(top.insights.engagementRate / avgRate).toFixed(1)}x avg engagement`,
              } as any,
            },
          });
          boosted++;
          this.log.log(`[${site.id}] Auto-boost: post ${top.post.externalId}, gunluk ${AUTO_BOOST_DAILY_BUDGET} ${result.currency ?? '(hesap para birimi)'} x ${AUTO_BOOST_DAYS} gun, campaign ${result.campaignId}`);
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
