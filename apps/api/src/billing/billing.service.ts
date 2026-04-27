import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';

export interface PlanDefinition {
  id: 'trial' | 'starter' | 'pro' | 'agency';
  name: string;
  monthly: number;       // ₺
  annual: number;        // ₺
  articlesPerMonth: number;
  sites: number;
  publishTargets: 'limited' | 'all';
  support: string;
  popular?: boolean;
}

export const PLANS: PlanDefinition[] = [
  {
    id: 'trial',
    name: 'Trial (14 gün)',
    monthly: 0, annual: 0,
    articlesPerMonth: 1,
    sites: 1,
    publishTargets: 'limited',
    support: 'community',
  },
  {
    id: 'starter',
    name: 'Starter',
    monthly: 499, annual: 4799,
    articlesPerMonth: 10,
    sites: 1,
    publishTargets: 'all',
    support: 'email 24h',
  },
  {
    id: 'pro',
    name: 'Pro',
    monthly: 1299, annual: 12499,
    articlesPerMonth: 50,
    sites: 3,
    publishTargets: 'all',
    support: 'email 4h',
    popular: true,
  },
  {
    id: 'agency',
    name: 'Agency',
    monthly: 3299, annual: 31999,
    articlesPerMonth: 250,
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
