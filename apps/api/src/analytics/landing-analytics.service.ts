import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';

/**
 * Landing page funnel analytics — kendi sistemimiz.
 * Anonim (IP yok), KVKK uyumlu. PostHog/Plausible'a gerek yok.
 */
@Injectable()
export class LandingAnalyticsService {
  private readonly log = new Logger(LandingAnalyticsService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** Frontend'ten gelen event'i kaydet — anonim, hızlı yaz */
  async record(body: {
    type: string;
    path?: string;
    sessionId: string;
    meta?: any;
    referrer?: string;
    ua?: string;
    utm?: { source?: string; medium?: string; campaign?: string };
  }) {
    if (!body.type || !body.sessionId) return { ok: false, reason: 'missing-fields' };
    if (body.type.length > 80) return { ok: false, reason: 'type-too-long' };

    await this.prisma.landingEvent.create({
      data: {
        type: body.type,
        path: body.path?.slice(0, 500),
        sessionId: body.sessionId.slice(0, 64),
        meta: body.meta ?? undefined,
        referrer: body.referrer?.slice(0, 500),
        ua: body.ua?.slice(0, 500),
        utm: body.utm ?? undefined,
      },
    });
    return { ok: true };
  }

  /** Admin dashboard summary — son N gün */
  async getSummary(daysBack = 7) {
    const since = new Date();
    since.setDate(since.getDate() - daysBack);

    const events = await this.prisma.landingEvent.findMany({
      where: { createdAt: { gte: since } },
      select: { type: true, path: true, sessionId: true, meta: true, createdAt: true },
    });

    const byType: Record<string, number> = {};
    const sessions = new Set<string>();
    const ctaClicks: Record<string, number> = {};
    const sectionViews: Record<string, number> = {};
    const pageviews = new Set<string>();
    const dailyTimeline: Record<string, { pageviews: number; signups: number }> = {};

    for (const e of events) {
      byType[e.type] = (byType[e.type] ?? 0) + 1;
      sessions.add(e.sessionId);

      const day = e.createdAt.toISOString().slice(0, 10);
      if (!dailyTimeline[day]) dailyTimeline[day] = { pageviews: 0, signups: 0 };

      if (e.type === 'pageview') {
        pageviews.add(`${e.sessionId}:${e.path}`);
        dailyTimeline[day].pageviews++;
      } else if (e.type === 'cta_click') {
        const ctaId = (e.meta as any)?.ctaId ?? 'unknown';
        ctaClicks[ctaId] = (ctaClicks[ctaId] ?? 0) + 1;
      } else if (e.type === 'section_view') {
        const sid = (e.meta as any)?.sectionId ?? 'unknown';
        sectionViews[sid] = (sectionViews[sid] ?? 0) + 1;
      } else if (e.type === 'signup_complete') {
        dailyTimeline[day].signups++;
      }
    }

    // Funnel
    const totalSessions = sessions.size;
    const ctaTotal = Object.values(ctaClicks).reduce((a, b) => a + b, 0);
    const signups = byType['signup_complete'] ?? 0;

    return {
      window: { daysBack, since: since.toISOString() },
      totals: {
        sessions: totalSessions,
        events: events.length,
        pageviews: pageviews.size,
        ctaClicks: ctaTotal,
        signups,
      },
      funnel: {
        sessionToCtaPct: totalSessions > 0 ? Math.round((ctaTotal / totalSessions) * 1000) / 10 : 0,
        sessionToSignupPct: totalSessions > 0 ? Math.round((signups / totalSessions) * 1000) / 10 : 0,
      },
      byType,
      topCtas: Object.entries(ctaClicks).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([id, n]) => ({ id, count: n })),
      topSections: Object.entries(sectionViews).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([id, n]) => ({ id, count: n })),
      timeline: Object.entries(dailyTimeline)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([date, d]) => ({ date, ...d })),
    };
  }
}
