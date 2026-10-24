import { Injectable, Logger } from '@nestjs/common';
import { google } from 'googleapis';
import { PrismaService } from '../prisma/prisma.service.js';
import { GaOAuthService } from '../auth/ga-oauth.service.js';
import { AI_SOURCES, analyticsSourceDomains } from '../audit/ai-source.js';
import { hostOf } from '../audit/source-domain-types.js';
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
/** GA4 hatasi kisa sure onbelleklenir: her sayfa gorunumunde Google'a gidilmesin */
const ERROR_CACHE_TTL_MS = 10 * 60_000;
/** kv_store.value TEXT (64 KB) — sigmayan sonuc onbelleklenmez, yine de doner */
const CACHE_MAX_BYTES = 60_000;

export type AiTrafficGaReason = 'not_connected' | 'auth_error' | 'permission' | 'api_disabled' | 'unavailable';

/** gaxios hatasinin HTTP durumu (yeni surumler `status`, eskiler `code`) */
export function gaErrorStatus(err: any): number | null {
  const v = err?.status ?? err?.response?.status ?? err?.code;
  const n = typeof v === 'number' ? v : typeof v === 'string' && /^\d{3}$/.test(v) ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
}

function gaErrorText(err: any): string {
  const details = JSON.stringify(err?.response?.data ?? err?.errors ?? '');
  return `${String(err?.message ?? err)} ${details}`;
}

/**
 * GA4 hatasi → panel nedeni. "API etkin degil" (SERVICE_DISABLED /
 * accessNotConfigured) 403 doner ama kullanicinin yetkisiyle ilgisi yok:
 * sunucu projesinde Data API kapali — ayri neden.
 */
export function gaErrorReason(err: any): Exclude<AiTrafficGaReason, 'not_connected'> {
  const status = gaErrorStatus(err);
  const text = gaErrorText(err);
  if (/SERVICE_DISABLED|accessNotConfigured|has not been used|is disabled/i.test(text)) return 'api_disabled';
  if (status === 401 || /invalid_grant|unauthorized/i.test(text)) return 'auth_error';
  if (status === 403 || /PERMISSION_DENIED|permission/i.test(text)) return 'permission';
  return 'unavailable';
}

/** Yalniz "bu metrik bu mulkte gecersiz" (400 INVALID_ARGUMENT) gelirsiz tekrar denemeyi hakli kilar */
export function isInvalidArgument(err: any): boolean {
  return gaErrorStatus(err) === 400 || /INVALID_ARGUMENT/.test(gaErrorText(err));
}

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

type GaData = AiTrafficGa & { generatedAt: string };

/** Basari 6 saat; hata (negatif onbellek) 10 dakika */
type CacheEnvelope =
  | { fingerprint: string; data: GaData; error?: undefined }
  | { fingerprint: string; error: Exclude<AiTrafficGaReason, 'not_connected'>; data?: undefined };

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
    const [site, trackerRows] = await Promise.all([
      this.prisma.site.findUnique({ where: { id: siteId }, select: { url: true, gaPropertyId: true, gaRefreshToken: true } }),
      this.prisma.aiReferrerHit.findMany({
        where: {
          siteId,
          date: { gte: new Date(`${range.startDate}T00:00:00Z`), lte: new Date(`${range.endDate}T00:00:00Z`) },
        },
        select: { date: true, referrer: true, hits: true, topUrls: true },
        orderBy: { date: 'asc' },
      }),
    ]);
    // Adresler yalniz sitenin kendi host'undaysa doner (isOwnSiteUrl)
    const tracker = mapTrackerHits(trackerRows, range, hostOf(site?.url ?? null));
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
    if (cached?.data) return { ...base, ga: cached.data };
    if (cached?.error) return { ...base, ga: null, reason: cached.error };

    const client = await this.gaOAuth.getAuthenticatedClient(siteId);
    if (!client) return { ...base, ga: null, reason: 'not_connected' };

    try {
      const ga = await this.fetchGa(client, site.gaPropertyId, range, days);
      const data = { ...ga, generatedAt: new Date().toISOString() };
      await this.writeCache(cacheKey, { fingerprint, data }, CACHE_TTL_MS);
      return { ...base, ga: data };
    } catch (err: any) {
      const reason = gaErrorReason(err);
      this.log.warn(`[${siteId}] GA AI trafigi hata (${reason}): ${String(err?.message ?? err).slice(0, 200)}`);
      await this.writeCache(cacheKey, { fingerprint, error: reason }, ERROR_CACHE_TTL_MS);
      return { ...base, ga: null, reason };
    }
  }

  private async fetchGa(client: unknown, propertyId: string, range: { startDate: string; endDate: string }, days: number): Promise<AiTrafficGa> {
    const data = google.analyticsdata({ version: 'v1beta', auth: client as any });
    const property = `properties/${propertyId}`;
    const run = (requestBody: unknown) => data.properties.runReport({ property, requestBody } as any);

    const withRev = buildAiTrafficRequests(days, { withRevenue: true });
    const [pagesRes, totalRes] = await Promise.all([run(withRev.pages), run(withRev.total)]);

    // Gelir: totalRevenue mulkte gecersizse (400 INVALID_ARGUMENT) gelirsiz tekrar.
    // Gecici hata (5xx, ag) tekrar denenmez, firlatilir: gelirsiz sonuc 6 saat
    // onbellekte kalip geliri yanlislikla "yok" gostermesin.
    let withRevenue = true;
    let dailyRes: any;
    try {
      dailyRes = await run(withRev.daily);
    } catch (err: any) {
      if (!isInvalidArgument(err)) throw err;
      withRevenue = false;
      dailyRes = await run(buildAiTrafficRequests(days, { withRevenue: false }).daily);
    }

    const thresholded = [dailyRes, pagesRes, totalRes].some((r: any) => r?.data?.metadata?.subjectToThresholding === true);
    return mapAiTraffic({
      range,
      days,
      thresholded,
      dailyRows: ((dailyRes as any)?.data?.rows ?? []) as GaRow[],
      pageRows: ((pagesRes as any)?.data?.rows ?? []) as GaRow[],
      pageRowCount: Number((pagesRes as any)?.data?.rowCount ?? 0) || undefined,
      totalRows: ((totalRes as any)?.data?.rows ?? []) as GaRow[],
      withRevenue,
    });
  }

  private async readCache(key: string, fingerprint: string): Promise<CacheEnvelope | null> {
    try {
      const row = await this.prisma.kvStore.findUnique({ where: { key } });
      if (!row || (row.expiresAt && row.expiresAt.getTime() < Date.now())) return null;
      const env = JSON.parse(row.value) as CacheEnvelope;
      return env.fingerprint === fingerprint ? env : null;
    } catch {
      return null;
    }
  }

  private async writeCache(key: string, env: CacheEnvelope, ttlMs: number): Promise<void> {
    const value = JSON.stringify(env);
    if (Buffer.byteLength(value, 'utf8') > CACHE_MAX_BYTES) return;
    const expiresAt = new Date(Date.now() + ttlMs);
    await this.prisma.kvStore
      .upsert({ where: { key }, create: { key, value, expiresAt }, update: { value, expiresAt } })
      .catch((err) => this.log.warn(`[ai-traffic] onbellek yazilamadi: ${err.message}`));
  }
}
