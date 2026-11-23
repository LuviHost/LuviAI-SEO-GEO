import { BadRequestException, Body, Controller, ForbiddenException, Get, Headers, Logger, Post, Query, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { encode } from 'next-auth/jwt';
import { createHash } from 'node:crypto';
import { OAuth2Client } from 'google-auth-library';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { Public } from './public.decorator.js';
import { SessionOnly } from './session-only.decorator.js';
import { AuthService } from './auth.service.js';
import { GscOAuthService } from './gsc-oauth.service.js';
import { GaOAuthService } from './ga-oauth.service.js';
import { EMAIL_NOT_SENT_STATUSES, EmailService } from '../email/email.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { assertSiteAccess } from './site-access.js';
import { readSessionUserId } from './session-cookie.js';
import { AppleSiwaService } from './apple-siwa.service.js';
import { deletedAccountMessage } from '../me/account-deletion.policy.js';
import {
  issueOAuthState, resolveOAuthCallback, resolveParkedFinish, oauthErrorCode, oauthHttpError,
  OAuthFlowError, type OAuthStateRecord,
} from './oauth-state.js';
import { TrialReadOnlyExempt } from '../billing/trial-read-only.decorator.js';

// AuthGuard Bearer branch ile aynı → üretilen token doğrudan Authorization: Bearer olarak geçerli
const SESSION_SALT = 'authjs.session-token';
const SESSION_MAX_AGE = 30 * 24 * 60 * 60;

// Native mobil giriş — token'lar doğrudan Google/Apple'dan gelir, sunucuda imza+audience doğrulanır (phishing yok)
const googleClient = new OAuth2Client();
const APPLE_JWKS = createRemoteJWKSet(new URL('https://appleid.apple.com/auth/keys'));

/**
 * Govde alanini kirpilmis dize olarak okur; dize degilse ''. Bu herkese acik
 * uclarda govde satir ici tiplidir (ValidationPipe denetlemez): sayi/nesne
 * gelince `.trim()` TypeError atiyor ve 500 donuyordu. Dize olmayan deger
 * "eksik" sayilir — mevcut 400 mesajlari aynen gecerli.
 */
export function bodyText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/**
 * Silme talebi olan hesap (30 gunluk kalici silme beklemesinde) giris yapamaz.
 * Mesaj silinme tarihini soyler; uygulama bunu giris ekraninda gosterir.
 */
export function assertNotDeletionRequested(user: { deletionRequestedAt?: Date | null }): void {
  if (user.deletionRequestedAt) throw new ForbiddenException(deletedAccountMessage(user.deletionRequestedAt));
}

// Suresi dolan deneme (salt okunur, TrialExpiryGuard): giris ve Google baglantisini kesme suresi dolan denemede de acik
@TrialReadOnlyExempt()
@Controller('auth')
export class AuthController {
  private readonly logger = new Logger(AuthController.name);

  constructor(
    private readonly auth: AuthService,
    private readonly gsc: GscOAuthService,
    private readonly ga: GaOAuthService,
    private readonly email: EmailService,
    private readonly prisma: PrismaService,
    private readonly apple: AppleSiwaService,
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
      if (linked) {
        assertNotDeletionRequested(linked);
        return linked;
      }
    }

    if (!email) {
      throw new BadRequestException('Hesap bulunamadı. Girişte e-posta paylaşımına izin verin.');
    }

    let user = await this.prisma.user.findUnique({ where: { email } });
    // Silme talebi olan hesaba giris yok — hesap baglanmadan (upsert) ONCE reddedilir
    if (user) assertNotDeletionRequested(user);
    if (!user) {
      user = await this.prisma.user.create({
        data: { email, name: input.name ?? null, image: input.image ?? null, emailVerified: new Date() },
      });
      // Yeni hesap: 14 gunluk deneme kayit aninda baslar (trial-policy.ts). Eskiden hicbir
      // kayit yolu cagirmiyordu; trialEndsAt bos kaliyor, deneme hic bitmiyordu.
      user = await this.auth.ensureTrialStarted(user.id);
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
    const idToken = bodyText(body?.idToken);
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
   * POST /api/auth/mobile/apple  { identityToken, rawNonce, email?, fullName?, authorizationCode? }
   * expo-apple-authentication'dan gelen identity token'ı Apple JWKS ile doğrular
   * (imza + iss + audience = bundle ID) ve nonce replay'ini engeller (SHA256(rawNonce) === token.nonce).
   * email/fullName yalnızca İLK girişte gelir; sonrakiler (provider, sub) ile çözülür.
   * authorizationCode varsa Apple'dan refresh token alınıp şifreli saklanır — hesap
   * silmede Apple token'ı iptal edilebilsin (apple-siwa.service.ts, TN3194).
   */
  @Public()
  @Post('mobile/apple')
  async mobileApple(@Body() body: { identityToken?: string; rawNonce?: string; fullName?: string; authorizationCode?: string }) {
    const identityToken = bodyText(body?.identityToken);
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
      const rawNonce = bodyText(body?.rawNonce);
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
    // Girisi bekletmez ve bozmaz (hata firlatmaz); basarisizsa silmede taze kod yolu kalir
    const code = typeof body?.authorizationCode === 'string' ? body.authorizationCode.trim().slice(0, 1024) : '';
    if (code) void this.apple.captureRefreshToken(payload.sub, code);
    return { token: await this.mintSessionToken(user.id) };
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
    const email = bodyText(body?.email).toLowerCase();
    if (!email) throw new BadRequestException('email gerekli');

    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user) throw new BadRequestException('Kullanici bulunamadi');

    // Emniyet agi: web kaydi trialEndsAt'i kendisi yazar (apps/web/src/auth.ts); yazilmamis
    // eski/eksik kayitta deneme burada baslar. Idempotent, plan ve sayaca dokunmaz.
    await this.auth.ensureTrialStarted(user.id);

    // Daha onceki welcome_day0 maili gonderildi mi? (idempotent)
    // Gonderilmemis kayit (saglayici yok / hata) sayilmaz — yoksa anahtar
    // eksikken yazilan tek kayit karsilama e-postasini kalici olarak engellerdi
    const earlier = await this.prisma.emailLog.findFirst({
      where: { userId: user.id, template: 'welcome_day0', status: { notIn: [...EMAIL_NOT_SENT_STATUSES] } },
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

  // ─── Google OAuth: Search Console + GA4 ────────────────────
  //
  // GUVENLIK (RFC 6749 §10.12, RFC 9700 §2.1 — ayrinti oauth-state.ts):
  //  - start: oturum + site sahipligi; state = tek kullanimlik, 10 dk'lik nonce
  //  - callback: siteId YALNIZCA sunucudaki state kaydindan; kayit ilk kullanimda silinir
  //  - kullanici ajanina baglama: tarayicinin RanksUp oturumu okunabiliyorsa
  //    state'i baslatanla ayni kullanici olmali. Okunamiyorsa (API ayri alan
  //    adindaysa NextAuth cerezi gelmez) kod park edilir; panel oturumlu
  //    /finish istegiyle tamamlar. Saldirganin baslattigi akisi kurbana
  //    tamamlatmak (kurbanin Google verisini saldirganin sitesine baglamak)
  //    iki yolda da reddedilir.
  //  - hata yonlendirmesi saldirgan girdisini (state) yanki yapmaz; yalniz kod.
  //  - sonuc dogrudan Baglantilar sayfasina gider: eski /sites/:id?tab=settings
  //    yonlendirmesi parametreleri dusurup sonucu hic gostermiyordu.

  /** GET /api/auth/gsc/start?siteId=xxx → Google OAuth consent URL üret */
  @Get('gsc/start')
  async startGscOAuth(@Query('siteId') siteId: string, @Req() req: Request) {
    const state = await this.issueGoogleState('gsc', siteId, req);
    return { url: this.gsc.buildAuthorizationUrl(state) };
  }

  /** GET /api/auth/gsc/callback?code=...&state=... — Google'dan donen tarayici yonlendirmesi (public) */
  @Public()
  @Get('gsc/callback')
  async gscCallback(
    @Query('code') code: string,
    @Query('state') state: string,
    @Query('error') error: string | undefined,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    return this.googleCallback('gsc', { code, state, error }, req, res);
  }

  /** POST /api/auth/gsc/finish { key } — oturum callback'te okunamadiysa panel akisi burada tamamlar */
  @SessionOnly()
  @Post('gsc/finish')
  async finishGsc(@Body() body: { key?: string }, @Req() req: Request) {
    return this.finishGoogle('gsc', body?.key, req);
  }

  /** Yalniz panel oturumu: Google token'larini siler (/auth scope haritasinda yok — her ':write' anahtari geciyordu) */
  @SessionOnly()
  @Post('gsc/disconnect')
  async disconnectGsc(@Body() body: { siteId: string }, @Req() req: Request) {
    await assertSiteAccess(this.prisma, (req as any).user, body?.siteId);
    return this.gsc.disconnect(body.siteId);
  }

  // ─── GA4 OAuth ─────────────────────────────────────────────

  /** GET /api/auth/ga/start?siteId=xxx → Google OAuth consent URL üret */
  @Get('ga/start')
  async startGaOAuth(@Query('siteId') siteId: string, @Req() req: Request) {
    const state = await this.issueGoogleState('ga', siteId, req);
    return { url: this.ga.buildAuthorizationUrl(state) };
  }

  @Public()
  @Get('ga/callback')
  async gaCallback(
    @Query('code') code: string,
    @Query('state') state: string,
    @Query('error') error: string | undefined,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    return this.googleCallback('ga', { code, state, error }, req, res);
  }

  /** POST /api/auth/ga/finish { key } */
  @SessionOnly()
  @Post('ga/finish')
  async finishGa(@Body() body: { key?: string }, @Req() req: Request) {
    return this.finishGoogle('ga', body?.key, req);
  }

  /** Yalniz panel oturumu — gsc/disconnect ile ayni gerekce */
  @SessionOnly()
  @Post('ga/disconnect')
  async disconnectGa(@Body() body: { siteId: string }, @Req() req: Request) {
    await assertSiteAccess(this.prisma, (req as any).user, body?.siteId);
    return this.ga.disconnect(body.siteId);
  }

  // ─── Google OAuth yardimcilari ─────────────────────────────

  private googleService(provider: 'gsc' | 'ga') {
    return provider === 'gsc' ? this.gsc : this.ga;
  }

  private connectionsPath(siteId: string): string {
    return `/sites/${encodeURIComponent(siteId)}/connections`;
  }

  private async issueGoogleState(provider: 'gsc' | 'ga', siteId: unknown, req: Request): Promise<string> {
    const user = (req as any).user;
    const site = await assertSiteAccess(this.prisma, user, siteId);
    return issueOAuthState(this.prisma, { userId: user.id, siteId: site.id, provider });
  }

  /** Akisi baslatan kullanici siteye HALA erisebiliyor mu (10 dk icinde site devredilmis/silinmis olabilir) */
  private async assertRecordAccess(record: OAuthStateRecord): Promise<void> {
    const owner = await this.prisma.user.findUnique({
      where: { id: record.userId },
      select: { id: true, role: true, deletionRequestedAt: true },
    });
    // Akis baslatildiktan sonra hesap silme istendiyse yeni Google token'i saklanmaz
    if (owner?.deletionRequestedAt) throw new OAuthFlowError('site_access_denied');
    try {
      await assertSiteAccess(this.prisma, owner, record.siteId);
    } catch {
      throw new OAuthFlowError('site_access_denied');
    }
  }

  private async googleCallback(
    provider: 'gsc' | 'ga',
    q: { code?: unknown; state?: unknown; error?: unknown },
    req: Request,
    res: Response,
  ) {
    const web = process.env.WEB_BASE_URL ?? '';
    res.setHeader('Cache-Control', 'no-store');
    let record: OAuthStateRecord | undefined;
    try {
      const outcome = await resolveOAuthCallback(this.prisma, provider, q, await readSessionUserId(req));
      record = outcome.record;
      if (outcome.kind === 'park') {
        return res.redirect(`${web}${this.connectionsPath(record.siteId)}?${provider}=finish&k=${outcome.key}`);
      }
      await this.assertRecordAccess(record);
      await this.googleService(provider).completeConnection(record.siteId, outcome.code);
      return res.redirect(`${web}${this.connectionsPath(record.siteId)}?${provider}=connected`);
    } catch (err) {
      const code = oauthErrorCode(err);
      if (!(err instanceof OAuthFlowError)) {
        this.logger.error(`${provider} OAuth callback beklenmeyen hata: ${String((err as any)?.message ?? err).slice(0, 200)}`);
      } else {
        this.logger.warn(`${provider} OAuth callback reddedildi: ${code}`);
      }
      // Hedef yalniz sunucudaki kayittan; oturum eslesmezse ya da erisim yoksa siteye degil genel sayfaya
      const rec = err instanceof OAuthFlowError
        ? err.record ?? (code === 'session_mismatch' || code === 'site_access_denied' ? undefined : record)
        : record;
      const target = rec ? this.connectionsPath(rec.siteId) : '/dashboard';
      const errParam = provider === 'gsc' ? 'gscerror' : 'gaerror';
      return res.redirect(`${web}${target}?${provider}=error&${errParam}=${code}`);
    }
  }

  private async finishGoogle(provider: 'gsc' | 'ga', key: unknown, req: Request) {
    const user = (req as any).user;
    if (!user?.id) throw new ForbiddenException('Oturum gerekli');
    try {
      const { record, code } = await resolveParkedFinish(this.prisma, provider, key, user.id);
      try {
        await assertSiteAccess(this.prisma, user, record.siteId);
      } catch {
        throw new OAuthFlowError('site_access_denied');
      }
      await this.googleService(provider).completeConnection(record.siteId, code);
      return { ok: true, siteId: record.siteId };
    } catch (err) {
      if (!(err instanceof OAuthFlowError)) {
        this.logger.error(`${provider} OAuth finish beklenmeyen hata: ${String((err as any)?.message ?? err).slice(0, 200)}`);
      }
      throw oauthHttpError(err, provider);
    }
  }
}
