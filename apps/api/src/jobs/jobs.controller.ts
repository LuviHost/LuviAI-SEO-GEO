import { Controller, Get, Param, Post } from '@nestjs/common';
import { JobsService } from './jobs.service.js';

@Controller('jobs')
export class JobsController {
  constructor(private readonly jobs: JobsService) {}

  @Get(':id')
  get(@Param('id') id: string) { return this.jobs.findOne(id); }

  @Post(':id/retry')
  retry(@Param('id') id: string) { return this.jobs.retry(id); }
}
