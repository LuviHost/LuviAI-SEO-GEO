import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { google } from 'googleapis';
import { PrismaService } from '../prisma/prisma.service.js';
import { GscOAuthService } from '../auth/gsc-oauth.service.js';
import { STUCK_PAGE_NOT_FOUND } from './stuck-page-messages.js';
// Kopya artik canli degil: cop kutusunda (trashedAt) ya da hedefte yok (missingAt,
// paylasilan sozlesme D3) — ikisi ayni kurala tabi (stuck-page-autopilot.ts)
import { STUCK_FAILED_COOLDOWN_DAYS, isRetiredStuckEntry } from './stuck-page-autopilot.js';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Adres karsilastirma anahtari (makale eslemesi): sema, www ve sondaki bolu
 * atilir, kucuk harf. Metin olmayan deger bos anahtar verir (hicbir seyle eslesmez).
 */
function urlKey(u: unknown): string {
  return typeof u === 'string' ? u.trim().replace(/^https?:\/\/(www\.)?/i, '').replace(/\/+$/, '').toLowerCase() : '';
}

/** publishedTo'daki nesne kayitlar (eski kayitlarda targetId olmayabilir; adres `url` alaninda olabilir) */
function entryObjects(publishedTo: unknown): Array<Record<string, unknown>> {
  return (Array.isArray(publishedTo) ? publishedTo : []).filter((e): e is Record<string, unknown> => !!e && typeof e === 'object');
}

/** Kayit bu adresteki kopya mi? Yayinci adresi externalUrl'e yazar; eski kayitlarda url */
function entryAt(e: Record<string, unknown>, key: string): boolean {
  return key !== '' && (urlKey(e.externalUrl) === key || urlKey(e.url) === key);
}

/** Yazinin bu adreste CANLI (cop kutusunda / hedefte yok olmayan) kopyasi var mi */
function liveCopyAt(publishedTo: unknown, key: string): boolean {
  return entryObjects(publishedTo).some((e) => !isRetiredStuckEntry(e) && entryAt(e, key));
}

/**
 * Bu adresteki kopya artik canli degil mi (ve ayni adreste canli kopya yok mu)?
 * Kayitta trashedAt: yayinci yerinde guncellemede yazinin WordPress cop
 * kutusunda oldugunu gordu; missingAt: yazi hedefte hic yok (404/410, yeniden
 * olusturulmadi — D3). Ikisi de ziyaretciye acik degildir; Search Console
 * adresi verisi eskiyene kadar listelemeye devam eder.
 */
function trashedCopyAt(publishedTo: unknown, key: string): boolean {
  const list = entryObjects(publishedTo);
  return list.some((e) => isRetiredStuckEntry(e) && entryAt(e, key)) && !list.some((e) => !isRetiredStuckEntry(e) && entryAt(e, key));
}

/**
 * Satir guncellemesinde top sorgular: yeni sorgu yoksa alan HIC yazilmaz (eski
 * deger kalir). Eskiden eski deger geri yaziliyordu; sorgusuz acilan satirda o
 * deger DB NULL'dur ve Prisma bos Json alanina duz null kabul etmez (kurulu
 * istemcide StuckPageUpdateManyMutationInput.topQueries:
 * NullableJsonNullValueInput | InputJsonValue, InputJsonValue null icermez;
 * prisma.io/docs .../working-with-json-fields null yazimi icin Prisma.DbNull /
 * Prisma.JsonNull ister).
 */
function freshTopQueries(topQueries: string[]): { topQueries?: string[] } {
  return topQueries.length > 0 ? { topQueries } : {};
}

/** Yeniden kullanilan "Basarisiz" satirin okunan alanlari */
interface FailedStuckRow {
  id: string;
  updatedAt: Date;
  title: string | null;
  articleId: string | null;
  recoveries?: Array<{ id: string }>;
}

