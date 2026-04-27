import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';

/** Plan-based quota enforcer */
@Injectable()
export class QuotaService {
  constructor(private readonly prisma: PrismaService) {}

  async checkArticleQuota(userId: string): Promise<{ allowed: boolean; remaining: number }> {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    const limits: Record<string, number> = {
      TRIAL: 1,
      STARTER: 10,
      PRO: 50,
      AGENCY: 250,
      ENTERPRISE: 9999,
    };
    const limit = limits[user.plan] ?? 0;
    return {
      allowed: user.articlesUsedThisMonth < limit,
      remaining: limit - user.articlesUsedThisMonth,
    };
  }

  async incrementArticleUsage(userId: string) {
    return this.prisma.user.update({
      where: { id: userId },
      data: { articlesUsedThisMonth: { increment: 1 } },
    });
  }
}
