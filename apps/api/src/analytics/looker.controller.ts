import { Controller, ForbiddenException, Get, NotFoundException, Query, Req } from '@nestjs/common';
import type { Request } from 'express';
import { PrismaService } from '../prisma/prisma.service.js';

/**
 * Looker Studio / BI data connector uclari.
 *
 * Ajanslar musteri dashboard'larini Looker Studio'da kurar; bu uclar
 * RanksUp verisini DUZ TABLO (flat rows) olarak verir — Looker'in
 * community connector'i veya generic JSON connector'lari dogrudan tuketir.
 *
 * AUTH: Authorization: Bearer luvi_XXX (API anahtari) — global AuthGuard
 * dogrular. site_id query param'i sahiplik kontrolunden gecer (SiteAccessGuard
 * yalnizca :siteId route param'ina bakar, o yuzden burada kendimiz dogruluyoruz).
 */
@Controller('looker')
export class LookerController {
  constructor(private readonly prisma: PrismaService) {}

  private async ensureSite(req: Request, siteId: unknown) {
    const user = (req as any).user;
    if (typeof siteId !== 'string' || !siteId) throw new NotFoundException('site_id zorunlu');
    const site = await this.prisma.site.findUnique({ where: { id: siteId }, select: { id: true, userId: true } });
    if (!site) throw new NotFoundException('Site bulunamadi');
    if (user.role !== 'ADMIN' && site.userId !== user.id) throw new ForbiddenException('Bu site sana ait degil');
    return site;
  }

  private days(raw: unknown, fallback = 30): Date {
    const n = parseInt(String(raw ?? ''), 10);
    const d = Number.isFinite(n) ? Math.min(Math.max(n, 1), 365) : fallback;
    return new Date(Date.now() - d * 86_400_000);
  }

  /**
   * GET /api/looker/mention-rate?site_id=...&days=30
   * Gunluk saglayici bazinda mention/citation orani.
   */
  @Get('mention-rate')
  async mentionRate(@Req() req: Request, @Query('site_id') siteId: string, @Query('days') days?: string) {
    const site = await this.ensureSite(req, siteId);
    const runs = await this.prisma.geoPromptRun.findMany({
      // Site metrikleri — App Prompt Lab olcumleri haric
      where: { siteId: site.id, date: { gte: this.days(days) }, prompt: { trackedAppId: null } },
      select: { date: true, provider: true, cited: true, brandMentioned: true },
    });

    const byKey = new Map<string, { date: string; provider: string; total: number; cited: number; mentioned: number }>();
    for (const r of runs) {
      const date = r.date.toISOString().slice(0, 10);
      const key = `${date}|${r.provider}`;
      const cur = byKey.get(key) ?? { date, provider: r.provider, total: 0, cited: 0, mentioned: 0 };
      cur.total++;
      if (r.cited) cur.cited++;
      if (r.brandMentioned) cur.mentioned++;
      byKey.set(key, cur);
    }

    return {
      rows: Array.from(byKey.values())
        .map((r) => ({
          date: r.date,
          provider: r.provider,
          probes: r.total,
          mention_rate: Math.round((r.mentioned / r.total) * 1000) / 10,
          citation_rate: Math.round((r.cited / r.total) * 1000) / 10,
        }))
        .sort((a, b) => a.date.localeCompare(b.date) || a.provider.localeCompare(b.provider)),
    };
  }

  /**
   * GET /api/looker/citations?site_id=...&days=30
   * Gunluk citation snapshot skorlari (saglayici bazinda).
   */
  @Get('citations')
  async citations(@Req() req: Request, @Query('site_id') siteId: string, @Query('days') days?: string) {
    const site = await this.ensureSite(req, siteId);
    const snaps = await this.prisma.aiCitationSnapshot.findMany({
      where: { siteId: site.id, date: { gte: this.days(days) } },
      select: { date: true, provider: true, score: true, citedCount: true, mentionedCount: true },
      orderBy: { date: 'asc' },
    });
    return {
      rows: snaps.map((s) => ({
        date: s.date.toISOString().slice(0, 10),
        provider: s.provider,
        score: s.score,
        cited: s.citedCount,
        mentioned: s.mentionedCount,
      })),
    };
  }

  /**
   * GET /api/looker/prompts?site_id=...
   * Prompt bazinda guncel gorunurluk (konu gorunurlugu tablosu).
   */
  @Get('prompts')
  async prompts(@Req() req: Request, @Query('site_id') siteId: string) {
    const site = await this.ensureSite(req, siteId);
    const prompts = await this.prisma.geoPrompt.findMany({
      where: { siteId: site.id, isActive: true, trackedAppId: null },
      select: { text: true, intent: true, lastRunAt: true, lastCitedCount: true, lastTotalCount: true },
      orderBy: { updatedAt: 'desc' },
      take: 200,
    });
    return {
      rows: prompts.map((p) => ({
        prompt: p.text,
        intent: p.intent,
        last_run: p.lastRunAt?.toISOString().slice(0, 10) ?? null,
        score: p.lastTotalCount > 0 ? Math.round((p.lastCitedCount / p.lastTotalCount) * 100) : null,
      })),
    };
  }

  /**
   * GET /api/looker/crawler-hits?site_id=...&days=30
   * AI bot trafigi — bot bazinda gunluk istek.
   */
  @Get('crawler-hits')
  async crawlerHits(@Req() req: Request, @Query('site_id') siteId: string, @Query('days') days?: string) {
    const site = await this.ensureSite(req, siteId);
    const hits = await this.prisma.aiCrawlerHit.findMany({
      where: { siteId: site.id, date: { gte: this.days(days) } },
      select: { date: true, bot: true, hits: true, status2xx: true, status4xx: true },
      orderBy: { date: 'asc' },
    });
    return {
      rows: hits.map((h) => ({
        date: h.date.toISOString().slice(0, 10),
        bot: h.bot,
        hits: h.hits,
        ok: h.status2xx,
        errors: h.status4xx,
      })),
    };
  }
}
