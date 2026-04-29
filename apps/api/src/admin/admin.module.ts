import { Module } from '@nestjs/common';
import { AdminController } from './admin.controller.js';
import { AdminService } from './admin.service.js';
import { AuditModule } from '../audit/audit.module.js';

/** Admin paneli — sizin için tenant yönetimi, kullanım metriği, manuel müdahale */
@Module({
  imports: [AuditModule],
  controllers: [AdminController],
  providers: [AdminService],
  exports: [AdminService],
})
export class AdminModule {}
