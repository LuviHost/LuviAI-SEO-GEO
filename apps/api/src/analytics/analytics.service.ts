import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { google } from 'googleapis';
import { PrismaService } from '../prisma/prisma.service.js';
import { GscOAuthService } from '../auth/gsc-oauth.service.js';
import { resolveSiteBrand } from '../audit/brand-in-query.js';
import { splitQueriesByBrand, dailyUnbrandedShare, type OrganicQueryRow } from './organic-brand-split.js';

interface GscRow {
  keys: string[];
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
}

@Injectable()
export class AnalyticsService {
  private readonly log = new Logger(AnalyticsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly gscOAuth: GscOAuthService,
  ) {}

  // ─────────────────────────────────────────────
  //  Daily snapshot — cron task çağırır
  // ─────────────────────────────────────────────

  /**
   * GSC ham satirini DB sekline cevirir.
   *
   * NEDEN AYRI FONKSIYON: upsert'un create dali bu esleme yapiyordu ama
   * update dali HAM satiri (`{keys:[...]}`) yaziyordu. Iki dal farkli sekil
   * uretince, ayni tarih ikinci kez yazildiginda kayit bozuluyor ve
   * pageDetails/queryDetails'i okuyan her yuzey (rank tracking, trending,
   * oneriler, rapor top-query) sessizce bosaliyor. Gunluk cron kayan
   * pencereye gectigi icin (T-3..T-7) ayni tarihler her gece tekrar
   * yaziliyor — yani bu bug artik her gece tetikleniyordu.
   */
  private toPageDetail(r: GscRow) {
    return {
      page: r.keys?.[0],
      clicks: r.clicks ?? 0,
      impressions: r.impressions ?? 0,
      ctr: r.ctr ?? 0,
      position: r.position ?? 0,
    };
  }

  private toQueryDetail(r: GscRow) {
    return {
      query: r.keys?.[0],
      page: r.keys?.[1],
      clicks: r.clicks ?? 0,
      impressions: r.impressions ?? 0,
      ctr: r.ctr ?? 0,
      position: r.position ?? 0,
    };
  }

  async captureSnapshot(siteId: string, date?: Date, opts?: { silent?: boolean }): Promise<void> {
    const targetDate = date ?? this.defaultSnapshotDate();
    const dateStr = targetDate.toISOString().slice(0, 10);

    const site = await this.prisma.site.findUniqueOrThrow({ where: { id: siteId } });
    if (!site.gscPropertyUrl || !site.gscRefreshToken) {
      if (opts?.silent) {
        this.log.log(`[${siteId}] GSC bağlı değil — snapshot atlandı`);
        return;
      }
      throw new BadRequestException(
        'Bu site Google Search Console hesabına bağlı değil. Önce ayarlardan GSC bağlamalısın.',
      );
    }

    const client = await this.gscOAuth.getAuthenticatedClient(siteId);
    if (!client) return;

    const webmasters = google.webmasters({ version: 'v3', auth: client as any });

    try {
      // Page-level top 50
      const pageRes = await webmasters.searchanalytics.query({
        siteUrl: site.gscPropertyUrl,
        requestBody: {
          startDate: dateStr,
          endDate: dateStr,
          dimensions: ['page'],
          rowLimit: 50,
        },
      });

      // Query-level top 100
      const queryRes = await webmasters.searchanalytics.query({
        siteUrl: site.gscPropertyUrl,
        requestBody: {
          startDate: dateStr,
          endDate: dateStr,
          dimensions: ['query', 'page'],
          rowLimit: 100,
        },
      });

      const pageRows: GscRow[] = (pageRes.data.rows ?? []) as any;
      const queryRows: GscRow[] = (queryRes.data.rows ?? []) as any;

      // GSC BOS DONDUYSE HICBIR SEY YAZMA.
      // Bos yanit "o gun trafik yoktu" demek DEGIL; neredeyse her zaman
      // "o gunun verisi henuz yayinlanmadi" demek. Sifir yazmak iki hasar
      // veriyordu: (1) grafik gercek olmayan bir dusus gosteriyor,
      // (2) upsert oldugu icin veri sonradan yayinlandiginda da duzelmiyor.
      // Yazmayip gecmek, bir sonraki calismada ayni gunun tekrar denenmesine
      // izin verir.
      if (pageRows.length === 0) {
        this.log.warn(
          `[${siteId}] ${dateStr} icin GSC bos dondu — snapshot YAZILMADI ` +
          `(veri henuz yayinlanmamis olabilir; GSC ~2 gun gecikmeli).`,
        );
        return;
      }

      const totalClicks = pageRows.reduce((s, r) => s + (r.clicks ?? 0), 0);
      const totalImpressions = pageRows.reduce((s, r) => s + (r.impressions ?? 0), 0);
      const avgCtr = totalImpressions > 0 ? totalClicks / totalImpressions : 0;
      const avgPosition = pageRows.length > 0
        ? pageRows.reduce((s, r) => s + (r.position ?? 0), 0) / pageRows.length
        : 0;

      const pageDetails = pageRows.map((r) => this.toPageDetail(r));
      const queryDetails = queryRows.map((r) => this.toQueryDetail(r));

      await this.prisma.analyticsSnapshot.upsert({
        where: { siteId_date: { siteId, date: targetDate } },
        create: {
          siteId,
          date: targetDate,
          totalClicks,
          totalImpressions,
          avgCtr,
          avgPosition,
          pageDetails: pageDetails as any,
          queryDetails: queryDetails as any,
        },
        update: {
          totalClicks,
          totalImpressions,
          avgCtr,
          avgPosition,
          pageDetails: pageDetails as any,
          queryDetails: queryDetails as any,
        },
      });

      // Article performansı update
      await this.updateArticleMetrics(siteId, pageRows);

      this.log.log(`[${siteId}] Snapshot ${dateStr}: ${totalClicks} clicks, ${totalImpressions} imp, pos ${avgPosition.toFixed(1)}`);
    } catch (err: any) {
      this.log.error(`[${siteId}] Snapshot error: ${err.message}`);
    }
  }

