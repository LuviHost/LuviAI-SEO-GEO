import { BadRequestException, Injectable, Logger, Optional } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { GscOAuthService } from '../auth/gsc-oauth.service.js';
import { resolveSiteBrand } from '../audit/brand-in-query.js';
import { splitQueriesByBrand, dailyUnbrandedShare, brandHostFromUrl, type OrganicQueryRow } from './organic-brand-split.js';
import { GscLiveService, type GscHandle } from './gsc-live.service.js';
import {
  addDays,
  buildRankings,
  compareQueryPeriods,
  daysInclusive,
  isoDay,
  periodWindows,
  snapshotCoverage,
  sumTotals,
  type DayTotals,
  type GscRow,
} from './gsc-aggregate.js';

/** Siralama tablosuna donen en fazla sorgu (ozet sayilari TUM sorgulardan) */
export const RANKINGS_KEYWORD_LIMIT = 2000;
/** Gunluk pozisyon serisi cekilen ust sorgu sayisi (tablo gosterime gore sirali) */
export const RANKINGS_SPARKLINE_QUERIES = 100;
/** Backfill'de gun gun detay (ilk-N sayfa/sorgu) cekilen son gun sayisi; toplamlar tum aralik icin */
export const BACKFILL_DETAIL_DAYS = 7;
/** GSC 16 ay geriye veri verir */
export const GSC_MAX_HISTORY_DAYS = 480;

const round1 = (n: number) => Math.round(n * 10) / 10;

@Injectable()
export class AnalyticsService {
  private readonly log = new Logger(AnalyticsService.name);
  private readonly live: GscLiveService;

  constructor(
    private readonly prisma: PrismaService,
    private readonly gscOAuth: GscOAuthService,
    @Optional() live?: GscLiveService,
  ) {
    // DI disinda (testler) elle kurulursa kendi canli istemcisini olusturur
    this.live = live ?? new GscLiveService(prisma, gscOAuth);
  }

  // ─────────────────────────────────────────────
  //  Daily snapshot — cron task çağırır
  // ─────────────────────────────────────────────

  /**
   * GSC ham satirini DB sekline cevirir.
   *
   * NEDEN AYRI FONKSIYON: upsert'un create dali bu esleme yapiyordu ama
   * update dali HAM satiri (`{keys:[...]}`) yaziyordu. Iki dal farkli sekil
   * uretince, ayni tarih ikinci kez yazildiginda kayit bozuluyor ve
   * pageDetails/queryDetails'i okuyan her yuzey (rapor top-query, oneriler)
   * sessizce bosaliyor. Gunluk cron kayan pencereye gectigi icin ayni
   * tarihler her gece tekrar yaziliyor.
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

  /**
   * Bir gunun snapshot'ini yazar — cron, tek gun ve backfill AYNI yoldan.
   *
   * TOPLAM TANIMI: totalClicks/totalImpressions/avgCtr/avgPosition GSC'nin
   * `dimensions: ['date']` gun agregasindan gelir (Search Console grafigindeki
   * sayi; anonim sorgular dahil, pozisyon GSC'nin gosterim-agirlikli degeri).
   * Eskiden cron ilk 50 SAYFAYI topluyor, pozisyonu 50 sayfanin duz ortalamasi
   * aliyordu: gosterim %30-40 eksik, pozisyon oldugundan iyi cikiyordu; backfill
   * ise gun agregasini yaziyordu — seri iki tanimi karistiriyordu.
   *
   * Detay (ilk 50 sayfa / ilk 100 sorgu+sayfa) yalnizca DETAYDIR; toplam diye
   * toplanmaz. Detay cekilmediyse update dali mevcut detayi EZMEZ.
   */
  private async writeDay(siteId: string, day: DayTotals, details: { pageRows: GscRow[]; queryRows: GscRow[] } | null) {
    const date = new Date(`${day.date}T00:00:00.000Z`);
    const pageDetails = (details?.pageRows ?? []).map((r) => this.toPageDetail(r));
    const queryDetails = (details?.queryRows ?? []).map((r) => this.toQueryDetail(r));
    const hasDetails = pageDetails.length > 0 || queryDetails.length > 0;
    const totals = {
      totalClicks: Math.round(day.clicks),
      totalImpressions: Math.round(day.impressions),
      avgCtr: day.ctr,
      avgPosition: day.position,
    };
    await this.prisma.analyticsSnapshot.upsert({
      where: { siteId_date: { siteId, date } },
      create: {
        siteId,
        date,
        ...totals,
        pageDetails: pageDetails as any,
        queryDetails: queryDetails as any,
      },
      update: {
        ...totals,
        ...(hasDetails ? { pageDetails: pageDetails as any, queryDetails: queryDetails as any } : {}),
      },
    });
  }

