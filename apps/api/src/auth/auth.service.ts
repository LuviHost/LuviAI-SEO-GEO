import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { QuotaService } from '../billing/quota.service.js';

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly quota: QuotaService,
  ) {}

  async getUserById(id: string) {
    return this.prisma.user.findUnique({ where: { id } });
  }

  async getUserByEmail(email: string) {
    return this.prisma.user.findUnique({ where: { email } });
  }

  /** Yeni kullanıcı yaratıldığında otomatik 14 gün trial başlat */
  async ensureTrialStarted(userId: string) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (user.trialEndsAt) return user; // zaten başlatılmış
    return this.quota.startTrial(userId);
  }
}
