import { BadRequestException, Body, Controller, Get, NotFoundException, Param, Patch, Post, Query, Req } from '@nestjs/common';
import type { Request } from 'express';
import { PrismaService } from '../../prisma/prisma.service.js';
import { JobQueueService } from '../../jobs/job-queue.service.js';
import { ImageAltSuggestService, IMAGE_ALT_DAILY_CAP, IMAGE_ALT_JOB_BATCH } from './image-alt-suggest.service.js';
import { ImageAltApplyService } from './image-alt-apply.service.js';
import { escapeAttr } from '@luviai/adapters';
import { ALT_HARD_MAX } from './image-alt-prompt.js';

/**
 * Gorsel alt metni — sites/:siteId/audit/images
 * Yol "audit" icerdigi icin API anahtarlarinda audit:read / audit:write
 * kapsami kendiliginden uygulanir; SiteAccessGuard site sahipligini dogrular.
 * Musteri sitesine YAZMA yalnizca /apply ile ve yalnizca KULLANICININ ONAYLADIGI
 * (APPROVED / DECORATIVE) gorseller icin yapilir; MCP/sohbette karsiligi yok.
 */
const DECISIONS = ['approve', 'decorative', 'dismiss', 'reset'] as const;
type Decision = typeof DECISIONS[number];

function userIdOf(req: Request): string | undefined {
  return (req as any).user?.id;
}

