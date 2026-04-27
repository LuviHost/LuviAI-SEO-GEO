import { Injectable, Logger } from '@nestjs/common';
import { google } from 'googleapis';
import { GscOAuthService } from '../auth/gsc-oauth.service.js';
import { PrismaService } from '../prisma/prisma.service.js';

export interface GscOpportunity {
  type: 'near-miss' | 'content-gap' | 'low-ctr' | 'trending';
  query: string;
  page: string;
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
  valueEstimate: number;
}

/**
 * Per-tenant GSC fetcher.
 * Site'nin gscRefreshToken'ını kullanır → 4 fırsat tipi tarar.
 */
@Injectable()
export class GscService {
  private readonly log = new Logger(GscService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly oauth: GscOAuthService,
  ) {}

  async fetchOpportunities(siteId: string, days = 90): Promise<GscOpportunity[]> {
    const site = await this.prisma.site.findUniqueOrThrow({ where: { id: siteId } });
    if (!site.gscPropertyUrl || !site.gscRefreshToken) {
      this.log.log(`[${siteId}] GSC bağlı değil — atlanıyor`);
      return [];
    }

    const client = await this.oauth.getAuthenticatedClient(siteId);
    if (!client) return [];

    const webmasters = google.webmasters({ version: 'v3', auth: client as any });

    const endDate = new Date().toISOString().slice(0, 10);
    const startDate = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);

    let rows: any[] = [];
    try {
      const res = await webmasters.searchanalytics.query({
        siteUrl: site.gscPropertyUrl,
        requestBody: {
          startDate,
          endDate,
          dimensions: ['query', 'page'],
          rowLimit: 1000,
        },
      });
      rows = res.data.rows ?? [];
    } catch (err: any) {
      this.log.error(`[${siteId}] GSC API: ${err.message}`);
      return [];
    }

    if (rows.length === 0) {
      this.log.log(`[${siteId}] GSC'de veri yok`);
      return [];
    }

    const opportunities: GscOpportunity[] = [];

    for (const row of rows) {
      const [query, pageUrl] = row.keys ?? [];
      if (!query) continue;

      const clicks = row.clicks ?? 0;
      const impressions = row.impressions ?? 0;
      const ctr = row.ctr ?? 0;
      const position = row.position ?? 0;

      let page = '';
      try { page = pageUrl ? new URL(pageUrl).pathname : ''; } catch {}

      if (position >= 4 && position <= 15 && impressions >= 100 && clicks < 5) {
        opportunities.push({
          type: 'near-miss', query, page, clicks, impressions, ctr, position,
          valueEstimate: Math.round(impressions * 0.20),
        });
      }
      if (position > 20 && impressions >= 50) {
        opportunities.push({
          type: 'content-gap', query, page, clicks, impressions, ctr, position,
          valueEstimate: Math.round(impressions * 0.10),
        });
      }
      if (clicks > 0 && ctr < 0.02 && impressions >= 100) {
        opportunities.push({
          type: 'low-ctr', query, page, clicks, impressions, ctr, position,
          valueEstimate: Math.round(impressions * 0.04),
        });
      }
    }

    this.log.log(`[${siteId}] GSC: ${rows.length} satır, ${opportunities.length} fırsat`);
    return opportunities;
  }
}
