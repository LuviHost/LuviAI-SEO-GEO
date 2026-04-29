import { BadRequestException, Body, Controller, ForbiddenException, Get, Post, Query, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { PrismaService } from '../prisma/prisma.service.js';
import { OAuthService } from './oauth.service.js';
import { Public } from '../auth/public.decorator.js';
import { encrypt } from '@luviai/shared';

/**
 * /api/oauth/* — Reklam hesabi popup-baglama akisi.
 *
 * Akis:
 *   1. Frontend → GET /oauth/<provider>/start?siteId=X      (auth gerekli)
 *      → Imzali state donar, frontend popup acar
 *   2. Provider → GET /oauth/<provider>/callback?code=X&state=Y   (Public)
 *      → State dogrula, code'u token'a cevir, DB'ye yaz, postMessage HTML done
 *   3. (Multi-account) Frontend → GET /oauth/<provider>/options?siteId=X
 *      → Bagli token ile erisilebilen Customer/Ad Account/Page listesi
 *   4. Frontend → POST /oauth/<provider>/select  body:{...}
 *      → Kullanici sectigi customer/page'i kaydet
 */
@Controller('oauth')
export class OAuthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly oauth: OAuthService,
  ) {}

  // ──────────────────────────────────────────────────────────
  //  GOOGLE ADS
  // ──────────────────────────────────────────────────────────

  @Get('google-ads/start')
  async startGoogleAds(@Query('siteId') siteId: string, @Req() req: Request) {
    const user = (req as any).user;
    if (!user) throw new ForbiddenException('Auth required');
    await this.assertSiteOwnership(siteId, user.id);
    const state = this.oauth.signState({ siteId, userId: user.id, provider: 'google-ads' });
    return { url: this.oauth.buildGoogleAdsAuthUrl(state) };
  }

  @Public()
  @Get('google-ads/callback')
  async callbackGoogleAds(
    @Query('code') code: string,
    @Query('state') state: string,
    @Query('error') error: string | undefined,
    @Res() res: Response,
  ) {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    try {
      if (error) throw new BadRequestException(`Google iptal: ${error}`);
      if (!code || !state) throw new BadRequestException('code/state eksik');
      const decoded = this.oauth.verifyState(state);
      if (decoded.provider !== 'google-ads') throw new BadRequestException('Provider uyusmuyor');

      const tokens = await this.oauth.exchangeGoogleCode(code);
      const customers = await this.oauth.listGoogleAdsCustomers(tokens.access_token);

      // Refresh token'i hemen kaydet
      const updateData: any = {
        googleAdsRefreshToken: encrypt(tokens.refresh_token),
        googleAdsConnectedAt: new Date(),
      };

      // Tek hesap varsa otomatik sec
      if (customers.length === 1) {
        updateData.googleAdsCustomerId = customers[0].id;
      }

      await this.prisma.site.update({ where: { id: decoded.siteId }, data: updateData });

      return res.send(this.oauth.buildCallbackHtml('google-ads', {
        autoSelected: customers.length === 1,
        customers,
      }));
    } catch (err: any) {
      return res.send(this.oauth.buildCallbackHtml('google-ads', null, err.message));
    }
  }

  /**
   * GET /oauth/google-ads/options?siteId=X
   * Kullanici birden fazla Google Ads hesabina erisebiliyorsa, secimi UI'a gostermek icin.
   * Mevcut refresh token kullanilarak fresh access token alinir.
   */
  @Get('google-ads/options')
  async optionsGoogleAds(@Query('siteId') siteId: string, @Req() req: Request) {
    const user = (req as any).user;
    if (!user) throw new ForbiddenException('Auth required');
    await this.assertSiteOwnership(siteId, user.id);

    const site: any = await this.prisma.site.findUniqueOrThrow({ where: { id: siteId } });
    if (!site.googleAdsRefreshToken) return { customers: [] };

    // Refresh token ile yeni access token al
    const accessToken = await this.refreshGoogleAccessToken(site.googleAdsRefreshToken);
    if (!accessToken) return { customers: [] };

    const customers = await this.oauth.listGoogleAdsCustomers(accessToken);
    return { customers, current: site.googleAdsCustomerId };
  }

  /**
   * POST /oauth/google-ads/select  body:{customerId}
   */
  @Post('google-ads/select')
  async selectGoogleAds(
    @Query('siteId') siteId: string,
    @Body() body: { customerId: string },
    @Req() req: Request,
  ) {
    const user = (req as any).user;
    if (!user) throw new ForbiddenException('Auth required');
    await this.assertSiteOwnership(siteId, user.id);

    if (!body.customerId) throw new BadRequestException('customerId zorunlu');
    await this.prisma.site.update({
      where: { id: siteId },
      data: { googleAdsCustomerId: body.customerId } as any,
    });
    return { ok: true };
  }

  // ──────────────────────────────────────────────────────────
  //  META ADS
  // ──────────────────────────────────────────────────────────

  @Get('meta-ads/start')
  async startMetaAds(@Query('siteId') siteId: string, @Req() req: Request) {
    const user = (req as any).user;
    if (!user) throw new ForbiddenException('Auth required');
    await this.assertSiteOwnership(siteId, user.id);
    const state = this.oauth.signState({ siteId, userId: user.id, provider: 'meta-ads' });
    return { url: this.oauth.buildMetaAuthUrl(state) };
  }

  @Public()
  @Get('meta-ads/callback')
  async callbackMetaAds(
    @Query('code') code: string,
    @Query('state') state: string,
    @Query('error') error: string | undefined,
    @Query('error_description') errorDesc: string | undefined,
    @Res() res: Response,
  ) {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    try {
      if (error) throw new BadRequestException(`Meta iptal: ${errorDesc ?? error}`);
      if (!code || !state) throw new BadRequestException('code/state eksik');
      const decoded = this.oauth.verifyState(state);
      if (decoded.provider !== 'meta-ads') throw new BadRequestException('Provider uyusmuyor');

      const tokens = await this.oauth.exchangeMetaCode(code);
      const adAccounts = await this.oauth.listMetaAdAccounts(tokens.access_token);
      const pages = await this.oauth.listMetaPages(tokens.access_token);

      const updateData: any = {
        metaAdsAccessToken: encrypt(tokens.access_token),
        metaAdsConnectedAt: new Date(),
      };

      // Tek hesap + tek page → otomatik sec
      if (adAccounts.length === 1) updateData.metaAdsAccountId = adAccounts[0].id;
      if (pages.length === 1) {
        updateData.metaPageId = pages[0].id;
        if (pages[0].instagramId) updateData.metaInstagramActorId = pages[0].instagramId;
      }

      await this.prisma.site.update({ where: { id: decoded.siteId }, data: updateData });

      return res.send(this.oauth.buildCallbackHtml('meta-ads', {
        autoSelected: adAccounts.length === 1 && pages.length === 1,
        adAccounts,
        pages,
      }));
    } catch (err: any) {
      return res.send(this.oauth.buildCallbackHtml('meta-ads', null, err.message));
    }
  }

  @Get('meta-ads/options')
  async optionsMetaAds(@Query('siteId') siteId: string, @Req() req: Request) {
    const user = (req as any).user;
    if (!user) throw new ForbiddenException('Auth required');
    await this.assertSiteOwnership(siteId, user.id);

    const site: any = await this.prisma.site.findUniqueOrThrow({ where: { id: siteId } });
    if (!site.metaAdsAccessToken) return { adAccounts: [], pages: [] };

    const { decrypt } = await import('@luviai/shared');
    let token: string;
    try { token = decrypt(site.metaAdsAccessToken); } catch { token = site.metaAdsAccessToken; }

    const [adAccounts, pages] = await Promise.all([
      this.oauth.listMetaAdAccounts(token),
      this.oauth.listMetaPages(token),
    ]);
    return {
      adAccounts, pages,
      current: {
        adAccountId: site.metaAdsAccountId,
        pageId: site.metaPageId,
        instagramActorId: site.metaInstagramActorId,
      },
    };
  }

  @Post('meta-ads/select')
  async selectMetaAds(
    @Query('siteId') siteId: string,
    @Body() body: { adAccountId?: string; pageId?: string; instagramActorId?: string },
    @Req() req: Request,
  ) {
    const user = (req as any).user;
    if (!user) throw new ForbiddenException('Auth required');
    await this.assertSiteOwnership(siteId, user.id);

    const data: any = {};
    if (body.adAccountId !== undefined) data.metaAdsAccountId = body.adAccountId || null;
    if (body.pageId !== undefined) data.metaPageId = body.pageId || null;
    if (body.instagramActorId !== undefined) data.metaInstagramActorId = body.instagramActorId || null;

    await this.prisma.site.update({ where: { id: siteId }, data });
    return { ok: true };
  }

  // ──────────────────────────────────────────────────────────
  //  Yardimcilar
  // ──────────────────────────────────────────────────────────

  private async assertSiteOwnership(siteId: string, userId: string): Promise<void> {
    const site = await this.prisma.site.findFirst({ where: { id: siteId, userId } });
    if (!site) throw new ForbiddenException('Site sana ait degil');
  }

  /**
   * Refresh token kullanarak fresh access token al (Google).
   */
  private async refreshGoogleAccessToken(encryptedRefresh: string): Promise<string | null> {
    const { decrypt } = await import('@luviai/shared');
    let refresh: string;
    try { refresh = decrypt(encryptedRefresh); } catch { refresh = encryptedRefresh; }

    const clientId = process.env.GOOGLE_CLIENT_ID ?? process.env.GOOGLE_OAUTH_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET ?? process.env.GOOGLE_OAUTH_CLIENT_SECRET;
    if (!clientId || !clientSecret) return null;

    try {
      const res = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: clientId,
          client_secret: clientSecret,
          refresh_token: refresh,
          grant_type: 'refresh_token',
        }),
      });
      if (!res.ok) return null;
      const data = await res.json() as any;
      return data.access_token ?? null;
    } catch {
      return null;
    }
  }
}
