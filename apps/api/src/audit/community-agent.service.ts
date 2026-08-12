import { Injectable, Logger, BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { CommunityOutreachService } from './community-outreach.service.js';

/**
 * Community Agent — CommunityOutreachService'in URUNLESMIS hali.
 *
 * Eski akis: findOpportunities() her cagrida sifirdan arar, sonuc ucucuydu.
 * Yeni akis: tarama sonuclari CommunityOpportunity tablosuna yazilir;
 * kullanici taslagi duzenler/onaylar, durum akisi izlenir:
 *   NEW → DRAFTED → APPROVED → POSTED (veya IGNORED)
 *
 * Reddit'e otomatik POST YOKTUR — taslak insan onayi ister (spam degil,
 * gercek deger). "Posted" isareti kullanicinin manuel paylasimini kaydeder.
 */
@Injectable()
export class CommunityAgentService {
  private readonly log = new Logger(CommunityAgentService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly outreach: CommunityOutreachService,
  ) {}

  /** Yeni firsat taramasi — bulunanlari persist eder (URL bazinda dedup) */
  async scan(siteId: string, opts: { limit?: number } = {}) {
    const found = await this.outreach.findOpportunities(siteId, { limit: opts.limit ?? 10 });

    const existing = await this.prisma.communityOpportunity.findMany({
      where: { siteId },
      select: { url: true },
    });
    const seen = new Set(existing.map((e) => e.url));

    let created = 0;
    for (const op of found) {
      if (seen.has(op.url)) continue;
      seen.add(op.url);
      await this.prisma.communityOpportunity.create({
        data: {
          siteId,
          platform: op.source,
          url: op.url,
          title: op.title,
          subreddit: op.subreddit ?? null,
          snippet: op.snippet?.slice(0, 2000) ?? null,
          relevance: Math.min(100, Math.max(0, Math.round(op.brandFitScore))),
          draftReply: op.draftReply || null,
          status: op.draftReply ? 'DRAFTED' : 'NEW',
          meta: { publishedAt: op.publishedAt ?? null, sourceLink: op.sourceLink ?? null },
        },
      });
      created++;
    }

    return { found: found.length, created, skippedDuplicates: found.length - created };
  }

  async list(siteId: string, opts: { status?: string } = {}) {
    return this.prisma.communityOpportunity.findMany({
      where: { siteId, ...(opts.status ? { status: opts.status } : {}) },
      orderBy: [{ status: 'asc' }, { relevance: 'desc' }, { createdAt: 'desc' }],
      take: 100,
    });
  }

  async update(siteId: string, id: string, input: { status?: string; draftReply?: string }) {
    const item = await this.require(siteId, id);

    const data: any = {};
    if (input.draftReply !== undefined) {
      data.draftReply = String(input.draftReply).slice(0, 10_000);
      if (item.status === 'NEW') data.status = 'DRAFTED';
    }
    if (input.status !== undefined) {
      const allowed = ['NEW', 'DRAFTED', 'APPROVED', 'POSTED', 'IGNORED'];
      if (!allowed.includes(input.status)) {
        throw new BadRequestException(`Durum yalnizca ${allowed.join('/')} olabilir`);
      }
      data.status = input.status;
      if (input.status === 'POSTED') data.postedAt = new Date();
    }

    return this.prisma.communityOpportunity.update({ where: { id: item.id }, data });
  }

  async remove(siteId: string, id: string) {
    const item = await this.require(siteId, id);
    await this.prisma.communityOpportunity.delete({ where: { id: item.id } });
    return { ok: true };
  }

  private async require(siteId: string, id: string) {
    // Tenant izolasyonu — id her zaman siteId ile birlikte aranir
    const item = await this.prisma.communityOpportunity.findFirst({ where: { id, siteId } });
    if (!item) throw new NotFoundException('Firsat bulunamadi');
    return item;
  }
}
