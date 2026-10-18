import { BadRequestException, Body, Controller, Delete, Get, Param, Patch, Post, Put, Req, UnauthorizedException } from '@nestjs/common';
import type { Request } from 'express';
import { assertResolvesPublic, assertPublicUrl } from '../common/safe-fetch.js';
import { SessionOnly } from '../auth/session-only.decorator.js';
import { SitesService, SITE_SECRET_FIELDS } from './sites.service.js';
import { assertSiteUrlAllowed } from './site-url-policy.js';
import {
  CreateSiteDto, DetectNicheDto, GaPropertyDto, GscPropertyDto, SetCompetitorsDto, SiteAutopilotDto, SiteWebhookDto,
  UpdateSiteDto,
} from './sites.dto.js';
import { GscOAuthService } from '../auth/gsc-oauth.service.js';
import { GaOAuthService } from '../auth/ga-oauth.service.js';
import { PlatformDetectorService } from './platform-detector.service.js';
import { NicheDetectorService } from './niche-detector.service.js';
import { DemoSeederService } from './demo-seeder.service.js';
import { PrismaService } from '../prisma/prisma.service.js';

function ensureUser(req: Request) {
  const user = (req as any).user;
  if (!user) throw new UnauthorizedException();
  return user as { id: string; role: 'USER' | 'ADMIN' | 'AGENCY_OWNER' };
}

/** Rakip ogesindeki dize listesi: yalniz dizeler, ogeler ve liste sinirli */
function stringList(v: unknown): string[] | undefined {
  if (!Array.isArray(v)) return undefined;
  return v.filter((x): x is string => typeof x === 'string').map((x) => x.slice(0, 300)).slice(0, 20);
}

@Controller('sites')
export class SitesController {
  constructor(
    private readonly sites: SitesService,
    private readonly gsc: GscOAuthService,
    private readonly ga: GaOAuthService,
    private readonly platformDetector: PlatformDetectorService,
    private readonly nicheDetector: NicheDetectorService,
    private readonly demoSeeder: DemoSeederService,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * POST /sites/detect-niche — URL'den AI ile niş tespit (onboarding'de kullanılır).
   * Site kaydindaki ayni adres kurali: bu uc da sunucudan istek attirir (ve
   * uye akisinda headless Chrome acabilir), ic ag adresi kabul edilmez.
   */
  @Post('detect-niche')
  async detectNiche(@Body() body: DetectNicheDto) {
    if (!body?.url) return { error: 'url required' };
    const checked = await assertSiteUrlAllowed(body.url, this.sites.urlResolver);
    return this.nicheDetector.detectFromUrl(checked.toString(), 'member');
  }

  @Post()
  create(@Req() req: Request, @Body() dto: CreateSiteDto) {
    const user = ensureUser(req);
    return this.sites.create(user.id, dto);
  }

  /** POST /sites/demo — yeni kullaniciya demo site + 5 makale + audit + AI snapshot */
  @Post('demo')
  async createDemo(@Req() req: Request) {
    const user = ensureUser(req);
    return this.demoSeeder.createDemoSiteForUser(user.id);
  }

  @Get()
  list(@Req() req: Request) {
    const user = ensureUser(req);
    return this.sites.list(user);
  }

  /**
   * crawlAccess: son tarama denemesinde anasayfa okunamadiysa nedeni + cozumu
   * (yoksa null). Panel "Erisim engellendi" durumunu buradan cizer — puan
   * uretilmedigi icin bu bilgi Audit satirinda yok.
   */
  @Get(':id')
  async get(@Req() req: Request, @Param('id') id: string) {
    const site = await this.sites.findOne(id, ensureUser(req));
    return { ...site, crawlAccess: await this.sites.getCrawlAccess(id) };
  }

  @Patch(':id')
  update(@Req() req: Request, @Param('id') id: string, @Body() dto: UpdateSiteDto) {
    return this.sites.update(id, dto, ensureUser(req));
  }

  @Delete(':id')
  remove(@Req() req: Request, @Param('id') id: string) {
    return this.sites.remove(id, ensureUser(req));
  }

  /** GET /sites/:id/brain — Brain'i dondurur (Sprint Onboarding 3 — smart prefill) */
  @Get(':id/brain')
  async getBrain(@Req() req: Request, @Param('id') id: string) {
    await this.sites.findOne(id, ensureUser(req));
    return this.prisma.brain.findUnique({ where: { siteId: id } });
  }

  /** POST /sites/:id/brain/regenerate */
  @Post(':id/brain/regenerate')
  regenerateBrain(@Req() req: Request, @Param('id') id: string) {
    return this.sites.regenerateBrain(id, ensureUser(req));
  }

  /** GET /sites/:id/competitors — brain'deki rakip listesi */
  @Get(':id/competitors')
  listCompetitors(@Req() req: Request, @Param('id') id: string) {
    return this.sites.listCompetitors(id, ensureUser(req));
  }

