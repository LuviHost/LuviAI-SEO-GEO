import { Controller, Get, Param, Req } from '@nestjs/common';
import type { Request } from 'express';
import { JobsService } from './jobs.service.js';

/**
 * Is durumu okuma ucu (panel tarama/uretim durumunu buradan yoklar).
 *
 * POST /jobs/:id/retry KALDIRILDI: sahiplik denetimi yoktu (baska musterinin
 * is kimligini bilen herkes, ya da /jobs scope haritasinda olmadigi icin her
 * ':write' API anahtari, isi QUEUED'a cekip payload/result'iyla tum satiri
 * okuyabiliyordu) ve BullMQ'ya yeniden kuyruklamadigi icin is sonsuza dek
 * QUEUED kaliyordu. Panel, mobil, SDK ve MCP bu ucu cagirmiyordu; yoneticinin
 * gercek yeniden deneme ucu POST /admin/queue/jobs/:jobId/retry (BullMQ
 * job.retry(), yalniz ADMIN + panel oturumu).
 */
@Controller('jobs')
export class JobsController {
  constructor(private readonly jobs: JobsService) {}

  @Get(':id')
  get(@Param('id') id: string, @Req() req: Request) {
    const user = (req as any).user as { id: string; role?: string } | undefined;
    return this.jobs.findOne(id, user);
  }
}
