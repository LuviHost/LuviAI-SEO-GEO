import { Controller, ForbiddenException, Get, Param, Query, Req } from '@nestjs/common';
import type { Request } from 'express';
import { LLMProviderService } from './llm-provider.service.js';

function assertAdmin(req: Request) {
  const user = (req as any).user;
  if (!user) throw new ForbiddenException('Auth required');
  if (user.role !== 'ADMIN') throw new ForbiddenException('Admin only');
  return user;
}

@Controller()
export class SpendController {
  constructor(private readonly llm: LLMProviderService) {}

  /** GET /admin/spend?days=30 — global spend dashboard */
  @Get('admin/spend')
  async adminSpend(@Req() req: Request, @Query('days') days?: string) {
    assertAdmin(req);
    return this.llm.getSpendSummary({ days: days ? parseInt(days, 10) : 30 });
  }

  /** GET /sites/:siteId/spend?days=30 — site bazlı spend (site sahibi görür) */
  @Get('sites/:siteId/spend')
  async siteSpend(
    @Param('siteId') siteId: string,
    @Query('days') days?: string,
  ) {
    return this.llm.getSpendSummary({ siteId, days: days ? parseInt(days, 10) : 30 });
  }
}