  /** Bir gunun detay listeleri: ilk 50 sayfa, ilk 100 sorgu+sayfa (tiklama sirali) */
  private async fetchDayDetails(h: GscHandle, date: string): Promise<{ pageRows: GscRow[]; queryRows: GscRow[] }> {
    const pageRes = await h.api.query({
      siteUrl: h.siteUrl,
      requestBody: { startDate: date, endDate: date, dimensions: ['page'], rowLimit: 50 },
    });
    const queryRes = await h.api.query({
      siteUrl: h.siteUrl,
      requestBody: { startDate: date, endDate: date, dimensions: ['query', 'page'], rowLimit: 100 },
    });
    return { pageRows: pageRes?.data?.rows ?? [], queryRows: queryRes?.data?.rows ?? [] };
  }

  /**
   * [from, to] araligini GSC'den yazar. Toplamlar TEK `['date']` istegiyle
   * tum aralik icin; detay yalnizca son `detailDays` gun icin (gun basina 2
   * istek — 90 gunun detayi 180 istek olur, HTTP istegi Cloudflare'in 100 sn
   * sinirina takilir).
   *
   * GSC BOS DONEN GUN YAZILMAZ: bos yanit "o gun trafik yoktu" degil, neredeyse
   * her zaman "henuz yayinlanmadi" demek. Sifir yazmak grafikte sahte dusus
   * uretir ve upsert oldugu icin sonradan duzelmezdi.
   */
  async syncSnapshots(
    siteId: string,
    h: GscHandle,
    from: string,
    to: string,
    opts: { detailDays?: number } = {},
  ): Promise<{ saved: number; detailed: number; totalClicks: number; totalImpressions: number; days: DayTotals[] }> {
    const days = await this.live.dailyTotals(h, from, to);
    if (days.length === 0) {
      this.log.warn(
        `[${siteId}] ${from}..${to} icin GSC bos dondu — snapshot YAZILMADI ` +
        `(veri henuz yayinlanmamis olabilir; GSC ~2 gun gecikmeli).`,
      );
      return { saved: 0, detailed: 0, totalClicks: 0, totalImpressions: 0, days };
    }
    const detailDays = Math.max(0, opts.detailDays ?? 0);
    const detailSet = new Set(detailDays > 0 ? days.slice(-detailDays).map((d) => d.date) : []);
    const latest = days[days.length - 1].date;

    let saved = 0;
    let detailed = 0;
    let latestPages: GscRow[] | null = null;
    for (const day of days) {
      let details: { pageRows: GscRow[]; queryRows: GscRow[] } | null = null;
      if (detailSet.has(day.date)) {
        try {
          details = await this.fetchDayDetails(h, day.date);
          detailed++;
          if (day.date === latest) latestPages = details.pageRows;
        } catch (err: any) {
          // Detay hatasi toplami dusurmesin: gun toplamla yazilir, detay sonraki calismada
          this.log.warn(`[${siteId}] ${day.date} detay alinamadi: ${String(err?.message ?? err).slice(0, 200)}`);
        }
      }
      await this.writeDay(siteId, day, details);
      saved++;
    }

    // Makale performansi: en son detayli gunun sayfa satirlarindan
    if (latestPages && latestPages.length > 0) await this.updateArticleMetrics(siteId, latestPages);

    const t = sumTotals(days);
    return { saved, detailed, totalClicks: t.clicks, totalImpressions: t.impressions, days };
  }