/**
 * Stuck Page Detector — On-page.ai Recipe 1 esleyicisi.
 *
 * "Stuck" tanimi:
 *   - Pozisyon 4-15 araliginda (ilk sayfada ama top 3 degil)
 *   - Son 30 gunde >= 50 impression (kayda deger gosterim)
 *   - CTR beklenenin altinda (pozisyona gore)
 *
 * Beklenen CTR (Sistrix/Backlinko ortalamalari):
 *   #1=27%, #2=15%, #3=11%, #4=8%, #5=6%, #6=4.5%, #7=3.5%,
 *   #8=3%, #9=2.5%, #10=2.5%, #11+=<2%
 *
 * stuckScore — oncelik siralamasi icin (0-100):
 *   - Impressions arttikca artar
 *   - CTR / expectedCTR orani dustukce artar
 *   - Pozisyon kotuyse (10+) ek bonus (yukari cikma potansiyeli daha buyuk)
 */
@Injectable()
export class StuckPageDetectorService {
  private readonly log = new Logger(StuckPageDetectorService.name);

  // Pozisyon -> beklenen CTR
  private readonly EXPECTED_CTR: Record<number, number> = {
    1: 0.27, 2: 0.15, 3: 0.11, 4: 0.08, 5: 0.06,
    6: 0.045, 7: 0.035, 8: 0.03, 9: 0.025, 10: 0.025,
    11: 0.02, 12: 0.018, 13: 0.015, 14: 0.012, 15: 0.01,
  };

  constructor(
    private readonly prisma: PrismaService,
    private readonly gscOAuth: GscOAuthService,
  ) {}

