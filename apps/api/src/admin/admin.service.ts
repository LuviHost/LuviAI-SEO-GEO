import { Injectable, Optional } from '@nestjs/common';
import { containsBrand } from '../audit/brand-in-query.js';
import { withMeasuredCounts } from '../audit/public-citation.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { QuotaService } from '../billing/quota.service.js';
import { articleQuotaView, resetAwareArticleLimit } from '../billing/article-quota-view.js';

@Injectable()
export class AdminService {
  constructor(
    private readonly prisma: PrismaService,
    // BillingModule @Global: uygulamada her zaman var. Opsiyonel cunku testler
    // servisi elle kurar; yoksa ozet kota alanini null doner.
    @Optional() private readonly quota?: QuotaService,
  ) {}

  async getOverview() {
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const last30Start = new Date(Date.now() - 30 * 86_400_000);

    const [
      users,
      sites,
      articlesPublished,
      failedJobs,
      activeSubs,
      trialUsers,
      paidThisMonthAgg,
      paidLast30Agg,
      newUsersLast30,
      pendingInvoices,
    ] = await Promise.all([
      this.prisma.user.count(),
      this.prisma.site.count(),
      this.prisma.article.count({ where: { status: 'PUBLISHED' } }),
      this.prisma.job.count({ where: { status: 'FAILED' } }),
      this.prisma.user.count({ where: { subscriptionStatus: 'ACTIVE' } }),
      this.prisma.user.count({ where: { subscriptionStatus: 'TRIAL' } }),
      this.prisma.invoice.aggregate({
        _sum: { amount: true },
        _count: true,
        where: { status: 'PAID', paidAt: { gte: startOfMonth } },
      }),
      this.prisma.invoice.aggregate({
        _sum: { amount: true },
        where: { status: 'PAID', paidAt: { gte: last30Start } },
      }),
      this.prisma.user.count({ where: { createdAt: { gte: last30Start } } }),
      this.prisma.invoice.count({ where: { status: 'PENDING' } }),
    ]);

    return {
      users,
      sites,
      publishedArticles: articlesPublished,
      failedJobs,
      activeSubs,
      trialUsers,
      pendingInvoices,
      newUsersLast30,
      revenueThisMonth: Number(paidThisMonthAgg._sum.amount ?? 0),
      paymentsThisMonth: paidThisMonthAgg._count,
      revenueLast30: Number(paidLast30Agg._sum.amount ?? 0),
    };
  }