  async captureSnapshot(siteId: string, date?: Date, opts?: { silent?: boolean }): Promise<void> {
    const targetDate = date ?? this.defaultSnapshotDate();
    const dateStr = isoDay(targetDate);

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

    const h = await this.live.handle(siteId);
    if (!h) return;

    try {
      const r = await this.syncSnapshots(siteId, h, dateStr, dateStr, { detailDays: 1 });
      const d = r.days[0];
      if (d) this.log.log(`[${siteId}] Snapshot ${dateStr}: ${d.clicks} clicks, ${d.impressions} imp, pos ${d.position.toFixed(1)}`);
    } catch (err: any) {
      this.log.error(`[${siteId}] Snapshot error: ${err.message}`);
    }
  }

  /**
   * Gece cron'u: son 90 gunun TOPLAMLARI tek istekle (bosluklar ve GSC
   * revizyonlari kendiliginden kapanir; yeni baglanan site 90 gunu bulur),
   * T-3..T-7 icin gun gun detay. Bitis T-3: GSC ~2 gun gecikmeli.
   */
  async refreshRecent(siteId: string, today = isoDay(new Date())) {
    const h = await this.live.handle(siteId);
    if (!h) return null;
    const to = addDays(today, -AnalyticsService.GSC_LAG_DAYS);
    const from = addDays(to, -89);
    const r = await this.syncSnapshots(siteId, h, from, to, { detailDays: 5 });
    this.live.invalidate(siteId);
    return r;
  }

  /**
   * Son N gun icin GSC'den veri cek, gunluk snapshot olarak kaydet.
   * Yeni site baglandiginda + "Yenile" butonu icin kullanilir.
   * Toplamlar captureSnapshot ile AYNI tanim (gun agregasi); detay son
   * `detailDays` gun icin. Tum donemin sorgu listesini tek gune iliştirmek
   * (eski davranis) o gunu sisiriyor, digerlerini bos birakiyordu — kaldirildi.
   */
  async backfillSnapshots(
    siteId: string,
    days: number,
    opts: { detailDays?: number } = {},
  ): Promise<{ saved: number; detailedDays: number; range: { from: string; to: string }; totalClicks: number; totalImpressions: number }> {
    const site = await this.prisma.site.findUniqueOrThrow({ where: { id: siteId } });
    if (!site.gscPropertyUrl || !site.gscRefreshToken) {
      throw new BadRequestException('Bu site Google Search Console hesabina bagli degil.');
    }

    const h = await this.live.handle(siteId);
    if (!h) throw new BadRequestException('GSC client kurulamadi.');

    const n = Math.max(1, Math.min(GSC_MAX_HISTORY_DAYS, Math.floor(days)));
    const endStr = isoDay(new Date());
    const startStr = addDays(endStr, -n);

    try {
      const r = await this.syncSnapshots(siteId, h, startStr, endStr, {
        detailDays: opts.detailDays ?? Math.min(n, BACKFILL_DETAIL_DAYS),
      });
      this.live.invalidate(siteId);
      this.log.log(`[${siteId}] Backfill ${n} days: ${r.saved} snapshots, ${r.totalClicks} clicks, ${r.totalImpressions} imp`);
      return {
        saved: r.saved,
        detailedDays: r.detailed,
        range: { from: startStr, to: endStr },
        totalClicks: r.totalClicks,
        totalImpressions: r.totalImpressions,
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
      } catch {
        // Tek satirin hatasi (GSC'den gelen bozuk URL, arada silinmis makale) diger sayfalarin metrik guncellemesini durdurmasin
      }
    }
  }

  // ─────────────────────────────────────────────
  //  Site overview (last 30 days)
  // ─────────────────────────────────────────────

