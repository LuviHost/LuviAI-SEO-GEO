import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';

@Injectable()
export class AdminService {
  constructor(private readonly prisma: PrismaService) {}

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

  listTenants() {
    return this.prisma.user.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        _count: { select: { sites: true, jobs: true, invoices: true } },
      },
      take: 200,
    });
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

  /** /api/me — kullanıcının dashboard özeti */
  async getMyDashboard(userId: string) {
    const [user, sitesCount, articlesPublished, draftCount, lastInvoice] = await Promise.all([
      this.prisma.user.findUnique({ where: { id: userId } }),
      this.prisma.site.count({ where: { userId } }),
      this.prisma.article.count({ where: { site: { userId }, status: 'PUBLISHED' } }),
      this.prisma.article.count({
        where: { site: { userId }, status: { in: ['DRAFT', 'EDITING', 'REVIEW'] } as any },
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
      lastInvoice,
    };
  }
}