  /**
   * Son N gun icin GSC'den tek seferde veri cek, gunluk snapshot olarak kaydet.
   * captureSnapshot'i her gun icin ayri cagirmaya gore cok daha verimli (tek GSC API call).
   *
   * Yeni site baglandiginda + "Yenile" butonu icin kullanilir.
   */
  async backfillSnapshots(
    siteId: string,
    days: number,
  ): Promise<{ saved: number; range: { from: string; to: string }; totalClicks: number; totalImpressions: number }> {
    const site = await this.prisma.site.findUniqueOrThrow({ where: { id: siteId } });
    if (!site.gscPropertyUrl || !site.gscRefreshToken) {
      throw new BadRequestException('Bu site Google Search Console hesabina bagli degil.');
    }

    const client = await this.gscOAuth.getAuthenticatedClient(siteId);
    if (!client) throw new BadRequestException('GSC client kurulamadi.');

    const webmasters = google.webmasters({ version: 'v3', auth: client as any });
    const endDate = new Date();
    const startDate = new Date(endDate.getTime() - days * 86400000);
    const startStr = startDate.toISOString().slice(0, 10);
    const endStr = endDate.toISOString().slice(0, 10);

    try {
      // Date dimension: her gun icin total clicks/imp/pos
      const dailyRes = await webmasters.searchanalytics.query({
        siteUrl: site.gscPropertyUrl,
        requestBody: { startDate: startStr, endDate: endStr, dimensions: ['date'], rowLimit: 1000 },
      });

      // Query + page (date'siz toplam, GSC privacy daily query'i gizleyebilir)
      const queryRes = await webmasters.searchanalytics.query({
        siteUrl: site.gscPropertyUrl,
        requestBody: { startDate: startStr, endDate: endStr, dimensions: ['query', 'page'], rowLimit: 200 },
      });

      const dailyRows: GscRow[] = (dailyRes.data.rows ?? []) as any;
      const queryRows: GscRow[] = (queryRes.data.rows ?? []) as any;

      const totalQueries = queryRows.map((r) => ({
        query: r.keys?.[0],
        page: r.keys?.[1],
        clicks: r.clicks ?? 0,
        impressions: r.impressions ?? 0,
        ctr: r.ctr ?? 0,
        position: r.position ?? 0,
      }));

      let saved = 0;
      let totalClicks = 0;
      let totalImpressions = 0;

      // En son tarihli snapshot'a tum query listesini iliştir (daily query yoksa bile)
      const sortedDates = dailyRows.map((r) => r.keys?.[0]).filter(Boolean).sort();
      const latestDate = sortedDates[sortedDates.length - 1];

      for (const row of dailyRows) {
        const dateStr = row.keys?.[0];
        if (!dateStr) continue;
        const date = new Date(`${dateStr}T00:00:00.000Z`);
        const dayQueries = dateStr === latestDate ? totalQueries : [];

        await this.prisma.analyticsSnapshot.upsert({
          where: { siteId_date: { siteId, date } },
          create: {
            siteId,
            date,
            totalClicks: row.clicks ?? 0,
            totalImpressions: row.impressions ?? 0,
            avgCtr: row.ctr ?? 0,
            avgPosition: row.position ?? 0,
            pageDetails: [],
            queryDetails: dayQueries as any,
          },
          // Bos gunde queryDetails EZILMEZ: backfill yalnizca EN SON tarihe
          // tam query listesi iliştiriyor, digerlerine [] veriyor. Bunu update
          // dalinda yazmak, gunluk cron'un o gun icin toplamis oldugu gercek
          // query listesini siliyordu.
          update: {
            totalClicks: row.clicks ?? 0,
            totalImpressions: row.impressions ?? 0,
            avgCtr: row.ctr ?? 0,
            avgPosition: row.position ?? 0,
            ...(dayQueries.length > 0 ? { queryDetails: dayQueries as any } : {}),
          },
        });
        saved++;
        totalClicks += row.clicks ?? 0;
        totalImpressions += row.impressions ?? 0;
      }

      this.log.log(`[${siteId}] Backfill ${days} days: ${saved} snapshots, ${totalClicks} clicks, ${totalImpressions} imp`);
      return {
        saved,
        range: { from: startStr, to: endStr },
        totalClicks,
        totalImpressions,
      };
    } catch (err: any) {
      this.log.error(`[${siteId}] Backfill error: ${err.message}`);
      throw new BadRequestException(`GSC backfill basarisiz: ${err.message}`);
    }
  }

