import { Injectable, Logger } from '@nestjs/common';
import { google } from 'googleapis';
import { PrismaService } from '../prisma/prisma.service.js';
import { GaOAuthService } from '../auth/ga-oauth.service.js';

export interface GaPagePerf {
  pagePath: string;
  sessions: number;
  engagementRate: number;     // 0..1
  avgEngagementSec: number;
  conversions: number;
  bounceRate: number;          // 0..1 (1 - engagementRate yaklaşığı)
}

export interface GaSiteSummary {
  totalSessions: number;
  totalConversions: number;
  avgEngagementSec: number;
  avgBounceRate: number;
  topPages: GaPagePerf[];
}

/**
 * GA4 Data API wrapper.
 * Tum metodlar opsiyonel calisir — site bagli degilse null doner.
 */
@Injectable()
export class GaService {
  private readonly log = new Logger(GaService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly gaOAuth: GaOAuthService,
  ) {}

  async fetchSiteSummary(siteId: string, days = 30): Promise<GaSiteSummary | null> {
    const site = await this.prisma.site.findUnique({ where: { id: siteId } });
    if (!site?.gaPropertyId || !site?.gaRefreshToken) return null;

    const client = await this.gaOAuth.getAuthenticatedClient(siteId);
    if (!client) return null;

    try {
      const data = google.analyticsdata({ version: 'v1beta', auth: client as any });

      const startDate = `${days}daysAgo`;

      const res = await data.properties.runReport({
        property: `properties/${site.gaPropertyId}`,
        requestBody: {
          dateRanges: [{ startDate, endDate: 'today' }],
          dimensions: [{ name: 'pagePath' }],
          metrics: [
            { name: 'sessions' },
            { name: 'engagementRate' },
            { name: 'userEngagementDuration' },
            { name: 'conversions' },
            { name: 'bounceRate' },
          ],
          orderBys: [{ metric: { metricName: 'sessions' }, desc: true }],
          limit: '50',
        },
      } as any);

      const rows = res.data.rows ?? [];
      const topPages: GaPagePerf[] = rows.map((r: any) => {
        const sessions = Number(r.metricValues?.[0]?.value ?? 0);
        const engagementRate = Number(r.metricValues?.[1]?.value ?? 0);
        const userEngagementDuration = Number(r.metricValues?.[2]?.value ?? 0);
        const conversions = Number(r.metricValues?.[3]?.value ?? 0);
        const bounceRate = Number(r.metricValues?.[4]?.value ?? 0);
        return {
          pagePath: r.dimensionValues?.[0]?.value ?? '/',
          sessions,
          engagementRate,
          avgEngagementSec: sessions > 0 ? userEngagementDuration / sessions : 0,
          conversions,
          bounceRate,
        };
      });

      const totalSessions = topPages.reduce((s, p) => s + p.sessions, 0);
      const totalConversions = topPages.reduce((s, p) => s + p.conversions, 0);
      const weightedEngagement =
        totalSessions > 0
          ? topPages.reduce((s, p) => s + p.avgEngagementSec * p.sessions, 0) / totalSessions
          : 0;
      const weightedBounce =
        totalSessions > 0
          ? topPages.reduce((s, p) => s + p.bounceRate * p.sessions, 0) / totalSessions
          : 0;

      return {
        totalSessions,
        totalConversions,
        avgEngagementSec: weightedEngagement,
        avgBounceRate: weightedBounce,
        topPages,
      };
    } catch (err: any) {
      this.log.warn(`[${siteId}] GA fetch error: ${err.message}`);
      return null;
    }
  }

  /**
   * Topic engine icin "underperforming" sayfalari donder — yuksek session
   * ama yuksek bounce. Ranker'a "bu konuda makale yenile/derinlestir" sinyali.
   */
  async getUnderperformingPages(siteId: string, days = 30): Promise<GaPagePerf[]> {
    const summary = await this.fetchSiteSummary(siteId, days);
    if (!summary) return [];
    return summary.topPages.filter(
      (p) => p.sessions >= 50 && p.bounceRate >= 0.7 && p.conversions === 0,
    );
  }
}
