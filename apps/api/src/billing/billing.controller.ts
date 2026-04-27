import { Body, Controller, Get, HttpCode, Param, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { BillingService } from './billing.service.js';
import { PaytrService } from './paytr.service.js';
import { QuotaService } from './quota.service.js';

@Controller('billing')
export class BillingController {
  constructor(
    private readonly billing: BillingService,
    private readonly paytr: PaytrService,
    private readonly quota: QuotaService,
  ) {}

  /** GET /api/billing/plans — public */
  @Get('plans')
  plans() {
    return this.billing.getPlans();
  }

  /** GET /api/billing/users/:userId/current */
  @Get('users/:userId/current')
  current(@Param('userId') userId: string) {
    return this.billing.getCurrentPlan(userId);
  }

  /** GET /api/billing/users/:userId/invoices */
  @Get('users/:userId/invoices')
  invoices(@Param('userId') userId: string) {
    return this.billing.getInvoices(userId);
  }

  /** GET /api/billing/users/:userId/quota */
  @Get('users/:userId/quota')
  async getQuota(@Param('userId') userId: string) {
    const [articles, sites] = await Promise.all([
      this.quota.checkArticleQuota(userId),
      this.quota.checkSiteQuota(userId),
    ]);
    return { articles, sites };
  }

  /**
   * POST /api/billing/subscribe
   * Body: { userId, planId, cycle, userEmail, userName, userPhone? }
   * Response: { token, iframeUrl }
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
    const userIp = (req.headers['x-forwarded-for'] as string)?.split(',')[0]
      ?? req.socket.remoteAddress
      ?? '127.0.0.1';

    return this.paytr.createPaymentToken({ ...body, userIp });
  }

  /** POST /api/billing/users/:userId/cancel */
  @Post('users/:userId/cancel')
  cancel(@Param('userId') userId: string) {
    return this.paytr.cancelSubscription(userId);
  }

  /**
   * POST /api/billing/webhooks/paytr
   * Response: "OK" string (PayTR handshake)
   */
  @Post('webhooks/paytr')
  @HttpCode(200)
  async webhook(@Body() body: any) {
    return this.paytr.handleWebhook(body);
  }
}
