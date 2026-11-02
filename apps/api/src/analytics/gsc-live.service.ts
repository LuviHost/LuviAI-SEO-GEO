import { Injectable, Logger } from '@nestjs/common';
import { google } from 'googleapis';
import { PrismaService } from '../prisma/prisma.service.js';
import { GscOAuthService } from '../auth/gsc-oauth.service.js';
import {
  addDays,
  dailyTotalsFromRows,
  exactQueryRegexChunks,
  fetchAllRows,
  isoDay,
  latestDateFromRows,
  queryMetricsFromRows,
  sparklinesFromRows,
  toMetric,
  topPageByQuery,
  type DayTotals,
  type GscRow,
  type Metric,
  type QueryMetric,
  type SearchAnalyticsApi,
} from './gsc-aggregate.js';

/**
 * Kucuk TTL onbellek. Ham GSC satirlarini DEGIL, turetilmis sonuclari
 * (siralama yaniti, yukselen sorgular, marka payi) tutar: 90 gunluk sorgu
 * listesi buyuk sitede 50 bin+ satir, API bellek tavanini zorlamasin.
 * Promise saklanir — ayni anda gelen iki istek GSC'ye iki kez gitmez.
 */
export class TtlCache {
  private readonly map = new Map<string, { at: number; value: Promise<unknown> }>();
  constructor(private readonly ttlMs: number, private readonly maxEntries = 500) {}

  get<T>(key: string, fn: () => Promise<T>, now = Date.now()): Promise<T> {
    const hit = this.map.get(key);
    if (hit && now - hit.at < this.ttlMs) return hit.value as Promise<T>;
    const value = fn().catch((err) => {
      // Hata onbellege yazilmaz — sonraki istek yeniden dener
      this.map.delete(key);
      throw err;
    });
    this.map.set(key, { at: now, value });
    if (this.map.size > this.maxEntries) {
      const oldest = this.map.keys().next().value;
      if (oldest !== undefined) this.map.delete(oldest);
    }
    return value;
  }

  invalidatePrefix(prefix: string) {
    for (const k of [...this.map.keys()]) if (k.startsWith(prefix)) this.map.delete(k);
  }
}

export interface GscHandle {
  api: SearchAnalyticsApi;
  siteUrl: string;
}

/**
 * Search Console'a CANLI sorgular — panelin donem toplamlari (siralama,
 * yukselen sorgular, marka payi) GSC'nin kendi agregasyonundan gelsin diye.
 * Saklanan gunluk snapshot'lar ilk-N detay tutar; donem sorusu onlardan
 * cevaplanmaz (bkz. gsc-aggregate.ts).
 *
 * Kota: sonuclar 6 saat onbellekte; tek bir siralama ekrani en fazla
 * ~10 istek atar. GSC sinirlari site basina dakikada 1.200 sorgu.
 */
@Injectable()
export class GscLiveService {
  private readonly log = new Logger(GscLiveService.name);
  static readonly CACHE_TTL_MS = 6 * 3600_000;
  /** Tek istegin beklenebilecek en uzun suresi */
  static readonly REQUEST_TIMEOUT_MS = 45_000;
  readonly cache = new TtlCache(GscLiveService.CACHE_TTL_MS);
  private readonly latestCache = new TtlCache(3600_000);

  /** Testte sahte istemci vermek icin degistirilebilir */
  apiFactory: (client: unknown) => SearchAnalyticsApi = (client) =>
    google.webmasters({ version: 'v3', auth: client as any }).searchanalytics as unknown as SearchAnalyticsApi;

  constructor(
    private readonly prisma: PrismaService,
    private readonly gscOAuth: GscOAuthService,
  ) {}

  /** Site GSC'ye bagli degilse null (hata atmaz) */
  async handle(siteId: string): Promise<GscHandle | null> {
    const site = await this.prisma.site.findUnique({
      where: { id: siteId },
      select: { gscPropertyUrl: true, gscRefreshToken: true },
    });
    if (!site?.gscPropertyUrl || !site.gscRefreshToken) return null;
    const client = await this.gscOAuth?.getAuthenticatedClient?.(siteId);
    if (!client) return null;
    return { api: this.apiFactory(client), siteUrl: site.gscPropertyUrl };
  }