@Controller('sites/:siteId/audit/images')
export class ImageAltController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jobQueue: JobQueueService,
    private readonly suggest: ImageAltSuggestService,
    private readonly applier: ImageAltApplyService,
  ) {}

  private async ownRow(siteId: string, id: string) {
    const row = await this.prisma.siteImage.findFirst({ where: { id, siteId } });
    if (!row) throw new NotFoundException('Gorsel bulunamadi');
    return row;
  }

  @Get()
  async list(
    @Param('siteId') siteId: string,
    @Query('status') status?: string,
    @Query('state') state?: string,
    @Query('page') pageStr?: string,
  ) {
    const pageSize = 50;
    const page = Math.max(1, parseInt(pageStr ?? '1', 10) || 1);
    const where: any = { siteId };
    if (status) where.status = { in: status.split(',').map((s) => s.trim()).filter(Boolean) };
    if (state) where.altState = state;
    const [items, total] = await Promise.all([
      this.prisma.siteImage.findMany({
        where,
        orderBy: [{ pageCount: 'desc' }, { lastSeenAt: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.siteImage.count({ where }),
    ]);
    return { items, total, page, pageSize };
  }

  @Get('summary')
  async summary(@Param('siteId') siteId: string) {
    const [byStatus, byState, target, remaining] = await Promise.all([
      this.prisma.siteImage.groupBy({ by: ['status'], where: { siteId }, _count: { _all: true } }),
      this.prisma.siteImage.groupBy({ by: ['altState'], where: { siteId }, _count: { _all: true } }),
      this.prisma.publishTarget.findFirst({
        where: { siteId, isActive: true },
        orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
        select: { type: true },
      }),
      this.suggest.remainingToday(siteId),
    ]);
    const type = String(target?.type ?? '');
    // Yazma yetenegi: WordPress (medya + gonderi), statik dosya hedefleri
    // (HTML yamasi) ya da yalnizca kopyala-yapistir snippet'i.
    const writeCapability = type === 'WORDPRESS_REST' ? 'wordpress'
      : ['FTP', 'SFTP', 'CPANEL_API'].includes(type) ? 'static'
        : 'snippet';
    return {
      byStatus: Object.fromEntries(byStatus.map((r) => [r.status, r._count._all])),
      byAltState: Object.fromEntries(byState.map((r) => [r.altState, r._count._all])),
      writeCapability,
      targetType: type || null,
      suggestionsLeftToday: remaining,
      dailyCap: IMAGE_ALT_DAILY_CAP,
      note: 'Yalnizca sunucunun gonderdigi HTML taranir; JavaScript ile sonradan yuklenen gorseller gorunmez.',
    };
  }

  /** Toplu oneri — kuyruga atilir (25'lik isler). imageIds yoksa all:true ile NEW kayitlar. */
  @Post('suggest')
  async suggestBatch(
    @Param('siteId') siteId: string,
    @Body() body: { imageIds?: string[]; all?: boolean; max?: number },
    @Req() req: Request,
  ) {
    const max = Math.min(100, Math.max(1, Number(body?.max) || 50));
    let ids: string[];
    if (Array.isArray(body?.imageIds) && body.imageIds.length > 0) {
      const rows = await this.prisma.siteImage.findMany({
        where: { siteId, id: { in: body.imageIds.slice(0, 100).map(String) }, status: { notIn: ['APPLYING'] } },
        select: { id: true },
      });
      ids = rows.map((r) => r.id);
    } else if (body?.all) {
      const rows = await this.prisma.siteImage.findMany({
        where: { siteId, status: 'NEW' },
        orderBy: [{ pageCount: 'desc' }],
        take: max,
        select: { id: true },
      });
      ids = rows.map((r) => r.id);
    } else {
      throw new BadRequestException('imageIds ya da all:true gerekli');
    }
    if (ids.length === 0) return { queued: 0, jobIds: [] };

    const room = await this.suggest.remainingToday(siteId);
    if (room <= 0) throw new BadRequestException(`Bugunku oneri tavani doldu (${IMAGE_ALT_DAILY_CAP}). Yarin tekrar dene.`);
    ids = ids.slice(0, Math.min(max, room));

    const site = await this.prisma.site.findUniqueOrThrow({ where: { id: siteId }, select: { userId: true } });
    const userId = userIdOf(req) ?? site.userId;
    const jobIds: string[] = [];
    for (let i = 0; i < ids.length; i += IMAGE_ALT_JOB_BATCH) {
      const job = await this.jobQueue.enqueue({
        type: 'IMAGE_ALT_SUGGEST',
        userId,
        siteId,
        payload: { siteId, userId, imageIds: ids.slice(i, i + IMAGE_ALT_JOB_BATCH) },
        priority: 10,
      });
      jobIds.push(job.dbJobId);
    }
    return { queued: ids.length, jobIds };
  }

  /** Tek gorsel — senkron (kullanici satirdaki "Oner"e basti) */
  @Post(':id/suggest')
  async suggestOne(@Param('siteId') siteId: string, @Param('id') id: string, @Req() req: Request) {
    const row = await this.ownRow(siteId, id);
    if (row.status === 'APPLYING') throw new BadRequestException('Gorsel su anda siteye yaziliyor');
    const { outcomes, capped } = await this.suggest.suggestMany(siteId, [id], userIdOf(req));
    if (capped) throw new BadRequestException(`Bugunku oneri tavani doldu (${IMAGE_ALT_DAILY_CAP}).`);
    return { outcome: outcomes[0] ?? null, image: await this.ownRow(siteId, id) };
  }

  /** Kullanici karari: onayla (duzenlenmis metinle), suslemeye ait, yoksay, sifirla */
  @Patch(':id')
  async decide(
    @Param('siteId') siteId: string,
    @Param('id') id: string,
    @Body() body: { decision?: Decision; approvedAlt?: string },
    @Req() req: Request,
  ) {
    const row = await this.ownRow(siteId, id);
    const decision = body?.decision;
    if (!decision || !DECISIONS.includes(decision)) throw new BadRequestException(`decision: ${DECISIONS.join(' | ')}`);
    if (['APPLYING'].includes(row.status)) throw new BadRequestException('Gorsel su anda siteye yaziliyor');
    const by = userIdOf(req) ?? null;
    const now = new Date();

    let data: any;
    if (decision === 'approve') {
      const alt = String(body.approvedAlt ?? row.suggestedAlt ?? '').replace(/\s+/g, ' ').trim();
      if (!alt) throw new BadRequestException('Onaylanacak alt metni bos — suslemeye ait ise "decorative" sec');
      if (alt.length > ALT_HARD_MAX) throw new BadRequestException(`Alt metni en fazla ${ALT_HARD_MAX} karakter`);
      if (/[<>]/.test(alt)) throw new BadRequestException('Alt metni HTML iceremez');
      data = { status: 'APPROVED', approvedAlt: alt, approvedBy: by, approvedAt: now };
    } else if (decision === 'decorative') {
      data = { status: 'DECORATIVE', approvedAlt: '', approvedBy: by, approvedAt: now };
    } else if (decision === 'dismiss') {
      data = { status: 'DISMISSED', approvedBy: by, approvedAt: now };
    } else {
      data = { status: 'NEW', approvedAlt: null, approvedBy: null, approvedAt: null };
    }
    return this.prisma.siteImage.update({ where: { id: row.id }, data });
  }

  /** Onaylanmis alt metinlerini siteye yaz — kuyruga atilir (25'lik isler) */
  @Post('apply')
  async apply(
    @Param('siteId') siteId: string,
    @Body() body: { imageIds?: string[]; all?: boolean },
    @Req() req: Request,
  ) {
    const where: any = { siteId, status: { in: ['APPROVED', 'DECORATIVE'] } };
    if (Array.isArray(body?.imageIds) && body.imageIds.length > 0) where.id = { in: body.imageIds.slice(0, 100).map(String) };
    else if (!body?.all) throw new BadRequestException('imageIds ya da all:true gerekli');
    const rows = await this.prisma.siteImage.findMany({ where, select: { id: true }, take: 100 });
    if (rows.length === 0) return { queued: 0, jobIds: [] };

    const site = await this.prisma.site.findUniqueOrThrow({ where: { id: siteId }, select: { userId: true } });
    const userId = userIdOf(req) ?? site.userId;
    const ids = rows.map((r) => r.id);
    const jobIds: string[] = [];
    for (let i = 0; i < ids.length; i += IMAGE_ALT_JOB_BATCH) {
      const job = await this.jobQueue.enqueue({
        type: 'IMAGE_ALT_APPLY',
        userId,
        siteId,
        payload: { siteId, userId, imageIds: ids.slice(i, i + IMAGE_ALT_JOB_BATCH) },
        priority: 10,
      });
      jobIds.push(job.dbJobId);
    }
    return { queued: ids.length, jobIds };
  }

  /** Geri al — yalnizca bizim yazdigimiz alt hala duruyorsa */
  @Post(':id/revert')
  async revert(@Param('siteId') siteId: string, @Param('id') id: string, @Req() req: Request) {
    await this.ownRow(siteId, id);
    return this.applier.revert(siteId, id, userIdOf(req));
  }

  /** Yazamayan hedefler icin kopyala-yapistir listesi (onaylanmislar) */
  @Get('snippets')
  async snippets(@Param('siteId') siteId: string) {
    const rows = await this.prisma.siteImage.findMany({
      where: { siteId, status: { in: ['APPROVED', 'DECORATIVE'] } },
      orderBy: [{ pageCount: 'desc' }],
      take: 200,
      select: { id: true, src: true, srcRaw: true, firstPageUrl: true, approvedAlt: true },
    });
    return rows.map((r) => ({
      ...r,
      html: `<img src="${escapeAttr(r.srcRaw)}" alt="${escapeAttr(r.approvedAlt ?? '')}">`,
    }));
  }
}
