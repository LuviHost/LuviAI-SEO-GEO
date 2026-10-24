import { Injectable, Logger } from '@nestjs/common';
import { google } from 'googleapis';
import { PrismaService } from '../prisma/prisma.service.js';
import { GaOAuthService } from '../auth/ga-oauth.service.js';
import { AI_SOURCES, analyticsSourceDomains } from '../audit/ai-source.js';
import {
  aiTrafficDays,
  aiTrafficRange,
  buildAiTrafficRequests,
  mapAiTraffic,
  mapTrackerHits,
  type AiTrafficGa,
  type GaRow,
  type TrackerSeries,
} from './ai-traffic.js';

const CACHE_TTL_MS = 6 * 3600_000;
/** kv_store.value TEXT (64 KB) — sigmayan sonuc onbelleklenmez, yine de doner */
const CACHE_MAX_BYTES = 60_000;

export type AiTrafficGaReason = 'not_connected' | 'auth_error' | 'permission' | 'unavailable';

export interface AiTrafficResponse {
  days: number;
  dateRange: { startDate: string; endDate: string };
  /** GA4 bagli degilse ya da okunamadiysa null — neden `reason`da */
  ga: (AiTrafficGa & { generatedAt: string }) | null;
  reason?: AiTrafficGaReason;
  /** RanksUp izleme kodu (ai_referrer_hits) — GA4'ten bagimsiz, her zaman doner */
  tracker: TrackerSeries;
  measurement: {
    assistants: Array<{ key: string; label: string }>;
    /** GA4 sessionSource filtresine giren alan adlari (ai-source.ts) */
    gaSourceDomains: string[];
  };
}

interface CacheEnvelope {
  fingerprint: string;
  data: AiTrafficGa & { generatedAt: string };
}

/**
 * "AI'dan gelen trafik" — I/O katmani (hesap saf `ai-traffic.ts`).
 * GA4 kismi site + pencere basina kv_store'da 6 saat tutulur (search-opportunity
 * ile ayni desen); tracker kismi her istekte DB'den okunur (ucuz, taze).
 */
@Injectable()
export class AiTrafficService {
  private readonly log = new Logger(AiTrafficService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly gaOAuth: GaOAuthService,
  ) {}

  async get(siteId: string, daysRaw?: unknown, now = new Date()): Promise<AiTrafficResponse> {
    const days = aiTrafficDays(daysRaw);
    const range = aiTrafficRange(now, days);
    const [site, tracker] = await Promise.all([
      this.prisma.site.findUnique({ where: { id: siteId }, select: { gaPropertyId: true, gaRefreshToken: true } }),
      this.tracker(siteId, range),
    ]);
    const base = {
      days,
      dateRange: range,
      tracker,
      measurement: {
        assistants: AI_SOURCES.map((s) => ({ key: s.key, label: s.label })),
        gaSourceDomains: analyticsSourceDomains(),
      },
    };
    if (!site?.gaPropertyId || !site?.gaRefreshToken) return { ...base, ga: null, reason: 'not_connected' };

    // Mulk degisirse (GA yeniden baglama) eski sonuc donmesin
    const fingerprint = [range.endDate, site.gaPropertyId].join('|');
    const cacheKey = `ai-traffic:v1:${siteId}:${days}`;
    const cached = await this.readCache(cacheKey, fingerprint);
    if (cached) return { ...base, ga: cached };

    const client = await this.gaOAuth.getAuthenticatedClient(siteId);
    if (!client) return { ...base, ga: null, reason: 'not_connected' };

    try {
      const ga = await this.fetchGa(client, site.gaPropertyId, range);
      const data = { ...ga, generatedAt: new Date().toISOString() };
      await this.writeCache(cacheKey, { fingerprint, data });
      return { ...base, ga: data };
    } catch (err: any) {
      const msg = String(err?.message ?? err);
      this.log.warn(`[${siteId}] GA AI trafigi hata: ${msg.slice(0, 200)}`);
      const reason: AiTrafficGaReason = err?.code === 401 || /invalid_grant|unauthorized/i.test(msg)
        ? 'auth_error'
        : err?.code === 403 || /permission/i.test(msg) ? 'permission' : 'unavailable';
      return { ...base, ga: null, reason };
    }
  }

  private async fetchGa(client: unknown, propertyId: string, range: { startDate: string; endDate: string }): Promise<AiTrafficGa> {
    const data = google.analyticsdata({ version: 'v1beta', auth: client as any });
    const property = `properties/${propertyId}`;
    const run = (requestBody: unknown) => data.properties.runReport({ property, requestBody } as any);

    const withRev = buildAiTrafficRequests(range, { withRevenue: true });
    const [pagesRes, totalRes] = await Promise.all([run(withRev.pages), run(withRev.total)]);

    // Gelir: e-ticaret izlemeyen mulkte totalRevenue hata verebilir — gelirsiz tekrar
    let withRevenue = true;
    let dailyRes: any;
    try {
      dailyRes = await run(withRev.daily);
    } catch (err: any) {
      if (err?.code === 401 || err?.code === 403) throw err;
      withRevenue = false;
      dailyRes = await run(buildAiTrafficRequests(range, { withRevenue: false }).daily);
    }

    return mapAiTraffic({
      range,
      dailyRows: ((dailyRes as any)?.data?.rows ?? []) as GaRow[],
      pageRows: ((pagesRes as any)?.data?.rows ?? []) as GaRow[],
      pageRowCount: Number((pagesRes as any)?.data?.rowCount ?? 0) || undefined,
      totalRows: ((totalRes as any)?.data?.rows ?? []) as GaRow[],
      withRevenue,
    });
  }

  private async tracker(siteId: string, range: { startDate: string; endDate: string }): Promise<TrackerSeries> {
    const rows = await this.prisma.aiReferrerHit.findMany({
      where: {
        siteId,
        date: { gte: new Date(`${range.startDate}T00:00:00Z`), lte: new Date(`${range.endDate}T00:00:00Z`) },
      },
      select: { date: true, referrer: true, hits: true, topUrls: true },
      orderBy: { date: 'asc' },
    });
    return mapTrackerHits(rows, range);
  }

  private async readCache(key: string, fingerprint: string): Promise<CacheEnvelope['data'] | null> {
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
      .catch((err) => this.log.warn(`[ai-traffic] onbellek yazilamadi: ${err.message}`));
  }
}
