import { BadRequestException, Body, Controller, ForbiddenException, Get, Headers, Param, Patch, Post, Query, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { encode } from 'next-auth/jwt';
import { createHash } from 'node:crypto';
import { OAuth2Client } from 'google-auth-library';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { Public } from './public.decorator.js';
import { AuthService } from './auth.service.js';
import { GscOAuthService } from './gsc-oauth.service.js';
import { GaOAuthService } from './ga-oauth.service.js';
import { EmailService } from '../email/email.service.js';
import { PrismaService } from '../prisma/prisma.service.js';

// AuthGuard Bearer branch ile aynı → üretilen token doğrudan Authorization: Bearer olarak geçerli
const SESSION_SALT = 'authjs.session-token';
const SESSION_MAX_AGE = 30 * 24 * 60 * 60;

// Native mobil giriş — token'lar doğrudan Google/Apple'dan gelir, sunucuda imza+audience doğrulanır (phishing yok)
const googleClient = new OAuth2Client();
const APPLE_JWKS = createRemoteJWKSet(new URL('https://appleid.apple.com/auth/keys'));

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly gsc: GscOAuthService,
    private readonly ga: GaOAuthService,
    private readonly email: EmailService,
    private readonly prisma: PrismaService,
  ) {}

  /** Session JWT üret — AuthGuard Bearer branch ile birebir simetrik. */
  private async mintSessionToken(userId: string): Promise<string> {
    const secret = process.env.NEXTAUTH_SECRET ?? process.env.AUTH_SECRET ?? '';
    if (!secret) throw new BadRequestException('Sunucu yapılandırma hatası');
    return encode({ token: { sub: userId }, secret, salt: SESSION_SALT, maxAge: SESSION_MAX_AGE });
  }

  /**
   * OAuth kullanıcısını çöz: önce (provider, sub) bağlı hesaptan, yoksa e-posta ile eşle/oluştur
   * ve hesabı bağla. Apple ilk girişten sonra e-posta göndermez → o durumda (provider, sub) yeter.
   * Web'deki NextAuth signIn callback (apps/web/src/auth.ts) ile aynı kullanıcı alanları.
   */
  private async resolveOAuthUser(input: {
    provider: 'google' | 'apple';
    sub: string;
    email?: string | null;
    name?: string | null;
    image?: string | null;
  }) {
    const { provider, sub } = input;
    const email = input.email?.toLowerCase().trim() || null;

    const acct = await this.prisma.account.findUnique({
      where: { provider_providerAccountId: { provider, providerAccountId: sub } },
    });
    if (acct) {
      const linked = await this.prisma.user.findUnique({ where: { id: acct.userId } });
      if (linked) return linked;
    }

    if (!email) {
      throw new BadRequestException('Hesap bulunamadı. Girişte e-posta paylaşımına izin verin.');
    }

    let user = await this.prisma.user.findUnique({ where: { email } });
    if (!user) {
      user = await this.prisma.user.create({
        data: { email, name: input.name ?? null, image: input.image ?? null, emailVerified: new Date() },
      });
    }
    await this.prisma.account.upsert({
      where: { provider_providerAccountId: { provider, providerAccountId: sub } },
      create: { userId: user.id, type: 'oauth', provider, providerAccountId: sub },
      update: {},
    });
    return user;
  }

  /**
   * POST /api/auth/mobile/google  { idToken }
   * Native Google Sign-In'den gelen ID token'ı Google'ın public key'leriyle doğrular
   * (imza + iss + audience = bizim client ID'lerimiz), kullanıcıyı çözer, session JWT döner.
   */
  @Public()
  @Post('mobile/google')
  async mobileGoogle(@Body() body: { idToken?: string }) {
    const idToken = body?.idToken?.trim();
    if (!idToken) throw new BadRequestException('idToken gerekli');

    const audience = [
      process.env.GOOGLE_IOS_CLIENT_ID,
      process.env.GOOGLE_ANDROID_CLIENT_ID,
      process.env.GOOGLE_WEB_CLIENT_ID,
    ].filter((v): v is string => !!v);
    if (audience.length === 0) throw new BadRequestException('Google giriş yapılandırılmamış');

    let ticket;
    try {
      ticket = await googleClient.verifyIdToken({ idToken, audience });
    } catch {
      throw new BadRequestException('Google token doğrulanamadı');
    }
    const payload = ticket.getPayload();
    if (!payload?.sub) throw new BadRequestException('Google token geçersiz');
    if (payload.email && payload.email_verified === false) {
      throw new BadRequestException('Google e-postası doğrulanmamış');
    }

    const user = await this.resolveOAuthUser({
      provider: 'google',
      sub: payload.sub,
      email: payload.email,
      name: payload.name,
      image: payload.picture,
    });
    return { token: await this.mintSessionToken(user.id) };
  }

  /**
   * POST /api/auth/mobile/apple  { identityToken, rawNonce, email?, fullName? }
   * expo-apple-authentication'dan gelen identity token'ı Apple JWKS ile doğrular
   * (imza + iss + audience = bundle ID) ve nonce replay'ini engeller (SHA256(rawNonce) === token.nonce).
   * email/fullName yalnızca İLK girişte gelir; sonrakiler (provider, sub) ile çözülür.
   */
  @Public()
  @Post('mobile/apple')
  async mobileApple(@Body() body: { identityToken?: string; rawNonce?: string; fullName?: string }) {
    const identityToken = body?.identityToken?.trim();
    if (!identityToken) throw new BadRequestException('identityToken gerekli');

    const audience = process.env.APPLE_IOS_BUNDLE_ID;
    if (!audience) throw new BadRequestException('Apple giriş yapılandırılmamış');

    let payload: Record<string, unknown>;
    try {
      const res = await jwtVerify(identityToken, APPLE_JWKS, { issuer: 'https://appleid.apple.com', audience });
      payload = res.payload as Record<string, unknown>;
    } catch {
      throw new BadRequestException('Apple token doğrulanamadı');
    }
    if (typeof payload.sub !== 'string') throw new BadRequestException('Apple token geçersiz');

    // Replay koruması: uygulama Apple'a SHA256(rawNonce) verdi; token.nonce buna eşit olmalı
    if (typeof payload.nonce === 'string') {
      const rawNonce = body?.rawNonce?.trim();
      if (!rawNonce) throw new BadRequestException('nonce eksik');
      const hashed = createHash('sha256').update(rawNonce).digest('hex');
      if (hashed !== payload.nonce) throw new BadRequestException('nonce eşleşmiyor');
    }

    // GÜVENLİK: kimlik/eşleşme YALNIZCA doğrulanmış token'dan. body.email ASLA kullanılmaz —
    // Apple ilk giriş sonrası email göndermez; body'ye güvenmek hesap ele geçirmeye açar.
    const emailVerified = payload.email_verified === true || payload.email_verified === 'true';
    const email = typeof payload.email === 'string' && emailVerified ? payload.email : undefined;
    const user = await this.resolveOAuthUser({
      provider: 'apple',
      sub: payload.sub,
      email,
      name: typeof body?.fullName === 'string' ? body.fullName : undefined, // yalnızca yeni kullanıcıda görünen ad
    });
    return { token: await this.mintSessionToken(user.id) };
  }

  private sanitizeOauthError(err: unknown): string {
    const fallback = 'Bağlantı tamamlanamadı. Lütfen tekrar dene.';
    if (!err) return fallback;
    const raw = typeof err === 'string'
      ? err
      : ((err as any)?.message as string | undefined);
    if (!raw) return fallback;
    return raw.replace(/\s+/g, ' ').trim().slice(0, 220);
  }

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
    try {
      const result = await this.gsc.handleCallback(code, state);
      return res.redirect(`${process.env.WEB_BASE_URL}/sites/${result.siteId}?tab=settings&step=gsc&gsc=connected`);
    } catch (err) {
      const msg = encodeURIComponent(this.sanitizeOauthError(err));
      const safeState = encodeURIComponent(state ?? '');
      return res.redirect(`${process.env.WEB_BASE_URL}/sites/${safeState}?tab=settings&step=gsc&gsc=error&gscerror=${msg}`);
    }
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
    try {
      const result = await this.ga.handleCallback(code, state);
      return res.redirect(`${process.env.WEB_BASE_URL}/sites/${result.siteId}?tab=settings&step=ga4&ga=connected`);
    } catch (err) {
      const msg = encodeURIComponent(this.sanitizeOauthError(err));
      const safeState = encodeURIComponent(state ?? '');
      return res.redirect(`${process.env.WEB_BASE_URL}/sites/${safeState}?tab=settings&step=ga4&ga=error&gaerror=${msg}`);
    }
  }

  @Post('ga/disconnect')
  async disconnectGa(@Body() body: { siteId: string }) {
    return this.ga.disconnect(body.siteId);
  }
}
