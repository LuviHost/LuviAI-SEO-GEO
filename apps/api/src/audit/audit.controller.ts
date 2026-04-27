import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { AuditService } from './audit.service.js';
import { AutoFixService } from './auto-fix.service.js';

@Controller('sites/:siteId/audit')
export class AuditController {
  constructor(
    private readonly audit: AuditService,
    private readonly autoFix: AutoFixService,
  ) {}

  /** GET /sites/:siteId/audit/latest */
  @Get('latest')
  latest(@Param('siteId') siteId: string) {
    return this.audit.getLatest(siteId);
  }

  /** POST /sites/:siteId/audit/run-now — şimdi çalıştır (synchronous, dev/test için) */
  @Post('run-now')
  async runNow(@Param('siteId') siteId: string) {
    return this.audit.runAudit(siteId);
  }

  /** POST /sites/:siteId/audit/run — queue (production) */
  @Post('run')
  run(@Param('siteId') siteId: string) {
    return this.audit.queueAudit(siteId);
  }

  /** POST /sites/:siteId/audit/auto-fix */
  @Post('auto-fix')
  autoFixApply(@Param('siteId') siteId: string, @Body() body: { fixes: string[] }) {
    return this.autoFix.applyFixes(siteId, body.fixes);
  }

  /** POST /sites/:siteId/audit/auto-fix-now — şimdi çalıştır */
  @Post('auto-fix-now')
  async autoFixNow(@Param('siteId') siteId: string, @Body() body: { fixes: string[] }) {
    return this.autoFix.runAutoFix(siteId, body.fixes);
  }
}
