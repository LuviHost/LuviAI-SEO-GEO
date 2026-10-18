import { BadRequestException, Body, Controller, Get, HttpCode, Post, Req, UnauthorizedException } from '@nestjs/common';
import type { Request } from 'express';
import { AdminService } from '../admin/admin.service.js';
import { entitlementsFor } from '../billing/entitlements.js';
import { SessionOnly } from '../auth/session-only.decorator.js';
import { AccountDeletionService } from './account-deletion.service.js';

/**
 * /api/me/* — login olmuş kullanıcının kendi datası.
 * AuthGuard global olduğu için req.user dolu.
 */
@Controller('me')
export class MeController {
  constructor(
    private readonly admin: AdminService,
    private readonly deletion: AccountDeletionService,
  ) {}

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
      // Ozellik haklari SUNUCUDA hesaplanir. Web'in FEATURE_MIN_PLAN tablosunun
      // bir kopyasini tutmasi gerekmesin — bu oturumda tekrar tekrar duzelttigimiz
      // "iki tablo birbirinden kayiyor" hatasinin ayni sinifi.
      entitlements: entitlementsFor(user.plan),
    };
  }

  @Get('dashboard')
  dashboard(@Req() req: Request) {
    const user = (req as any).user;
    if (!user) throw new UnauthorizedException();
    return this.admin.getMyDashboard(user.id);
  }

  // ─── Hesap silme (Apple 5.1.1(v), KVKK) ────────────────────────
  // Yalniz panel/uygulama oturumu: /me bilinmeyen kaynak oldugu icin herhangi
  // bir ':write' API anahtari mutasyon yapabilirdi; hesap silmek insan karari.

  /** GET /api/me/account-deletion — silme ekrani icin engel/abonelik/Apple durumu */
  @SessionOnly()
  @Get('account-deletion')
  deletionStatus(@Req() req: Request) {
    return this.deletion.status(this.userId(req));
  }

  /**
   * POST /api/me/delete-account { confirm: 'DELETE_MY_ACCOUNT', appleAuthorizationCode? }
   * Erisim hemen kapanir; veriler 30 gun sonra kalici silinir (account-deletion.policy.ts).
   */
  @SessionOnly()
  @Post('delete-account')
  @HttpCode(200)
  deleteAccount(@Req() req: Request, @Body() body: { confirm?: unknown; appleAuthorizationCode?: unknown }) {
    this.requireJson(req);
    return this.deletion.requestDeletion(this.userId(req), body ?? {});
  }

  /** POST /api/me/agency-clients/detach { confirm: true } — silme oncesi musteri hesaplarini ajanstan ayir */
  @SessionOnly()
  @Post('agency-clients/detach')
  @HttpCode(200)
  detachAgencyClients(@Req() req: Request, @Body() body: { confirm?: unknown }) {
    this.requireJson(req);
    return this.deletion.detachAgencyClients(this.userId(req), body?.confirm);
  }

  private userId(req: Request): string {
    const user = (req as any).user;
    if (!user?.id) throw new UnauthorizedException();
    return user.id;
  }

  /**
   * Yikici uclar yalniz JSON govde kabul eder: baska siteden gelen form/text
   * istegi CORS on kontrolune takilmadan gidebilir; JSON zorunlulugu on kontrolu
   * (CORS_ORIGINS) devreye sokar. SameSite=Lax oturum cerezinin ustune ikinci kat.
   */
  private requireJson(req: Request): void {
    if (!req.is('application/json')) throw new BadRequestException('İstek JSON olmalı.');
  }
}
