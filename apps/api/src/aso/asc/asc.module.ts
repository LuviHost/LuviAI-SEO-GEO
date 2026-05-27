import { Module } from '@nestjs/common';
import { AscController } from './asc.controller.js';
import { AscService } from './asc.service.js';
import { AscCronService } from './asc.cron.js';
import { PrismaModule } from '../../prisma/prisma.module.js';
import { AuthModule } from '../../auth/auth.module.js';

@Module({
  imports: [PrismaModule, AuthModule],
  controllers: [AscController],
  providers: [AscService, AscCronService],
  exports: [AscService],
})
export class AscModule {}
