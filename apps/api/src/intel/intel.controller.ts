import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  Param,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { PrismaService } from '../prisma/prisma.service.js';
import { IntelCollectorService } from './collector.service.js';
import { IntelTriageService } from './triage.service.js';
import { IntelAnalystService, PRODUCT_AREAS } from './analyst.service.js';
import { ClaimLedgerService } from './claim-ledger.service.js';
import { IntelDigestService } from './digest.service.js';
import { XSearchService } from './x-search.service.js';
import { DISABLED_SOURCES } from './source-registry.js';

/**
 * Intel uclari — TAMAMI admin. Bu bir ic arastirma aracidir; musteri
 * yuzeyine acilmaz. Kanit defteri ham haliyle (elenmis yayinlar, hatali
 * kaynaklar, LLM notlari) disari verilecek bir sey degil.
 */

function assertAdmin(req: Request) {
  const user = (req as any).user;
  if (!user) throw new ForbiddenException('Auth required');
  if (user.role !== 'ADMIN') throw new ForbiddenException('Admin only');
  return user;
}

@Controller('intel')
export class IntelController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly collector: IntelCollectorService,
    private readonly triage: IntelTriageService,
    private readonly analyst: IntelAnalystService,
    private readonly ledger: ClaimLedgerService,
    private readonly digest: IntelDigestService,
    private readonly xSearch: XSearchService,
  ) {}

  // ────────────────────────────────────────────────────────────
  //  GENEL DURUM
  // ────────────────────────────────────────────────────────────

  @Get('overview')
  async overview(@Req() req: Request) {
    assertAdmin(req);

    const since7 = new Date(Date.now() - 7 * 86_400_000);
    const [byStatus, byClaimStatus, sources, recentItems, latestDigest, openActions] = await Promise.all([
      this.prisma.intelItem.groupBy({ by: ['status'], _count: true }),
      this.prisma.intelClaim.groupBy({ by: ['status'], _count: true }),
      this.prisma.intelSource.findMany({
        orderBy: [{ enabled: 'desc' }, { tier: 'asc' }, { name: 'asc' }],
        select: {
          id: true, key: true, name: true, kind: true, tier: true, weight: true,
          enabled: true, failCount: true, lastError: true, lastFetchedAt: true,
          intervalHours: true, _count: { select: { items: true } },
        },
      }),
      this.prisma.intelItem.count({ where: { createdAt: { gte: since7 } } }),
      this.digest.latest(),
      this.prisma.intelClaim.count({ where: { actionStatus: 'OPEN', status: { in: ['CONFIRMED', 'MYTH'] } } }),
    ]);

    return {
      items: {
        byStatus: Object.fromEntries(byStatus.map((s) => [s.status, s._count])),
        last7Days: recentItems,
      },
      claims: Object.fromEntries(byClaimStatus.map((s) => [s.status, s._count])),
      openActions,
      sources,
      disabledSources: DISABLED_SOURCES,
      xSearchEnabled: this.xSearch.enabled,
      latestDigest: latestDigest
        ? { id: latestDigest.id, period: latestDigest.period, date: latestDigest.date, emailedAt: latestDigest.emailedAt }
        : null,
      productAreas: PRODUCT_AREAS,
    };
  }

  // ────────────────────────────────────────────────────────────
  //  IDDIA DEFTERI
  // ────────────────────────────────────────────────────────────

  @Get('claims')
  async claims(
    @Req() req: Request,
    @Query('status') status?: string,
    @Query('topic') topic?: string,
    @Query('area') area?: string,
    @Query('limit') limit?: string,
  ) {
    assertAdmin(req);
    return this.ledger.list({
      status: status || undefined,
      topic: topic || undefined,
      area: area || undefined,
      limit: limit ? parseInt(limit, 10) : undefined,
    });
  }

  @Get('claims/:idOrSlug')
  async claim(@Req() req: Request, @Param('idOrSlug') idOrSlug: string) {
    assertAdmin(req);
    const claim = await this.ledger.get(idOrSlug);
    if (!claim) throw new BadRequestException('Iddia bulunamadi');
    return claim;
  }

  @Post('claims/:id/action')
  async setAction(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() body: { actionStatus: string; note?: string },
  ) {
    assertAdmin(req);
    try {
      return await this.ledger.setAction(id, body.actionStatus, body.note);
    } catch (err: any) {
      throw new BadRequestException(err.message);
    }
  }

  // ────────────────────────────────────────────────────────────
  //  HAM KAYITLAR — triage denetimi icin
  // ────────────────────────────────────────────────────────────

  @Get('items')
  async items(
    @Req() req: Request,
    @Query('status') status?: string,
    @Query('limit') limit?: string,
  ) {
    assertAdmin(req);
    return this.prisma.intelItem.findMany({
      where: status ? { status } : undefined,
      orderBy: [{ createdAt: 'desc' }],
      take: Math.min(limit ? parseInt(limit, 10) : 100, 300),
      select: {
        id: true, url: true, title: true, publishedAt: true, status: true,
        relevance: true, topics: true, triageNote: true, engagement: true,
        source: { select: { name: true, tier: true } },
      },
    });
  }

  // ────────────────────────────────────────────────────────────
  //  KAYNAKLAR
  // ────────────────────────────────────────────────────────────

  @Post('sources/sync')
  async syncSources(@Req() req: Request) {
    assertAdmin(req);
    return this.collector.syncCatalog();
  }

  /** Devre disi kalmis kaynagi elle geri acar (hata sayacini sifirlar). */
  @Post('sources/:id/toggle')
  async toggleSource(@Req() req: Request, @Param('id') id: string, @Body() body: { enabled: boolean }) {
    assertAdmin(req);
    return this.prisma.intelSource.update({
      where: { id },
      data: { enabled: !!body.enabled, ...(body.enabled ? { failCount: 0, lastError: null } : {}) },
    });
  }

  /** Tek kaynagi hemen ceker — yeni feed eklendiginde beklemeden test icin. */
  @Post('sources/:id/collect')
  async collectOne(@Req() req: Request, @Param('id') id: string) {
    assertAdmin(req);
    try {
      const newItems = await this.collector.collectSource(id);
      return { ok: true, newItems };
    } catch (err: any) {
      return { ok: false, error: err.message };
    }
  }

  // ────────────────────────────────────────────────────────────
  //  ELLE CALISTIRMA — cron beklemeden boru hattini surmek icin
  // ────────────────────────────────────────────────────────────

  @Post('run/:stage')
  async run(@Req() req: Request, @Param('stage') stage: string) {
    assertAdmin(req);

    switch (stage) {
      case 'collect':
        return this.collector.collectDue();
      case 'triage':
        return this.triage.runPending();
      case 'analyze':
        return this.analyst.runRelevant();
      case 'recompute':
        return this.ledger.recomputeAll();
      default:
        throw new BadRequestException('Gecersiz asama: collect | triage | analyze | recompute');
    }
  }

  // ────────────────────────────────────────────────────────────
  //  OZET
  // ────────────────────────────────────────────────────────────

  @Get('digest/latest')
  async latestDigest(@Req() req: Request, @Query('period') period?: string) {
    assertAdmin(req);
    return this.digest.latest(period || undefined);
  }

  @Get('digest')
  async digests(@Req() req: Request, @Query('limit') limit?: string) {
    assertAdmin(req);
    return this.prisma.intelDigest.findMany({
      orderBy: { date: 'desc' },
      take: Math.min(limit ? parseInt(limit, 10) : 20, 60),
      select: { id: true, period: true, date: true, stats: true, emailedAt: true },
    });
  }

  @Post('digest/build')
  async buildDigest(@Req() req: Request, @Body() body: { period?: string; send?: boolean }) {
    assertAdmin(req);
    const period = body?.period === 'weekly' ? 'weekly' : 'daily';
    return this.digest.build(period, body?.send !== false);
  }
}
