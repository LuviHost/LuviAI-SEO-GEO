import { Body, Controller, Delete, Get, Logger, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { PrismaService } from '../prisma/prisma.service.js';
import { AdsClientService } from './ads-client.service.js';
import { AdsAuditService } from './ads-audit.service.js';
import { adsAutopilotRules } from './budget-guard.js';
import { SiteUserThrottlerGuard, SITE_USER_THROTTLE } from '../audit/site-user-throttler.guard.js';
import type { Industry, Platform } from './rules/types.js';
import { encrypt } from '@luviai/shared';
import { AdsLaunchDto, AdsSettingsDto, GoogleAdsManualDto, MetaAdsManualDto } from './ads-settings.dto.js';
import { fetchMissingMetaPermissions } from '../oauth/meta-permissions.js';
import { OAuthFlowError, oauthHttpError } from '../auth/oauth-state.js';

/** Yanita sifreli token / ingestSecret gibi alanlar girmesin — yalniz baglanti durumu */
const ADS_STATE_SELECT = {
  id: true,
  adsAutopilot: true,
  googleAdsCustomerId: true,
  googleAdsConnectedAt: true,
  metaAdsAccountId: true,
  metaAdsConnectedAt: true,
  metaPageId: true,
  metaInstagramActorId: true,
} as const;

@Controller('sites/:siteId/ads')
export class AdsController {
  private readonly log = new Logger(AdsController.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly adsClient: AdsClientService,
    private readonly adsAudit: AdsAuditService,
  ) {}

  // ─── ADS AUDIT (Kampanya Skoru) ─────────────────────────────
  /**
   * POST /sites/:siteId/ads/audit/run-now?platform=google&industry=saas
   *
   * Tek calistirma LLM ile degerlendirilen her kural icin bir model cagrisi
   * yapar (bugunku kural setinde Google 57, Meta 32). Hakem hatasi duzeltilene kadar bu
   * cagrilar baslamadan dusuyordu; artik gercekten ucretli oldugu icin diger
   * model cagiran rotalardaki site + kullanici tavani burada da var.
   */
  @UseGuards(SiteUserThrottlerGuard)
  @Throttle({ [SITE_USER_THROTTLE]: { limit: 3, ttl: 60 * 60_000 } })
  @Post('audit/run-now')
  async runAudit(
    @Param('siteId') siteId: string,
    @Query('platform') platform: Platform = 'google',
    @Query('industry') industry: Industry = 'saas',
  ) {
    return this.adsAudit.run(siteId, platform, industry);
  }

  /** GET /sites/:siteId/ads/audit/latest?platform=google */
  @Get('audit/latest')
  async getLatestAudit(
    @Param('siteId') siteId: string,
    @Query('platform') platform: Platform = 'google',
  ) {
    return this.adsAudit.getLatest(siteId, platform);
  }

  /** GET /sites/:siteId/ads/campaigns */
  @Get('campaigns')
  list(@Param('siteId') siteId: string, @Query('status') status?: string) {
    // Yalniz dize suzgec (?status[not]=x nesne olur, Prisma'da filtreye donusurdu)
    const s = typeof status === 'string' && status ? status : undefined;
    return this.prisma.adCampaign.findMany({
      where: { siteId, ...(s ? { status: s } : {}) },
      orderBy: { createdAt: 'desc' },
    });
  }

  /** GET /sites/:siteId/ads/campaigns/:id */
  @Get('campaigns/:id')
  get(@Param('siteId') siteId: string, @Param('id') id: string) {
    return this.prisma.adCampaign.findFirst({ where: { id, siteId } });
  }

  /**
   * POST /sites/:siteId/ads/:campaignId/launch
   *
   * Eger campaign'in zaten externalId'si varsa (manuel olarak Ads Manager'da
   * olusturulup ID'si yapistirildiysa) direkt ENABLE eder. Yoksa kullaniciya
   * Ads Manager'da olusturup ID'yi `externalId` field'ina yapistirma talimati doner.
   */
  @Post(':campaignId/launch')
  async launch(
    @Param('siteId') siteId: string,
    @Param('campaignId') campaignId: string,
    @Body() body: AdsLaunchDto = {},
  ) {
    const c = await this.prisma.adCampaign.findFirstOrThrow({ where: { id: campaignId, siteId } });
    // Pipe atlanirsa (ic cagri) da yalniz dize kimlik kullanilir
    const externalId = (typeof body?.externalId === 'string' && body.externalId) || c.externalId;

    if (!externalId) {
      return {
        ok: false,
        error: 'Bu kampanyanin platform tarafinda external_id\'si yok. Once Google Ads / Meta Ads Manager\'da DRAFT konfigurasyonunu kullanarak kampanyayi olustur, sonra ID\'yi externalId alanina yapistirip launch et.',
      };
    }

    const result = await this.adsClient.setStatus(siteId, c.platform as any, externalId, false);

    if (result.ok) {
      await this.prisma.adCampaign.update({
        where: { id: campaignId },
        data: { status: 'ACTIVE', externalId },
      });
    }
    return result;
  }

  /**
   * POST /sites/:siteId/ads/:campaignId/pause
   *
   * Kayit yalniz platform duraklatmayi ONAYLARSA "Duraklatıldı" olur. Eskiden
   * platform cevabi yok sayiliyordu: belirtec suresi dolmus ya da istek
   * reddedilmisse panel duraklatildi derken kampanya harcamaya devam ediyordu.
   */
  @Post(':campaignId/pause')
  async pause(@Param('siteId') siteId: string, @Param('campaignId') campaignId: string) {
    const c = await this.prisma.adCampaign.findFirstOrThrow({ where: { id: campaignId, siteId } });
    if (c.externalId) {
      const res: { ok: boolean; error?: string } = await this.adsClient.setStatus(siteId, c.platform as any, c.externalId, true).catch(() => ({ ok: false }));
      if (!res.ok) {
        // Platformun kesin nedeni (or. Google Ads AB siyasi reklam beyani eksik;
        // google-ads-api.ts googleAdsUserReason) varsa genel metnin sonuna eklenir
        const reason = typeof res.error === 'string' && res.error ? ` Neden: ${res.error}` : '';
        return {
          ok: false,
          error: `Reklam platformu duraklatmayı onaylamadı; kampanya platformda çalışmaya devam ediyor olabilir. Bağlantıyı kontrol edip tekrar dene ya da kampanyayı Google Ads / Meta panelinden duraklat.${reason}`,
        };
      }
    }
    await this.prisma.adCampaign.update({ where: { id: campaignId }, data: { status: 'PAUSED' } });
    return { ok: true };
  }

  /**
   * GET /sites/:siteId/ads/connections — Google + Meta baglanti durumu.
   * autopilotRules: panel otopilot aciklamasindaki sayilari buradan yazar;
   * sahip env ile sinirlari degistirirse metin kendiliginden dogru kalir.
   */
  @Get('connections')
  async connections(@Param('siteId') siteId: string) {
    const platforms = await this.adsClient.getConnectedPlatforms(siteId);
    return { ...platforms, autopilotRules: adsAutopilotRules() };
  }

  /** PATCH /sites/:siteId/ads/google-ads — Google Ads OAuth manuel kayit */
  @Patch('google-ads')
  async setGoogleAds(
    @Param('siteId') siteId: string,
    @Body() body: GoogleAdsManualDto,
  ) {
    return this.prisma.site.update({
      where: { id: siteId },
      data: {
        googleAdsCustomerId: body.customerId ?? null,
        googleAdsRefreshToken: body.refreshToken ? encrypt(body.refreshToken) : null,
        googleAdsConnectedAt: body.refreshToken ? new Date() : null,
      },
      select: ADS_STATE_SELECT,
    });
  }

  /** PATCH /sites/:siteId/ads/meta-ads — Meta Ads access token manuel kayit */
  @Patch('meta-ads')
  async setMetaAds(
    @Param('siteId') siteId: string,
    @Body() body: MetaAdsManualDto,
  ) {
    // Elle verilen token da OAuth akisindaki izin kuralindan gecer: reklam
    // izinleri olmayan token "bagli" yazilmaz (oauth/meta-permissions.ts).
    // Token'siz govde (panelin "Kaldir" dugmesi) baglantiyi temizler, sormaz.
    if (body.accessToken) {
      const missing = await fetchMissingMetaPermissions(body.accessToken, this.log);
      if (missing === null) throw oauthHttpError(new OAuthFlowError('provider_error'), 'meta-ads');
      if (missing.length > 0) {
        throw oauthHttpError(new OAuthFlowError('scope_not_granted', undefined, missing.join(',')), 'meta-ads');
      }
    }
    return this.prisma.site.update({
      where: { id: siteId },
      data: {
        metaAdsAccountId: body.accountId ?? null,
        metaAdsAccessToken: body.accessToken ? encrypt(body.accessToken) : null,
        metaAdsConnectedAt: body.accessToken ? new Date() : null,
        metaPageId: body.pageId ?? null,
        metaInstagramActorId: body.instagramActorId ?? null,
      },
      select: ADS_STATE_SELECT,
    });
  }

  /**
   * DELETE /sites/:siteId/ads/google-ads — Google Ads baglantisini kaldirir (token silinir).
   * PATCH'in token'siz govdesiyle ayni sonuc; ayri DELETE NEDEN: suresi dolan deneme
   * (salt okunur, TrialExpiryGuard) PATCH'i reddeder ama DELETE'i gecirir — hesap
   * baglanti kesemeyip reklam hesabina erisimi acik birakmasin.
   */
  @Delete('google-ads')
  async disconnectGoogleAds(@Param('siteId') siteId: string) {
    return this.prisma.site.update({
      where: { id: siteId },
      data: { googleAdsCustomerId: null, googleAdsRefreshToken: null, googleAdsConnectedAt: null },
      select: ADS_STATE_SELECT,
    });
  }

  /** DELETE /sites/:siteId/ads/meta-ads — Meta Ads baglantisini kaldirir (disconnectGoogleAds ile ayni gerekce) */
  @Delete('meta-ads')
  async disconnectMetaAds(@Param('siteId') siteId: string) {
    return this.prisma.site.update({
      where: { id: siteId },
      data: { metaAdsAccountId: null, metaAdsAccessToken: null, metaAdsConnectedAt: null, metaPageId: null, metaInstagramActorId: null },
      select: ADS_STATE_SELECT,
    });
  }

  /** PATCH /sites/:siteId/ads/settings — autopilot toggle */
  @Patch('settings')
  async updateSettings(
    @Param('siteId') siteId: string,
    @Body() body: AdsSettingsDto,
  ) {
    // Govde ASLA dogrudan Prisma'ya verilmez: yalniz izin verilen alan, tek tek.
    const data: { adsAutopilot?: boolean } = {};
    if (typeof body?.adsAutopilot === 'boolean') data.adsAutopilot = body.adsAutopilot;
    return this.prisma.site.update({
      where: { id: siteId },
      data,
      select: ADS_STATE_SELECT,
    });
  }
}
