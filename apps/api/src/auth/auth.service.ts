import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';

@Injectable()
export class AuthService {
  constructor(private readonly prisma: PrismaService) {}

  // NextAuth session JWT'sinden kullanıcı bilgisi çıkartır.
  // Faz 1: NextAuth API web tarafında oturumu yönetiyor; bu service
  // API endpoint'lerinde "siz kimsiniz" sorusunu cevaplayan helper.
  async getUserFromSessionToken(token: string) {
    // TODO: NextAuth session decode (Faz 1 hafta 1)
    return null;
  }

  async getUserById(id: string) {
    return this.prisma.user.findUnique({ where: { id } });
  }
}
