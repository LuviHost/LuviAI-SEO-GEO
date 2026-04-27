import { Body, Controller, Get, Post } from '@nestjs/common';
import { BillingService } from './billing.service.js';
import { PaytrService } from './paytr.service.js';

@Controller('billing')
export class BillingController {
  constructor(
    private readonly billing: BillingService,
    private readonly paytr: PaytrService,
  ) {}

  /** GET /billing/plans */
  @Get('plans')
  plans() {
    return this.billing.getPlans();
  }

  /** POST /billing/subscribe */
  @Post('subscribe')
  subscribe(@Body() body: { plan: string; userId: string }) {
    return this.paytr.createSubscription(body.userId, body.plan);
  }

  /** POST /webhooks/paytr/notification */
  @Post('webhooks/paytr')
  webhookHandler(@Body() body: any) {
    return this.paytr.handleWebhook(body);
  }
}
