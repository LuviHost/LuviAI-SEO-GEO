import { BadRequestException, Body, Controller, Delete, ForbiddenException, Get, HttpException, Logger, Param, Post, Query, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { Throttle } from '@nestjs/throttler';
import { Public } from '../auth/public.decorator.js';
import { SessionOnly } from '../auth/session-only.decorator.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { clientIp } from '../common/client-ip.js';
import { assertSiteAccess } from '../auth/site-access.js';
import { readSessionUserId } from '../auth/session-cookie.js';
import {
  OAuthFlowError, issueOAuthState, oauthErrorCode, oauthHttpError, resolveOAuthCallback, resolveParkedFinish, type OAuthStateRecord,
} from '../auth/oauth-state.js';
import { GbpService } from './gbp.service.js';

/**
 * Google Isletme Profili uclari.
 *  - /sites/:siteId/gbp/*  : panel (SiteAccessGuard :siteId sahipligini dogrular)
 *  - /gbp/oauth/*          : Google OAuth (business.manage) — GSC akisiyla ayni guvenlik (oauth-state.ts)
 *  - /public/gbp/*         : ucretsiz "Google Isletme karnesi" (Turnstile + IP gunluk siniri + harcama tavani)
 */
@Controller()
export class GbpController {
  private readonly log = new Logger(GbpController.name);

  constructor(private readonly svc: GbpService, private readonly prisma: PrismaService) {}

  // ─── Panel ──────────────────────────────────────────────────

  @Get('sites/:siteId/gbp')
  durum(@Param('siteId') siteId: string) {
    return this.svc.durum(siteId);
  }

  @Post('sites/:siteId/gbp/ara')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  ara(@Body() body: { sorgu?: string }) {
    return this.svc.ara(String(body?.sorgu ?? ''));
  }

  @Post('sites/:siteId/gbp/place')
  placeBagla(@Param('siteId') siteId: string, @Body() body: { placeId?: string }) {
    return this.svc.placeBagla(siteId, String(body?.placeId ?? ''));
  }

  @Delete('sites/:siteId/gbp/place')
  placeKaldir(@Param('siteId') siteId: string) {
    return this.svc.placeKaldir(siteId);
  }

  @Post('sites/:siteId/gbp/denetim')
  @Throttle({ default: { limit: 6, ttl: 60_000 } })
  denetle(@Param('siteId') siteId: string) {
    return this.svc.denetle(siteId);
  }

  @Get('sites/:siteId/gbp/konumlar')
  konumlar(@Param('siteId') siteId: string) {
    return this.svc.konumListesi(siteId);
  }

  @Post('sites/:siteId/gbp/konum')
  konumSec(@Param('siteId') siteId: string, @Body() body: { hesap?: string; konum?: string }) {
    return this.svc.konumSec(siteId, String(body?.hesap ?? ''), String(body?.konum ?? ''));
  }

  @Get('sites/:siteId/gbp/yorumlar')
  yorumlar(@Param('siteId') siteId: string, @Query('sayfa') sayfa?: string) {
    return this.svc.yorumListesi(siteId, sayfa || undefined);
  }

  @Post('sites/:siteId/gbp/yorumlar/:reviewId/taslak')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  taslak(@Param('siteId') siteId: string, @Param('reviewId') reviewId: string) {
    return this.svc.yanitTaslagi(siteId, reviewId);
  }

  @Post('sites/:siteId/gbp/yorumlar/:reviewId/yanit')
  yanit(@Param('siteId') siteId: string, @Param('reviewId') reviewId: string, @Body() body: { metin?: string }) {
    return this.svc.yanitGonder(siteId, reviewId, String(body?.metin ?? ''));
  }

  @Get('sites/:siteId/gbp/gonderiler')
  gonderiler(@Param('siteId') siteId: string) {
    return this.svc.gonderiListesi(siteId);
  }

  @Post('sites/:siteId/gbp/gonderiler')
  gonderiOlustur(@Param('siteId') siteId: string, @Body() body: { metin?: string; url?: string | null }) {
    return this.svc.gonderiOlustur(siteId, body ?? {});
  }

  @Get('sites/:siteId/gbp/performans')
  performans(@Param('siteId') siteId: string) {
    return this.svc.performansOzeti(siteId);
  }

  // ─── OAuth (GBP API onayi sonrasi) ─────────────────────────────

  /** GET /api/gbp/oauth/start?siteId= → { url } */
  @Get('gbp/oauth/start')
  async oauthBaslat(@Query('siteId') siteId: string, @Req() req: Request) {
    const user = (req as any).user;
    const site = await assertSiteAccess(this.prisma, user, siteId);
    const state = await issueOAuthState(this.prisma, { userId: user.id, siteId: site.id, provider: 'gbp' });
    return { url: this.svc.yetkiUrl(state) };
  }

  @Public()
  @Get('gbp/oauth/callback')
  async oauthDonus(
    @Query('code') code: string, @Query('state') state: string, @Query('error') error: string | undefined,
    @Req() req: Request, @Res() res: Response,
  ) {
    const web = process.env.WEB_BASE_URL ?? '';
    res.setHeader('Cache-Control', 'no-store');
    let record: OAuthStateRecord | undefined;
    try {
      const outcome = await resolveOAuthCallback(this.prisma, 'gbp', { code, state, error }, await readSessionUserId(req));
      record = outcome.record;
      if (outcome.kind === 'park') return res.redirect(`${web}${this.sayfa(record.siteId)}?gbp=finish&k=${outcome.key}`);
      await this.kayitErisimi(record);
      await this.svc.baglantiTamamla(record.siteId, outcome.code);
      return res.redirect(`${web}${this.sayfa(record.siteId)}?gbp=connected`);
    } catch (err) {
      const kod = oauthErrorCode(err);
      if (err instanceof OAuthFlowError) this.log.warn(`gbp OAuth reddedildi: ${kod}`);
      else this.log.error(`gbp OAuth beklenmeyen hata: ${String((err as any)?.message ?? err).slice(0, 200)}`);
      const rec = err instanceof OAuthFlowError ? err.record ?? (kod === 'session_mismatch' || kod === 'site_access_denied' ? undefined : record) : record;
      return res.redirect(`${web}${rec ? this.sayfa(rec.siteId) : '/dashboard'}?gbp=error&gbperror=${kod}`);
    }
  }

  /** Oturum callback'te okunamadiysa panel tamamlar (GSC ile ayni) */
  @SessionOnly()
  @Post('gbp/oauth/finish')
  async oauthBitir(@Body() body: { key?: string }, @Req() req: Request) {
    const user = (req as any).user;
    if (!user?.id) throw new ForbiddenException('Oturum gerekli');
    try {
      const { record, code } = await resolveParkedFinish(this.prisma, 'gbp', body?.key, user.id);
      try { await assertSiteAccess(this.prisma, user, record.siteId); } catch { throw new OAuthFlowError('site_access_denied'); }
      await this.svc.baglantiTamamla(record.siteId, code);
      return { ok: true, siteId: record.siteId };
    } catch (err) {
      if (!(err instanceof OAuthFlowError)) this.log.error(`gbp finish beklenmeyen hata: ${String((err as any)?.message ?? err).slice(0, 200)}`);
      throw oauthHttpError(err, 'gbp');
    }
  }

  @SessionOnly()
  @Post('gbp/oauth/disconnect')
  async oauthKes(@Body() body: { siteId?: string }, @Req() req: Request) {
    const site = await assertSiteAccess(this.prisma, (req as any).user, body?.siteId);
    return this.svc.baglantiKes(site.id);
  }

  private sayfa(siteId: string): string {
    return `/sites/${encodeURIComponent(siteId)}/google-isletme`;
  }

  private async kayitErisimi(record: OAuthStateRecord): Promise<void> {
    const owner = await this.prisma.user.findUnique({ where: { id: record.userId }, select: { id: true, role: true, deletionRequestedAt: true } });
    if (owner?.deletionRequestedAt) throw new OAuthFlowError('site_access_denied');
    try { await assertSiteAccess(this.prisma, owner, record.siteId); } catch { throw new OAuthFlowError('site_access_denied'); }
  }

  // ─── Herkese acik karne ───────────────────────────────────────

  /** POST /api/public/gbp/ara { sorgu, turnstileToken } → en fazla 5 aday */
  @Public()
  @Throttle({ default: { limit: 6, ttl: 60_000 } })
  @Post('public/gbp/ara')
  async publicAra(@Body() body: { sorgu?: string; turnstileToken?: string }, @Req() req: Request) {
    const ip = clientIp(req);
    await this.turnstile(body?.turnstileToken, ip);
    await this.svc.publicHakKontrol(ip, true);
    return this.hataSar(() => this.svc.ara(String(body?.sorgu ?? ''), true));
  }

  /** POST /api/public/gbp/karne { placeId, turnstileToken } → denetim sonucu (saklanmaz) */
  @Public()
  @Throttle({ default: { limit: 6, ttl: 60_000 } })
  @Post('public/gbp/karne')
  async publicKarne(@Body() body: { placeId?: string; turnstileToken?: string }, @Req() req: Request) {
    const ip = clientIp(req);
    await this.turnstile(body?.turnstileToken, ip);
    await this.svc.publicHakKontrol(ip, true);
    return this.hataSar(() => this.svc.publicKarne(String(body?.placeId ?? '')));
  }

  /** Turnstile (TURNSTILE_SECRET tanimliysa zorunlu) — ucretsiz AI testiyle ayni kural */
  private async turnstile(token: string | undefined, ip: string): Promise<void> {
    const secret = process.env.TURNSTILE_SECRET;
    if (!secret) return;
    let ok = false;
    if (token) {
      try {
        const form = new URLSearchParams({ secret, response: token });
        if (ip) form.append('remoteip', ip);
        const r = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
          method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: form.toString(),
        });
        ok = !!((await r.json()) as { success?: boolean }).success;
      } catch (e: any) {
        this.log.warn(`Turnstile dogrulama hatasi: ${e?.message}`);
      }
    }
    if (!ok) throw new BadRequestException('Güvenlik doğrulaması tamamlanamadı; sayfayı yenileyip tekrar deneyin.');
  }

  /** Beklenmeyen hata istemciye ham gitmesin */
  private async hataSar<T>(f: () => Promise<T>): Promise<T> {
    try {
      return await f();
    } catch (e) {
      if (e instanceof HttpException) throw e;
      this.log.error(`public gbp hata: ${String((e as any)?.message ?? e).slice(0, 200)}`);
      throw new BadRequestException('İşlem tamamlanamadı; biraz sonra tekrar deneyin.');
    }
  }
}
