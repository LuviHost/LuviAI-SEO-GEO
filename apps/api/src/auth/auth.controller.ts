import { BadRequestException, Body, Controller, ForbiddenException, Get, Headers, Param, Patch, Post, Query, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { Public } from './public.decorator.js';
import { AuthService } from './auth.service.js';
import { GscOAuthService } from './gsc-oauth.service.js';
import { GaOAuthService } from './ga-oauth.service.js';
import { EmailService } from '../email/email.service.js';
import { PrismaService } from '../prisma/prisma.service.js';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly gsc: GscOAuthService,
    private readonly ga: GaOAuthService,
    private readonly email: EmailService,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * POST /api/auth/welcome-hook
   * Web (NextAuth) tarafindan yeni kullanici DB'ye yazildiktan sonra
   * fire-and-forget cagrilir. Internal-key ile auth (cookie/JWT degil).
   * Body: { email }
   */
  @Public()
  @Post('welcome-hook')
  async welcomeHook(
    @Headers('x-internal-key') headerKey: string | undefined,
    @Body() body: { email?: string },
  ) {
    const expected = process.env.INTERNAL_API_KEY ?? process.env.NEXTAUTH_SECRET ?? process.env.AUTH_SECRET ?? '';
    if (!expected || !headerKey || headerKey !== expected) {
      throw new ForbiddenException('Internal key gecersiz');
    }
    const email = body?.email?.trim().toLowerCase();
    if (!email) throw new BadRequestException('email gerekli');

    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user) throw new BadRequestException('Kullanici bulunamadi');

    // Daha onceki welcome_day0 maili gonderildi mi? (idempotent)
    const earlier = await this.prisma.emailLog.findFirst({
      where: { userId: user.id, template: 'welcome_day0' },
      select: { id: true },
    });
    if (earlier) {
      return { ok: true, skipped: 'already-sent' };
    }

    const result = await this.email.send({
      userId: user.id,
      to: user.email,
      template: 'welcome_day0',
      data: { name: user.name ?? 'kullanici' },
    });
    return result;
  }

  /** GET /api/auth/gsc/start?siteId=xxx → Google OAuth consent URL üret */
  @Get('gsc/start')
  async startGscOAuth(@Query('siteId') siteId: string) {
    return { url: await this.gsc.buildAuthorizationUrl(siteId) };
  }

  /**
   * GET /api/auth/gsc/callback?code=...&state=...
   * Browser'dan gelen Google OAuth redirect — cookie/session yok, public.
   * State token'ı GscOAuthService kendi içinde doğrular.
   */
  @Public()
  @Get('gsc/callback')
  async gscCallback(
    @Query('code') code: string,
    @Query('state') state: string,
    @Res() res: Response,
  ) {
    const result = await this.gsc.handleCallback(code, state);
    return res.redirect(`${process.env.WEB_BASE_URL}/sites/${result.siteId}?step=gsc&gsc=connected`);
  }

  @Post('gsc/disconnect')
  async disconnectGsc(@Body() body: { siteId: string }) {
    return this.gsc.disconnect(body.siteId);
  }

  // ─── GA4 OAuth ─────────────────────────────────────────────

  /** GET /api/auth/ga/start?siteId=xxx → Google OAuth consent URL üret */
  @Get('ga/start')
  async startGaOAuth(@Query('siteId') siteId: string) {
    return { url: await this.ga.buildAuthorizationUrl(siteId) };
  }

  @Public()
  @Get('ga/callback')
  async gaCallback(
    @Query('code') code: string,
    @Query('state') state: string,
    @Res() res: Response,
  ) {
    const result = await this.ga.handleCallback(code, state);
    return res.redirect(`${process.env.WEB_BASE_URL}/sites/${result.siteId}?step=ga4&ga=connected`);
  }

  @Post('ga/disconnect')
  async disconnectGa(@Body() body: { siteId: string }) {
    return this.ga.disconnect(body.siteId);
  }
}
