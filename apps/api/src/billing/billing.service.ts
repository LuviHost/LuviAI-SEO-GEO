import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';

export interface PlanDefinition {
  id: 'trial' | 'starter' | 'pro' | 'agency';
  name: string;
  monthly: number;       // ₺
  annual: number;        // ₺
  articlesPerMonth: number;
  socialPostsPerMonth: number;
  sites: number;
  publishTargets: 'limited' | 'all';
  support: string;
  popular?: boolean;
}

export const PLANS: PlanDefinition[] = [
  {
    id: 'trial',
    name: 'Ücretsiz Deneme',
    monthly: 0, annual: 0,
    articlesPerMonth: 1,
    socialPostsPerMonth: 1,
    sites: 1,
    publishTargets: 'limited',
    support: 'community',
  },
  {
    id: 'starter',
    name: 'Başlangıç',
    monthly: 3080, annual: 29568,
    articlesPerMonth: 10,
    socialPostsPerMonth: 8,
    sites: 1,
    publishTargets: 'all',
    support: 'email 24h',
  },
  {
    id: 'pro',
    name: 'Profesyonel',
    monthly: 6980, annual: 67008,
    articlesPerMonth: 40,
    socialPostsPerMonth: 18,
    sites: 3,
    publishTargets: 'all',
    support: 'email 4h',
    popular: true,
  },
  {
    id: 'agency',
    name: 'Kurumsal',
    monthly: 13610, annual: 130656,
    articlesPerMonth: 100,
    socialPostsPerMonth: 30,
    sites: 10,
    publishTargets: 'all',
    support: 'priority + Slack',
  },
];

@Injectable()
export class BillingService {
  constructor(private readonly prisma: PrismaService) {}

  getPlans(): PlanDefinition[] {
    return PLANS;
  }

  async getCurrentPlan(userId: string) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    const planDef = PLANS.find(p => p.id.toUpperCase() === user.plan) ?? PLANS[0];
    return {
      plan: planDef,
      status: user.subscriptionStatus,
      trialEndsAt: user.trialEndsAt,
      articlesUsedThisMonth: user.articlesUsedThisMonth,
      articlesQuotaResetAt: user.articlesQuotaResetAt,
    };
  }

  async getInvoices(userId: string) {
    return this.prisma.invoice.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
  }
}
