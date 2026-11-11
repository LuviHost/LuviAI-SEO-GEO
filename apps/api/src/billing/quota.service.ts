import { Injectable, ForbiddenException, HttpException, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  findPlan, articleOfferPlan, featureOfferPlan, planEngines, planHasFeature, FEATURE_MIN_PLAN, PLAN_FEATURE_LABELS, PLAN_RANK,
  PURCHASABLE_PLAN_IDS, VIDEOS_PER_MONTH,
  type BasePlan, type PlanFeature, type PlanId,
} from './plans.js';
import { acquireCronLock } from '../common/cron-lock.js';
import { periodEndFromInvoice, shouldDowngrade } from './subscription-period.js';
import {
  hasGenerationSource, requiresGenerationSource, TRIAL_SOURCE_REQUIRED_CODE, TRIAL_SOURCE_REQUIRED_MESSAGE, type GenerationReadiness,
} from './trial-policy.js';

/**
 * RanksUp anahtariyla (havuz) olculebilen alti asistan — plans.ts BASE_ENGINES ile
 * ayni kume (plan-pool.spec.ts denetler). Bir planin bunlardan HANGILERINI olctugu
 * 11.11.2026'dan beri plana baglidir: getPlanPool → plans.ts planEngines (Baslangic
 * ve deneme dort asistan, Profesyonel ve ustu altisi).
 *
 * TARIHCE:
 * NEDEN: eskiden LIMITS[plan].pool plana gore 1-6 saglayici listeliyordu
 * (TRIAL yalniz gemini, STARTER gemini+anthropic...). Fiyat karti her planda
 * 6 asistan satiyor, olcum motoru da (ai-citation.service resolveKey) env
 * anahtari olan saglayiciyi her planda olcuyordu; liste yalniz panel rozetini
 * ve hata metnini yaniltiyordu. Kota sayilarina (citationTests) dokunulmadi.
 * Meta AI (meta) burada yok: yalniz META_MODEL_API_KEY tanimliyken olculur
 * (audit/citation-providers.ts llamaModelConfigured).
 */
export const PLAN_POOL_PROVIDERS: readonly string[] = Object.freeze([
  'anthropic', 'gemini', 'openai', 'perplexity', 'xai', 'deepseek',
]);

/** Aylik AI butcesi dolu 403'unun makine kodu (panel sohbeti bunu asistan notu olarak gosterir) */
export const AI_BUDGET_EXHAUSTED_CODE = 'AI_BUDGET_EXHAUSTED';
/** Panel sohbeti mesaj hakki dolu 403'unun makine kodu */
export const CHAT_MESSAGE_LIMIT_CODE = 'CHAT_MESSAGE_LIMIT';
/** Ayni hesaptan ayni anda cok fazla sohbet mesaji: sayac yazilamadi (429) */
export const CHAT_BUSY_CODE = 'CHAT_BUSY';

/** consumeChatMessageSlot sonucu; iade (refundChatMessageSlot) bunu geri alir */
export interface ChatMessageSlot {
  /** Sayac bu cagride bir artti (ADMIN, platform otomasyonu ve okunamayan sayacta false) */
  charged: boolean;
  /** Artan kv_store anahtari; charged false ise null */
  key: string | null;
}

/** Sayac yazimi (karsilastir-ve-yaz) en fazla bu kadar denenir; sonra 429 */
const CHAT_SLOT_ATTEMPTS = 6;

const counterValue = (v: unknown): number => {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : 0;
};

/** 1500 → "1.500" (musteri metni; ICU'ya bagli olmasin diye elle) */
const fmtCount = (n: number): string => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, '.');

/**
 * Plan-based quota enforcer.
 *
 * 4 limit:
 *  1. articlesPerMonth — ay sonu reset
 *  2. sites — toplam site sayısı
 *  3. publishTargets — TRIAL'da sadece markdown_zip
 *  4. trial expiry — 14 gun sonra hesap salt okunur (trial-policy.ts, trial-expiry.guard.ts)
 */
/**
 * Butce tavani hesabinda kullanilan UST tahminler (USD; kod okumasindan — canli olcum degil):
 * bir makale revizyon turlariyla en cok ~1.5, bir Asistan mesaji 7 tura kadar model cagrisiyla
 * en cok ~0.25. Deneme tavani bu ikisinden turetilir (SPEND_CAP_USD.TRIAL).
 */
