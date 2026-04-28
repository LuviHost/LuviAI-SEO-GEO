import { Body, Controller, ForbiddenException, Get, Param, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { Public } from '../auth/public.decorator.js';
import { AffiliateService } from './affiliate.service.js';

function ensureSelf(req: Request, requestedUserId: string) {
  const user = (req as any).user;
  if (!user) throw new ForbiddenException('Auth required');
  if (user.role === 'ADMIN') return user;
  if (user.id !== requestedUserId) throw new ForbiddenException('Bu kullanıcının verisine erişim yok');
}

@Controller('affiliate')
export class AffiliateController {
  constructor(private readonly affiliate: AffiliateService) {}

  @Post('enroll')
  enroll(@Req() req: Request, @Body() body: { userId: string }) {
    ensureSelf(req, body.userId);
    return this.affiliate.enroll(body.userId);
  }

  @Get('users/:userId/stats')
  stats(@Req() req: Request, @Param('userId') userId: string) {
    ensureSelf(req, userId);
    return this.affiliate.getStats(userId);
  }

  /** Public — landing page'de referral kodu doğrulama (cookie'ye yazmak için) */
  @Public()
  @Get('check/:refCode')
  check(@Param('refCode') refCode: string) {
    return this.affiliate.trackClick(refCode);
  }
}
