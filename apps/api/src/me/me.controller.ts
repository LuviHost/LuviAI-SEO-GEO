import { Controller, Get, Req, UnauthorizedException } from '@nestjs/common';
import type { Request } from 'express';
import { AdminService } from '../admin/admin.service.js';

/**
 * /api/me/* — login olmuş kullanıcının kendi datası.
 * AuthGuard global olduğu için req.user dolu.
 */
@Controller('me')
export class MeController {
  constructor(private readonly admin: AdminService) {}

  @Get()
  whoami(@Req() req: Request) {
    const user = (req as any).user;
    if (!user) throw new UnauthorizedException();
    return {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      plan: user.plan,
      subscriptionStatus: user.subscriptionStatus,
      trialEndsAt: user.trialEndsAt,
      articlesUsedThisMonth: user.articlesUsedThisMonth,
    };
  }

  @Get('dashboard')
  dashboard(@Req() req: Request) {
    const user = (req as any).user;
    if (!user) throw new UnauthorizedException();
    return this.admin.getMyDashboard(user.id);
  }
}
