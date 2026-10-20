import { Injectable, ForbiddenException, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  findPlan, planHasFeature, FEATURE_MIN_PLAN, PLAN_FEATURE_LABELS,
  type PlanFeature, type PlanId,
} from './plans.js';
import { acquireCronLock } from '../common/cron-lock.js';
import { periodEndFromInvoice, shouldDowngrade } from './subscription-period.js';

/**
 * Her planda RanksUp anahtariyla (havuz) olculen asistanlar — plans.ts kart
 * maddesi "ChatGPT · Claude · Gemini · Perplexity · Grok · DeepSeek" ve
 * aiProviders: 6 ile ayni liste (plan-pool.spec.ts denetler).
 *
 * NEDEN: eskiden LIMITS[plan].pool plana gore 1-6 saglayici listeliyordu
 * (TRIAL yalniz gemini, STARTER gemini+anthropic...). Fiyat karti her planda
 * 6 asistan satiyor, olcum motoru da (ai-citation.service resolveKey) env
 * anahtari olan saglayiciyi her planda olcuyordu; liste yalniz panel rozetini
 * ve hata metnini yaniltiyordu. Kota sayilarina (citationTests) dokunulmadi.
 * Llama (meta) burada yok: yalniz GROQ_LLAMA_MODEL tanimliyken olculur
 * (audit/citation-providers.ts llamaModelConfigured).
 */
