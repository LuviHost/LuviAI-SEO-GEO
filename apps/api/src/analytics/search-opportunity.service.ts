import { Injectable, Logger } from '@nestjs/common';
import { google } from 'googleapis';
import { PrismaService } from '../prisma/prisma.service.js';
import { GscOAuthService } from '../auth/gsc-oauth.service.js';
import { GaService } from './ga.service.js';
import {
  buildSearchOpportunities,
  opportunityDateRange,
  type GscPageRow,
  type SearchOpportunityResult,
} from './search-opportunity.js';

const GSC_ROW_LIMIT = 5000;
const GA_ROW_LIMIT = 5000;
const CACHE_TTL_MS = 6 * 3600_000;
/** kv_store.value TEXT (64 KB) — sigmayan sonuc onbelleklenmez, yine de doner */
const CACHE_MAX_BYTES = 60_000;

export type SearchOpportunityResponse =
  | { status: 'not_connected'; gscConnected: boolean; gaConnected: boolean }
  | { status: 'unavailable'; source: 'gsc' | 'ga' }
  | ({
      status: 'ok';
      dateRange: { startDate: string; endDate: string };
      truncated: { gsc: boolean; ga: boolean };
      generatedAt: string;
    } & SearchOpportunityResult);

interface CacheEnvelope {
  fingerprint: string;
  data: SearchOpportunityResponse;
}

/**
 * GSC × GA4 arama firsatlari — I/O katmani (hesap saf `search-opportunity.ts`).
 * Iki Google cagrisi yapar; sonuc site basina TEK kv_store satirinda 6 saat
 * tutulur (pencere gunluk kayar, anahtar birikmesin diye tarih anahtarda degil
 * parmak izinde).
 */
@Injectable()
export class SearchOpportunityService {
  private readonly log = new Logger(SearchOpportunityService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly gscOAuth: GscOAuthService,
    private readonly ga: GaService,
  ) {}

  async get(siteId: string, limit?: number): Promise<SearchOpportunityResponse> {
    const site = await this.prisma.site.findUniqueOrThrow({
      where: { id: siteId },
      select: { gscPropertyUrl: true, gscRefreshToken: true, gaPropertyId: true, gaRefreshToken: true },
    });
    const gscConnected = !!(site.gscPropertyUrl && site.gscRefreshToken);
    const gaConnected = !!(site.gaPropertyId && site.gaRefreshToken);
    if (!gscConnected || !gaConnected) return { status: 'not_connected', gscConnected, gaConnected };

    const range = opportunityDateRange(new Date());
    const lim = typeof limit === 'number' && Number.isFinite(limit) ? Math.max(1, Math.min(100, Math.floor(limit))) : 50;
    // Mulk degisirse (GA/GSC yeniden baglama) eski sonuc donmesin
    const fingerprint = [range.endDate, lim, site.gscPropertyUrl, site.gaPropertyId].join('|');
    const cacheKey = `search-opp:v1:${siteId}`;
    const cached = await this.readCache(cacheKey, fingerprint);
    if (cached) return cached;

    const [gscRows, gaRes] = await Promise.all([
      this.fetchGscPages(siteId, site.gscPropertyUrl!, range),
      this.ga.fetchOrganicLandingPages(siteId, range.startDate, range.endDate, GA_ROW_LIMIT),
    ]);
    if (!gscRows) return { status: 'unavailable', source: 'gsc' };
    if (!gaRes) return { status: 'unavailable', source: 'ga' };

    const data: SearchOpportunityResponse = {
      status: 'ok',
      dateRange: range,
      truncated: { gsc: gscRows.length >= GSC_ROW_LIMIT, ga: gaRes.totalRows > gaRes.rows.length },
      generatedAt: new Date().toISOString(),
      ...buildSearchOpportunities(gscRows, gaRes.rows, { limit: lim }),
    };
    await this.writeCache(cacheKey, { fingerprint, data });
    return data;
  }

  private async fetchGscPages(
    siteId: string,
    siteUrl: string,
    range: { startDate: string; endDate: string },
  ): Promise<GscPageRow[] | null> {
    const client = await this.gscOAuth.getAuthenticatedClient(siteId);
    if (!client) return null;
    try {
      const webmasters = google.webmasters({ version: 'v3', auth: client as any });
      const res = await webmasters.searchanalytics.query({
        siteUrl,
        requestBody: { startDate: range.startDate, endDate: range.endDate, dimensions: ['page'], rowLimit: GSC_ROW_LIMIT },
      });
      return (res.data.rows ?? [])
        .map((r: any) => ({
          page: (r.keys?.[0] ?? '') as string,
          clicks: r.clicks ?? 0,
          impressions: r.impressions ?? 0,
          position: r.position ?? 0,
        }))
        .filter((r) => r.page);
    } catch (err: any) {
      this.log.warn(`[${siteId}] GSC sayfa performansi hata: ${err.message}`);
      return null;
    }
  }

  private async readCache(key: string, fingerprint: string): Promise<SearchOpportunityResponse | null> {
    try {
      const row = await this.prisma.kvStore.findUnique({ where: { key } });
      if (!row || (row.expiresAt && row.expiresAt.getTime() < Date.now())) return null;
      const env = JSON.parse(row.value) as CacheEnvelope;
      return env.fingerprint === fingerprint ? env.data : null;
    } catch {
      return null;
    }
  }

  private async writeCache(key: string, env: CacheEnvelope): Promise<void> {
    const value = JSON.stringify(env);
    if (Buffer.byteLength(value, 'utf8') > CACHE_MAX_BYTES) return;
    const expiresAt = new Date(Date.now() + CACHE_TTL_MS);
    await this.prisma.kvStore
      .upsert({ where: { key }, create: { key, value, expiresAt }, update: { value, expiresAt } })
      .catch((err) => this.log.warn(`[search-opp] onbellek yazilamadi: ${err.message}`));
  }
}