  /** Page URL'den slug çıkartıp Article.performanceMetrics güncelle */
  private async updateArticleMetrics(siteId: string, pageRows: GscRow[]) {
    const articles = await this.prisma.article.findMany({
      where: { siteId, status: 'PUBLISHED' },
      select: { id: true, slug: true },
    });
    const slugMap = new Map(articles.map(a => [a.slug, a.id]));

    for (const row of pageRows) {
      const url = row.keys?.[0];
      if (!url) continue;
      try {
        const path = new URL(url).pathname;
        const slug = path.split('/').filter(Boolean).pop();
        if (!slug) continue;
        const articleId = slugMap.get(slug);
        if (!articleId) continue;

        await this.prisma.article.update({
          where: { id: articleId },
          data: {
            performanceCheckedAt: new Date(),
            performanceMetrics: {
              clicks: row.clicks ?? 0,
              impressions: row.impressions ?? 0,
              ctr: row.ctr ?? 0,
              position: row.position ?? 0,
              lastUpdated: new Date().toISOString(),
            },
          },
        });
      } catch {}
    }
  }

  // ─────────────────────────────────────────────
  //  Site overview (last 30 days)
  // ─────────────────────────────────────────────

  async getOverview(siteId: string, days = 30) {
    const since = new Date(Date.now() - days * 86400000);
    const [snapshots, site] = await Promise.all([
      this.prisma.analyticsSnapshot.findMany({
        where: { siteId, date: { gte: since } },
        orderBy: { date: 'asc' },
      }),
      this.prisma.site.findUnique({ where: { id: siteId }, select: { name: true, url: true } }),
    ]);

    // Markali / markasiz organik ayrimi — AI probe'lariyla AYNI marka kurali
    // (brand-in-query.ts). Markali sorgu hafiza, markasiz sorgu kesif olcer;
    // "SEO kanalin var mi?" sorusunun cevabi markasiz payda. Orneklem:
    // queryDetails gun basina ilk 100 sorgu (bkz. organic-brand-split.ts).
    const brand = site ? resolveSiteBrand(site.name, site.url) : '';
    const allQueries = snapshots.flatMap((s) => (Array.isArray(s.queryDetails) ? (s.queryDetails as unknown as OrganicQueryRow[]) : []));
    const brandSplit = brand
      ? {
          ...splitQueriesByBrand(allQueries, brand),
          brand,
          daysWithQueries: snapshots.filter((s) => Array.isArray(s.queryDetails) && (s.queryDetails as any[]).length > 0).length,
          series: dailyUnbrandedShare(snapshots, brand),
        }
      : null;

    const totals = snapshots.reduce(
      (acc, s) => ({
        clicks: acc.clicks + s.totalClicks,
        impressions: acc.impressions + s.totalImpressions,
      }),
      { clicks: 0, impressions: 0 },
    );

    return {
      totals: {
        ...totals,
        avgCtr: totals.impressions > 0 ? totals.clicks / totals.impressions : 0,
        avgPosition:
          snapshots.length > 0
            ? snapshots.reduce((s, x) => s + x.avgPosition, 0) / snapshots.length
            : 0,
      },
      timeSeries: snapshots.map(s => ({
        date: s.date.toISOString().slice(0, 10),
        clicks: s.totalClicks,
        impressions: s.totalImpressions,
        ctr: s.avgCtr,
        position: s.avgPosition,
      })),
      brandSplit,
      latestSnapshot: snapshots[snapshots.length - 1] ?? null,
    };
  }