export const AI_COST_ESTIMATE_MAX_USD = { article: 1.5, chatMessage: 0.25 } as const;

@Injectable()
export class QuotaService {
  private readonly log = new Logger(QuotaService.name);

  /**
   * 2026-05 Premium pricing update — bkz. billing.service.ts BASE_PLANS.
   * Spend cap (USD/ay): TRIAL=$3, STARTER=$25, PRO=$120, AGENCY=$200, ENTERPRISE=$700.
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
    // 11.11.2026: Baslangic paketinde makale uretimi yok (plans.ts articlesPerMonth 0)
    STARTER:    { articles: 0,    sites: 2,  publishTargets: 'all' as const,                                  citationTests: 20 },
    PRO:        { articles: 40,   sites: 5,  publishTargets: 'all' as const,                                  citationTests: 75 },
    AGENCY:     { articles: 100,  sites: 15, publishTargets: 'all' as const,                                  citationTests: 300 },
    ENTERPRISE: { articles: 350,  sites: 50, publishTargets: 'all' as const,                                  citationTests: 1000 },
  };

  /**
   * Plan başına aylık USD spend cap — tek kaynak (admin.controller da buradan okur).
   *
   * KAPSAM (sahip karari 11.11.2026, "zarar etmeyelim"): butce, makale hattinin (bes ajan +
   * QA kapisi), cevirinin, panel sohbetinin, gorsel alt metni onerisinin ve yorum yaniti
   * taslaginin harcamasini sayar ve doldugunda makale uretimini (kullanicinin baslattigi +
   * takvim / otomatik), ceviriyi ve panel sohbetini durdurur. Olcum sayilmaz ve durmaz: onu
   * aylik calistirma tavani ve haftalik olcum hakki sinirlar.
   * SAYILMAYANLAR (bilinen aciklik; kucuk, sahipsiz cagrilar): kapak gorseli uretimi (LLM
   * saglayici katmanindan gecmez), sema siniflandirici, marka beyni / nis cikarimi, dal
   * (fan-out) uretimi, takili sayfa iyilestirmesi. Bunlar sayaca eklenene kadar tavan
   * "her AI harcamasi" degil, yukaridaki kalemlerin tavanidir. Eskiden sayac
   * yalniz userId'li LLMProviderService cagrilarinda artiyor, kapi yalniz uc kucuk ozellikte
   * (gorsel alt metni, yorum yaniti, video metni) calisiyordu; en buyuk harcayanlar (makale
   * ajanlari, sohbet, ceviri) butceye hic ugramiyordu.
   *
   * PRO 80 → 120 (11.11.2026): makale ve sohbet harcamasi artik sayiliyor. Profesyonel hesap
   * hakkini olagan kullanirsa — 40 makale x yaklasik $0.75 (revizyon turlariyla $1.5'e kadar)
   * = $30-60 ve ustune sohbet — $80'e yaklasirdi; tavan normal kullanimi engellememeli,
   * yalniz asiri / kotuye kullanimi kesmeli.
   *
   * TRIAL 3 → 8 (11.11.2026, bagimsiz inceleme): deneme tavani OMUR BOYUdur (sifirlanmaz) ve
   * sayac artik makale ile sohbeti de sayiyor. 3 USD denemenin VAAT ETTIGINI karsilamiyordu:
   * 2 makale (her biri en cok ~$1.5) + 20 Asistan mesaji (her biri en cok ~$0.25) = $8.
   * Once 15-20 mesaj yazan deneme kullanicisi "Şimdi üret"te "deneme bütçen doldu" aliyor,
   * ikinci makalesini (ya da ikisini) hic uretemiyordu. Tavan, denemenin iki hakkinin UST
   * tahminle toplamidir (AI_COST_ESTIMATE_MAX_USD; quota-ai-budget.spec sabitler): haklar
   * tavandan once biter. Deneme basina en kotu maliyet 8 USD; eskiden sohbetin siniri yoktu.
   * Baslangic (makale yok, 100 mesaj x $0.25 = $25) ve ustu degismedi.
   */
  private readonly SPEND_CAP_USD: Record<string, number> = {
    TRIAL: 8,
    STARTER: 25,
    PRO: 120,
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

    // Deneme modeli: omur boyu kota (LIMITS.TRIAL). 14 gunluk sure burada denetlenmez:
    // suresi dolan hesabi global TrialExpiryGuard salt okunur yapar (satin alma acikken).

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

  /**
   * Makale hakki dolu 403'u — deneme "Profesyonel'e gec", makale hakki OLMAYAN plan
   * (Baslangic, 11.11.2026) "bu pakette yok", digerleri "plan yukselt".
   */
  private articleQuotaError(plan: string, limit: number): ForbiddenException {
    if (plan === 'TRIAL') {
      // Makale uretimi yalniz Profesyonel ve ustunde: "plan sec" Baslangic'i da kapsardi ve yanlis olurdu
      return new ForbiddenException(`Deneme hesabındaki ${limit} ücretsiz makale hakkını kullandın. Makale üretimine devam etmek için ${articleOfferPlan().name_tr} plana geç.`);
    }
    if (limit === 0) {
      return new ForbiddenException(`Makale üretimi bu pakette yok. Makale üretmek için ${articleOfferPlan().name_tr} plana geç.`);
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
  async consumeArticleAllowance(userId: string, siteId: string): Promise<{ remaining: number }> {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { plan: true } });
    // Ay basi sifirlamasi + plan hakki: enforceArticleQuota ile ayni okuma
    const { allowed, remaining, limit } = await this.checkArticleQuota(userId);
    // Hak bittiyse once o soylenir: kaynak baglamak bitmis hakki geri getirmez
    if (!allowed) throw this.articleQuotaError(user.plan, limit);
    // Deneme: uretim yalniz sitede kaynak (yayin hedefi) bagliyken (trial-policy.ts).
    // siteId ZORUNLU parametre: yeni bir uretim yolu bu kapiyi atlayamasin.
    const readiness = await this.generationReadinessFor(user.plan, siteId);
    if (!readiness.ready) {
      throw new ForbiddenException({ statusCode: 403, message: readiness.message, code: TRIAL_SOURCE_REQUIRED_CODE });
    }
    // Aylik AI butcesi (11.11.2026): doluysa uretim baslamaz, hak dusmez. Kullanicinin
    // baslattigi her uretim yolu (Uret, run-now, Simdi uret, MCP create_article, icerik
    // firsati) bu metottan gecer; musteri 403'u tikladigi anda gorur. Takvim / otomatik
    // uretim ayni kapiya hat baslarken carpar (articles/pipeline.service runPipeline).
    await this.enforceAiCostBudget(userId);
    const r = await this.prisma.user.updateMany({
      where: { id: userId, articlesUsedThisMonth: { lt: limit } },
      data: { articlesUsedThisMonth: { increment: 1 } },
    });
    // Hak dolu ya da okuma ile yazma arasinda son hakki baska bir istek aldi
    if (r.count !== 1) throw this.articleQuotaError(user.plan, limit);
    return { remaining: Math.max(0, remaining - 1) };
  }

  /**
   * Bu sitede uretim icin kaynak sarti saglaniyor mu (panel "Uret" dugmesi ve
   * consumeArticleAllowance ayni karari okur). Sart yalniz denemede
   * (requiresGenerationSource); ucretli planda sorgu yapilmaz.
   */
  async generationReadiness(userId: string, siteId: string): Promise<GenerationReadiness> {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { plan: true } });
    return this.generationReadinessFor(user.plan, siteId);
  }

  /**
   * Hakki daha once dusulmus yazinin yeniden uretimi (consumeArticleAllowance
   * cagrilmaz) de ayni kaynak kuralina tabi: 403 metni ve kodu ayni.
   * Aylik AI butcesi de burada denetlenir (11.11.2026): bu metot
   * consumeArticleAllowance'in "hak onceden dusulmus" ikizi; butce doluyken "Simdi uret"
   * tiklandigi anda 403 doner, yazi GENERATING'e alinmaz.
   */
  async assertGenerationSource(userId: string, siteId: string): Promise<void> {
    const readiness = await this.generationReadiness(userId, siteId);
    if (!readiness.ready) {
      throw new ForbiddenException({ statusCode: 403, message: readiness.message, code: TRIAL_SOURCE_REQUIRED_CODE });
    }
    await this.enforceAiCostBudget(userId);
  }

  private async generationReadinessFor(plan: string, siteId: string): Promise<GenerationReadiness> {
    if (!requiresGenerationSource(plan)) return { requiresSource: false, ready: true, message: null };
    const targets = await this.prisma.publishTarget.findMany({
      where: { siteId, isActive: true },
      select: { type: true, isActive: true },
    });
    const ready = hasGenerationSource(targets);
    return { requiresSource: true, ready, message: ready ? null : TRIAL_SOURCE_REQUIRED_MESSAGE };
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
  //  RanksUp Video — aylik video hakki
  // ────────────────────────────────────────────

  /** Planin aylik video hakki (plans.ts VIDEOS_PER_MONTH tek kaynak); bilinmeyen plan 0 */
  videoLimitFor(plan: string): number {
    const id = String(plan ?? '').toLowerCase();
    return Object.prototype.hasOwnProperty.call(VIDEOS_PER_MONTH, id) ? VIDEOS_PER_MONTH[id as PlanId] : 0;
  }

  /** Panel icin: bu ayki kullanim, hak, kalan (ay basi sifirlamasi once uygulanir) */
  async checkVideoQuota(userId: string): Promise<{ used: number; limit: number; remaining: number; unlimited: boolean }> {
    const before = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    await this.maybeResetMonthlyQuota(before);
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { plan: true, role: true, videosUsedThisMonth: true },
    });
    const limit = this.videoLimitFor(user.plan);
    const used = user.videosUsedThisMonth ?? 0;
    // ADMIN (platform sahibi/ekip) hakka takilmaz — site/uygulama kotasiyla ayni gerekce
    const unlimited = user.role === 'ADMIN';
    return { used, limit, remaining: Math.max(0, limit - used), unlimited };
  }

  /**
   * Bir video icin hak dus — kuyruga atmadan ONCE. Tek kosullu UPDATE
   * (`videosUsedThisMonth < hak`): ayni anda gelen iki istek son hakki iki kez alamaz
   * (consumeArticleAllowance ile ayni kalip). Hak 0 ise (Deneme/Baslangic) ozellik yok mesaji;
   * hak dolduysa aylik doldu mesaji. ADMIN sayac artirmadan gecer (charged=false) — iade
   * de yapilmaz.
   */
  async consumeVideoAllowance(userId: string): Promise<{ charged: boolean; remaining: number; limit: number }> {
    const q = await this.checkVideoQuota(userId);
    if (q.unlimited) return { charged: false, remaining: q.remaining, limit: q.limit };
    if (q.limit <= 0) {
      this.assertPlanFeature((await this.planOf(userId)), 'articleVideo');
      // Plan ozelligi acik ama hak 0 (ileride boyle bir plan olursa): yine net bir 403
      throw new ForbiddenException('Planında RanksUp Video hakkı yok. Planını yükselterek kullanabilirsin.');
    }
    const r = q.remaining > 0
      ? await this.prisma.user.updateMany({
        where: { id: userId, videosUsedThisMonth: { lt: q.limit } },
        data: { videosUsedThisMonth: { increment: 1 } },
      })
      : { count: 0 };
    if (r.count !== 1) {
      throw new ForbiddenException(`Bu ayki ${q.limit} video hakkını kullandın. Hak yeni ayda yenilenir; daha fazlası için planını yükseltebilirsin.`);
    }
    return { charged: true, remaining: Math.max(0, q.remaining - 1), limit: q.limit };
  }

  /**
   * consumeVideoAllowance'in dustugu hakki geri ver (render basarisiz, is kuyruga girmedi,
   * kuyruktaki video silindi). Cagiran bunu YALNIZ BIR KEZ cagirmali (videonun durum gecisi
   * kosullu UPDATE ile korunur, bkz. video-render.service markFailed).
   *
   * chargedAt: hakkin dusuldugu an (Video.createdAt). Hak gecen ay dusulduyse iade EDILMEZ:
   * sayac yeni ayda sifirlanir (ya da ilk kota okumasinda sifirlanacak), eski ayin hakki yeni
   * ayin sayacindan dusulmemeli. Ay tanimi maybeResetMonthlyQuota ile ayni (sunucu saati, yil +
   * ay). articlesQuotaResetAt'e bakilmaz: ay ortasi plan degisimi o damgayi yeniler ama video
   * sayacini sifirlamaz (paytr.service activateSubscription).
   * Sayac 0'in altina inmez. Hata loglanir ve yutulur: asil hata kaybolmasin.
   */
  async refundVideoAllowance(userId: string, chargedAt: Date, now: Date = new Date()): Promise<boolean> {
    const at = new Date(chargedAt);
    if (at.getFullYear() !== now.getFullYear() || at.getMonth() !== now.getMonth()) return false;
    try {
      const r = await this.prisma.user.updateMany({
        where: { id: userId, videosUsedThisMonth: { gt: 0 } },
        data: { videosUsedThisMonth: { decrement: 1 } },
      });
      return r.count === 1;
    } catch (err: any) {
      this.log.warn(`[${userId}] Video hakki geri verilemedi: ${err?.message ?? err}`);
      return false;
    }
  }

  private async planOf(userId: string): Promise<string> {
    const u = await this.prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { plan: true } });
    return u.plan;
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
   *  - %80'i geçince warn: panelde uyari (web quota-monitor.tsx)
   *  - %100'ü geçince hardBlock: enforceAiCostBudget / aiBudgetBlock cagiranlari durur
   *
   * Cap'ler SPEND_CAP_USD sabitinden gelir; panelden degistirilemez.
   *
   * `exempt`: ADMIN (platform sahibi / ekip) butceye takilmaz — site, uygulama ve video
   * haklariyla ayni muafiyet. Sayac yine artar (harcama /admin/users-spend-status'ta gorunur);
   * yalniz hardBlock false kalir. NEDEN (11.11.2026): butce artik makale uretimini de
   * durduruyor; sahibin kendi (dogfood / demo) sitelerinin takvimi plan tavaninda kesilmesin.
   * Muafiyet SAHIBIN rolune bakar: yoneticinin bir musteri sitesinde baslattigi is
   * musterinin butcesine tabidir.
   */
  async checkAiCostBudget(userId: string): Promise<{ used: number; cap: number; pct: number; warn: boolean; hardBlock: boolean; exempt: boolean }> {
    const before = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    // Ay basi sifirlamasi burada da calismali: yalniz checkArticleQuota'da
    // calistigi icin gecen ay butceye takilan ucretli kullanici, makale kotasina
    // bakan bir islem olana kadar yeni ayda da engelli kaliyordu.
    await this.maybeResetMonthlyQuota(before);
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    const cap = this.SPEND_CAP_USD[user.plan] ?? this.SPEND_CAP_USD.STARTER;
    const used = (user as any).aiCostThisMonthUsd ?? 0;
    // Asagi yuvarlanir (11.11.2026): Math.round %99,5'te 100 veriyor, $119.99 / $120 harcamis
    // hesap "bütçen doldu" metniyle engelleniyordu. Engel gercekten dolunca (used >= cap).
    // 1e-9: 2.4 / 3 gibi tam esik degerleri kayan nokta yuzunden 79,99... cikmasin.
    const pct = cap > 0 ? Math.floor((used * 100) / cap + 1e-9) : 0;
    const exempt = (user as any).role === 'ADMIN';
    return {
      used,
      cap,
      pct,
      warn: pct >= 80,
      hardBlock: !exempt && pct >= 100,
      exempt,
    };
  }

  /**
   * Butce doluysa 403 (kod AI_BUDGET_EXHAUSTED). Cagiranlar: kullanicinin baslattigi makale
   * uretimi (consumeArticleAllowance / assertGenerationSource), gorsel alt metni onerisi,
   * App Store yorum yaniti taslagi. Panel sohbeti, ceviri ve uretim hatti ayni karari
   * aiBudgetBlock ile okur (sayac okunamazsa engellemez). Web'deki uyari metni
   * (quota-monitor.tsx) bu listeyle ayni olmali — public-docs.spec.ts denetler.
   * Sayac okunamazsa hata cagirana gider (cagiranlarin kendi okumalari da ayni satira bagli).
   */
  async enforceAiCostBudget(userId: string): Promise<void> {
    const { hardBlock, used, cap } = await this.checkAiCostBudget(userId);
    if (!hardBlock) return;
    const plan = await this.planOf(userId);
    throw new ForbiddenException({ statusCode: 403, message: this.aiBudgetMessage(plan, used, cap), code: AI_BUDGET_EXHAUSTED_CODE });
  }

  /**
   * Butce dolu mu — 403 ATMADAN: doluysa musteriye gidecek metin, degilse null.
   * Uretim hatti (takvim / otomatik uretim worker'da baslarken) ve ceviri bunu kullanir.
   * Sayac OKUNAMAZSA null doner ve loglanir (urun durmaz): butce bir emniyet agidir,
   * veritabani hatasi yuzunden uretimi kesmek icin degil.
   */
  async aiBudgetBlock(userId: string): Promise<string | null> {
    try {
      const { hardBlock, used, cap } = await this.checkAiCostBudget(userId);
      if (!hardBlock) return null;
      return this.aiBudgetMessage(await this.planOf(userId), used, cap);
    } catch (err: any) {
      this.log.warn(`[${userId}] AI butcesi okunamadi, islem engellenmedi: ${err?.message ?? err}`);
      return null;
    }
  }

  /**
   * Butce dolu metni — her planda dogru olmali:
   *  - Deneme: butce HIC sifirlanmaz (maybeResetMonthlyQuota TRIAL'da donmeden cikar);
   *    "yeni ayi bekle" denmez.
   *  - Ust satin alinabilir planin tavani daha yuksekse (Baslangic → Profesyonel) soylenir.
   *  - Profesyonel ve ustunde yukseltme VAAT EDILMEZ (Kurumsal teklifle): yalniz yenilenme.
   */
  private aiBudgetMessage(plan: string, used: number, cap: number): string {
    const tutar = `($${used.toFixed(2)} / $${cap})`;
    if (plan === 'TRIAL') {
      return `Deneme hesabının AI kullanım bütçesi doldu ${tutar}. Deneme bütçesi yenilenmez. ` +
        'Ücretli planlarda bütçe yeni ayda sıfırlanır; devam etmek için ücretli bir plana geçebilirsin.';
    }
    const ust = this.upgradeOffers(plan).find((p) => (this.SPEND_CAP_USD[p.id.toUpperCase()] ?? 0) > cap);
    return `Aylık AI kullanım bütçen doldu ${tutar}. Bütçe yeni ayın başında sıfırlanır` +
      (ust ? `; ${ust.name_tr} planda sınır daha yüksek.` : '.');
  }

  /** Bu planin USTUNDEKI, panelden satin alinabilen planlar (dusukten yuksege) */
  private upgradeOffers(plan: string): BasePlan[] {
    const rank = PLAN_RANK[String(plan ?? '').toLowerCase() as PlanId];
    if (rank === undefined) return [];
    return PURCHASABLE_PLAN_IDS
      .map((id) => findPlan(id))
      .filter((p): p is BasePlan => !!p && PLAN_RANK[p.id] > rank)
      .sort((x, y) => PLAN_RANK[x.id] - PLAN_RANK[y.id]);
  }

  // ────────────────────────────────────────────
  //  Panel sohbeti (Asistan) — mesaj hakki
  // ────────────────────────────────────────────

  /** Planin sohbet mesaji hakki (plans.ts chatMessagesPerMonth tek kaynak); bilinmeyen plan 0 */
  chatMessageLimitFor(plan: string): number {
    return findPlan(String(plan ?? '').toLowerCase())?.chatMessagesPerMonth ?? 0;
  }

  /**
   * Sayacin kv_store anahtari.
   *  - Ucretli plan: takvim ayi basina bir anahtar. Ay tanimi diger aylik sayaclarla ayni
   *    (maybeResetMonthlyQuota: sunucu saati, yil + ay); yeni ayda yeni anahtar = sifirdan.
   *    Eski ayin satiri bir daha okunmaz, suresi dolunca KvSweepCron siler.
   *  - Deneme: TEK anahtar, suresiz — hak aylik degil toplam (denemenin makale, calistirma
   *    ve butce sayaclari da sifirlanmaz).
   * Anahtar kullanici kimligini icerir: hesap kalici silinince satir da silinir
   * (me/account-purge.plan.ts kimligi iceren kv anahtarlarini siler).
   */
  private chatCounterKey(userId: string, plan: string, now: Date): { key: string; expiresAt: Date | null } {
    if (plan === 'TRIAL') return { key: `sohbet-mesaj:${userId}:deneme`, expiresAt: null };
    const ay = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    return { key: `sohbet-mesaj:${userId}:${ay}`, expiresAt: new Date(now.getFullYear(), now.getMonth() + 2, 1) };
  }

  /** Panel icin: bu donemki mesaj sayisi, hak, kalan (deneme: toplam hak) */
  async checkChatQuota(userId: string, now: Date = new Date()): Promise<{ used: number; limit: number; remaining: number; unlimited: boolean; lifetime: boolean }> {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { plan: true, role: true } });
    const limit = this.chatMessageLimitFor(user.plan);
    const { key } = this.chatCounterKey(userId, user.plan, now);
    const row = await this.prisma.kvStore.findUnique({ where: { key }, select: { value: true } });
    const used = counterValue(row?.value);
    return { used, limit, remaining: Math.max(0, limit - used), unlimited: user.role === 'ADMIN', lifetime: user.plan === 'TRIAL' };
  }

  /**
   * Bir sohbet mesaji icin hak ayir — ilk model cagrisindan ONCE. Hak doluysa 403
   * (kod CHAT_MESSAGE_LIMIT, musteriye gosterilen metin chatLimitMessage).
   *
   * NEDEN kv_store sayaci (ChatMessage satirlarini saymak yerine): sohbet silinince mesaj
   * satirlari da silinir (chat.service deleteConversation, site silme) — satir sayan sinir
   * gecmis silinerek sifirlanabilirdi; platformun kendi baslattigi haftalik plan mesaji da
   * musterinin hakkindan duserdi. Sema degismedi (yeni tablo / sutun yok).
   *
   * ESZAMANLILIK: artis karsilastir-ve-yaz (`value` hala okunan degerse yazilir; haftalik
   * olcum hakkiyla ayni kalip, measurement-allowance.service). Ayni anda gelen iki mesajdan
   * yalniz biri son hakki alir; sinir HIC asilmaz. Yaris CHAT_SLOT_ATTEMPTS denemede
   * cozulmezse 429 (CHAT_BUSY): istek reddedilir, hak dusmez.
   *
   * ADMIN sayilmaz ve takilmaz (charged false). Sayac OKUNAMAZ / YAZILAMAZSA mesaj
   * engellenmez (loglanir, charged false): sinir veritabani hatasinda sohbeti kapatmamali;
   * maliyetin emniyet agi aylik AI butcesidir.
   */
  async consumeChatMessageSlot(user: { id: string; role?: string | null; plan?: string | null }, now: Date = new Date()): Promise<ChatMessageSlot> {
    if (user.role === 'ADMIN') return { charged: false, key: null };
    let plan: string;
    let limit: number;
    let key: string;
    let taken: boolean | null;
    try {
      // Plan oturumdaki kullanici satirindan gelir (AuthGuard her istekte DB'den okur); yoksa okunur
      plan = user.plan ?? (await this.planOf(user.id));
      limit = this.chatMessageLimitFor(plan);
      const counter = this.chatCounterKey(user.id, plan, now);
      key = counter.key;
      taken = await this.takeCounterSlot(key, limit, counter.expiresAt);
    } catch (err: any) {
      this.log.warn(`[${user.id}] Sohbet mesaj sayaci yazilamadi, mesaj engellenmedi: ${err?.message ?? err}`);
      return { charged: false, key: null };
    }
    if (taken === true) return { charged: true, key };
    if (taken === null) {
      throw new HttpException(
        { statusCode: 429, message: 'Aynı anda çok fazla mesaj gönderildi. Birkaç saniye sonra tekrar dene.', code: CHAT_BUSY_CODE },
        429,
      );
    }
    throw new ForbiddenException({ statusCode: 403, message: this.chatLimitMessage(plan, limit), code: CHAT_MESSAGE_LIMIT_CODE });
  }

  /**
   * consumeChatMessageSlot'un ayirdigi hakki geri ver: mesaj hicbir model cagrisi
   * tamamlanmadan basarisiz oldu (saglayici hatasi, kayit acilamadi). Sayac 0'in altina
   * inmez. Hata loglanir ve yutulur: cagiranin asil hatasi kaybolmasin.
   */
  async refundChatMessageSlot(slot: ChatMessageSlot): Promise<void> {
    if (!slot.charged || !slot.key) return;
    try {
      for (let attempt = 0; attempt < CHAT_SLOT_ATTEMPTS; attempt++) {
        const row = await this.prisma.kvStore.findUnique({ where: { key: slot.key }, select: { value: true } });
        const used = counterValue(row?.value);
        if (!row || used <= 0) return;
        const r = await this.prisma.kvStore.updateMany({ where: { key: slot.key, value: row.value }, data: { value: String(used - 1) } });
        if (r.count === 1) return;
      }
    } catch (err: any) {
      this.log.warn(`Sohbet mesaj hakki geri verilemedi (${slot.key}): ${err?.message ?? err}`);
    }
  }

  /** Sayac < hak ise bir artir. true: alindi, false: hak dolu, null: yaris cozulemedi */
  private async takeCounterSlot(key: string, limit: number, expiresAt: Date | null): Promise<boolean | null> {
    if (limit <= 0) return false;
    for (let attempt = 0; attempt < CHAT_SLOT_ATTEMPTS; attempt++) {
      const row = await this.prisma.kvStore.findUnique({ where: { key }, select: { value: true } });
      if (!row) {
        try {
          await this.prisma.kvStore.create({ data: { key, value: '1', expiresAt } });
          return true;
        } catch (err: any) {
          // P2002: ayni anda baska bir istek satiri olusturdu — kosullu artisa don
          if (err?.code !== 'P2002') throw err;
          continue;
        }
      }
      const used = counterValue(row.value);
      if (used >= limit) return false;
      const r = await this.prisma.kvStore.updateMany({ where: { key, value: row.value }, data: { value: String(used + 1) } });
      if (r.count === 1) return true;
    }
    return null;
  }

  /**
   * Mesaj hakki dolu metni: sinir, ne zaman yenilendigi ve (varsa) yukseltme yolu.
   * Deneme hakki yenilenmez; Baslangic → Profesyonel soylenir; Profesyonel ve ustunde
   * yukseltme VAAT EDILMEZ (Kurumsal teklifle), yalniz yenilenme.
   */
  private chatLimitMessage(plan: string, limit: number): string {
    const ust = this.upgradeOffers(plan).filter((p) => p.chatMessagesPerMonth > limit);
    const teklif = ust.map((p) => `${p.name_tr} planında ayda ${fmtCount(p.chatMessagesPerMonth)}`).join(', ');
    if (plan === 'TRIAL') {
      return `Deneme hesabındaki ${fmtCount(limit)} Asistan mesajı hakkını kullandın; deneme hakkı yenilenmez.` +
        (teklif ? ` ${teklif} mesaj gönderebilirsin.` : '');
    }
    return `Bu ayki ${fmtCount(limit)} Asistan mesajı hakkını kullandın. Hak gelecek ayın başında yenilenir` +
      (teklif ? `; ${teklif} mesaj gönderebilirsin.` : '.');
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

    // Ozelligi iceren en dusuk SATISTAKI plan (Ajans satistan kalkti → Kurumsal)
    const needed = featureOfferPlan(feature).name_tr;
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
   * Planin havuzdan (RanksUp anahtariyla) olculen saglayicilari: PLAN_POOL_PROVIDERS ile
   * planin kapsaminin (plans.ts planEngines) kesisimi — Baslangic ve denemede dort,
   * Profesyonel ve ustunde alti asistan; bilinmeyen plan bos liste.
   * Gercekten olculup olculmeyecegini env anahtari belirler (resolveKey).
   */
  getPlanPool(plan: string): string[] {
    if (!Object.prototype.hasOwnProperty.call(this.LIMITS, plan)) return [];
    // 11.11.2026: kapsam plana gore (plans.ts planEngines) — Baslangic ve deneme 4 asistan.
    // Kosullu asistan (Meta/Muse) havuz listesinde yok: olculup olculmeyecegini anahtar belirler.
    const kapsam = new Set<string>(planEngines(plan.toLowerCase() as PlanId));
    return PLAN_POOL_PROVIDERS.filter((p) => kapsam.has(p));
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
    // TRIAL'in 3 AI gorunurluk calistirmasi TOPLAM hak (makale hakki gibi,
    // maybeResetMonthlyQuota); ay donumunde sifirlamak denemeyi ayliga ceviriyordu.
    // Ucretli plana gecince ilk kontrol sifirlar (son sifirlama eski ayda kalir).
    if (user.plan === 'TRIAL') return;

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
