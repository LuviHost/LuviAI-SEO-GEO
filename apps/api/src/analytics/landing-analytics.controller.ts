import { Body, Controller, Get, Post, Query, Req, ForbiddenException } from '@nestjs/common';
import type { Request } from 'express';
import { Public } from '../auth/public.decorator.js';
import { LandingAnalyticsService } from './landing-analytics.service.js';
import { LandingEventDto } from './analytics-body.dto.js';

/** meta JSON ust siniri — anonim uc, DB'ye sinirsiz yazilmasin (asan meta dusurulur, olay kalir) */
const LANDING_META_MAX_CHARS = 2000;
/**
 * landing_events.path VARCHAR(191) (Prisma String? → MySQL varsayilani).
 * Panel yolu sorgu dizesiyle gonderir (utm_*, fbclid, gclid): 191'i asan yol
 * kati SQL kipinde (MySQL 8 varsayilani) Prisma P2000 "too long" hatasi verir
 * ve olay KAYBOLUR — reklamdan gelen ziyaretler hunide eksik sayilirdi.
 * Yol kesilir, olay kalir.
 */
const LANDING_PATH_MAX = 191;

/** utm: yalniz bilinen uc alan, dize ve kisa */
function pickUtm(v: unknown): { source?: string; medium?: string; campaign?: string } | undefined {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return undefined;
  const o = v as Record<string, unknown>;
  const out: { source?: string; medium?: string; campaign?: string } = {};
  for (const k of ['source', 'medium', 'campaign'] as const) {
    if (typeof o[k] === 'string' && o[k]) out[k] = (o[k] as string).slice(0, 200);
  }
  return Object.keys(out).length ? out : undefined;
}

function boundedMeta(v: unknown): Record<string, unknown> | undefined {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return undefined;
  try {
    return JSON.stringify(v).length <= LANDING_META_MAX_CHARS ? (v as Record<string, unknown>) : undefined;
  } catch {
    return undefined;
  }
}

@Controller('analytics/landing')
export class LandingAnalyticsController {
  constructor(private readonly svc: LandingAnalyticsService) {}

  /** POST /api/analytics/landing — anonim event ingest (public) */
  @Public()
  @Post()
  record(@Req() req: Request, @Body() body: LandingEventDto) {
    // Alanlar tek tek — govde yayilmaz; ua yalniz istek basligindan
    return this.svc.record({
      type: body.type,
      path: typeof body.path === 'string' ? body.path.slice(0, LANDING_PATH_MAX) : undefined,
      sessionId: body.sessionId,
      meta: boundedMeta(body.meta),
      referrer: body.referrer,
      utm: pickUtm(body.utm),
      ua: req.headers['user-agent']?.toString().slice(0, 500),
    });
  }

  /** GET /api/analytics/landing/summary?days=7 — admin dashboard */
  @Get('summary')
  summary(@Req() req: Request, @Query('days') days?: string) {
    // Sadece admin görsün
    const user = (req as any).user;
    if (!user || user.role !== 'ADMIN') {
      throw new ForbiddenException('Sadece admin');
    }
    return this.svc.getSummary(days ? parseInt(days, 10) : 7);
  }
}