export const PLAN_POOL_PROVIDERS: readonly string[] = Object.freeze([
  'anthropic', 'gemini', 'openai', 'perplexity', 'xai', 'deepseek',
]);

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
   * Tavanlar asagidaki SPEND_CAP_USD sabitinden okunur; admin ayarlarinda
   * karsiligi yok (SPEND_CAP_* katalog kayitlari hicbir yere bagli degildi,
   * 2026-10'da katalogdan cikarildi).
   */
  /**
   * SITES: plans.ts ile AYNI olmali. Onceden burada 1/1/3/12/50 yaziyordu ama
   * fiyatlandirma 1/2/5/15/50 reklam ediyordu — musteri 5 site icin odeyip
   * 3'te bloklanacakti. Reklam degeri esas alindi (dayatmayi yukseltmek,
   * satilani kucultmekten dogru).
   *
   * CITATIONTESTS: plans.ts aiRunsPerMonth ile AYNI olmali. AI Citation testi
   * ve Prompt Lab calistirmasi ayni kovadan duser.
   *
   * Eski `pool` alani (plana gore saglayici listesi) kaldirildi — bkz.
   * PLAN_POOL_PROVIDERS. Kota sayilari aynen korundu.
   */
  private readonly LIMITS = {
    TRIAL:      { articles: 2,    sites: 1,  publishTargets: ['MARKDOWN_ZIP', 'WORDPRESS_REST'] as string[], citationTests: 3 },
    STARTER:    { articles: 15,   sites: 2,  publishTargets: 'all' as const,                                  citationTests: 20 },
    PRO:        { articles: 40,   sites: 5,  publishTargets: 'all' as const,                                  citationTests: 75 },
    AGENCY:     { articles: 100,  sites: 15, publishTargets: 'all' as const,                                  citationTests: 300 },
    ENTERPRISE: { articles: 350,  sites: 50, publishTargets: 'all' as const,                                  citationTests: 1000 },
  };

  /** Plan başına aylık USD spend cap — tek kaynak (admin.controller da buradan okur). */
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
    const before = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });

    // Ay sonu otomatik reset (basit: bir önceki ay'a bakınca sıfırla)
    await this.maybeResetMonthlyQuota(before);
    // Sifirlama sonrasi satir YENIDEN okunur: eski nesneyle yanit verilince yeni
    // ayin ilk cagrisi gecen ayin sayacini donuyor ve hakki dolan ucretli
    // musterinin ayin ilk uretimi bir kez yanlislikla reddediliyordu
    // (checkCitationQuota ayni kalibi zaten kullaniyor).
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });

    // Deneme modeli: TRIAL'da sure kontrolu yok, yalniz omur boyu kota (LIMITS.TRIAL).

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
    if (!allowed) throw this.articleQuotaError(user.plan, limit);
    return { remaining };
  }

  /** Makale hakki dolu 403'u — deneme "plan sec", ucretli plan "plan yukselt" */
  private articleQuotaError(plan: string, limit: number): ForbiddenException {
    if (plan === 'TRIAL') {
      return new ForbiddenException(`Deneme hesabındaki ${limit} ücretsiz makale hakkını kullandın. Devam etmek için plan seç.`);
    }
    return new ForbiddenException(`Aylık ${limit} makale kotan doldu. Plan yükseltebilir veya ayın sonunu bekleyebilirsin.`);
  }

  /**
   * Kullanicinin baslattigi uretim icin makale hakkindan BIR yazi dus — uretim
   * baslamadan (kuyruga atmadan / hatti calistirmadan) ONCE. Hak doluysa
   * enforceArticleQuota'nin 403'u (ayni metin), sayac degismez.
   *
   * NEDEN tek kosullu UPDATE (`articlesUsedThisMonth < hak`): eski sira "once
   * enforceArticleQuota oku, kuyruga at, sonra kosulsuz artir" idi. Ayni anda gelen
   * iki istek (cift tiklama, iki sekme, Uret + Simdi uret) ikisi de "hak var" okuyup
   * son hakki iki kez kullanabiliyordu: deneme hesabi 2 yerine 3 makale uretebilirdi.
   * Kosul ve artis tek SQL'de calisir; es zamanli iki cagridan yalniz biri son hakki
   * alir (takvimin chargeArticle'i ile ayni iyimser eszamanlilik kalibi). Uretim
   * baslatilamazsa cagiran refundArticleAllowance ile hakki geri verir.
   */
  async consumeArticleAllowance(userId: string): Promise<{ remaining: number }> {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { plan: true } });
    // Ay basi sifirlamasi + plan hakki: enforceArticleQuota ile ayni okuma
    const { allowed, remaining, limit } = await this.checkArticleQuota(userId);
    const r = allowed
      ? await this.prisma.user.updateMany({
        where: { id: userId, articlesUsedThisMonth: { lt: limit } },
        data: { articlesUsedThisMonth: { increment: 1 } },
      })
      : { count: 0 };
    // Hak dolu ya da okuma ile yazma arasinda son hakki baska bir istek aldi
    if (r.count !== 1) throw this.articleQuotaError(user.plan, limit);
    return { remaining: Math.max(0, remaining - 1) };
  }

  /**
   * consumeArticleAllowance'in dustugu hakki geri ver (uretim baslatilamadi: kayit
   * acilamadi, is kuyruga girmedi, senkron hat hata verdi). Sayac 0'in altina inmez
   * (arada ay basi sifirlamasi olduysa yeni ayin sayaci eksiye dusmesin). Hata
   * loglanir ve yutulur: cagiranin asil hatasi kaybolmasin.
   */
  async refundArticleAllowance(userId: string): Promise<void> {
    try {
      await this.prisma.user.updateMany({
        where: { id: userId, articlesUsedThisMonth: { gt: 0 } },
        data: { articlesUsedThisMonth: { decrement: 1 } },
      });
    } catch (err: any) {
      this.log.warn(`[${userId}] Baslatilamayan uretimin makale hakki geri verilemedi: ${err?.message ?? err}`);
    }
  }

  /** Planin makale hakki (TRIAL omur boyu, digerleri aylik); bilinmeyen plan 0 */
  articleLimitFor(plan: string): number {
    return Object.prototype.hasOwnProperty.call(this.LIMITS, plan)
      ? this.LIMITS[plan as keyof typeof this.LIMITS].articles
      : 0;
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
    if (allowed) return;
    // ADMIN (platform sahibi/ekip) site kotasina takilmaz. Site limiti bir
    // FIYATLANDIRMA kademesidir ve son kullanici (USER) icindir; owner kendi
    // hesabina dogfood/demo sitesi ekleyebilmeli. Yalniz kota asildiginda (nadir)
    // ek sorgu yapilir. Rapor/limit gosterimi (checkSiteQuota) DEGISMEDI.
    const u = await this.prisma.user.findUnique({ where: { id: userId }, select: { role: true } });
    if (u?.role === 'ADMIN') return;
    throw new ForbiddenException(`Plan limit: ${limit} site. Şu an ${current} siteniz var. Profesyonel veya Kurumsal'a yükseltin.`);
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
   * Cap'ler SPEND_CAP_USD sabitinden gelir; panelden degistirilemez.
   */
  async checkAiCostBudget(userId: string): Promise<{ used: number; cap: number; pct: number; warn: boolean; hardBlock: boolean }> {
    const before = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    // Ay basi sifirlamasi burada da calismali: yalniz checkArticleQuota'da
    // calistigi icin gecen ay butceye takilan ucretli kullanici, makale kotasina
    // bakan bir islem olana kadar yeni ayda da engelli kaliyordu.
    await this.maybeResetMonthlyQuota(before);
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
      // "Yeni ayi bekle" yalniz ucretli planlarda dogru: maybeResetMonthlyQuota
      // TRIAL'da donmeden cikar, deneme hesabinin butcesi hic sifirlanmaz.
      // Ust planin tavani daha yuksek (SPEND_CAP_USD), yukseltme gercek cozum.
      throw new ForbiddenException(
        `Aylık AI kullanım bütçen doldu ($${used.toFixed(2)} / $${cap}). ` +
        `Ücretli planlarda bütçe yeni ayda sıfırlanır; plan yükselterek sınırı artırabilirsin.`,
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
    const { allowed, current, limit } = await this.trackedAppQuota(userId);
    return { allowed, current, limit };
  }

  private async trackedAppQuota(userId: string) {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { plan: true, role: true },
    });
    const limit = findPlan(user.plan.toLowerCase())?.trackedApps ?? 1;
    // TrackedApp Site'a bagli; kullanicinin tum sitelerindeki uygulamalar sayilir.
    const current = await this.prisma.trackedApp.count({ where: { site: { userId } } });
    return { allowed: current < limit, current, limit, role: user.role };
  }

  async enforceTrackedAppQuota(userId: string): Promise<void> {
    const { allowed, current, limit, role } = await this.trackedAppQuota(userId);
    if (allowed) return;
    // ADMIN (platform sahibi/ekip) uygulama kotasina takilmaz — enforceSiteQuota
    // ile ayni gerekce: limit son kullanici icin bir fiyatlandirma kademesi,
    // owner kendi hesabina dogfood/demo uygulamasi ekleyebilmeli. Onceden site
    // kotasinda muaf olup burada takiliyordu (PRO = 3 uygulama, 4. reddediliyordu).
    if (role === 'ADMIN') return;
    throw new ForbiddenException(
      `Plan limiti: ${limit} uygulama. Şu an ${current} uygulaman var. Daha fazlası için plan yükselt.`,
    );
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

  /**
   * Iptal edilen ve odenmis donemi biten abonelikleri dusurur: plan → TRIAL,
   * durum → EXPIRED.
   *
   * NEDEN: cancelSubscription yalniz durumu CANCELED yapiyordu; plan/kota
   * kapilari yalniz `plan` alanina baktigindan iptal eden kullanici ucretli
   * ozellikleri suresiz kullanabiliyordu. Kullanici odedigi donemin sonuna kadar
   * planini korur (donem = son odenen fatura + dongu; bkz. subscription-period.ts).
   * Gunluk 04:15, cift-calisma kilidiyle (API ve worker ayni modulu yukler).
   */
  @Cron('15 4 * * *', { timeZone: 'Europe/Istanbul' })
  async expireCanceledSubscriptionsCron() {
    if (!(await acquireCronLock(this.prisma, 'canceled-sub-expiry', 'daily'))) return;
    await this.expireCanceledSubscriptions();
  }

  async expireCanceledSubscriptions(now: Date = new Date()): Promise<number> {
    const canceled = await this.prisma.user.findMany({
      where: { subscriptionStatus: 'CANCELED', plan: { not: 'TRIAL' } },
      select: { id: true, plan: true },
    });
    let downgraded = 0;
    for (const u of canceled) {
      const lastPaid = await this.prisma.invoice.findFirst({
        where: { userId: u.id, status: 'PAID' },
        orderBy: { paidAt: 'desc' },
        select: { paidAt: true, createdAt: true, description: true },
      });
      if (!shouldDowngrade(periodEndFromInvoice(lastPaid), now)) continue;
      await this.prisma.user.update({
        where: { id: u.id },
        data: { plan: 'TRIAL', subscriptionStatus: 'EXPIRED' },
      });
      downgraded++;
      this.log.log(`Iptal edilen abonelik dustu: ${u.id} (${u.plan} → TRIAL)`);
    }
    return downgraded;
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
      // Eski metin "BYOK ile sinirsiz" diyordu; iki yanlis: BYOK yalniz Kurumsal
      // planda (plans.ts FEATURE_MIN_PLAN.byok) ve kendi anahtarla olcum de
      // haftalik olcum hakkina tabi (billing/measurement-allowance.ts). Kota
      // dolunca BYOK saglayicilari kosmaya devam eder (ai-citation.service.ts),
      // sinirsiz olmaz. Hak her takvim ayinda sifirlanir (maybeResetCitationQuota).
      const byokPlan = findPlan(FEATURE_MIN_PLAN.byok)?.name_tr ?? 'Kurumsal';
      throw new ForbiddenException(
        `Aylık ${limit} AI görünürlük çalıştırması hakkın doldu (${used}/${limit}). Hak yeni ayda yenilenir; daha fazlası için planını yükseltebilirsin. ` +
        `${byokPlan} planda kendi API anahtarlarını (BYOK) bağlarsan havuz kotası dolduğunda da ölçüm bu anahtarlarla sürer; haftalık ölçüm hakkı yine geçerlidir.`,
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

  /**
   * Planin havuzdan (RanksUp anahtariyla) olculen saglayicilari — her bilinen
   * planda ayni 6 asistan (PLAN_POOL_PROVIDERS); bilinmeyen plan bos liste.
   * Gercekten olculup olculmeyecegini env anahtari belirler (resolveKey).
   */
  getPlanPool(plan: string): string[] {
    return Object.prototype.hasOwnProperty.call(this.LIMITS, plan) ? [...PLAN_POOL_PROVIDERS] : [];
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
