import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { AdGeneratorService } from './ad-generator.service.js';
import { AdImageGeneratorService } from './ad-image-generator.service.js';
import { AudienceBuilderService } from './audience-builder.service.js';
import { CampaignOrchestratorService } from './campaign-orchestrator.service.js';
import { AdsClientService } from './ads-client.service.js';
import { AdsAuditService } from './ads-audit.service.js';
import type { Industry, Platform } from './rules/types.js';
import { encrypt } from '@luviai/shared';

@Controller('sites/:siteId/ads')
export class AdsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly adGen: AdGeneratorService,
    private readonly imgGen: AdImageGeneratorService,
    private readonly audience: AudienceBuilderService,
    private readonly orchestrator: CampaignOrchestratorService,
    private readonly adsClient: AdsClientService,
    private readonly adsAudit: AdsAuditService,
  ) {}

  // ─── ADS AUDIT (Kampanya Skoru) ─────────────────────────────
  /** POST /sites/:siteId/ads/audit/run-now?platform=google&industry=saas */
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
    return this.prisma.adCampaign.findMany({
      where: { siteId, ...(status ? { status } : {}) },
      orderBy: { createdAt: 'desc' },
    });
  }

  /** GET /sites/:siteId/ads/campaigns/:id */
  @Get('campaigns/:id')
  get(@Param('siteId') siteId: string, @Param('id') id: string) {
    return this.prisma.adCampaign.findFirst({ where: { id, siteId } });
  }

  /** POST /sites/:siteId/ads/audience — sadece audience onerisi */
  @Post('audience')
  buildAudience(@Param('siteId') siteId: string, @Body() body: any) {
    return this.audience.build(siteId, body);
  }

  /** POST /sites/:siteId/ads/copy — sadece reklam metni varyantlari */
  @Post('copy')
  buildCopy(@Param('siteId') siteId: string, @Body() body: any) {
    return this.adGen.generate(siteId, body);
  }

  /** POST /sites/:siteId/ads/images — 3 format reklam gorseli */
  @Post('images')
  async buildImages(
    @Param('siteId') siteId: string,
    @Body() body: { prompt: string; brandColor?: string; formats?: any[] },
  ) {
    const site: any = await this.prisma.site.findUniqueOrThrow({ where: { id: siteId } });
    const slug = String(site.name).toLowerCase().replace(/\s+/g, '-').slice(0, 30);
    return this.imgGen.generateSet({
      prompt: body.prompt,
      siteSlug: slug,
      formats: body.formats,
      brandColor: body.brandColor,
    });
  }

  /** POST /sites/:siteId/ads/build — TUM kampanya: audience + copy + image + DB + (autoLaunch ise MCP) */
  @Post('build')
  build(@Param('siteId') siteId: string, @Body() body: any) {
    return this.orchestrator.buildCampaign({ ...body, siteId });
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
    @Body() body: { externalId?: string } = {},
  ) {
    const c = await this.prisma.adCampaign.findFirstOrThrow({ where: { id: campaignId, siteId } });
    const externalId = body.externalId ?? c.externalId;

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

  /** POST /sites/:siteId/ads/:campaignId/pause */
  @Post(':campaignId/pause')
  async pause(@Param('siteId') siteId: string, @Param('campaignId') campaignId: string) {
    const c = await this.prisma.adCampaign.findFirstOrThrow({ where: { id: campaignId, siteId } });
    if (c.externalId) {
      await this.adsClient.setStatus(siteId, c.platform as any, c.externalId, true);
    }
    await this.prisma.adCampaign.update({ where: { id: campaignId }, data: { status: 'PAUSED' } });
    return { ok: true };
  }

  /** GET /sites/:siteId/ads/connections — Google + Meta baglanti durumu */
  @Get('connections')
  connections(@Param('siteId') siteId: string) {
    return this.adsClient.getConnectedPlatforms(siteId);
  }

  /** PATCH /sites/:siteId/ads/google-ads — Google Ads OAuth manuel kayit */
  @Patch('google-ads')
  async setGoogleAds(
    @Param('siteId') siteId: string,
    @Body() body: { customerId?: string; refreshToken?: string },
  ) {
    return this.prisma.site.update({
      where: { id: siteId },
      data: {
        googleAdsCustomerId: body.customerId ?? null,
        googleAdsRefreshToken: body.refreshToken ? encrypt(body.refreshToken) : null,
        googleAdsConnectedAt: body.refreshToken ? new Date() : null,
      } as any,
    });
  }

  /** PATCH /sites/:siteId/ads/meta-ads — Meta Ads access token manuel kayit */
  @Patch('meta-ads')
  async setMetaAds(
    @Param('siteId') siteId: string,
    @Body() body: { accountId?: string; accessToken?: string; pageId?: string; instagramActorId?: string },
  ) {
    return this.prisma.site.update({
      where: { id: siteId },
      data: {
        metaAdsAccountId: body.accountId ?? null,
        metaAdsAccessToken: body.accessToken ? encrypt(body.accessToken) : null,
        metaAdsConnectedAt: body.accessToken ? new Date() : null,
        metaPageId: body.pageId ?? null,
        metaInstagramActorId: body.instagramActorId ?? null,
      } as any,
    });
  }

  /** PATCH /sites/:siteId/ads/settings — autopilot toggle */
  @Patch('settings')
  async updateSettings(
    @Param('siteId') siteId: string,
    @Body() body: { adsAutopilot?: boolean },
  ) {
    return this.prisma.site.update({
      where: { id: siteId },
      data: body as any,
    });
  }
}
