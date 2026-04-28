import { Body, Controller, ForbiddenException, Get, HttpCode, Param, Post, Req } from '@nestjs/common';
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

  /** GET /api/billing/plans — herkes plan listesini görebilir */
  @Public()
  @Get('plans')
  plans() {
    return this.billing.getPlans();
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
    const [articles, sites] = await Promise.all([
      this.quota.checkArticleQuota(userId),
      this.quota.checkSiteQuota(userId),
    ]);
    return { articles, sites };
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

  /** PayTR webhook — body signature ile doğrulanır, public olmalı */
  @Public()
  @Post('webhooks/paytr')
  @HttpCode(200)
  async webhook(@Body() body: any) {
    return this.paytr.handleWebhook(body);
  }
}