  /** PUT /sites/:id/competitors — tüm rakip listesini değiştir */
  @Put(':id/competitors')
  setCompetitors(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() body: SetCompetitorsDto,
  ) {
    // Ogeler tek tek: yalniz dize alanlar servise gider (servis URL'yi site
    // adresi kuralindan gecirir, ad ve listeleri keser)
    const competitors = (Array.isArray(body?.competitors) ? body.competitors : []).map((c) => ({
      name: typeof c?.name === 'string' ? c.name : '',
      url: typeof c?.url === 'string' ? c.url : '',
      strengths: stringList(c?.strengths),
      weaknesses: stringList(c?.weaknesses),
    }));
    return this.sites.setCompetitors(id, competitors, ensureUser(req));
  }

  /** GET /sites/:id/gsc/properties — kullanicinin erisilebilir GSC property'leri */
  @Get(':id/gsc/properties')
  async listGscProperties(@Req() req: Request, @Param('id') id: string) {
    await this.sites.findOne(id, ensureUser(req));
    return this.gsc.listProperties(id);
  }

  /** PATCH /sites/:id/gsc/property body { propertyUrl } */
  @Patch(':id/gsc/property')
  async setGscProperty(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() body: GscPropertyDto,
  ) {
    await this.sites.findOne(id, ensureUser(req));
    return this.gsc.setProperty(id, body.propertyUrl);
  }

  /** GET /sites/:id/ga/properties — kullanicinin erisilebilir GA4 property'leri */
  @Get(':id/ga/properties')
  async listGaProperties(@Req() req: Request, @Param('id') id: string) {
    await this.sites.findOne(id, ensureUser(req));
    return this.ga.listProperties(id);
  }

  /** PATCH /sites/:id/ga/property body { propertyId } */
  @Patch(':id/ga/property')
  async setGaProperty(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() body: GaPropertyDto,
  ) {
    await this.sites.findOne(id, ensureUser(req));
    return this.ga.setProperty(id, body.propertyId);
  }

  /** POST /sites/:id/detect-platform — manuel platform tespiti */
  @Post(':id/detect-platform')
  async detectPlatform(@Req() req: Request, @Param('id') id: string) {
    const site = await this.sites.findOne(id, ensureUser(req));
    const detection = await this.platformDetector.detect(site.url);
    // Site okunamadiysa (engel, zaman asimi) sonuc bir tahmin degil — onceki
    // tespitin uzerine 'unknown' yazilmaz
    if (detection.unreadable) return detection;
    await this.prisma.site.update({
      where: { id },
      data: {
        platform: detection.platform,
        platformConfidence: detection.confidence,
        platformDetectedAt: new Date(),
      } as any,
    });
    return detection;
  }

  /** PATCH /sites/:id/autopilot body { enabled: boolean } */
  @Patch(':id/autopilot')
  async setAutopilot(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() body: SiteAutopilotDto,
  ) {
    await this.sites.findOne(id, ensureUser(req));
    // Sirlar cevapta yok. Liste sites.service SITE_SECRET_FIELDS'in kendisi:
    // eskiden burada elle tutulan bir kopyasi vardi (SITE_RESPONSE_OMIT); yeni
    // bir sir kolonu eklenip kopya unutulsaydi bu cevap o siri sizdirirdi.
    return this.prisma.site.update({
      where: { id },
      data: { autopilot: body.enabled === true },
      omit: SITE_SECRET_FIELDS,
    });
  }

  /** POST /sites/:id/complete-onboarding — wizard sonu. Site ACTIVE, cron olusturulur. */
  @Post(':id/complete-onboarding')
  async completeOnboarding(@Req() req: Request, @Param('id') id: string) {
    return this.sites.completeOnboarding(id, ensureUser(req));
  }

  /**
   * PATCH /sites/:id/webhook body { url, kind }
   *
   * Yalniz panel oturumuyla: '/sites/:id/webhook' api-keys.service
   * ROUTE_RESOURCE eslesmesinde yok ('webhook' bilinmeyen alt kaynak), AuthGuard
   * bu durumda HERHANGI bir ':write' anahtarini yeterli sayiyordu. Bildirim
   * adresini degistiren, sitenin bildirimlerini (tarayici hatasi, reklam ve
   * takili sayfa olaylari...) kendi adresine akitabilirdi. API anahtari 403
   * alir; SDK ve MCP bu ucu cagirmiyor. (Ingest sirrini yenileme bu dosyada
   * degil, audit.controller live-crawler/rotate-secret'ta.)
   */
  @SessionOnly()
  @Patch(':id/webhook')
  async setWebhook(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() body: SiteWebhookDto,
  ) {
    await this.sites.findOne(id, ensureUser(req));
    const raw = typeof body?.url === 'string' ? body.url.trim() : '';
    if (raw) {
      // Bildirim servisi bu adrese POST atar: ic ag / bulut metadata adresi
      // kaydedilemez. Slack ve Discord webhook'lari https.
      try {
        const u = assertPublicUrl(raw);
        if (u.protocol !== 'https:') throw new Error('https');
        await assertResolvesPublic(raw);
      } catch {
        throw new BadRequestException('Webhook adresi herkese açık bir https:// adresi olmalı (ör. Slack veya Discord webhook bağlantısı).');
      }
    }
    const kind = body?.kind === 'slack' || body?.kind === 'discord' ? body.kind : null;
    return this.prisma.site.update({
      where: { id },
      data: {
        notifyWebhookUrl: raw || null,
        notifyWebhookKind: raw ? kind : null,
      },
      omit: SITE_SECRET_FIELDS,
    });
  }
}
