import { Injectable, Logger } from '@nestjs/common';
import { google } from 'googleapis';
import { PrismaService } from '../prisma/prisma.service.js';
import { GscOAuthService } from '../auth/gsc-oauth.service.js';

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

    // GSC'den per-URL top sorgular (recovery'de kullanilmak uzere snapshot)
    const queriesByUrl = await this.fetchTopQueriesByUrl(siteId);

    for (const s of stuckResults) {
      const matchedArticle = this.matchArticle(s.url, articles);

      // Bu URL icin son 30 gunde DETECTED/RECOVERING kaydi var mi?
      const existing = await this.prisma.stuckPage.findFirst({
        where: {
          siteId,
          url: s.url,
          status: { in: ['DETECTED', 'RECOVERING'] as any[] },
        },
        orderBy: { detectedAt: 'desc' },
      });

      // RECOVERED/REVERTED/IGNORED kayit varsa atla
      const closedExisting = await this.prisma.stuckPage.findFirst({
        where: {
          siteId,
          url: s.url,
          status: { in: ['RECOVERED', 'IGNORED'] as any[] },
        },
      });
      if (closedExisting) {
        skipped++;
        continue;
      }

      const topQueries = queriesByUrl.get(this.urlPath(s.url)) ?? [];

      if (existing) {
        await this.prisma.stuckPage.update({
          where: { id: existing.id },
          data: {
            impressions: s.impressions,
            clicks: s.clicks,
            ctr: s.ctr,
            position: s.position,
            stuckScore: s.stuckScore,
            title: matchedArticle?.title ?? existing.title,
            articleId: matchedArticle?.id ?? existing.articleId,
            topQueries: topQueries.length > 0 ? topQueries : (existing.topQueries as any),
          },
        });
        updated++;
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

  /** URL'i RanksUp'da var olan bir article ile eslestir. */
  private matchArticle(
    url: string,
    articles: Array<{ id: string; slug: string; title: string; publishedTo: any }>,
  ): { id: string; title: string } | null {
    let urlPath = '';
    try { urlPath = new URL(url).pathname; } catch { return null; }
    const slug = urlPath.replace(/^\/|\/$/g, '').split('/').pop() ?? '';

    // 1) Exact slug match
    const bySlug = articles.find((a) => a.slug === slug);
    if (bySlug) return { id: bySlug.id, title: bySlug.title };

    // 2) publishedTo[].url icinde tam URL var mi?
    for (const a of articles) {
      const targets = (a.publishedTo ?? []) as Array<{ url?: string }>;
      if (Array.isArray(targets) && targets.some((t) => t.url === url)) {
        return { id: a.id, title: a.title };
      }
    }
    return null;
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

  async ignore(stuckPageId: string): Promise<void> {
    await this.prisma.stuckPage.update({
      where: { id: stuckPageId },
      data: { status: 'IGNORED' as any },
    });
  }

  async getDetail(stuckPageId: string): Promise<any> {
    return this.prisma.stuckPage.findUnique({
      where: { id: stuckPageId },
      include: {
        recoveries: { orderBy: { appliedAt: 'desc' } },
      },
    });
  }
}