  /**
   * Site icin tum sayfalari tara, stuck olanlari DB'ye yazip listeyi don.
   * Daha onceden DETECTED/RECOVERING durumunda olanlar update edilir (yeni metriklerle).
   * RECOVERED/REVERTED/IGNORED olanlar atlanir (kullanici kararini bozma).
   * FAILED satir YENIDEN KULLANILIR (yeni satir acilmaz; refreshFailedRow).
   * Yazinin cop kutusundaki ya da hedefte silinmis bulunan (D3) kopyasinin adresi
   * atlanir (satir acilmaz, guncellenmez).
   */
  async detect(siteId: string): Promise<{ found: number; created: number; updated: number; skipped: number }> {
    const pages = await this.fetchPagePerformance(siteId, 30);
    if (pages.length === 0) {
      this.log.log(`[${siteId}] GSC verisi yok — detector atlandi`);
      return { found: 0, created: 0, updated: 0, skipped: 0 };
    }

    let created = 0;
    let updated = 0;
    let skipped = 0;
    const stuckResults: Array<{
      url: string;
      impressions: number;
      clicks: number;
      ctr: number;
      position: number;
      stuckScore: number;
    }> = [];

    for (const p of pages) {
      const pos = p.position;
      // Filtre: ilk sayfada (4-15) ama top 3 degil
      if (pos < 4 || pos > 15) continue;
      if (p.impressions < 50) continue;

      const expected = this.expectedCtr(pos);
      const ctrGap = expected > 0 ? Math.max(0, 1 - p.ctr / expected) : 0; // 0..1, yuksek = daha kotu

      // stuckScore formulu — impressions log + ctrGap + pozisyon penaltisi
      const impScore = Math.min(100, Math.log10(p.impressions) * 25);   // 50→43, 500→67, 5000→92
      const ctrScore = ctrGap * 100;                                     // 0..100
      const posScore = ((pos - 3) / 12) * 100;                           // 4→8, 10→58, 15→100
      const stuckScore = Math.round(impScore * 0.4 + ctrScore * 0.4 + posScore * 0.2);

      if (stuckScore < 30) continue; // gercekten stuck olmayanlari filtre

      stuckResults.push({
        url: p.url,
        impressions: p.impressions,
        clicks: p.clicks,
        ctr: p.ctr,
        position: pos,
        stuckScore,
      });
    }

    if (stuckResults.length === 0) {
      this.log.log(`[${siteId}] Stuck sayfa bulunamadi (${pages.length} sayfa tarandi)`);
      return { found: 0, created: 0, updated: 0, skipped: 0 };
    }

    // Mevcut RanksUp makaleleriyle eslestir
    const articles = await this.prisma.article.findMany({
      where: { siteId, status: 'PUBLISHED' as any },
      select: { id: true, title: true, publishedTo: true, slug: true },
    });
    // Cop kutusu kaniti icin yayinda OLMAYAN yazilarin kayitlari da okunur:
    // bilinen tek kopyasi cop kutusunda bulunan yazi READY_TO_PUBLISH'e duser
    // (publisher.service recordUnwrittenLiveState) ve yukaridaki listede yoktur
    const otherEntries = await this.prisma.article.findMany({
      where: { siteId, status: { not: 'PUBLISHED' as any } },
      select: { publishedTo: true },
    });

    // GSC'den per-URL top sorgular (recovery'de kullanilmak uzere snapshot)
    const queriesByUrl = await this.fetchTopQueriesByUrl(siteId);
    const now = new Date();

    for (const s of stuckResults) {
      const matchedArticle = this.matchArticle(s.url, articles);

      // Adres yazinin COP KUTUSUNDAKI ya da hedefte SILINMIS bulunan kopyasi
      // (ve hicbir yazinin canli kopyasi degil): sayfa takili degil, musteri
      // kaldirdi. Satir acilmaz, guncellenmez: makale akisi bu kopyalara yazmaz
      // (stuck-page-autopilot planStuckRepublish live_copy_trashed /
      // live_copy_missing); "RanksUp disi" satir da yanlis olurdu.
      if (!matchedArticle && this.isTrashedCopyUrl(s.url, [...articles, ...otherEntries])) {
        skipped++;
        continue;
      }

      // Bu URL icin son 30 gunde DETECTED/RECOVERING kaydi var mi?
      const existing = await this.prisma.stuckPage.findFirst({
        where: {
          siteId,
          url: s.url,
          status: { in: ['DETECTED', 'RECOVERING'] as any[] },
        },
        orderBy: { detectedAt: 'desc' },
      });

      // RECOVERED/REVERTED/IGNORED kayit varsa atla. REVERTED eskiden listede
      // yoktu: musterinin geri aldigi sayfaya yeni bir DETECTED satiri aciliyor,
      // haftalik tarama (runStuckPageSweep yalniz DETECTED secer) ayni AI
      // duzenlemesini otomatik yeniden uyguluyordu. Geri alma kullanicinin
      // karari; panel de REVERTED satiri icin onarim dugmesi gostermiyor.
      // Bekleyen geri alma (yayin kuyrukta) da REVERTED'dir; yayin olmazsa
      // satir RECOVERED'a doner ve yine atlanir.
      const closedExisting = await this.prisma.stuckPage.findFirst({
        where: {
          siteId,
          url: s.url,
          status: { in: ['RECOVERED', 'REVERTED', 'IGNORED'] as any[] },
        },
      });
      if (closedExisting) {
        skipped++;
        continue;
      }

      const topQueries = queriesByUrl.get(this.urlPath(s.url)) ?? [];

      if (existing) {
        // KOSULLU ve RECOVERING satirda updatedAt AYNEN: sahiplenme kirasi
        // (stuck-page-autopilot.ts STUCK_CLAIM_LEASE_MS) satirin updatedAt'inden
        // olculur; haftalik tazeleme onu "simdi" yapsaydi sahipsiz kalan
        // sahiplenme hic bayatlamaz, kiradaki an da artik satira uymazdi
        // (Prisma @updatedAt yalniz deger verilmezse yazilir — refreshFailedRow
        // notundaki iki kaynak). Durum okunandan farkliysa (arada sahiplenildi ya
        // da birakildi) tazeleme bu tur atlanir.
        const recovering = String(existing.status) === 'RECOVERING';
        const r = await this.prisma.stuckPage.updateMany({
          where: { id: existing.id, status: existing.status, ...(recovering ? { updatedAt: existing.updatedAt } : {}) },
          data: {
            impressions: s.impressions,
            clicks: s.clicks,
            ctr: s.ctr,
            position: s.position,
            stuckScore: s.stuckScore,
            title: matchedArticle?.title ?? existing.title,
            articleId: matchedArticle?.id ?? existing.articleId,
            ...freshTopQueries(topQueries),
            ...(recovering ? { updatedAt: existing.updatedAt } : {}),
          },
        });
        if (r.count === 1) updated++;
        else skipped++;
        continue;
      }

      // Acik satir yok; adresin "Basarisiz" satiri varsa yeni satir ACILMAZ
      const failed = (await this.prisma.stuckPage.findFirst({
        where: { siteId, url: s.url, status: { in: ['FAILED'] as any[] } },
        orderBy: { updatedAt: 'desc' },
        select: { id: true, updatedAt: true, title: true, articleId: true, recoveries: { select: { id: true }, take: 1 } },
      })) as FailedStuckRow | null;
      if (failed) {
        if (await this.refreshFailedRow(failed, s, matchedArticle, topQueries, now)) updated++;
        else skipped++;
      } else {
        await this.prisma.stuckPage.create({
          data: {
            siteId,
            articleId: matchedArticle?.id ?? null,
            url: s.url,
            title: matchedArticle?.title ?? null,
            impressions: s.impressions,
            clicks: s.clicks,
            ctr: s.ctr,
            position: s.position,
            stuckScore: s.stuckScore,
            status: 'DETECTED' as any,
            topQueries: (topQueries.length > 0 ? topQueries : undefined) as any,
          },
        });
        created++;
      }
    }

    this.log.log(`[${siteId}] Stuck detect: ${stuckResults.length} bulundu (yeni=${created}, guncel=${updated}, atlandi=${skipped})`);
    return { found: stuckResults.length, created, updated, skipped };
  }

