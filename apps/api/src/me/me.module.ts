import { Module } from '@nestjs/common';
import { MeController } from './me.controller.js';
import { AdminModule } from '../admin/admin.module.js';

@Module({
  imports: [AdminModule],
  controllers: [MeController],
})
export class MeModule {}
