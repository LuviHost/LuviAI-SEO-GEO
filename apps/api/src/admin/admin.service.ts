import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';

@Injectable()
export class AdminService {
  constructor(private readonly prisma: PrismaService) {}

  async getOverview() {
    const [users, sites, articles, failedJobs] = await Promise.all([
      this.prisma.user.count(),
      this.prisma.site.count(),
      this.prisma.article.count({ where: { status: 'PUBLISHED' } }),
      this.prisma.job.count({ where: { status: 'FAILED' } }),
    ]);
    return { users, sites, publishedArticles: articles, failedJobs };
  }

  listTenants() {
    return this.prisma.user.findMany({
      orderBy: { createdAt: 'desc' },
      include: { _count: { select: { sites: true, jobs: true } } },
    });
  }

  getFailedJobs() {
    return this.prisma.job.findMany({
      where: { status: 'FAILED' },
      orderBy: { finishedAt: 'desc' },
      take: 50,
    });
  }
}
