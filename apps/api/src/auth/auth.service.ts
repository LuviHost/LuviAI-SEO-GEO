import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { trialEndsAtFrom } from '../billing/trial-policy.js';

@Injectable()
export class AuthService {
  constructor(private readonly prisma: PrismaService) {}

  async getUserById(id: string) {
    return this.prisma.user.findUnique({ where: { id } });
  }

  async getUserByEmail(email: string) {
    return this.prisma.user.findUnique({ where: { email } });
  }

  /**
   * Yeni kullanicinin 14 gunluk denemesini baslatir: trialEndsAt = kayit + 14 gun
   * (trial-policy.ts). Kayit yollarinin hepsi cagirir: mobil Google/Apple girisi
   * (auth.controller resolveOAuthUser) ve web kaydinin welcome-hook'u (web NextAuth
   * kaydi ayni degeri zaten yazar; bu cagri emniyet agi).
   *
   * NEDEN kosullu UPDATE ve QuotaService.startTrial DEGIL: startTrial plani TRIAL'a
   * ceker ve makale sayacini sifirlar. Eskiden yalniz "trialEndsAt bos mu" bakiliyordu;
   * bitis tarihi hic yazilmamis UCRETLI bir hesap icin cagrilsa plan dusurulurdu ve
   * deneme hesabinin sayaci sifirlanip 2 makale yeniden acilirdi. Burada yalniz
   * deneme durumundaki, bitisi bos hesaba tarih yazilir; plan ve sayaclara dokunulmaz.
   * Idempotent: ikinci cagri hicbir sey degistirmez. Baslangic kayit ani (createdAt):
   * cagri gecikse de (fire-and-forget hook) deneme kayittan itibaren 14 gundur.
   */
  async ensureTrialStarted(userId: string) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (user.trialEndsAt || user.plan !== 'TRIAL' || user.subscriptionStatus !== 'TRIAL') return user;
    const trialEndsAt = trialEndsAtFrom(user.createdAt ?? new Date());
    await this.prisma.user.updateMany({
      where: { id: userId, plan: 'TRIAL', subscriptionStatus: 'TRIAL', trialEndsAt: null },
      data: { trialEndsAt },
    });
    return this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
  }
}
