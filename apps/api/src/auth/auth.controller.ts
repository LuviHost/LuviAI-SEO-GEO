import { Body, Controller, Get, Post, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { AuthService } from './auth.service.js';
import { GscOAuthService } from './gsc-oauth.service.js';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly gsc: GscOAuthService,
  ) {}

  /** GET /api/auth/gsc/start?siteId=xxx → Google OAuth consent URL üret */
  @Get('gsc/start')
  async startGscOAuth(@Query('siteId') siteId: string) {
    return { url: await this.gsc.buildAuthorizationUrl(siteId) };
  }

  /** GET /api/auth/gsc/callback?code=...&state=... */
  @Get('gsc/callback')
  async gscCallback(
    @Query('code') code: string,
    @Query('state') state: string,
    @Res() res: Response,
  ) {
    const result = await this.gsc.handleCallback(code, state);
    return res.redirect(`${process.env.WEB_BASE_URL}/sites/${result.siteId}/settings?gsc=connected`);
  }

  /** POST /api/auth/gsc/disconnect */
  @Post('gsc/disconnect')
  async disconnectGsc(@Body() body: { siteId: string }) {
    return this.gsc.disconnect(body.siteId);
  }
}
