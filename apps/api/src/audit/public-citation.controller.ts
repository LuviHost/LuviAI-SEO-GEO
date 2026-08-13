import { Body, Controller, Get, HttpException, HttpStatus, Logger, Post, Query, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { Public } from '../auth/public.decorator.js';
import { PublicCitationService, type PublicCheckResult } from './public-citation.service.js';
import { PublicCitationSubscriberService } from './public-citation-subscriber.service.js';
import { QuotaService } from '../billing/quota.service.js';

interface PublicCheckBody {
  domain: string;
  /** Cloudflare Turnstile token (env-gated — TURNSTILE_SECRET set ise zorunlu) */
  turnstileToken?: string;
}

interface SubscribeBody {
  email: string;
  domain: string;
  brand: string;
  niche?: string;
  customNiche?: string;
  locale?: string;
  consent: boolean;
}

/**
 * Landing page — anonim AI citation checker
 *
 *   POST /api/v1/public/citation-check
 *   Body: { domain: "kobipratik.com", turnstileToken?: "..." }
 *
 * Abuse koruma katmanlari:
 *   1. UA bot blok (curl, python-requests, scrapy, bot/spider)
 *   2. Cloudflare Turnstile verify (env'de TURNSTILE_SECRET varsa)
 *   3. PublicCitationService icindeki IP rate limit + 24h cache
 */
@Controller('public')
export class PublicCitationController {
  private readonly log = new Logger(PublicCitationController.name);

  constructor(
    private readonly citation: PublicCitationService,
    private readonly subscribers: PublicCitationSubscriberService,
    private readonly quota: QuotaService,
  ) {}

  @Public()
  @Post('citation-check')
  async check(@Req() req: Request, @Body() body: PublicCheckBody): Promise<PublicCheckResult> {
    // 1) Bot UA blok
    const ua = (req.headers['user-agent'] ?? '').toString().toLowerCase();
    if (this.isObviousBot(ua)) {
      throw new HttpException('Bot tespit edildi', HttpStatus.FORBIDDEN);
    }

    // 2) Turnstile (env-gated)
    const turnstileSecret = process.env.TURNSTILE_SECRET;
    if (turnstileSecret) {
      const ok = await this.verifyTurnstile(body.turnstileToken, this.extractIp(req), turnstileSecret);
      if (!ok) throw new HttpException('Insan dogrulamasi basarisiz', HttpStatus.FORBIDDEN);
    }

    // 3) Domain validate (servis kendi normalize eder)
    if (!body?.domain || typeof body.domain !== 'string') {
      throw new HttpException('domain alani gerekli', HttpStatus.BAD_REQUEST);
    }

    const ip = this.extractIp(req);
    try {
      return await this.citation.check(body.domain, ip);
    } catch (err: any) {
      if (err.status) throw err;
      this.log.warn(`Public check fail (${body.domain}): ${err.message}`);
      throw new HttpException(err.message || 'Beklenmedik hata', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  @Public()
  @Post('citation-check/rate-limit')
  async rateLimit(@Req() req: Request): Promise<{ ok: boolean; remaining: number; resetIn?: string }> {
    return this.citation.checkRateLimit(this.extractIp(req));
  }

  /**
   * POST /api/v1/public/citation-check/unlock — teaser kilidini acar.
   *
   * @Public DEGIL: giris yapmis kullanici gerekir. Landing'deki teaser 10
   * sorudan yalnizca 2'sini olcer; burasi kalan sorulari da olcer (uye
   * kademesi → Opus 5) ve tam raporu doner.
   *
   * Kotaya tabidir (plan basina aylik citationTests): aksi halde tek hesapla
   * sinirsiz domain acilabilirdi.
   */
  @Post('citation-check/unlock')
  async unlock(@Req() req: Request, @Body() body: { domain?: string }): Promise<PublicCheckResult> {
    const user = (req as any).user as
      | { id: string; role?: string; subscriptionStatus?: string; plan?: string }
      | undefined;
    if (!user?.id) throw new HttpException('Giris gerekli', HttpStatus.UNAUTHORIZED);
    if (!body?.domain || typeof body.domain !== 'string') {
      throw new HttpException('domain alani gerekli', HttpStatus.BAD_REQUEST);
    }

    // ODEME KAPISI — kilit "giris yapmis olmakla" degil SATIN ALMAYLA acilir.
    // Yalnizca giris sarti olsaydi teaser'in satisa itme islevi kalmazdi:
    // herkes ucretsiz hesap acip tam raporu alirdi. subscriptionStatus'un
    // ACTIVE olmasi = PayTR odemesi tamamlanmis demek; TRIAL (kayit olmus
    // ama odememis) BURADA GECMEZ.
    const isAdmin = user.role === 'ADMIN';
    const hasPaid = user.subscriptionStatus === 'ACTIVE';
    if (!isAdmin && !hasPaid) {
      throw new HttpException(
        {
          statusCode: HttpStatus.PAYMENT_REQUIRED,
          code: 'PAYMENT_REQUIRED',
          message: 'Tam raporu acmak icin bir plan satin almalisin.',
        },
        HttpStatus.PAYMENT_REQUIRED,
      );
    }

    await this.quota.enforceCitationQuota(user.id);
    try {
      const result = await this.citation.check(body.domain, this.extractIp(req), 'signup_baseline');
      // Cache'ten donduyse yeni olcum YAPILMADI — kota dusulmez. Aksi halde
      // sayfayi yenilemek her seferinde hak yakardi.
      if (!result.fromCache) await this.quota.incrementCitationUsage(user.id);
      return result;
    } catch (err: any) {
      if (err.status) throw err;
      this.log.warn(`Unlock fail (${body.domain}): ${err.message}`);
      throw new HttpException(err.message || 'Beklenmedik hata', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  /** Domain icin son N snapshot — dashboard delta gosterimi icin */
  @Public()
  @Get('citation-check/history')
  async history(@Query('domain') domain: string, @Query('limit') limit?: string) {
    if (!domain) throw new HttpException('domain query param gerekli', HttpStatus.BAD_REQUEST);
    return this.citation.getHistory(domain, limit ? Math.min(50, parseInt(limit, 10)) : 12);
  }

  /** Email-based retest abonelik baslat (double-opt-in) */
  @Public()
  @Post('citation-check/subscribe')
  async subscribe(@Body() body: SubscribeBody): Promise<{ ok: true; status: string; alreadyActive: boolean }> {
    if (!body?.consent) {
      throw new HttpException('Aboneligi onaylamak icin checkbox tikli olmali', HttpStatus.BAD_REQUEST);
    }
    return this.subscribers.subscribe({
      email: body.email,
      domain: body.domain,
      brand: body.brand,
      niche: body.niche,
      customNiche: body.customNiche,
      locale: body.locale,
    });
  }

  /** Double-opt-in confirm — welcome email'deki linkten gelir */
  @Public()
  @Get('citation-check/confirm')
  async confirm(@Query('token') token: string, @Res() res: Response) {
    if (!token) throw new HttpException('token gerekli', HttpStatus.BAD_REQUEST);
    try {
      const r = await this.subscribers.confirm(token);
      const webUrl = process.env.WEB_URL ?? 'https://ranksup.ai';
      return res.redirect(`${webUrl}/?citation_confirmed=${encodeURIComponent(r.domain)}`);
    } catch (err: any) {
      const webUrl = process.env.WEB_URL ?? 'https://ranksup.ai';
      return res.redirect(`${webUrl}/?citation_confirm_error=${encodeURIComponent(err.message ?? 'error')}`);
    }
  }

  /** Internal: OAuth signup callback'ten cagrilir, ziyaretci -> user attribution kur */
  @Public()
  @Post('citation-check/link-signup')
  async linkSignup(@Req() req: Request, @Body() body: { userId: string; email: string }) {
    const internalKey = req.headers['x-internal-key'];
    const expected = process.env.INTERNAL_API_KEY ?? process.env.NEXTAUTH_SECRET;
    if (!expected || internalKey !== expected) {
      throw new HttpException('forbidden', HttpStatus.FORBIDDEN);
    }
    if (!body?.userId || !body?.email) {
      throw new HttpException('userId + email gerekli', HttpStatus.BAD_REQUEST);
    }
    return this.subscribers.linkSignup(body.userId, body.email);
  }

  /** Aboneligi iptal — email'deki linkten gelir */
  @Public()
  @Get('citation-check/unsubscribe')
  async unsubscribe(@Query('token') token: string, @Res() res: Response) {
    if (!token) throw new HttpException('token gerekli', HttpStatus.BAD_REQUEST);
    try {
      const r = await this.subscribers.unsubscribe(token);
      const webUrl = process.env.WEB_URL ?? 'https://ranksup.ai';
      return res.redirect(`${webUrl}/?citation_unsubscribed=${encodeURIComponent(r.domain)}`);
    } catch (err: any) {
      const webUrl = process.env.WEB_URL ?? 'https://ranksup.ai';
      return res.redirect(`${webUrl}/?citation_unsubscribe_error=${encodeURIComponent(err.message ?? 'error')}`);
    }
  }

  // ──────────────────────────────────────
  //  HELPERS
  // ──────────────────────────────────────
  private extractIp(req: Request): string {
    const xff = req.headers['x-forwarded-for'];
    if (typeof xff === 'string' && xff.length > 0) return xff.split(',')[0].trim();
    if (Array.isArray(xff) && xff.length > 0) return xff[0];
    const cfIp = req.headers['cf-connecting-ip'];
    if (typeof cfIp === 'string') return cfIp;
    return req.socket?.remoteAddress ?? '';
  }

  private isObviousBot(ua: string): boolean {
    if (!ua || ua.length < 5) return true;
    const botSignals = [
      'curl/', 'wget/', 'python-requests', 'scrapy', 'go-http-client',
      'bot', 'spider', 'crawler', 'gptbot', 'claude-web', 'perplexitybot',
      'lighthouse', 'pagespeed', 'headless',
    ];
    return botSignals.some((s) => ua.includes(s));
  }

  /** Cloudflare Turnstile siteverify endpoint */
  private async verifyTurnstile(token: string | undefined, ip: string, secret: string): Promise<boolean> {
    if (!token) return false;
    try {
      const form = new URLSearchParams();
      form.append('secret', secret);
      form.append('response', token);
      if (ip) form.append('remoteip', ip);
      const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: form.toString(),
      });
      const data = await res.json() as { success?: boolean };
      return !!data.success;
    } catch (err: any) {
      this.log.warn(`Turnstile verify fail: ${err.message}`);
      return false;
    }
  }
}
