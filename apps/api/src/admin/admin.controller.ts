import { Controller, ForbiddenException, Get, Query, Req } from '@nestjs/common';
import type { Request } from 'express';
import { AdminService } from './admin.service.js';

function assertAdmin(req: Request) {
  const user = (req as any).user;
  if (!user) throw new ForbiddenException('Auth required');
  if (user.role !== 'ADMIN') throw new ForbiddenException('Admin only');
  return user;
}

@Controller('admin')
export class AdminController {
  constructor(private readonly admin: AdminService) {}

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
}
