import { Injectable, ForbiddenException, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  findPlan, planHasFeature, FEATURE_MIN_PLAN, PLAN_FEATURE_LABELS,
  type PlanFeature, type PlanId,
} from './plans.js';
import { acquireCronLock } from '../common/cron-lock.js';

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

  /**
   * 2026-05 Premium pricing update — bkz. billing.service.ts BASE_PLANS.
   * Spend cap (USD/ay): TRIAL=$3, STARTER=$25, PRO=$80, AGENCY=$200, ENTERPRISE=$700.
   * settings.constants'tan dinamik okunur — burada sadece kota.
   */
  /**
   * SITES: plans.ts ile AYNI olmali. Onceden burada 1/1/3/12/50 yaziyordu ama
   * fiyatlandirma 1/2/5/15/50 reklam ediyordu — musteri 5 site icin odeyip
   * 3'te bloklanacakti. Reklam degeri esas alindi (dayatmayi yukseltmek,
   * satilani kucultmekten dogru).
   *
   * CITATIONTESTS: plans.ts aiRunsPerMonth ile AYNI olmali. AI Citation testi
   * ve Prompt Lab calistirmasi ayni kovadan duser.
   */
  private readonly LIMITS = {
    TRIAL:      { articles: 2,    sites: 1,  publishTargets: ['MARKDOWN_ZIP', 'WORDPRESS_REST'] as string[], citationTests: 3,   pool: ['gemini'] as string[] },
    STARTER:    { articles: 15,   sites: 2,  publishTargets: 'all' as const,                                  citationTests: 20,  pool: ['gemini', 'anthropic'] },
    PRO:        { articles: 40,   sites: 5,  publishTargets: 'all' as const,                                  citationTests: 75,  pool: ['gemini', 'anthropic', 'xai'] },
    AGENCY:     { articles: 100,  sites: 15, publishTargets: 'all' as const,                                  citationTests: 300, pool: ['gemini', 'anthropic', 'xai', 'openai', 'deepseek', 'perplexity'] },
    ENTERPRISE: { articles: 350,  sites: 50, publishTargets: 'all' as const,                                  citationTests: 1000, pool: ['gemini', 'anthropic', 'xai', 'openai', 'deepseek', 'perplexity'] },
  };

  /** Plan başına aylık USD spend cap. settings.constants ile senkron tutulmalı. */
  private readonly SPEND_CAP_USD: Record<string, number> = {
    TRIAL: 3,
    STARTER: 25,
    PRO: 80,
    AGENCY: 200,
    ENTERPRISE: 700,
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
  //  AI Cost tracking (USD) — cost monitoring
  // ────────────────────────────────────────────
  async addAiCost(userId: string, usdAmount: number) {
    if (!Number.isFinite(usdAmount) || usdAmount <= 0) return;
    await this.prisma.user.update({
      where: { id: userId },
      data: { aiCostThisMonthUsd: { increment: usdAmount } } as any,
    });
  }

  /**
   * Plan başına aylık USD spend cap (cost guard).
   *
   * Kullanıcının aylık AI maliyeti planın cap'ini aşarsa:
   *  - %80'i geçince warn: dashboard banner + email
   *  - %100'ü geçince hardBlock: pipeline pause + admin alert
   *
   * Cap'ler settings.constants'tan dinamik okunabilir (SPEND_CAP_*_USD), burada sabit fallback.
   */
  async checkAiCostBudget(userId: string): Promise<{ used: number; cap: number; pct: number; warn: boolean; hardBlock: boolean }> {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    const cap = this.SPEND_CAP_USD[user.plan] ?? this.SPEND_CAP_USD.STARTER;
    const used = (user as any).aiCostThisMonthUsd ?? 0;
    const pct = cap > 0 ? Math.round((used / cap) * 100) : 0;
    return {
      used,
      cap,
      pct,
      warn: pct >= 80,
      hardBlock: pct >= 100,
    };
  }

  /**
   * Pipeline başlangıcında çağrılır. Hard block durumunda ForbiddenException atar.
   * Worker/article-scheduler'da AI çağrıları öncesi kullan.
   */
  async enforceAiCostBudget(userId: string): Promise<void> {
    const { hardBlock, used, cap } = await this.checkAiCostBudget(userId);
    if (hardBlock) {
      throw new ForbiddenException(
        `Aylık AI kullanım bütçen doldu ($${used.toFixed(2)} / $${cap}). ` +
        `Yeni ay başlangıcını bekleyebilir veya plan yükseltebilirsin.`,
      );
    }
  }

  // ────────────────────────────────────────────
  //  Plan ozellik kapilari (feature gate)
  // ────────────────────────────────────────────

  /**
   * plans.ts'teki boolean ozellik bayraklarini dayatir.
   *
   * NEDEN: ASO modulu, MCP sunucusu, REST API ve BYOK fiyat kartinda ust
   * planlara ait gorunuyordu ama kodda HICBIR plan kontrolu yoktu — alt plan
   * musterisi hepsini kullanabiliyordu. Kartta yazan her kilidin burada bir
   * karsiligi olmali; aksi halde karttaki katmanlama bos vaattir.
   */
  async enforcePlanFeature(userId: string, feature: PlanFeature): Promise<void> {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { plan: true },
    });
    this.assertPlanFeature(user.plan, feature);
  }

  /** Plan zaten elimizdeyse DB'ye tekrar gitmeden kontrol (guard bu yolu kullanir). */
  assertPlanFeature(plan: string, feature: PlanFeature): void {
    const planId = plan.toLowerCase() as PlanId;
    if (planHasFeature(planId, feature)) return;

    const needed = findPlan(FEATURE_MIN_PLAN[feature])?.name_tr ?? 'üst';
    throw new ForbiddenException(
      `${PLAN_FEATURE_LABELS[feature]} ${needed} planına dahildir. Planını yükselterek kullanabilirsin.`,
    );
  }

  /** ASO: takip edilen uygulama sayisi kotasi */
  async checkTrackedAppQuota(userId: string): Promise<{ allowed: boolean; current: number; limit: number }> {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { plan: true },
    });
    const limit = findPlan(user.plan.toLowerCase())?.trackedApps ?? 1;
    // TrackedApp Site'a bagli; kullanicinin tum sitelerindeki uygulamalar sayilir.
    const current = await this.prisma.trackedApp.count({ where: { site: { userId } } });
    return { allowed: current < limit, current, limit };
  }

  async enforceTrackedAppQuota(userId: string): Promise<void> {
    const { allowed, current, limit } = await this.checkTrackedAppQuota(userId);
    if (!allowed) {
      throw new ForbiddenException(
        `Plan limiti: ${limit} uygulama. Şu an ${current} uygulaman var. Daha fazlası için plan yükselt.`,
      );
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

  /**
   * Suresi dolan trial'lari EXPIRED'a cevirir.
   *
   * NEDEN CRON: bu metod yazildigindan beri hicbir yerden cagrilmiyordu —
   * TRIAL kullanicisi omur boyu TRIAL kaliyordu ve tek freni omur boyu
   * 2 makale + 3 calistirmaydi. Gunluk 04:00'te, cift-calisma kilidiyle.
   */
  @Cron('0 4 * * *', { timeZone: 'Europe/Istanbul' })
  async expireOldTrialsCron() {
    if (!(await acquireCronLock(this.prisma, 'trial-expiry', 'daily'))) return;
    await this.expireOldTrials();
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
          videosUsedThisMonth: 0,
          aiCostThisMonthUsd: 0,
          articlesQuotaResetAt: now,
        } as any,
      });
      this.log.log(`[${user.id}] Aylık kota sıfırlandı (articles + videos + cost)`);
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
