import { Module } from '@nestjs/common';
import { AdminController } from './admin.controller.js';
import { AdminService } from './admin.service.js';

/** Admin paneli — sizin için tenant yönetimi, kullanım metriği, manuel müdahale */
@Module({
  controllers: [AdminController],
  providers: [AdminService],
})
export class AdminModule {}
