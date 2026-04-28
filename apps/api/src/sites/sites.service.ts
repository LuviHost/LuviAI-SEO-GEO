import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { JobQueueService } from '../jobs/job-queue.service.js';
import { CreateSiteDto, UpdateSiteDto } from './sites.dto.js';

type RequestingUser = { id: string; role: 'USER' | 'ADMIN' | 'AGENCY_OWNER' };

/**
 * URL'leri tek standarda sokar (mukerrer site kontrolu icin).
 *  - lowercase host
 *  - trailing slash temizlenir
 *  - query/fragment atilir
 *  - protokol bos gelirse https zorlanir
 */
export function normalizeSiteUrl(raw: string): string {
  if (!raw) throw new Error('URL bos olamaz');
  let candidate = raw.trim();
  if (!/^https?:\/\//i.test(candidate)) candidate = `https://${candidate}`;
  const u = new URL(candidate);
  u.protocol = u.protocol.toLowerCase();
  u.hostname = u.hostname.toLowerCase();
  u.search = '';
  u.hash = '';
  let pathname = u.pathname.replace(/\/+$/, '');
  if (!pathname) pathname = '';
  return `${u.protocol}//${u.hostname}${pathname}`;
}

@Injectable()
export class SitesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jobQueue: JobQueueService,
  ) {}

  async create(userId: string, dto: CreateSiteDto) {
    const normalizedUrl = normalizeSiteUrl(dto.url);

    const duplicate = await this.prisma.site.findFirst({
      where: { userId, url: normalizedUrl },
      select: { id: true },
    });
    if (duplicate) {
      throw new ConflictException('Bu site zaten ekli.');
    }

    let site;
    try {
      site = await this.prisma.site.create({
        data: { ...dto, url: normalizedUrl, userId },
      });
    } catch (err: any) {
      // Prisma unique constraint (race condition guard'i)
      if (err?.code === 'P2002') {
        throw new ConflictException('Bu site zaten ekli.');
      }
      throw err;
    }
    // Wow-moment: brain → audit → topics → 1.makale tek job
    await this.jobQueue.enqueue({
      type: 'ONBOARDING_CHAIN',
      userId: site.userId,
      siteId: site.id,
      payload: { siteId: site.id },
      priority: 10, // yüksek öncelik
    });
    return site;
  }

  list(user: RequestingUser) {
    const where = user.role === 'ADMIN' ? {} : { userId: user.id };
    return this.prisma.site.findMany({ where, orderBy: { createdAt: 'desc' } });
  }

  async findOne(id: string, user: RequestingUser) {
    const site = await this.prisma.site.findUnique({ where: { id }, include: { brain: true } });
    if (!site) throw new NotFoundException();
    if (user.role !== 'ADMIN' && site.userId !== user.id) {
      throw new ForbiddenException('Bu site sana ait degil');
    }
    return site;
  }

  async update(id: string, dto: UpdateSiteDto, user: RequestingUser) {
    await this.assertOwnership(id, user);
    return this.prisma.site.update({ where: { id }, data: dto });
  }

  async remove(id: string, user: RequestingUser) {
    await this.assertOwnership(id, user);
    return this.prisma.site.delete({ where: { id } });
  }

  async regenerateBrain(siteId: string, user: RequestingUser) {
    const site = await this.assertOwnership(siteId, user);
    return this.jobQueue.enqueue({
      type: 'BRAIN_GENERATE',
      userId: site.userId,
      siteId,
      payload: { siteId, forceRegenerate: true },
    });
  }

  async listCompetitors(siteId: string, user: RequestingUser) {
    await this.assertOwnership(siteId, user);
    const brain = await this.prisma.brain.findUnique({ where: { siteId } });
    if (!brain) return [];
    return Array.isArray(brain.competitors) ? brain.competitors : [];
  }

  async setCompetitors(
    siteId: string,
    competitors: Array<{ name: string; url: string; strengths?: string[]; weaknesses?: string[] }>,
    user: RequestingUser,
  ) {
    await this.assertOwnership(siteId, user);
    const brain = await this.prisma.brain.findUnique({ where: { siteId } });
    if (!brain) {
      throw new NotFoundException('Brain henuz olusturulmadi. Once site analizini bekle.');
    }
    // URL normalize + duplicate at
    const seen = new Set<string>();
    const cleaned: Array<{ name: string; url: string; strengths?: string[]; weaknesses?: string[] }> = [];
    for (const c of competitors) {
      if (!c?.url || !c?.name) continue;
      let url: string;
      try {
        url = normalizeSiteUrl(c.url);
      } catch {
        continue;
      }
      if (seen.has(url)) continue;
      seen.add(url);
      cleaned.push({
        name: String(c.name).trim().slice(0, 100),
        url,
        strengths: Array.isArray(c.strengths) ? c.strengths.slice(0, 5) : undefined,
        weaknesses: Array.isArray(c.weaknesses) ? c.weaknesses.slice(0, 5) : undefined,
      });
    }
    await this.prisma.brain.update({
      where: { siteId },
      data: { competitors: cleaned as any, generatedBy: 'hybrid' },
    });
    return cleaned;
  }

  private async assertOwnership(siteId: string, user: RequestingUser) {
    const site = await this.prisma.site.findUnique({ where: { id: siteId } });
    if (!site) throw new NotFoundException();
    if (user.role !== 'ADMIN' && site.userId !== user.id) {
      throw new ForbiddenException('Bu site sana ait degil');
    }
    return site;
  }
}
