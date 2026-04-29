import { Module } from '@nestjs/common';
import { AgencyController } from './agency.controller.js';
import { AgencyService } from './agency.service.js';

@Module({
  controllers: [AgencyController],
  providers: [AgencyService],
  exports: [AgencyService],
})
export class AgencyModule {}