  // ─────────────────────────────────────────────
  //  Top articles by performance
  // ─────────────────────────────────────────────

  async getTopArticles(siteId: string, limit = 10) {
    const articles = await this.prisma.article.findMany({
      where: {
        siteId,
        status: 'PUBLISHED',
        performanceMetrics: { not: null as any },
      },
      orderBy: { publishedAt: 'desc' },
      take: 100,
    });

    return articles
      .map(a => {
        const m = (a.performanceMetrics as any) ?? {};
        return {
          id: a.id,
          slug: a.slug,
          title: a.title,
          publishedAt: a.publishedAt,
          clicks: m.clicks ?? 0,
          impressions: m.impressions ?? 0,
          ctr: m.ctr ?? 0,
          position: m.position ?? 0,
        };
      })
      .sort((a, b) => b.clicks - a.clicks)
      .slice(0, limit);
  }

  // ─────────────────────────────────────────────
  //  Trending queries (last 7 vs prev 7)
  // ─────────────────────────────────────────────

  async getTrendingQueries(siteId: string) {
    const now = new Date();
    const sevenDaysAgo = new Date(now.getTime() - 7 * 86400000);
    const fourteenDaysAgo = new Date(now.getTime() - 14 * 86400000);

    const recent = await this.prisma.analyticsSnapshot.findMany({
      where: { siteId, date: { gte: sevenDaysAgo, lt: now } },
    });
    const previous = await this.prisma.analyticsSnapshot.findMany({
      where: { siteId, date: { gte: fourteenDaysAgo, lt: sevenDaysAgo } },
    });

    const recentTotals = this.aggregateQueries(recent);
    const previousTotals = this.aggregateQueries(previous);

    const trending: any[] = [];
    for (const [query, recentImp] of recentTotals) {
      const prevImp = previousTotals.get(query) ?? 0;
      if (recentImp < 50) continue;
      const growth = prevImp > 0 ? ((recentImp - prevImp) / prevImp) * 100 : 100;
      if (growth >= 30) {
        trending.push({ query, recentImp, prevImp, growthPct: Math.round(growth) });
      }
    }

    return trending.sort((a, b) => b.growthPct - a.growthPct).slice(0, 10);
  }

  private aggregateQueries(snapshots: any[]): Map<string, number> {
    const totals = new Map<string, number>();
    for (const s of snapshots) {
      const queries = (s.queryDetails as any[]) ?? [];
      for (const q of queries) {
        if (!q.query) continue;
        totals.set(q.query, (totals.get(q.query) ?? 0) + (q.impressions ?? 0));
      }
    }
    return totals;
  }

  // ─────────────────────────────────────────────
  //  Improvement suggestions (low-CTR + near-miss)
  // ─────────────────────────────────────────────