  /**
   * URL'i RanksUp'da var olan bir article ile eslestir.
   *
   * Cop kutusundaki kopyalar (kayitta trashedAt) eslesme kaniti DEGILDIR: o
   * adres yazinin canli sayfasi degil, onarilacak bir sey yok. Slug eslesmesi de
   * yazinin BU ADRESTEKI kopyasi cop kutusundaysa kullanilmaz: WordPress kalici
   * baglantisinin son parcasi yazinin slug'idir, yoksa adres eslemesindeki suzgec
   * WordPress kopyalarinda hic devreye girmezdi.
   */
  private matchArticle(
    url: string,
    articles: Array<{ id: string; slug: string; title: string; publishedTo: any }>,
  ): { id: string; title: string } | null {
    let urlPath = '';
    try { urlPath = new URL(url).pathname; } catch { return null; }
    // Statik hedefler (FTP/SFTP/cPanel) yaziyi '<slug>.html' olarak yayinlar;
    // uzanti atilmazsa bu sitelerde hicbir takili sayfa makaleyle eslesmiyordu
    const slug = (urlPath.replace(/^\/|\/$/g, '').split('/').pop() ?? '').replace(/\.(html?|php)$/i, '');
    const target = urlKey(url);

    // 1) Exact slug match (bu adresteki kopyasi cop kutusunda olan yazi haric)
    const bySlug = articles.find((a) => a.slug === slug && !trashedCopyAt(a.publishedTo, target));
    if (bySlug) return { id: bySlug.id, title: bySlug.title };

    // 2) publishedTo[] icinde tam URL var mi? Yayinci alani externalUrl olarak
    //    yaziyor (publisher.service.ts); eski kayitlar icin url de okunur.
    //    Yalniz canli kopyalar (cop kutusundaki kayit haric).
    for (const a of articles) {
      if (liveCopyAt(a.publishedTo, target)) return { id: a.id, title: a.title };
    }
    return null;
  }

  /**
   * Adres bir yazinin cop kutusundaki / silinmis bulunan kopyasinin adresi mi ve hicbir yazinin
   * canli kopyasi bu adreste degil mi? (Yazinin durumu fark etmez: tek kopyasi
   * cop kutusunda bulunan yazi artik PUBLISHED degildir.)
   */
  private isTrashedCopyUrl(url: string, articles: Array<{ publishedTo: unknown }>): boolean {
    const key = urlKey(url);
    if (!key) return false;
    if (articles.some((a) => liveCopyAt(a.publishedTo, key))) return false;
    return articles.some((a) => trashedCopyAt(a.publishedTo, key));
  }

