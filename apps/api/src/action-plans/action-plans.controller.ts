import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ActionPlansService } from './action-plans.service.js';

@Controller('sites/:siteId/action-plan')
export class ActionPlansController {
  constructor(private readonly actionPlans: ActionPlansService) {}

  /** GET /sites/:siteId/action-plan */
  @Get()
  list(
    @Param('siteId') siteId: string,
    @Query('status') status?: string,
    @Query('source') source?: string,
  ) {
    return this.actionPlans.list(siteId, { status, source });
  }

  /** GET /sites/:siteId/action-plan/counts */
  @Get('counts')
  counts(@Param('siteId') siteId: string) {
    return this.actionPlans.counts(siteId);
  }

  /** POST /sites/:siteId/action-plan — "Aksiyon Planina Ekle" */
  @Post()
  create(@Param('siteId') siteId: string, @Body() body: any) {
    return this.actionPlans.create(siteId, body);
  }

  /** PATCH /sites/:siteId/action-plan/:id */
  @Patch(':id')
  update(@Param('siteId') siteId: string, @Param('id') id: string, @Body() body: any) {
    return this.actionPlans.update(siteId, id, body);
  }

  /** DELETE /sites/:siteId/action-plan/:id */
  @Delete(':id')
  remove(@Param('siteId') siteId: string, @Param('id') id: string) {
    return this.actionPlans.remove(siteId, id);
  }
}