  async getImprovementSuggestions(siteId: string) {
    const lastSnap = await this.prisma.analyticsSnapshot.findFirst({
      where: { siteId },
      orderBy: { date: 'desc' },
    });
    if (!lastSnap) return [];

    const queries = (lastSnap.queryDetails as any[]) ?? [];
    const suggestions: any[] = [];

    for (const q of queries) {
      // Near-miss: position 4-15, impressions > 100, clicks < 5
      if (q.position >= 4 && q.position <= 15 && q.impressions > 100 && q.clicks < 5) {
        suggestions.push({
          type: 'near-miss',
          query: q.query,
          page: q.page,
          impressions: q.impressions,
          position: q.position,
          recommendation: 'İlk sayfaya yakın, içerik güçlendirilirse ilk 3\'e çıkabilir',
        });
      }
      // Low-CTR: clicks > 0, ctr < 2%, impressions > 100
      else if (q.clicks > 0 && q.ctr < 0.02 && q.impressions > 100) {
        suggestions.push({
          type: 'low-ctr',
          query: q.query,
          page: q.page,
          ctr: q.ctr,
          impressions: q.impressions,
          recommendation: 'Meta title/description yeniden yazılmalı — düşük CTR',
        });
      }
    }

    return suggestions.slice(0, 20);
  }

  // ─────────────────────────────────────────────
  //  Rank Tracking — GSC tabanlı keyword rank takibi (sıfır ek maliyet)
  // ─────────────────────────────────────────────

  /**
   * Her keyword için son N gündeki avg position + N gün öncesine göre delta + sparkline.
   * Rakip yok (DataForSEO'ya gerek yok), sadece kendi sitenin ranking trendi.
   */
  async getRankings(siteId: string, days = 30) {
    const now = new Date();
    const periodStart = new Date(now.getTime() - days * 86400000);
    const prevPeriodStart = new Date(now.getTime() - 2 * days * 86400000);

    // Son 2*days gün için tüm snapshot'ları çek
    const snapshots = await this.prisma.analyticsSnapshot.findMany({
      where: { siteId, date: { gte: prevPeriodStart, lte: now } },
      orderBy: { date: 'asc' },
    });

    if (snapshots.length === 0) {
      return { keywords: [], summary: null, hasData: false };
    }

    // Bu periyoda ait snapshot'lardan toplam metrikleri hesapla
    // (queryDetails bos olsa bile snapshot.totalClicks/Impressions GSC daily'den geliyor).
    // Keyword listesi yoksa bile kullanici "9 gosterim, 2 tiklama" gibi gercek toplami gormeli.
    const currentSnapshots = snapshots.filter((s) => s.date >= periodStart);
    const periodTotalClicks = currentSnapshots.reduce((s, x) => s + (x.totalClicks ?? 0), 0);
    const periodTotalImpressions = currentSnapshots.reduce((s, x) => s + (x.totalImpressions ?? 0), 0);
    const periodAvgPosition = currentSnapshots.length > 0
      ? currentSnapshots.reduce((s, x) => s + (x.avgPosition ?? 0), 0) / currentSnapshots.length
      : 0;

    // Her query için: günlük pozisyon dizisi, toplam click/impression
    type KwAcc = {
      query: string;
      page: string;
      currentPositions: number[];
      previousPositions: number[];
      clicks: number;
      impressions: number;
      sparkline: { date: string; position: number }[];
    };

    const acc = new Map<string, KwAcc>();

    for (const snap of snapshots) {
      const isCurrentPeriod = snap.date >= periodStart;
      const queries = (snap.queryDetails as any[]) ?? [];
      for (const q of queries) {
        if (!q.query) continue;
        const key = q.query;
        if (!acc.has(key)) {
          acc.set(key, {
            query: q.query,
            page: q.page ?? '',
            currentPositions: [],
            previousPositions: [],
            clicks: 0,
            impressions: 0,
            sparkline: [],
          });
        }
        const a = acc.get(key)!;
        if (isCurrentPeriod) {
          a.currentPositions.push(q.position ?? 0);
          a.clicks += q.clicks ?? 0;
          a.impressions += q.impressions ?? 0;
          a.sparkline.push({
            date: snap.date.toISOString().slice(0, 10),
            position: q.position ?? 0,
          });
          // Page güncel kalsın (en son ranking eden URL)
          if (q.page) a.page = q.page;
        } else {
          a.previousPositions.push(q.position ?? 0);
        }
      }
    }

    // Aggregate
    const keywords = Array.from(acc.values())
      .filter(k => k.currentPositions.length > 0) // bu periyotta görünenler
      .map(k => {
        const avg = (arr: number[]) =>
          arr.length > 0 ? arr.reduce((s, x) => s + x, 0) / arr.length : 0;
        const currentPos = avg(k.currentPositions);
        const previousPos = avg(k.previousPositions);
        // Delta: previousPos - currentPos (pozitif = iyileşti, çünkü pos düştü)
        const delta = k.previousPositions.length > 0
          ? Math.round((previousPos - currentPos) * 10) / 10
          : null;
        const ctr = k.impressions > 0 ? k.clicks / k.impressions : 0;
        return {
          query: k.query,
          page: k.page,
          position: Math.round(currentPos * 10) / 10,
          previousPosition: previousPos > 0 ? Math.round(previousPos * 10) / 10 : null,
          delta, // null = ilk dönem, yok karşılaştırma
          clicks: k.clicks,
          impressions: k.impressions,
          ctr: Math.round(ctr * 10000) / 100, // 0-100 arası yüzde
          sparkline: k.sparkline.slice(-30), // son 30 nokta
          tier: this.classifyTier(currentPos),
        };
      })
      .sort((a, b) => b.impressions - a.impressions);

    // Summary
    const winning = keywords.filter(k => k.tier === 'top3').length;
    const top10 = keywords.filter(k => ['top3', 'top10'].includes(k.tier)).length;
    const opportunities = keywords.filter(k => k.tier === 'near').length;
    const improving = keywords.filter(k => k.delta !== null && k.delta > 0.5).length;
    const declining = keywords.filter(k => k.delta !== null && k.delta < -0.5).length;
    const avgPosition =
      keywords.length > 0
        ? Math.round((keywords.reduce((s, k) => s + k.position, 0) / keywords.length) * 10) / 10
        : 0;

    // Keyword listesi GSC privacy filter nedeniyle bos olabilir; bu durumda da
    // toplam metrikler snapshot'larin kendisinden gelecek.
    const totalClicksFromKw = keywords.reduce((s, k) => s + k.clicks, 0);
    const totalImpFromKw = keywords.reduce((s, k) => s + k.impressions, 0);
    const summaryTotalClicks = Math.max(totalClicksFromKw, periodTotalClicks);
    const summaryTotalImp = Math.max(totalImpFromKw, periodTotalImpressions);
    const summaryAvgPos = keywords.length > 0
      ? avgPosition
      : Math.round(periodAvgPosition * 10) / 10;

    return {
      keywords,
      summary: {
        total: keywords.length,
        winning,
        top10,
        opportunities,
        improving,
        declining,
        avgPosition: summaryAvgPos,
        totalClicks: summaryTotalClicks,
        totalImpressions: summaryTotalImp,
      },
      hasData: summaryTotalImp > 0 || keywords.length > 0,
      period: { days, startDate: periodStart.toISOString().slice(0, 10), endDate: now.toISOString().slice(0, 10) },
    };
  }