  /**
   * Adresin "Basarisiz" satirini yeniden kullanir; yeni DETECTED satiri ACMAZ.
   *
   * NEDEN: dedektor acik satiri yalniz DETECTED / RECOVERING arasinda ariyordu;
   * son satiri FAILED olan adrese her taramada yeni bir satir aciyor, satirlar
   * panelde birikiyordu (her basarisiz deneme bir satir daha).
   *
   * Otopilot bekleme suresi (stuck-page-autopilot.ts STUCK_FAILED_COOLDOWN_DAYS,
   * hasRecentFailure) korunur; basarisizlik ani satirin updatedAt'idir (kurtarma
   * servisi markFailed onu acikca yazar):
   *  - Bekleme suresi icinde: satir FAILED kalir, yalniz metrikler tazelenir ve
   *    updatedAt AYNEN yazilir. Yazilmasa Prisma @updatedAt'i "simdi" yapardi;
   *    her hafta tazelenen basarisizlik ani bekleme suresini hic bitirmezdi.
   *    Iki kaynak: prisma.io/docs/orm/reference/prisma-schema-reference
   *    (@updatedAt: "If you do not supply a time yourself, Prisma Client will
   *    automatically set the value") ve kurulu motor surumunun kaynagi
   *    (prisma-engines c2990dca, @prisma/client 6.19.3)
   *    query-engine/query-structure/src/write_args.rs add_datetimes: "if
   *    self.args.get(f.db_name()).is_none()" iken simdiki zamani ekler;
   *    update_record_node ve update_many_record_node ikisi de update_datetimes cagirir.
   *  - Bekleme suresi dolmus ve satirda hic kurtarma kaydi yok: satir yeniden
   *    DETECTED olur; otopilot (yalniz DETECTED secer) adresi yeniden deneyebilir;
   *    eskiden bu, sure dolunca acilan yeni satirla oluyordu.
   *  - Kurtarma kaydi olan FAILED satir FAILED kalir: kayit kismen yayina gitmis
   *    bir duzeltme olabilir (republishFailed anyLive). Panel DETECTED satirdaki
   *    kaydi "Oneri: uygulanmadi ve yayinlanmadi" diye gosterir; bu yanlis bir
   *    iddia olurdu. Kullanici "AI Duzelt" ile her zaman yeniden deneyebilir.
   * Yazim kosullu (ayni FAILED satir, ayni updatedAt): arada kullanici yeniden
   * denediyse (RECOVERING) satir ezilmez; o zaman false doner.
   */
  private async refreshFailedRow(
    failed: FailedStuckRow,
    s: { impressions: number; clicks: number; ctr: number; position: number; stuckScore: number },
    matchedArticle: { id: string; title: string } | null,
    topQueries: string[],
    now: Date,
  ): Promise<boolean> {
    const failedAt = failed.updatedAt instanceof Date ? failed.updatedAt.getTime() : Number.NaN;
    // Taramanin kurali ile ayni sinir (hasRecentFailure: updatedAt >= simdi - sure).
    // Basarisizlik ani bilinmiyorsa bekleme suresinde sayilir (emin olmadan yeniden acilmaz)
    const coolingDown = !Number.isFinite(failedAt) || failedAt >= now.getTime() - STUCK_FAILED_COOLDOWN_DAYS * DAY_MS;
    const hasHistory = Array.isArray(failed.recoveries) && failed.recoveries.length > 0;
    const reopen = !coolingDown && !hasHistory;
    const r = await this.prisma.stuckPage.updateMany({
      where: { id: failed.id, status: 'FAILED' as any, updatedAt: failed.updatedAt },
      data: {
        impressions: s.impressions,
        clicks: s.clicks,
        ctr: s.ctr,
        position: s.position,
        stuckScore: s.stuckScore,
        title: matchedArticle?.title ?? failed.title,
        articleId: matchedArticle?.id ?? failed.articleId,
        ...freshTopQueries(topQueries),
        ...(reopen ? { status: 'DETECTED' as any, updatedAt: now } : { updatedAt: failed.updatedAt }),
      },
    });
    return r.count === 1;
  }

  private expectedCtr(position: number): number {
    const rounded = Math.max(1, Math.min(15, Math.round(position)));
    return this.EXPECTED_CTR[rounded] ?? 0.01;
  }

