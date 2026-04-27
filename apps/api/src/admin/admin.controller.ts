import { Controller, Get } from '@nestjs/common';
import { AdminService } from './admin.service.js';

@Controller('admin')
export class AdminController {
  constructor(private readonly admin: AdminService) {}

  @Get('overview')
  overview() { return this.admin.getOverview(); }

  @Get('tenants')
  tenants() { return this.admin.listTenants(); }

  @Get('jobs/failed')
  failedJobs() { return this.admin.getFailedJobs(); }
}
