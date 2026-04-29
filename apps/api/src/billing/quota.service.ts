import { Injectable, ForbiddenException, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';

/**
 * Plan-based quota enforcer.
 *
 * 4 limit:
 *  1. articlesPerMonth — ay sonu reset
 *  2. sites — toplam site sayısı
 *  3. publishTargets — TRIAL'da sadece markdown_zip
 *  4. trial expiry — 14 gün sonra plan zorunlu
 */
@Injectable()
export class QuotaService {
  private readonly log = new Logger(QuotaService.name);

  private readonly LIMITS = {
    TRIAL:      { articles: 1,    sites: 1,  publishTargets: ['MARKDOWN_ZIP'] as string[], citationTests: 3,   pool: ['gemini'] as string[] },
    STARTER:    { articles: 10,   sites: 1,  publishTargets: 'all' as const,                citationTests: 15,  pool: ['gemini', 'anthropic'] },
    PRO:        { articles: 50,   sites: 3,  publishTargets: 'all' as const,                citationTests: 50,  pool: ['gemini', 'anthropic', 'xai'] },
    AGENCY:     { articles: 250,  sites: 10, publishTargets: 'all' as const,                citationTests: 200, pool: ['gemini', 'anthropic', 'xai', 'openai', 'deepseek', 'perplexity'] },
    ENTERPRISE: { articles: 9999, sites: 999, publishTargets: 'all' as const,               citationTests: 500, pool: ['gemini', 'anthropic', 'xai', 'openai', 'deepseek', 'perplexity'] },
  };

  constructor(private readonly prisma: PrismaService) {}

  // ────────────────────────────────────────────
  //  Article quota
  // ────────────────────────────────────────────
  async checkArticleQuota(userId: string): Promise<{ allowed: boolean; remaining: number; limit: number }> {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });

    // Ay sonu otomatik reset (basit: bir önceki ay'a bakınca sıfırla)
    await this.maybeResetMonthlyQuota(user);

    // 1 makale ücretsiz modeli: TRIAL'da süre kontrolü yok, sadece kota.

    const limit = this.LIMITS[user.plan].articles;
    return {
      allowed: user.articlesUsedThisMonth < limit,
      remaining: Math.max(0, limit - user.articlesUsedThisMonth),
      limit,
    };
  }

  async enforceArticleQuota(userId: string) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { plan: true } });
    const { allowed, remaining, limit } = await this.checkArticleQuota(userId);
    if (!allowed) {
      if (user.plan === 'TRIAL') {
        throw new ForbiddenException('Ücretsiz 1 makale hakkını kullandın. Devam etmek için plan seç.');
      }
      throw new ForbiddenException(`Aylık ${limit} makale kotan doldu. Plan yükseltebilir veya ayın sonunu bekleyebilirsin.`);
    }
    return { remaining };
  }

  async incrementArticleUsage(userId: string) {
    return this.prisma.user.update({
      where: { id: userId },
      data: { articlesUsedThisMonth: { increment: 1 } },
    });
  }

  // ────────────────────────────────────────────
  //  Site quota
  // ────────────────────────────────────────────
  async checkSiteQuota(userId: string): Promise<{ allowed: boolean; current: number; limit: number }> {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      include: { _count: { select: { sites: true } } },
    });
    const limit = this.LIMITS[user.plan].sites;
    return {
      allowed: user._count.sites < limit,
      current: user._count.sites,
      limit,
    };
  }

  async enforceSiteQuota(userId: string) {
    const { allowed, current, limit } = await this.checkSiteQuota(userId);
    if (!allowed) {
      throw new ForbiddenException(`Plan limit: ${limit} site. Şu an ${current} siteniz var. Profesyonel veya Kurumsal'a yükseltin.`);
    }
  }

  // ────────────────────────────────────────────
  //  Publish target quota
  // ────────────────────────────────────────────
  async canUsePublishTarget(userId: string, targetType: string): Promise<boolean> {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    const allowed = this.LIMITS[user.plan].publishTargets;
    if (allowed === 'all') return true;
    return (allowed as string[]).includes(targetType);
  }

  // ────────────────────────────────────────────
  //  Trial helpers
  // ────────────────────────────────────────────
  async startTrial(userId: string, days = 14) {
    const trialEndsAt = new Date(Date.now() + days * 86400000);
    return this.prisma.user.update({
      where: { id: userId },
      data: {
        plan: 'TRIAL',
        subscriptionStatus: 'TRIAL',
        trialEndsAt,
        articlesUsedThisMonth: 0,
        articlesQuotaResetAt: new Date(),
      },
    });
  }

  async expireOldTrials() {
    const result = await this.prisma.user.updateMany({
      where: {
        plan: 'TRIAL',
        trialEndsAt: { lt: new Date() },
        subscriptionStatus: 'TRIAL',
      },
      data: { subscriptionStatus: 'EXPIRED' },
    });
    if (result.count > 0) {
      this.log.log(`${result.count} trial süresi doldu`);
    }
    return result.count;
  }

  // ────────────────────────────────────────────
  //  AI Citation testi kotasi (Sprint BYOK)
  // ────────────────────────────────────────────
  async checkCitationQuota(userId: string): Promise<{ allowed: boolean; remaining: number; limit: number; used: number }> {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    await this.maybeResetCitationQuota(user);
    const fresh = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    const limit = this.LIMITS[fresh.plan].citationTests;
    const used = fresh.aiCitationTestsThisMonth;
    return {
      allowed: used < limit,
      remaining: Math.max(0, limit - used),
      limit,
      used,
    };
  }

  async enforceCitationQuota(userId: string): Promise<{ remaining: number; limit: number }> {
    const { allowed, remaining, limit, used } = await this.checkCitationQuota(userId);
    if (!allowed) {
      throw new ForbiddenException(
        `Aylık ${limit} AI Citation testi hakkın doldu (${used}/${limit}). Plan yükseltebilir veya kendi API key'lerini bağlayıp BYOK ile sınırsız kullanabilirsin.`,
      );
    }
    return { remaining, limit };
  }

  async incrementCitationUsage(userId: string): Promise<void> {
    await this.prisma.user.update({
      where: { id: userId },
      data: { aiCitationTestsThisMonth: { increment: 1 } },
    });
  }

  /** Plan'in havuzdan saglayicilari (kullanicinin BYOK gerekmeden testleyebilecegi) */
  getPlanPool(plan: string): string[] {
    return (this.LIMITS as any)[plan]?.pool ?? [];
  }

  getPlanCitationLimit(plan: string): number {
    return (this.LIMITS as any)[plan]?.citationTests ?? 0;
  }

  // ────────────────────────────────────────────
  //  Helpers
  // ────────────────────────────────────────────
  private async maybeResetMonthlyQuota(user: { id: string; plan: string; articlesQuotaResetAt: Date }) {
    // TRIAL'da kota ömür boyu sayılır; ay başı reset YOK.
    if (user.plan === 'TRIAL') return;

    const lastReset = new Date(user.articlesQuotaResetAt);
    const now = new Date();
    const sameMonth = lastReset.getFullYear() === now.getFullYear() && lastReset.getMonth() === now.getMonth();

    if (!sameMonth) {
      await this.prisma.user.update({
        where: { id: user.id },
        data: {
          articlesUsedThisMonth: 0,
          articlesQuotaResetAt: now,
        },
      });
      this.log.log(`[${user.id}] Aylık kota sıfırlandı`);
    }
  }

  private async maybeResetCitationQuota(user: { id: string; plan: string; aiCitationQuotaResetAt: Date }) {
    const lastReset = new Date(user.aiCitationQuotaResetAt);
    const now = new Date();
    const sameMonth = lastReset.getFullYear() === now.getFullYear() && lastReset.getMonth() === now.getMonth();
    if (!sameMonth) {
      await this.prisma.user.update({
        where: { id: user.id },
        data: { aiCitationTestsThisMonth: 0, aiCitationQuotaResetAt: now },
      });
      this.log.log(`[${user.id}] Citation kotasi ay basinda sifirlandi`);
    }
  }
}
