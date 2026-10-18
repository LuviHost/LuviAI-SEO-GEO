import { Controller, Get, Param, Req } from '@nestjs/common';
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

  // POST /jobs/:id/retry kaldirildi: sahiplik denetimi yoktu (baskasinin isini
  // QUEUED'a cekip tum satiri, payload dahil, donduruyordu) ve kuyruga yeniden
  // eklemedigi icin isi gercekte de yeniden calistirmiyordu. Panel bu ucu
  // kullanmiyor; yoneticiler /admin/queue/jobs/:id/retry ile yeniden dener.
}