  /**
   * Pencere SON VERI GUNUNE dayanir (GSC ~2 gun gecikmeli; bugunden saymak
   * son 2 gunu her zaman bos birakirdi). Saklanan gunler pencereyi
   * kapsamiyorsa `coverage` bunu soyler — "30 gun" etiketi 15 gunluk toplamin
   * ustunde durmasin.
   */
  async getOverview(siteId: string, days = 30, opts: { brandSplit?: boolean } = {}) {
    const n = Math.max(1, Math.min(GSC_MAX_HISTORY_DAYS, Math.floor(days) || 30));
    const today = isoDay(new Date());
    const [latestSnap, site] = await Promise.all([
      this.prisma.analyticsSnapshot.findFirst({ where: { siteId }, orderBy: { date: 'desc' }, select: { date: true } }),
      this.prisma.site.findUnique({ where: { id: siteId }, select: { name: true, url: true } }),
    ]);
    const latest = latestSnap?.date ? isoDay(latestSnap.date) : null;
    // Son veri pencereden de eskiyse bugune dayan: eski veri "son 30 gun" diye sunulmasin
    const windowTo = latest && latest >= addDays(today, -n) ? latest : today;
    const windowFrom = addDays(windowTo, -(n - 1));

    const snapshots = await this.prisma.analyticsSnapshot.findMany({
      where: {
        siteId,
        date: { gte: new Date(`${windowFrom}T00:00:00.000Z`), lte: new Date(`${windowTo}T00:00:00.000Z`) },
      },
      orderBy: { date: 'asc' },
    });

    const coverage = snapshotCoverage(snapshots.map((s) => isoDay(s.date)), windowFrom, windowTo, n);
    const t = sumTotals(snapshots.map((s) => ({ clicks: s.totalClicks, impressions: s.totalImpressions, position: s.avgPosition })));
    // Marka payi canli GSC sorgusu ister; yalniz zaman serisine bakan cagiran
    // (RanksUp etkisi karti, 90 gun) kotayi bosa harcamasin diye kapatabilir
    const brandSplit = opts.brandSplit === false
      ? null
      : await this.brandSplitFor(siteId, site, snapshots, windowFrom, windowTo);

    return {
      totals: {
        clicks: t.clicks,
        impressions: t.impressions,
        avgCtr: t.ctr,
        // Gosterim-agirlikli: 3 gosterimli gun 3000 gosterimli gunle esit sayilmaz
        avgPosition: t.position,
      },
      coverage,
      timeSeries: snapshots.map(s => ({
        date: isoDay(s.date),
        clicks: s.totalClicks,
        impressions: s.totalImpressions,
        ctr: s.avgCtr,
        position: s.avgPosition,
      })),
      brandSplit,
      latestSnapshot: snapshots[snapshots.length - 1] ?? null,
    };
  }

  /**
   * Markali / markasiz organik ayrimi — AI probe'lariyla AYNI marka kurali
   * (brand-in-query.ts). Markali sorgu hafiza, markasiz sorgu kesif olcer.
   *
   * KAYNAK: once GSC'nin donem sorgu agregasi (tum sorgular; anonim sorgular
   * GSC'de sorgu satiri olmadigi icin disarida — `anonymizedClicks`). GSC'ye
   * ulasilamazsa saklanan gunluk ilk-100 listeden ORNEKLEM (`source: 'sample'`).
   * Eskiden yalniz ornekleme bakiliyordu: 354 sorguluk orneklemde markali
   * sorgu cikmayinca pay "%100 markasiz" gorunuyordu.
   */
  private async brandSplitFor(
    siteId: string,
    site: { name: string | null; url: string } | null,
    snapshots: Array<{ date: Date; queryDetails: unknown }>,
    from: string,
    to: string,
  ) {
    const brand = site ? resolveSiteBrand(site.name, site.url) : '';
    if (!brand) return null;
    // Host: jenerik turetilmis markada ("emlak" ← emlak.com) her sektor
    // aramasi markali sayilmasin — AI olcumuyle ayni karar
    const brandHost = brandHostFromUrl(site?.url);
    const series = dailyUnbrandedShare(snapshots, brand, brandHost);

    const live = await this.liveBrandSplit(siteId, brand, brandHost, from, to).catch((err) => {
      this.log.warn(`[${siteId}] canli marka ayrimi alinamadi: ${String(err?.message ?? err).slice(0, 200)}`);
      return null;
    });
    if (live) {
      return { ...live, brand, daysWithQueries: daysInclusive(from, to), series, source: 'gsc' as const, from, to };
    }

    const allQueries = snapshots.flatMap((s) => (Array.isArray(s.queryDetails) ? (s.queryDetails as unknown as OrganicQueryRow[]) : []));
    return {
      ...splitQueriesByBrand(allQueries, brand, brandHost),
      brand,
      daysWithQueries: snapshots.filter((s) => Array.isArray(s.queryDetails) && (s.queryDetails as any[]).length > 0).length,
      series,
      source: 'sample' as const,
      from,
      to,
    };
  }

