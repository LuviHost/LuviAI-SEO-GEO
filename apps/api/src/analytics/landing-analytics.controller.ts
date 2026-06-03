import { Body, Controller, Get, Post, Query, Req, ForbiddenException } from '@nestjs/common';
import type { Request } from 'express';
import { Public } from '../auth/public.decorator.js';
import { LandingAnalyticsService } from './landing-analytics.service.js';

@Controller('analytics/landing')
export class LandingAnalyticsController {
  constructor(private readonly svc: LandingAnalyticsService) {}

  /** POST /api/analytics/landing — anonim event ingest (public) */
  @Public()
  @Post()
  record(@Req() req: Request, @Body() body: {
    type: string;
    path?: string;
    sessionId: string;
    meta?: any;
    referrer?: string;
    utm?: { source?: string; medium?: string; campaign?: string };
  }) {
    return this.svc.record({
      ...body,
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