  /** GSC per-page aggregate metrikleri (inline — TopicsModule bagimliligini onlemek icin). */
  private async fetchPagePerformance(
    siteId: string,
    days: number,
  ): Promise<Array<{ url: string; impressions: number; clicks: number; ctr: number; position: number }>> {
    const site = await this.prisma.site.findUniqueOrThrow({ where: { id: siteId } });
    if (!site.gscPropertyUrl || !site.gscRefreshToken) {
      this.log.log(`[${siteId}] GSC bagli degil — atlandi`);
      return [];
    }
    const client = await this.gscOAuth.getAuthenticatedClient(siteId);
    if (!client) return [];
    const webmasters = google.webmasters({ version: 'v3', auth: client as any });
    const endDate = new Date().toISOString().slice(0, 10);
    const startDate = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
    try {
      const res = await webmasters.searchanalytics.query({
        siteUrl: site.gscPropertyUrl,
        requestBody: { startDate, endDate, dimensions: ['page'], rowLimit: 5000 },
      });
      return (res.data.rows ?? [])
        .map((r: any) => ({
          url: (r.keys?.[0] ?? '') as string,
          impressions: r.impressions ?? 0,
          clicks: r.clicks ?? 0,
          ctr: r.ctr ?? 0,
          position: r.position ?? 0,
        }))
        .filter((p: any) => p.url);
    } catch (err: any) {
      this.log.error(`[${siteId}] GSC page perf hata: ${err.message}`);
      return [];
    }
  }

  /** GSC'den per-URL top sorgular — Map<urlPath, queries[]> */
  private async fetchTopQueriesByUrl(siteId: string): Promise<Map<string, string[]>> {
    const map = new Map<string, string[]>();
    const site = await this.prisma.site.findUniqueOrThrow({ where: { id: siteId } });
    if (!site.gscPropertyUrl || !site.gscRefreshToken) return map;
    const client = await this.gscOAuth.getAuthenticatedClient(siteId);
    if (!client) return map;

    const webmasters = google.webmasters({ version: 'v3', auth: client as any });
    const endDate = new Date().toISOString().slice(0, 10);
    const startDate = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);

    try {
      const res = await webmasters.searchanalytics.query({
        siteUrl: site.gscPropertyUrl,
        requestBody: {
          startDate,
          endDate,
          dimensions: ['page', 'query'],
          rowLimit: 5000,
        },
      });
      const byPage = new Map<string, Array<{ query: string; impressions: number }>>();
      for (const r of res.data.rows ?? []) {
        const pageUrl = (r.keys?.[0] ?? '') as string;
        const query = (r.keys?.[1] ?? '') as string;
        if (!pageUrl || !query) continue;
        let path = '';
        try { path = new URL(pageUrl).pathname; } catch { continue; }
        const arr = byPage.get(path) ?? [];
        arr.push({ query, impressions: r.impressions ?? 0 });
        byPage.set(path, arr);
      }
      for (const [path, queries] of byPage) {
        queries.sort((a, b) => b.impressions - a.impressions);
        map.set(path, queries.slice(0, 5).map((q) => q.query));
      }
    } catch (err: any) {
      this.log.warn(`GSC top sorgu fetch hata: ${err.message}`);
    }
    return map;
  }

  private urlPath(url: string): string {
    try { return new URL(url).pathname; } catch { return ''; }
  }

  async list(
    siteId: string,
    filters: { status?: string; limit?: number } = {},
  ): Promise<Array<any>> {
    return this.prisma.stuckPage.findMany({
      where: {
        siteId,
        ...(filters.status ? { status: filters.status as any } : {}),
      },
      orderBy: [{ stuckScore: 'desc' }, { detectedAt: 'desc' }],
      take: filters.limit ?? 100,
      include: {
        recoveries: {
          orderBy: { appliedAt: 'desc' },
          take: 1,
        },
      },
    });
  }

  /**
   * KIRACI IZOLASYONU: siteId zorunlu.
   * SiteAccessGuard yalnizca URL'deki :siteId'nin sahipligini dogrular; bu
   * metotlar id ile calistigi icin siteId ile kisitlanmazsa saldirgan kendi
   * sitesinin URL'i altinda baskasinin stuckPageId'sini gecirip o kaydi
   * okuyabilir/degistirebilirdi.
   */
  async ignore(siteId: string, stuckPageId: string): Promise<void> {
    const existing = await this.prisma.stuckPage.findFirst({
      where: { id: stuckPageId, siteId },
      select: { id: true },
    });
    if (!existing) throw new NotFoundException(STUCK_PAGE_NOT_FOUND);
    await this.prisma.stuckPage.update({
      where: { id: stuckPageId },
      data: { status: 'IGNORED' as any },
    });
  }

  async getDetail(siteId: string, stuckPageId: string): Promise<any> {
    return this.prisma.stuckPage.findFirst({
      where: { id: stuckPageId, siteId },
      include: {
        recoveries: { orderBy: { appliedAt: 'desc' } },
      },
    });
  }
}
