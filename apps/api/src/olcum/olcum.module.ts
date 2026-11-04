import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module.js';
import { OlcumController } from './olcum.controller.js';
import { OlcumService } from './olcum.service.js';

/** Olcum altyapisi taramasi (site + rakipler): olcum-tespit.ts saf, olcum.service.ts I/O */
@Module({
  imports: [PrismaModule],
  controllers: [OlcumController],
  providers: [OlcumService],
  exports: [OlcumService],
})
export class OlcumModule {}