  /** Onbellek anahtari property'yi de icerir: property degisirse eski sonuc donmez */
  key(h: GscHandle, siteId: string, ...parts: Array<string | number>) {
    return `${siteId}|${h.siteUrl}|${parts.join('|')}`;
  }

  invalidate(siteId: string) {
    this.cache.invalidatePrefix(`${siteId}|`);
    this.latestCache.invalidatePrefix(`${siteId}|`);
  }

  private opts(maxRows: number) {
    return { maxRows, timeoutMs: GscLiveService.REQUEST_TIMEOUT_MS };
  }

  /**
   * GSC'nin yayinladigi SON gun. Veri ~2 gun gecikmeli; "son 7 gun" bugunden
   * degil bu gunden geriye sayilir. Son 14 gunde hic veri yoksa null.
   */
  async latestDate(siteId: string, h: GscHandle, today = isoDay(new Date())): Promise<string | null> {
    return this.latestCache.get(this.key(h, siteId, 'latest', today), async () => {
      const { rows } = await fetchAllRows(
        h.api,
        h.siteUrl,
        { startDate: addDays(today, -14), endDate: today, dimensions: ['date'] },
        this.opts(100),
      );
      return latestDateFromRows(rows);
    });
  }

  /** Gun gun site toplamlari (`dimensions: ['date']`) — snapshot ile AYNI tanim */
  async dailyTotals(h: GscHandle, from: string, to: string): Promise<DayTotals[]> {
    const { rows } = await fetchAllRows(h.api, h.siteUrl, { startDate: from, endDate: to, dimensions: ['date'] }, this.opts(1000));
    return dailyTotalsFromRows(rows);
  }

  /** Donem toplami — boyutsuz istek, anonim sorgular DAHIL (GSC grafigindeki sayi) */
  async periodTotals(h: GscHandle, from: string, to: string): Promise<Metric> {
    const res = await h.api.query(
      { siteUrl: h.siteUrl, requestBody: { startDate: from, endDate: to, rowLimit: 1 } },
      { timeout: GscLiveService.REQUEST_TIMEOUT_MS },
    );
    return toMetric((res?.data?.rows ?? [])[0]);
  }

  /** Donemdeki tum sorgular (`dimensions: ['query']`, sayfali) */
  async queryTotals(h: GscHandle, from: string, to: string, maxRows = 100_000): Promise<{ rows: QueryMetric[]; truncated: boolean }> {
    const res = await fetchAllRows(h.api, h.siteUrl, { startDate: from, endDate: to, dimensions: ['query'] }, this.opts(maxRows));
    if (res.truncated) this.log.warn(`${from}..${to} sorgu listesi ${maxRows} satirda kesildi`);
    return { rows: queryMetricsFromRows(res.rows), truncated: res.truncated };
  }

  /** Sorgu basina en cok tiklanan sayfa (`['query','page']`) */
  async topPages(h: GscHandle, from: string, to: string, maxRows = 50_000): Promise<Map<string, string>> {
    const { rows } = await fetchAllRows(h.api, h.siteUrl, { startDate: from, endDate: to, dimensions: ['query', 'page'] }, this.opts(maxRows));
    return topPageByQuery(rows);
  }

  /** Verilen sorgularin gunluk pozisyonu (`['query','date']`, regex filtreli) */
  async sparklines(h: GscHandle, from: string, to: string, queries: string[]): Promise<Map<string, { date: string; position: number }[]>> {
    const all: GscRow[] = [];
    for (const expression of exactQueryRegexChunks(queries)) {
      const { rows } = await fetchAllRows(
        h.api,
        h.siteUrl,
        {
          startDate: from,
          endDate: to,
          dimensions: ['query', 'date'],
          dimensionFilterGroups: [{ filters: [{ dimension: 'query', operator: 'includingRegex', expression }] }],
        },
        this.opts(25_000),
      );
      all.push(...rows);
    }
    return sparklinesFromRows(all);
  }
}
