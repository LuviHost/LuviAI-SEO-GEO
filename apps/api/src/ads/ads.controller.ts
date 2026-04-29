import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { AdGeneratorService } from './ad-generator.service.js';
import { AdImageGeneratorService } from './ad-image-generator.service.js';
import { AudienceBuilderService } from './audience-builder.service.js';
import { CampaignOrchestratorService } from './campaign-orchestrator.service.js';
import { AdsMcpClientService } from './mcp-client.service.js';

@Controller('sites/:siteId/ads')
export class AdsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly adGen: AdGeneratorService,
    private readonly imgGen: AdImageGeneratorService,
    private readonly audience: AudienceBuilderService,
    private readonly orchestrator: CampaignOrchestratorService,
    private readonly mcp: AdsMcpClientService,
  ) {}

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

  /** POST /sites/:siteId/ads/:campaignId/launch — DRAFT'ı MCP araciligiyla canli yayina */
  @Post(':campaignId/launch')
  async launch(@Param('siteId') siteId: string, @Param('campaignId') campaignId: string) {
    const c = await this.prisma.adCampaign.findFirstOrThrow({ where: { id: campaignId, siteId } });
    const site: any = await this.prisma.site.findUniqueOrThrow({ where: { id: siteId } });
    const command = `Bu DRAFT kampanyayi yayina al: ${c.name}, platform: ${c.platform}, butce: ${c.budgetAmount} TL/${c.budgetType}, hedef: ${c.objective}. Tum konfigurasyon DB'de hazir, MCP tool'lari kullanip platform-side kampanya olustur ve external_id dondur.`;
    const result = await this.mcp.runMcpCommand(siteId, command);

    if (result.ok) {
      const idMatch = result.output.match(/campaign[_\s]id[":\s]+([a-zA-Z0-9_-]+)/i);
      await this.prisma.adCampaign.update({
        where: { id: campaignId },
        data: { status: 'ACTIVE', externalId: idMatch?.[1] ?? null },
      });
    }
    return result;
  }

  /** POST /sites/:siteId/ads/:campaignId/pause */
  @Post(':campaignId/pause')
  async pause(@Param('siteId') siteId: string, @Param('campaignId') campaignId: string) {
    const c = await this.prisma.adCampaign.findFirstOrThrow({ where: { id: campaignId, siteId } });
    const result = await this.mcp.runMcpCommand(siteId, `Kampanya ${c.externalId ?? c.name} (${c.platform}) pause et.`);
    await this.prisma.adCampaign.update({ where: { id: campaignId }, data: { status: 'PAUSED' } });
    return result;
  }

  /** POST /sites/:siteId/ads/mcp/ping — MCP endpoint healthcheck */
  @Post('mcp/ping')
  ping(@Param('siteId') siteId: string) {
    return this.mcp.ping(siteId);
  }

  /** POST /sites/:siteId/ads/mcp/run — manuel komut */
  @Post('mcp/run')
  runMcp(@Param('siteId') siteId: string, @Body() body: { command: string }) {
    return this.mcp.runMcpCommand(siteId, body.command);
  }

  /** PATCH /sites/:siteId/ads/settings — MCP endpoint + token + autopilot */
  @Patch('settings')
  async updateSettings(
    @Param('siteId') siteId: string,
    @Body() body: { adsMcpEndpoint?: string; adsMcpToken?: string; adsAutopilot?: boolean },
  ) {
    return this.prisma.site.update({
      where: { id: siteId },
      data: body as any,
    });
  }
}
