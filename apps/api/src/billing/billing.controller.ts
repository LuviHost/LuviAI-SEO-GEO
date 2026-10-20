import { Body, Controller, ForbiddenException, Get, HttpCode, Param, Post, Query, Req } from '@nestjs/common';
import type { Request } from 'express';
import { SkipThrottle } from '@nestjs/throttler';
import { Public } from '../auth/public.decorator.js';
import { SessionOnly } from '../auth/session-only.decorator.js';
import { BillingService } from './billing.service.js';
import { PaytrService } from './paytr.service.js';
import { QuotaService } from './quota.service.js';
import { MeasurementAllowanceService } from './measurement-allowance.service.js';
import { clientIp } from '../common/client-ip.js';

function ensureSelf(req: Request, requestedUserId: string) {
  const user = (req as any).user;
  if (!user) throw new ForbiddenException('Auth required');
  if (user.role === 'ADMIN') return user;
  if (user.id !== requestedUserId) throw new ForbiddenException('Bu kullanıcının verisine erişim yok');
  return user;
}

@Controller('billing')
export class BillingController {
  constructor(
    private readonly billing: BillingService,
    private readonly paytr: PaytrService,
    private readonly quota: QuotaService,
    private readonly measurement: MeasurementAllowanceService,
  ) {}

  /**
   * GET /api/billing/measurement-allowance — oturumdaki hesabin haftalik AI
   * olcum hakki. Panel butonlari bunu okuyup kilitlenir; asil kapi sunucuda.
   */
  @Get('measurement-allowance')
  measurementAllowance(@Req() req: Request) {
    return this.measurement.status((req as any).user);
  }

  /**
   * GET /api/billing/plans — herkes plan listesini görebilir.
   * Fiyat USD kanonik; `monthlyTry`/`annualTry` gunun TCMB kuruyla hesaplanir.
   * `fx` alani UI dipnotu icin kur + cekilme zamani + bayat mi bilgisini tasir.
   * `checkout`: satin alma acik mi (PayTR test modunda kapali) — fiyat sayfasi
   * butonlari bununla kilitlenir. Herkese acik uc oturumu tanimaz, bu yuzden
   * anonim ziyaretci karari; hesaba ozel karar (test modunda yonetici acik) /current'ta.
   */
  @Public()
  @Get('plans')
  async plans(@Query('locale') locale?: string) {
    const lang = locale === 'en' ? 'en' : 'tr';
    const [list, checkout] = await Promise.all([
      this.billing.getPlansWithFx(lang),
      this.paytr.checkoutStatus(null, lang),
    ]);
    return { ...list, checkout };
  }

  @Get('users/:userId/current')
  async current(@Req() req: Request, @Param('userId') userId: string) {
    ensureSelf(req, userId);
    // checkout: istenen HESABA gore (odeme kapisi da fatura sahibine bakar)
    const [plan, checkout] = await Promise.all([
      this.billing.getCurrentPlan(userId),
      this.paytr.checkoutStatus(userId),
    ]);
    return { ...plan, checkout };
  }

  @Get('users/:userId/invoices')
  invoices(@Req() req: Request, @Param('userId') userId: string) {
    ensureSelf(req, userId);
    return this.billing.getInvoices(userId);
  }

  @Get('users/:userId/quota')
  async getQuota(@Req() req: Request, @Param('userId') userId: string) {
    ensureSelf(req, userId);
    const [articles, sites, aiRuns, budget] = await Promise.all([
      this.quota.checkArticleQuota(userId),
      this.quota.checkSiteQuota(userId),
      // AI gorunurluk calistirmasi — panelde gosterilen ucuncu eksen.
      // Onceki 'videos' ekseni 108edda'da urunden cikarildi ama panel onu
      // okumaya devam ediyordu; site sayfasi bu yuzden patliyordu.
      this.quota.checkCitationQuota(userId),
      this.quota.checkAiCostBudget(userId),
    ]);
    return { articles, sites, aiRuns, budget };
  }

  // ─── Abonelik mutasyonlari yalniz panel oturumuyla ─────────────────
  // /billing, api-keys.service ROUTE_RESOURCE eslesmesinde yok: AuthGuard bilinmeyen kaynakta
  // HERHANGI bir ':write' anahtarini (orn. yalniz 'social:write') yeterli
  // sayiyordu. Odeme baslatmak, aboneligi iptal etmek (autoRenew'i kapatir)
  // ve test odemesini onaylamak insan karari; anahtar 403 alir. SDK ve MCP
  // bu uclari cagirmiyor. GET uclari (plan, fatura, kota) anahtarla okunur.

  /**
   * POST /api/billing/subscribe
   * Body'de userId varsa session.user.id ile eşleşmeli (cross-user koruması).
   * PayTR test modunda yalniz yonetici hesabina odeme baslatilir; digerleri
   * 403 + panelde gosterilen metni alir (PaytrService.assertCheckoutOpen).
   */
  @SessionOnly()
  @Post('subscribe')
  async subscribe(
    @Req() req: Request,
    @Body() body: {
      userId: string;
      planId: 'starter' | 'pro' | 'agency';
      cycle: 'monthly' | 'annual';
      userEmail: string;
      userName: string;
      userPhone?: string;
      userAddress?: string;
    },
  ) {
    ensureSelf(req, body.userId);
    // PayTR user_ip = musterinin IP'si. XFF'in ilk adresi istemcinin kendi
    // yazdigi deger olabilir; ortak kural CF-Connecting-IP / nginx'in ekledigi
    // adresi okur (common/client-ip.ts). Bos kalirsa eski varsayilan.
    const userIp = clientIp(req) || '127.0.0.1';

    return this.paytr.createPaymentToken({ ...body, userIp });
  }

  @SessionOnly()
  @Post('users/:userId/cancel')
  cancel(@Req() req: Request, @Param('userId') userId: string) {
    ensureSelf(req, userId);
    return this.paytr.cancelSubscription(userId);
  }

  /** DEV/TEST mode: PayTR webhook gelmiyorsa yonetici kendi tetikler (digerleri 403) */
  @SessionOnly()
  @Post('dev-confirm/:merchantOid')
  async devConfirm(@Req() req: Request, @Param('merchantOid') merchantOid: string) {
    const user = (req as any).user;
    if (!user?.id) throw new ForbiddenException('Auth required');
    return this.paytr.devConfirmPayment(user.id, merchantOid);
  }

  /**
   * PayTR webhook — body signature ile dogrulanir, public olmali.
   * SkipThrottle: PayTR tum musterilerin bildirimini ayni IP havuzundan gonderir.
   * Rate limit'e takilan bir bildirim = odenmis ama aktive edilmemis abonelik.
   * Guvenlik HMAC imzasiyla saglanir, IP limitiyle degil.
   */
  @SkipThrottle()
  @Public()
  @Post('webhooks/paytr')
  @HttpCode(200)
  async webhook(@Body() body: any) {
    return this.paytr.handleWebhook(body);
  }

  // ──────────────────────────────────────────────────────────────────────
  //  Video Credit Add-on (2026-05 Premium Pricing)
  // ──────────────────────────────────────────────────────────────────────
}
