import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { QuotaService } from './quota.service.js';
import { PLAN_FEATURE_KEY } from './plan-feature.decorator.js';
import type { PlanFeature } from './plans.js';

/**
 * `@RequiresPlan('productRadar')` ile isaretli rotalarda plan kapisini dayatir.
 *
 * Global AuthGuard'dan SONRA calisir; req.user tam User satiridir, plan alani
 * orada oldugu icin ek DB sorgusu yapmayiz.
 *
 * ADMIN muaftir — destek/hata ayiklama icin her ucu calistirabilmeli.
 */
@Injectable()
export class PlanFeatureGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly quota: QuotaService,
  ) {}

  canActivate(ctx: ExecutionContext): boolean {
    const feature = this.reflector.getAllAndOverride<PlanFeature>(PLAN_FEATURE_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (!feature) return true;

    const req = ctx.switchToHttp().getRequest<Request & { user?: { role?: string; plan?: string } }>();
    const user = req.user;
    // AuthGuard zaten 401 atmis olmali; burada tekrar atmiyoruz.
    if (!user?.plan) return true;
    if (user.role === 'ADMIN') return true;

    this.quota.assertPlanFeature(user.plan, feature);
    return true;
  }
}
