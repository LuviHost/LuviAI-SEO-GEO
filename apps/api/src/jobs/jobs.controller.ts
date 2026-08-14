import { Controller, Get, Param, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { JobsService } from './jobs.service.js';

@Controller('jobs')
export class JobsController {
  constructor(private readonly jobs: JobsService) {}

  @Get(':id')
  get(@Param('id') id: string, @Req() req: Request) {
    const user = (req as any).user as { id: string; role?: string } | undefined;
    return this.jobs.findOne(id, user);
  }

  @Post(':id/retry')
  retry(@Param('id') id: string) { return this.jobs.retry(id); }
}
