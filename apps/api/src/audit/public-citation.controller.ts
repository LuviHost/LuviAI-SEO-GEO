import { Body, Controller, Get, HttpException, HttpStatus, Logger, Post, Query, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { Public } from '../auth/public.decorator.js';
import { PublicCitationService, type PublicCheckResult } from './public-citation.service.js';
import { PublicCitationSubscriberService } from './public-citation-subscriber.service.js';

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
      const webUrl = process.env.WEB_URL ?? 'https://ai.luvihost.com';
      return res.redirect(`${webUrl}/?citation_confirmed=${encodeURIComponent(r.domain)}`);
    } catch (err: any) {
      const webUrl = process.env.WEB_URL ?? 'https://ai.luvihost.com';
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
      const webUrl = process.env.WEB_URL ?? 'https://ai.luvihost.com';
      return res.redirect(`${webUrl}/?citation_unsubscribed=${encodeURIComponent(r.domain)}`);
    } catch (err: any) {
      const webUrl = process.env.WEB_URL ?? 'https://ai.luvihost.com';
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