  private async liveBrandSplit(siteId: string, brand: string, host: string | null, from: string, to: string) {
    const h = await this.live.handle(siteId);
    if (!h) return null;
    return this.live.cache.get(this.live.key(h, siteId, 'brand', from, to, brand, host ?? ''), async () => {
      const q = await this.live.queryTotals(h, from, to);
      const totals = await this.live.periodTotals(h, from, to);
      const split = splitQueriesByBrand(q.rows, brand, host);
      const queryClicks = split.branded.clicks + split.unbranded.clicks;
      return {
        ...split,
        siteClicks: totals.clicks,
        // GSC gizlilik esigi: nadir sorgular sorgu satirinda yok, toplamda var
        anonymizedClicks: Math.max(0, totals.clicks - queryClicks),
        truncated: q.truncated,
      };
    });
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

  /**
   * Yukselen sorgular: GSC'nin SON 7 TAM GUNU, hemen onceki 7 gune karsi,
   * ayni sorgu. Iki donem de GSC'den canli gelir.
   *
   * Eskiden saklanan gunluk ilk-100 listeler toplaniyordu; onceki haftanin
   * cogu gununde liste bos oldugu icin gercekte %88 DUSEN bir sorgu
   * +%31.386 "yukselen" gorunuyordu. GSC'ye ulasilamazsa bos liste doner —
   * eksik veriyle kiyas YAPILMAZ.
   */
  async getTrendingQueries(siteId: string) {
    const h = await this.live.handle(siteId).catch(() => null);
    if (!h) return [];
    try {
      const r = await this.queryMovers(siteId, h);
      return r ? r.rising.map((t) => ({ ...t, from: r.current.from, to: r.current.to })) : [];
    } catch (err: any) {
      this.log.warn(`[${siteId}] yukselen sorgular alinamadi: ${String(err?.message ?? err).slice(0, 200)}`);
      return [];
    }
  }

  private async queryMovers(siteId: string, h: GscHandle) {
    const latest = await this.live.latestDate(siteId, h);
    if (!latest) return null;
    const { current, previous } = periodWindows(latest, 7);
    return this.live.cache.get(this.live.key(h, siteId, 'movers', current.from, current.to), async () => {
      const cur = await this.live.queryTotals(h, current.from, current.to, 50_000);
      const prev = await this.live.queryTotals(h, previous.from, previous.to, 50_000);
      return { ...compareQueryPeriods(cur.rows, prev.rows), current, previous };
    });
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
   * Secilen donem (7/30/90) icin GSC'nin KENDI sorgu agregasi: toplam sorgu,
   * ilk 3/10, 11-20, gosterim-agirlikli ortalama sira ve sorgu bazinda
   * tiklama/gosterim/CTR/sira Search Console ile ayni cikar. "Degisim" ve
   * Yukselen/Dusen hemen onceki esit donemle, ayni sorgu, gosterim esigiyle.
   *
   * Eskiden gunluk ilk-100 sorgu+sayfa satirlarindan hesaplaniyordu: 30 gunde
   * 23.914 sorgu yerine 354, ortalama sira 6,86 yerine 3,7; backfill tum
   * listeyi tek gune yazdigi icin onceki donem bos, "Degisim" hep "—" idi.
   */
  async getRankings(siteId: string, days = 30) {
    const n = Math.max(1, Math.min(GSC_MAX_HISTORY_DAYS, Math.floor(days) || 30));
    const h = await this.live.handle(siteId).catch(() => null);
    if (!h) {
      return { keywords: [], summary: null, hasData: false, source: 'unavailable' as const, reason: 'not_connected' as const };
    }
    try {
      const latest = await this.live.latestDate(siteId, h);
      if (!latest) return { keywords: [], summary: null, hasData: false, source: 'gsc' as const, reason: 'no_data' as const };
      return await this.live.cache.get(this.live.key(h, siteId, 'rankings', n, latest), () => this.computeRankings(h, n, latest));
    } catch (err: any) {
      this.log.warn(`[${siteId}] siralama verisi alinamadi: ${String(err?.message ?? err).slice(0, 200)}`);
      return { keywords: [], summary: null, hasData: false, source: 'unavailable' as const, reason: 'gsc_error' as const };
    }
  }

  private async computeRankings(h: GscHandle, days: number, latest: string) {
    const { current, previous } = periodWindows(latest, days);
    const cur = await this.live.queryTotals(h, current.from, current.to);
    const prev = await this.live.queryTotals(h, previous.from, previous.to);
    const totals = await this.live.periodTotals(h, current.from, current.to);

    // Sayfa ve trend detay; basarisizsa bos kalir (sahte deger uretilmez)
    const pages = await this.live.topPages(h, current.from, current.to).catch(() => new Map<string, string>());
    const topQueries = [...cur.rows]
      .sort((a, b) => b.impressions - a.impressions)
      .slice(0, RANKINGS_SPARKLINE_QUERIES)
      .map((q) => q.query);
    const sparklines = days >= 2
      ? await this.live.sparklines(h, current.from, current.to, topQueries).catch(() => new Map())
      : new Map();

    const built = buildRankings({
      current: cur.rows,
      previous: prev.rows,
      pages,
      sparklines,
      limit: RANKINGS_KEYWORD_LIMIT,
    });
    const s = built.summary;

    return {
      keywords: built.keywords,
      summary: {
        total: s.total,
        winning: s.winning,
        top10: s.top10,
        opportunities: s.opportunities,
        improving: s.improving,
        declining: s.declining,
        // Site geneli GSC ortalama sirasi (gosterim-agirlikli); yoksa sorgu satirlarindan
        avgPosition: totals.position > 0 ? round1(totals.position) : s.avgPosition,
        queryAvgPosition: s.avgPosition,
        // GSC grafigindeki toplam (anonim sorgular dahil)
        totalClicks: totals.clicks,
        totalImpressions: totals.impressions,
        // Sorgu satirlarinin toplami — fark anonim sorgulardir
        queryClicks: s.queryClicks,
        queryImpressions: s.queryImpressions,
      },
      hasData: totals.impressions > 0 || built.keywords.length > 0,
      period: {
        days,
        startDate: current.from,
        endDate: current.to,
        previousStartDate: previous.from,
        previousEndDate: previous.to,
      },
      source: 'gsc' as const,
      totalKeywords: s.total,
      keywordsTruncated: built.truncated,
      queriesTruncated: cur.truncated,
      sparklineQueries: topQueries.length,
    };
  }

  // ─────────────────────────────────────────────
  //  Helpers
  // ─────────────────────────────────────────────

  /**
   * Gunluk snapshot icin varsayilan tarih.
   *
   * DUN DEGIL, T-3. Google Search Console verisi ~2 gun gecikmeli yayinlanir;
   * dun icin sorgu ATTIGIMIZ HER GECE BOS DONUYORDU (gercek bir sc-domain
   * property'de olculdu: T-1 0 satir, T-2 ve oncesi dolu). Cron bu bos
   * yaniti sifir snapshot olarak yaziyor, upsert oldugu icin de o sifir bir
   * daha duzelmiyordu. T-3, 1 gunluk emniyet payi birakir.
   */
  private static readonly GSC_LAG_DAYS = 3;

  private defaultSnapshotDate(): Date {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() - AnalyticsService.GSC_LAG_DAYS);
    d.setUTCHours(0, 0, 0, 0);
    return d;
  }
}