  private classifyTier(position: number): 'top3' | 'top10' | 'near' | 'low' {
    if (position > 0 && position <= 3) return 'top3';
    if (position > 0 && position <= 10) return 'top10';
    if (position > 0 && position <= 20) return 'near';
    return 'low';
  }

  // ─────────────────────────────────────────────
  //  Helpers
  // ─────────────────────────────────────────────

  /**
   * Gunluk snapshot icin varsayilan tarih.
   *
   * DUN DEGIL, T-3. Google Search Console verisi ~2 gun gecikmeli yayinlanir;
   * dun icin sorgu ATTIGIMIZ HER GECE BOS DONUYORDU. Olculdu (kobipratik,
   * sc-domain, siteOwner):
   *   T-1 -> 0 satir      T-2 -> 50 satir / 486 tiklama
   *   T-3 -> 50 satir     T-4 -> 50 satir / 289 tiklama
   * Cron her gece bu bos yaniti sifir snapshot olarak yaziyor, upsert oldugu
   * icin de o sifir bir daha duzelmiyordu — kobipratik'te 3 ay boyunca
   * 36 snapshot'in hepsi 0 tiklama/0 gosterim olarak kaldi, oysa ayni
   * property gercekte ayda ~9.800 tiklama aliyordu.
   * T-3, 1 gunluk emniyet payi birakir.
   */
  private static readonly GSC_LAG_DAYS = 3;

  private defaultSnapshotDate(): Date {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() - AnalyticsService.GSC_LAG_DAYS);
    d.setUTCHours(0, 0, 0, 0);
    return d;
  }
}
