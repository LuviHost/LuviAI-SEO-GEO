import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';

@Injectable()
export class JobsService {
  constructor(private readonly prisma: PrismaService) {}

  findOne(id: string) {
    return this.prisma.job.findUnique({ where: { id } });
  }

  async retry(id: string) {
    return this.prisma.job.update({
      where: { id },
      data: { status: 'QUEUED', attempts: 0, error: null },
    });
  }
}
