import { Module } from '@nestjs/common';
import { PromptsController } from './prompts.controller.js';
import { PromptsService } from './prompts.service.js';
import { PrismaModule } from '../prisma/prisma.module.js';

@Module({
  imports: [PrismaModule],
  controllers: [PromptsController],
  providers: [PromptsService],
  exports: [PromptsService],
})
export class PromptsModule {}
