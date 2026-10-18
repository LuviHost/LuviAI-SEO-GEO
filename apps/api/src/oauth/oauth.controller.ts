import { BadRequestException, Body, Controller, ForbiddenException, Get, Logger, NotFoundException, Post, Query, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { PrismaService } from '../prisma/prisma.service.js';
import { OAuthService } from './oauth.service.js';
import { googleAdsOAuthClient } from '../ads/google-ads-api.js';
import { Public } from '../auth/public.decorator.js';
import { SessionOnly } from '../auth/session-only.decorator.js';
import { readSessionUserId } from '../auth/session-cookie.js';
import { SITE_NOT_FOUND_MESSAGE } from '../auth/site-access.guard.js';
import { isCanonicalSiteId } from '../common/site-id.js';
import {
  issueOAuthState, resolveOAuthCallback, resolveParkedFinish, oauthErrorCode, oauthErrorMessage, oauthHttpError,
  OAuthFlowError, type OAuthStateRecord,
} from '../auth/oauth-state.js';
import { encrypt } from '@luviai/shared';
import { GoogleAdsSelectDto, MetaAdsSelectDto, OAuthFinishDto } from './oauth.dto.js';

type AdsProvider = 'google-ads' | 'meta-ads';

/**
 * /api/oauth/* — Reklam hesabi popup-baglama akisi.
 *
 * Akis:
 *   1. Frontend → GET /oauth/<provider>/start?siteId=X      (auth gerekli)
 *      → Sahiplik + tek kullanimlik sunucu state'i (auth/oauth-state.ts), frontend popup acar
 *   2. Provider → GET /oauth/<provider>/callback?code=X&state=Y   (Public)
 *      → State tuketilir (siteId YALNIZCA kayittan). Tarayici oturumu okunuyorsa
 *        akisi baslatanla ayni olmali → token DB'ye, 'oauth-success' postMessage.
 *        Okunamiyorsa kod park edilir → 'oauth-pending' postMessage, panel
 *        POST /oauth/<provider>/finish ile oturumlu tamamlar.
 *   3. (Multi-account) Frontend → GET /oauth/<provider>/options?siteId=X
 *      → Bagli token ile erisilebilen Customer/Ad Account/Page listesi
 *   4. Frontend → POST /oauth/<provider>/select  body:{...}
 *      → Kullanici sectigi customer/page'i kaydet
 */
@Controller('oauth')
export class OAuthController {
  private readonly log = new Logger(OAuthController.name);

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
    const state = await issueOAuthState(this.prisma, { userId: user.id, siteId, provider: 'google-ads' });
    return { url: this.oauth.buildGoogleAdsAuthUrl(state) };
  }

  @Public()
  @Get('google-ads/callback')
  async callbackGoogleAds(
    @Query('code') code: string,
    @Query('state') state: string,
    @Query('error') error: string | undefined,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    return this.popupCallback('google-ads', { code, state, error }, req, res);
  }

  /** POST /oauth/google-ads/finish { key } — 'oauth-pending' mesajindan sonra panel cagirir */
  @SessionOnly()
  @Post('google-ads/finish')
  async finishGoogleAds(@Body() body: OAuthFinishDto, @Req() req: Request) {
    return this.finishParked('google-ads', body?.key, req);
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

    // Liste alinamazsa (API surumu, erisim seviyesi vb.) neden de doner; panel
    // bunu "bu hesapta reklam hesabi yok" diye gostermesin
    const { customers, error } = await this.oauth.listGoogleAdsCustomersDetailed(accessToken);
    return { customers, current: site.googleAdsCustomerId, ...(error ? { customersError: error } : {}) };
  }

  /**
   * POST /oauth/google-ads/select  body:{customerId}
   * Yalniz panel oturumu: reklam otopilotunun ve butce kaydiricinin yonettigi
   * Google Ads hesabini degistirir (ajans token'i birden cok musteriye erisir).
   * /oauth scope haritasinda yok; isaretsizken her ':write' anahtari geciyordu.
   */
  @SessionOnly()
  @Post('google-ads/select')
  async selectGoogleAds(
    @Query('siteId') siteId: string,
    @Body() body: GoogleAdsSelectDto,
    @Req() req: Request,
  ) {
    const user = (req as any).user;
    if (!user) throw new ForbiddenException('Auth required');
    await this.assertSiteOwnership(siteId, user.id);

    // Pipe atlanirsa (ic cagri) da yalniz dize yazilir
    const customerId = typeof body?.customerId === 'string' ? body.customerId.trim() : '';
    if (!customerId) throw new BadRequestException('customerId zorunlu');
    await this.prisma.site.update({
      where: { id: siteId },
      data: { googleAdsCustomerId: customerId },
      select: { id: true },
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
    const state = await issueOAuthState(this.prisma, { userId: user.id, siteId, provider: 'meta-ads' });
    return { url: this.oauth.buildMetaAuthUrl(state) };
  }

  @Public()
  @Get('meta-ads/callback')
  async callbackMetaAds(
    @Query('code') code: string,
    @Query('state') state: string,
    @Query('error') error: string | undefined,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    // error_description sayfaya basilmaz (yansitilan metin) — sabit Turkce mesaj
    return this.popupCallback('meta-ads', { code, state, error }, req, res);
  }

  /** POST /oauth/meta-ads/finish { key } */
  @SessionOnly()
  @Post('meta-ads/finish')
  async finishMetaAds(@Body() body: OAuthFinishDto, @Req() req: Request) {
    return this.finishParked('meta-ads', body?.key, req);
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

    // Izin denetimi gelmeden once kurulmus baglantilarda reklam izinleri
    // reddedilmis olabilir: liste o zaman sessizce bos donup "aktif reklam
    // hesabi bulunamadi" derdi. Eksik izin KESINSE durust hata; liste
    // okunamazsa (gecici Graph hatasi) eskisi gibi devam.
    const missing = await this.oauth.missingMetaPermissionsFor(token);
    if (missing && missing.length > 0) {
      throw oauthHttpError(new OAuthFlowError('scope_not_granted', undefined, missing.join(',')), 'meta-ads');
    }

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

  /** Yalniz panel oturumu — google-ads/select ile ayni gerekce (reklam hesabi + sayfa secimi) */
  @SessionOnly()
  @Post('meta-ads/select')
  async selectMetaAds(
    @Query('siteId') siteId: string,
    @Body() body: MetaAdsSelectDto,
    @Req() req: Request,
  ) {
    const user = (req as any).user;
    if (!user) throw new ForbiddenException('Auth required');
    await this.assertSiteOwnership(siteId, user.id);

    // Yalniz dize kabul — govdeden gelen nesne Prisma'ya islem olarak gitmesin
    const pick = (v: unknown): string | null | undefined => (v === undefined ? undefined : (typeof v === 'string' && v) || null);
    const data: { metaAdsAccountId?: string | null; metaPageId?: string | null; metaInstagramActorId?: string | null } = {};
    const adAccountId = pick(body?.adAccountId);
    const pageId = pick(body?.pageId);
    const instagramActorId = pick(body?.instagramActorId);
    if (adAccountId !== undefined) data.metaAdsAccountId = adAccountId;
    if (pageId !== undefined) data.metaPageId = pageId;
    if (instagramActorId !== undefined) data.metaInstagramActorId = instagramActorId;

    await this.prisma.site.update({ where: { id: siteId }, data, select: { id: true } });
    return { ok: true };
  }

  // ──────────────────────────────────────────────────────────
  //  META — Deauthorize + Data Deletion webhook'lari (App Review zorunlu)
  // ──────────────────────────────────────────────────────────

  /**
   * POST /api/oauth/meta-ads/deauthorize
   * Kullanici Meta'da app yetkisini cekince Meta bu URL'i HTTPS POST ile cagirir.
   * Body: signed_request (form-urlencoded). Tokeni temizler, baglantiyi kopar.
   * Response: 200 OK (Meta sadece status bekliyor).
   */
  // Govde bilerek DTO degil: Meta'nin form govdesine alan eklemesi whitelist
  // ile 400 dondurur ve webhook sessizce bozulurdu. Tek okunan alan
  // signed_request ve o HMAC ile dogrulaniyor; govde Prisma'ya gitmiyor.
  @Public()
  @Post('meta-ads/deauthorize')
  async metaDeauthorize(@Body() body: any, @Res() res: Response) {
    try {
      const signed = body?.signed_request;
      if (!signed) {
        res.status(400).json({ ok: false, error: 'signed_request eksik' });
        return;
      }
      const data = this.oauth.parseMetaSignedRequest(signed);
      // Meta user_id ile eslesen tum site kayitlarinda Meta tokenlarini temizle.
      // user_id Meta'nin App-Scoped User ID'si — biz bunu Site uzerinde tutmuyoruz,
      // bu yuzden tum site'larda token'i null'lamak yerine token suresi dolmus gibi
      // davraniyoruz. Pratik: deauth event'i logla, sonraki API call 401 doninca
      // zaten temizlenecek. Yine de log + audit trail.
      // TODO: Eger SocialIdentity tablosunda metaUserId tutuluyorsa, oradan eslesen siteleri bul.
      console.warn(`[meta-deauthorize] user_id=${data.user_id} issued_at=${data.issued_at}`);
      res.status(200).json({ ok: true });
    } catch (err: any) {
      res.status(400).json({ ok: false, error: err.message });
    }
  }

  /**
   * POST /api/oauth/meta-ads/data-deletion
   * Kullanici Facebook hesabindan veri silme talep edince Meta bu URL'i cagirir.
   * Format: signed_request POST.
   * Response (zorunlu format): { url, confirmation_code }
   */
  @Public()
  @Post('meta-ads/data-deletion')
  async metaDataDeletion(@Body() body: any, @Res() res: Response) {
    try {
      const signed = body?.signed_request;
      if (!signed) {
        res.status(400).json({ error: 'signed_request eksik' });
        return;
      }
      const data = this.oauth.parseMetaSignedRequest(signed);
      const response = this.oauth.buildMetaDataDeletionResponse(data.user_id);
      // TODO: Bu user_id ile eslesen tum kullanici verisini kuyruga at (async sil).
      console.warn(`[meta-data-deletion] user_id=${data.user_id} code=${response.confirmation_code}`);
      res.status(200).json(response);
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  }

  // ──────────────────────────────────────────────────────────
  //  Yardimcilar
  // ──────────────────────────────────────────────────────────

  private async assertSiteOwnership(siteId: unknown, userId: string): Promise<void> {
    // siteId tanimsizken Prisma filtreyi YOK sayar ve kullanicinin herhangi bir sitesini dondururdu
    if (typeof siteId !== 'string' || !siteId) throw new BadRequestException('siteId gerekli');
    // KANONIK KIMLIK (common/site-id.ts): harmanlama 'CMSQ..' / sonu bosluklu
    // yazimi ayni satira esler ve findFirst onu kabul ediyordu. Handler'lar
    // sonra HAM parametreyi kullaniyor: start OAuth state kaydina, select ve
    // options sorgularina varyant yaziliyordu. SiteAccessGuard ile ayni iki
    // kapi: kurala uymayan kimlik DB'ye gitmeden 404, bulunan satir birebir
    // ayni kimlikte degilse yine 404.
    if (!isCanonicalSiteId(siteId)) throw new NotFoundException(SITE_NOT_FOUND_MESSAGE);
    const site = await this.prisma.site.findFirst({ where: { id: siteId, userId }, select: { id: true } });
    if (!site) throw new ForbiddenException('Site sana ait değil');
    if (site.id !== siteId) throw new NotFoundException(SITE_NOT_FOUND_MESSAGE);
  }

  /** Akisi baslatan kullanici siteye HALA sahip mi (10 dk icinde devredilmis/silinmis olabilir) */
  private async assertRecordOwnership(record: OAuthStateRecord): Promise<void> {
    // Akis baslatildiktan sonra hesap silme istendiyse reklam token'i saklanmaz:
    // silme talebi siteyi PAUSED yapip Google Ads/Meta token'larini siler
    // (me/account-deletion.service.ts freezeAccountData); gec donen callback
    // onlari geri yazardi. auth.controller assertRecordAccess ile ayni kural.
    const owner = await this.prisma.user.findUnique({
      where: { id: record.userId },
      select: { deletionRequestedAt: true },
    });
    if (owner?.deletionRequestedAt) throw new OAuthFlowError('site_access_denied');
    try {
      await this.assertSiteOwnership(record.siteId, record.userId);
    } catch {
      throw new OAuthFlowError('site_access_denied');
    }
  }

  private async popupCallback(
    provider: AdsProvider,
    q: { code?: unknown; state?: unknown; error?: unknown },
    req: Request,
    res: Response,
  ) {
    res.setHeader('Cross-Origin-Opener-Policy', 'unsafe-none');
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    try {
      const outcome = await resolveOAuthCallback(this.prisma, provider, q, await readSessionUserId(req));
      if (outcome.kind === 'park') {
        return res.send(this.oauth.buildCallbackHtml(provider, null, undefined, { pendingKey: outcome.key }));
      }
      await this.assertRecordOwnership(outcome.record);
      const data = await this.complete(provider, outcome.record.siteId, outcome.code);
      return res.send(this.oauth.buildCallbackHtml(provider, data));
    } catch (err) {
      const code = oauthErrorCode(err);
      if (err instanceof OAuthFlowError) this.log.warn(`${provider} OAuth callback reddedildi: ${code}`);
      else this.log.error(`${provider} OAuth callback beklenmeyen hata: ${String((err as any)?.message ?? err).slice(0, 200)}`);
      // Ham hata (saglayici govdesi, istek parametresi) sayfaya basilmaz — yalniz koda bagli sabit metin
      return res.send(this.oauth.buildCallbackHtml(provider, null, oauthErrorMessage(code, provider)));
    }
  }

  private async finishParked(provider: AdsProvider, key: unknown, req: Request) {
    const user = (req as any).user;
    if (!user?.id) throw new ForbiddenException('Auth required');
    try {
      const { record, code } = await resolveParkedFinish(this.prisma, provider, key, user.id);
      await this.assertRecordOwnership(record);
      return await this.complete(provider, record.siteId, code);
    } catch (err) {
      if (!(err instanceof OAuthFlowError)) {
        this.log.error(`${provider} OAuth finish beklenmeyen hata: ${String((err as any)?.message ?? err).slice(0, 200)}`);
      }
      throw oauthHttpError(err, provider);
    }
  }

  private complete(provider: AdsProvider, siteId: string, code: string) {
    return provider === 'google-ads' ? this.completeGoogleAds(siteId, code) : this.completeMetaAds(siteId, code);
  }

  private async completeGoogleAds(siteId: string, code: string) {
    const tokens = await this.oauth.exchangeGoogleCode(code);
    const { customers, error: customersError } = await this.oauth.listGoogleAdsCustomersDetailed(tokens.access_token);

    // Refresh token'i hemen kaydet
    const updateData: any = {
      googleAdsRefreshToken: encrypt(tokens.refresh_token),
      googleAdsConnectedAt: new Date(),
    };
    // Tek hesap varsa otomatik sec
    if (customers.length === 1) updateData.googleAdsCustomerId = customers[0].id;

    await this.prisma.site.update({ where: { id: siteId }, data: updateData });
    return { autoSelected: customers.length === 1, customers, ...(customersError ? { customersError } : {}) };
  }

  private async completeMetaAds(siteId: string, code: string) {
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

    await this.prisma.site.update({ where: { id: siteId }, data: updateData });
    return { autoSelected: adAccounts.length === 1 && pages.length === 1, adAccounts, pages };
  }

  /**
   * Refresh token kullanarak fresh access token al (Google).
   */
  private async refreshGoogleAccessToken(encryptedRefresh: string): Promise<string | null> {
    const { decrypt } = await import('@luviai/shared');
    let refresh: string;
    try { refresh = decrypt(encryptedRefresh); } catch { refresh = encryptedRefresh; }

    // Baglanti akisi ve Ads istemcisiyle AYNI OAuth istemcisi (google-ads-api.ts)
    const { clientId, clientSecret } = googleAdsOAuthClient();
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
