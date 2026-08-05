import { Body, Controller, ForbiddenException, Get, HttpCode, Param, Post, Query, Req } from '@nestjs/common';
import type { Request } from 'express';
import { Public } from '../auth/public.decorator.js';
import { BillingService } from './billing.service.js';
import { PaytrService } from './paytr.service.js';
import { QuotaService } from './quota.service.js';

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
  ) {}

  /**
   * GET /api/billing/plans — herkes plan listesini görebilir.
   * Fiyat USD kanonik; `monthlyTry`/`annualTry` gunun TCMB kuruyla hesaplanir.
   * `fx` alani UI dipnotu icin kur + cekilme zamani + bayat mi bilgisini tasir.
   */
  @Public()
  @Get('plans')
  plans(@Query('locale') locale?: string) {
    return this.billing.getPlansWithFx(locale === 'en' ? 'en' : 'tr');
  }

  @Get('users/:userId/current')
  current(@Req() req: Request, @Param('userId') userId: string) {
    ensureSelf(req, userId);
    return this.billing.getCurrentPlan(userId);
  }

  @Get('users/:userId/invoices')
  invoices(@Req() req: Request, @Param('userId') userId: string) {
    ensureSelf(req, userId);
    return this.billing.getInvoices(userId);
  }

  @Get('users/:userId/quota')
  async getQuota(@Req() req: Request, @Param('userId') userId: string) {
    ensureSelf(req, userId);
    const [articles, sites, videos, budget] = await Promise.all([
      this.quota.checkArticleQuota(userId),
      this.quota.checkSiteQuota(userId),
      this.quota.checkVideoQuota(userId),
      this.quota.checkAiCostBudget(userId),
    ]);
    return { articles, sites, videos, budget };
  }

  /**
   * POST /api/billing/subscribe
   * Body'de userId varsa session.user.id ile eşleşmeli (cross-user koruması).
   */
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
    const userIp = (req.headers['x-forwarded-for'] as string)?.split(',')[0]
      ?? req.socket.remoteAddress
      ?? '127.0.0.1';

    return this.paytr.createPaymentToken({ ...body, userIp });
  }

  @Post('users/:userId/cancel')
  cancel(@Req() req: Request, @Param('userId') userId: string) {
    ensureSelf(req, userId);
    return this.paytr.cancelSubscription(userId);
  }

  /** DEV/TEST mode: PayTR webhook gelmiyorsa user kendi tetikler */
  @Post('dev-confirm/:merchantOid')
  async devConfirm(@Req() req: Request, @Param('merchantOid') merchantOid: string) {
    const user = (req as any).user;
    if (!user?.id) throw new ForbiddenException('Auth required');
    return this.paytr.devConfirmPayment(user.id, merchantOid);
  }

  /** PayTR webhook — body signature ile doğrulanır, public olmalı */
  @Public()
  @Post('webhooks/paytr')
  @HttpCode(200)
  async webhook(@Body() body: any) {
    return this.paytr.handleWebhook(body);
  }

  // ──────────────────────────────────────────────────────────────────────
  //  Video Credit Add-on (2026-05 Premium Pricing)
  // ──────────────────────────────────────────────────────────────────────

  /** Mevcut credit pack'ler — fiyat tablosu. */
  @Public()
  @Get('video-credits/packs')
  creditPacks() {
    return [
      { key: '5',  packSize: 5,  priceTry: 499,  description: '5 ek video — küçük kampanya için' },
      { key: '20', packSize: 20, priceTry: 1799, description: '20 ek video — %28 indirimli (₺25/video yerine ₺90)' },
      { key: '50', packSize: 50, priceTry: 3999, description: '50 ek video — %20 indirimli (en avantajlı)' },
    ];
  }

  /** Kullanıcının credit havuzunu döner (kalan kullanılabilir video sayısı). */
  @Get('users/:userId/video-credits')
  async myCredits(@Req() req: Request, @Param('userId') userId: string) {
    ensureSelf(req, userId);
    return this.billing.getVideoCreditPool(userId);
  }

  /** Credit pack satın al → PayTR iframe URL döner. */
  @Post('users/:userId/video-credits/purchase')
  async buyCredits(
    @Req() req: Request,
    @Param('userId') userId: string,
    @Body() body: { packKey: '5' | '20' | '50'; userEmail: string; userName: string },
  ) {
    ensureSelf(req, userId);
    const userIp = (req.headers['x-forwarded-for'] as string)?.split(',')[0]
      ?? req.socket.remoteAddress
      ?? '127.0.0.1';
    return this.paytr.startVideoCreditPurchase({
      userId,
      packKey: body.packKey,
      userEmail: body.userEmail,
      userName: body.userName,
      userIp,
    });
  }
}
