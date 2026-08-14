import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';

@Injectable()
export class JobsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Is durumu — SAHIPLIK ZORUNLU.
   *
   * Onceden id ile herkese aciak donuyordu: /jobs/:id rotasi sites/:siteId
   * altinda olmadigi icin global SiteAccessGuard da devreye girmiyor. Bir is
   * id'sini ele geciren baska bir musterinin isini (payload icinde siteId ve
   * site URL'i ile birlikte) okuyabilirdi. Panel artik tarama durumunu bu
   * uctan yokladigi icin kapatmak sart.
   */
  async findOne(id: string, user?: { id: string; role?: string }) {
    const job = await this.prisma.job.findUnique({ where: { id } });
    if (!job) throw new NotFoundException('Is bulunamadi');
    if (user && user.role !== 'ADMIN' && job.userId !== user.id) {
      throw new ForbiddenException('Bu is sana ait degil');
    }
    return job;
  }

  async retry(id: string) {
    return this.prisma.job.update({
      where: { id },
      data: { status: 'QUEUED', attempts: 0, error: null },
    });
  }
}