  async listTenants() {
    const rows = await this.prisma.user.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        _count: { select: { sites: true, jobs: true, invoices: true } },
      },
      take: 200,
    });
    // PayTR kart-saklama anahtari istemciye hicbir uctan donmez (admin dahil)
    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- alan bilerek ayiklaniyor
    return rows.map(({ paytrUtoken: _gizli, ...u }) => u);
  }

  async listInvoices(opts: { status?: string; limit?: number } = {}) {
    return this.prisma.invoice.findMany({
      where: opts.status ? { status: opts.status as any } : {},
      orderBy: { createdAt: 'desc' },
      take: opts.limit ?? 100,
      include: {
        user: { select: { id: true, email: true, name: true, plan: true } },
      },
    });
  }

  listSites() {
    return this.prisma.site.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        user: { select: { id: true, email: true, name: true, plan: true } },
        _count: { select: { articles: true } },
      },
      take: 200,
    });
  }

  getFailedJobs() {
    return this.prisma.job.findMany({
      where: { status: 'FAILED' },
      orderBy: { finishedAt: 'desc' },
      take: 50,
    });
  }

  /**
   * Anonim (üye olmadan yapılan) AI görünürlük testleri — lead/kullanım takibi.
   * public_citation_checks tablosundan listeler + özet istatistik döner.
   */
  async listCitationLeads(opts: { limit?: number; offset?: number; search?: string } = {}) {
    const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
    const offset = Math.max(opts.offset ?? 0, 0);
    const search = opts.search?.trim();

    const where: any = {};
    if (search) {
      where.OR = [
        { domain: { contains: search } },
        { brand: { contains: search } },
      ];
    }

    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);

    const [rows, total, today, uniqueDomains] = await Promise.all([
      this.prisma.publicCitationCheck.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: limit,
        skip: offset,
        select: {
          id: true, domain: true, brand: true, niche: true, customNiche: true,
          source: true, ip: true, totalCalls: true, costUsd: true, createdAt: true, result: true,
        },
      }),
      this.prisma.publicCitationCheck.count({ where }),
      this.prisma.publicCitationCheck.count({ where: { createdAt: { gte: startOfToday } } }),
      this.prisma.publicCitationCheck.groupBy({ by: ['domain'] }).then((g) => g.length),
    ]);

    const items = rows.map((r) => {
      // Payda yalniz OLCULEN cevaplar (public getHistory ile ayni normalizasyon):
      // calismayan saglayici satiri (eski kayitta Meta Llama) ve HATA satiri
      // totalProviders'a girmez.
      const res = withMeasuredCounts((r.result ?? {}) as any) as any;
      const queries: any[] = Array.isArray(res?.queries) ? res.queries : [];
      // MARKASIZ sorularin toplami — public getHistory ile ayni tanim.
      // Karisik toplam kalsaydi ayni domain admin listesinde baska,
      // gecmis grafiginde baska skor gosterirdi. Eski kayitlarda alan yok;
      // sorgu metninden ayni kuralla yeniden hesaplanir. Host BILEREK
      // verilmez — alani olmayan kayit CITATION_MATCH_VERSION 4 oncesi
      // (yalin kelime kurali); gerekce public getHistory'deki notta.
      const isBranded = (q: any): boolean =>
        typeof q?.brandInQuery === 'boolean' ? q.brandInQuery : containsBrand(q?.query ?? '', r.brand ?? '');
      // Skora giren soru: kilitsiz (teaser'da kilitli soru hic SORULMADI) ve
      // markasiz. Eskiden maxScore = tum sorular x ilk sorunun saglayici
      // sayisiydi: 10 soruluk teaser'da (varsayilan 3 soru olculur) 7 kilitli
      // soru da paydaya girip "3/70" gibi oransiz bir skor gosteriyordu.
      const locked = queries.filter((q) => q?.locked === true);
      const open = queries.filter((q) => q && q.locked !== true);
      const counted = open.filter((q) => !isBranded(q));
      const citedScore = counted.reduce((a: number, q: any) => a + (q.citedCount ?? 0), 0);
      // Soru basina olculen cevap sayisi toplanir (HATA alan saglayici o soruda paydada yok)
      const maxScore = counted.reduce((a: number, q: any) => a + (q.totalProviders ?? 0), 0);
      // "N sorgu x M motor" etiketi: M = bu kontrolde calisan saglayici sayisi.
      // HATA yoksa maxScore = N x M; varsa maxScore daha kucuktur (olculemeyen cevap).
      const totalProviders = counted.reduce(
        (m: number, q: any) => Math.max(m, Array.isArray(q.providers) ? q.providers.length : (q.totalProviders ?? 0)),
        0,
      );
      const queriesCount = counted.length;
      return {
        id: r.id,
        domain: r.domain,
        brand: r.brand,
        niche: r.customNiche || r.niche || null,
        source: r.source,
        ip: r.ip,
        totalCalls: r.totalCalls,
        costUsd: r.costUsd,
        createdAt: r.createdAt,
        citedScore,
        maxScore,
        queriesCount,
        totalProviders,
        /** Skora girmeyen sorular — kilitli (teaser'da sorulmadi) ve markali (anilma totolojik) */
        lockedQueries: locked.length,
        brandedQueries: open.length - counted.length,
      };
    });

    return { items, total, today, uniqueDomains };
  }

  /** /api/me — kullanıcının dashboard özeti */
  async getMyDashboard(userId: string) {
    // Kota kontrolu ONCE: ay basi sifirlamasi yalniz kota kontrolunde calisir
    // (article-quota-view.ts). Satir ardindan okunur ki "Bu ay uretilen" gecen
    // ayin sayacini gostermesin; eski mobil surumler de ayni alani okur.
    const articleLimit = await resetAwareArticleLimit(this.quota, userId);
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    // ADMIN dashboard KPI'lari listede gorulen tum siteleri yansitir (sites.service list() ile ayni semantik)
    const siteWhere = user?.role === 'ADMIN' ? {} : { userId };
    const articleWhere = user?.role === 'ADMIN' ? {} : { site: { userId } };
    const [sitesCount, articlesPublished, draftCount, lastInvoice] = await Promise.all([
      this.prisma.site.count({ where: siteWhere }),
      this.prisma.article.count({ where: { ...articleWhere, status: 'PUBLISHED' } }),
      this.prisma.article.count({
        where: {
          ...articleWhere,
          status: { in: ['DRAFT', 'GENERATING', 'EDITING', 'REVIZE_NEEDED', 'READY_TO_PUBLISH'] as any },
        },
      }),
      this.prisma.invoice.findFirst({
        where: { userId, status: 'PAID' },
        orderBy: { paidAt: 'desc' },
        select: { paidAt: true, amount: true, description: true },
      }),
    ]);
    return {
      plan: user?.plan,
      subscriptionStatus: user?.subscriptionStatus,
      trialEndsAt: user?.trialEndsAt,
      sitesCount,
      articlesPublished,
      drafts: draftCount,
      articlesUsedThisMonth: user?.articlesUsedThisMonth ?? 0,
      // { limit, remaining, used } — panel "Ucretsiz hak: 1/2 kaldi" bunu basar
      articleQuota: articleQuotaView(articleLimit, user?.articlesUsedThisMonth),
      lastInvoice,
    };
  }
}
