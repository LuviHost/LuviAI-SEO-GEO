import { Module } from '@nestjs/common';
import { AscController } from './asc.controller.js';
import { AscService } from './asc.service.js';
import { AscCronService } from './asc.cron.js';
import { PrismaModule } from '../../prisma/prisma.module.js';
import { AuthModule } from '../../auth/auth.module.js';
import { AscMetadataController } from './asc-metadata.controller.js';
import { AscMetadataService } from './asc-metadata.service.js';
import { AscScreenshotsController } from './asc-screenshots.controller.js';
import { AscScreenshotsService } from './asc-screenshots.service.js';
import { AppliedFixService } from '../../audit/applied-fix.service.js';

@Module({
  imports: [PrismaModule, AuthModule],
  controllers: [AscController, AscMetadataController, AscScreenshotsController],
  // AppliedFixService yalniz Prisma'ya bagli — AuditModule'u (LLM, e-posta...) cekmemek icin burada da saglanir
  providers: [AscService, AscCronService, AscMetadataService, AscScreenshotsService, AppliedFixService],
  exports: [AscService],
})
export class AscModule {}
