import { BadRequestException, Body, Controller, ForbiddenException, Get, Param, Post, Query, Req } from '@nestjs/common';
import type { Request } from 'express';
import { AdminService } from './admin.service.js';
import { EmailService, type EmailTemplate } from '../email/email.service.js';
import { AiCitationService } from '../audit/ai-citation.service.js';
import { JobQueueService } from '../jobs/job-queue.service.js';

function assertAdmin(req: Request) {
  const user = (req as any).user;
  if (!user) throw new ForbiddenException('Auth required');
  if (user.role !== 'ADMIN') throw new ForbiddenException('Admin only');
  return user;
}

@Controller('admin')
export class AdminController {
  constructor(
    private readonly admin: AdminService,
    private readonly email: EmailService,
    private readonly aiCitation: AiCitationService,
    private readonly jobQueue: JobQueueService,
  ) {}

  // ──────────────────────────────────────────────────────────────────────
  // Queue Monitoring (BullMQ)
  // ──────────────────────────────────────────────────────────────────────

  @Get('queue/stats')
  async queueStats(@Req() req: Request) {
    assertAdmin(req);
    const [counts, paused] = await Promise.all([
      this.jobQueue.getQueueCounts(),
      this.jobQueue.getQueueIsPaused(),
    ]);
    return { counts, paused };
  }

  @Get('queue/jobs')
  async queueJobs(@Req() req: Request, @Query('state') state?: string, @Query('limit') limit?: string) {
    assertAdmin(req);
    const validStates = ['waiting', 'active', 'delayed', 'completed', 'failed', 'paused'] as const;
    const s = validStates.includes(state as any) ? (state as typeof validStates[number]) : 'delayed';
    const lim = Math.min(200, Math.max(1, parseInt(limit ?? '50', 10) || 50));
    return this.jobQueue.listJobs(s, lim);
  }

  @Post('queue/jobs/:jobId/retry')
  async queueRetryJob(@Req() req: Request, @Param('jobId') jobId: string) {
    assertAdmin(req);
    const ok = await this.jobQueue.retryJob(jobId);
    return { ok };
  }

  @Post('queue/jobs/:jobId/promote')
  async queuePromoteJob(@Req() req: Request, @Param('jobId') jobId: string) {
    assertAdmin(req);
    const ok = await this.jobQueue.promoteJob(jobId);
    return { ok };
  }

  @Post('queue/jobs/:jobId/remove')
  async queueRemoveJob(@Req() req: Request, @Param('jobId') jobId: string) {
    assertAdmin(req);
    const ok = await this.jobQueue.removeJob(jobId);
    return { ok };
  }

  @Post('queue/pause')
  async queuePause(@Req() req: Request) {
    assertAdmin(req);
    await this.jobQueue.pauseQueue();
    return { ok: true, paused: true };
  }

  @Post('queue/resume')
  async queueResume(@Req() req: Request) {
    assertAdmin(req);
    await this.jobQueue.resumeQueue();
    return { ok: true, paused: false };
  }

  /**
   * GET /admin/ai-costs
   * Bugunku AI provider harcama + cap durumu (citation tracking icin).
   */
  @Get('ai-costs')
  async aiCosts(@Req() req: Request) {
    assertAdmin(req);
    return this.aiCitation.getTodayCosts();
  }

  @Get('overview')
  overview(@Req() req: Request) {
    assertAdmin(req);
    return this.admin.getOverview();
  }

  @Get('users')
  users(@Req() req: Request) {
    assertAdmin(req);
    return this.admin.listTenants();
  }

  @Get('tenants')
  tenants(@Req() req: Request) {
    assertAdmin(req);
    return this.admin.listTenants();
  }

  @Get('invoices')
  invoices(@Req() req: Request, @Query('status') status?: string) {
    assertAdmin(req);
    return this.admin.listInvoices({ status });
  }

  @Get('sites')
  sites(@Req() req: Request) {
    assertAdmin(req);
    return this.admin.listSites();
  }

  @Get('jobs/failed')
  failedJobs(@Req() req: Request) {
    assertAdmin(req);
    return this.admin.getFailedJobs();
  }

  /**
   * POST /admin/email-test
   * body: { to: 'foo@bar.com', template?: 'welcome_day0' | ..., name?: string }
   * Resend'in canli ortamda gercekten mail gonderdigini dogrulamak icin.
   * RESEND_API_KEY yoksa "log only" moda duser, "ok:true" doner ama gercek
   * mail atmaz — donus body'sinde uyari verilir.
   */
  @Post('email-test')
  async emailTest(
    @Req() req: Request,
    @Body() body: { to?: string; template?: EmailTemplate; name?: string },
  ) {
    assertAdmin(req);
    const to = body.to?.trim();
    if (!to || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) {
      throw new BadRequestException('Gecerli bir email adresi gerekli (to alani)');
    }
    const template: EmailTemplate = body.template ?? 'welcome_day0';
    const result = await this.email.send({
      to,
      template,
      data: {
        name: body.name ?? 'Test Kullanicisi',
        // first_article_published icin demo veri
        title: 'Test Makalesi: WordPress Hosting Nasil Secilir?',
        publicUrl: 'https://ai.luvihost.com',
        wordCount: 1500,
        faqs: 5,
        editorScore: 56,
        // weekly_report icin
        articlesPublished: 3,
        totalClicks: 124,
        totalImpressions: 4530,
        avgPosition: '8.2',
      },
    });
    return {
      ...result,
      mode: process.env.RESEND_API_KEY ? 'resend' : 'log-only',
      template,
      to,
    };
  }
}
