import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { AffiliateService } from './affiliate.service.js';

@Controller('affiliate')
export class AffiliateController {
  constructor(private readonly affiliate: AffiliateService) {}

  /** POST /affiliate/enroll */
  @Post('enroll')
  enroll(@Body() body: { userId: string }) {
    return this.affiliate.enroll(body.userId);
  }

  /** GET /affiliate/users/:userId/stats */
  @Get('users/:userId/stats')
  stats(@Param('userId') userId: string) {
    return this.affiliate.getStats(userId);
  }

  /** GET /affiliate/check/:refCode — landing page validation */
  @Get('check/:refCode')
  check(@Param('refCode') refCode: string) {
    return this.affiliate.trackClick(refCode);
  }
}
