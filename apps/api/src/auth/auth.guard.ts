import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { decode } from 'next-auth/jwt';
import { PrismaService } from '../prisma/prisma.service.js';

/**
 * NextAuth session JWT'sini doğrular.
 *
 * Frontend (Next.js) NextAuth ile login olur, cookie'de "next-auth.session-token" döner.
 * API çağrılarında bu cookie veya Authorization header gelir.
 * Bu guard:
 *  1. Cookie/header'dan token çıkartır
 *  2. NEXTAUTH_SECRET ile decode eder
 *  3. User ID'yi DB'den lookup eder
 *  4. req.user'a koyar (controller'lar erişebilsin)
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly prisma: PrismaService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>('isPublic', [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (isPublic) return true;

    const req = ctx.switchToHttp().getRequest<Request>();
    const extracted = this.extractToken(req);
    if (!extracted) throw new UnauthorizedException('Token yok');

    const secret = process.env.NEXTAUTH_SECRET ?? process.env.AUTH_SECRET ?? '';

    try {
      const decoded = await decode({
        token: extracted.token,
        secret,
        salt: extracted.salt,
      });
      if (!decoded?.sub) throw new UnauthorizedException('Geçersiz token');

      const user = await this.prisma.user.findUnique({ where: { id: decoded.sub as string } });
      if (!user) throw new UnauthorizedException('Kullanıcı bulunamadı');

      (req as any).user = user;
      return true;
    } catch (err: any) {
      throw new UnauthorizedException(err.message);
    }
  }

  /**
   * Cookie veya Authorization header'dan token + salt çıkartır.
   * NextAuth v5'te cookie name'i (`authjs.session-token` veya
   * `__Secure-authjs.session-token`) decode salt'ı olarak da kullanılır.
   * Backwards-compat için v4 isimleri (`next-auth.session-token`) de kabul edilir.
   */
  private extractToken(req: Request): { token: string; salt: string } | null {
    const authHeader = req.headers.authorization;
    if (authHeader?.startsWith('Bearer ')) {
      return { token: authHeader.slice(7), salt: 'authjs.session-token' };
    }

    const cookies = req.headers.cookie ?? '';
    const candidates = [
      'authjs.session-token',
      '__Secure-authjs.session-token',
      'next-auth.session-token',
      '__Secure-next-auth.session-token',
    ];
    for (const name of candidates) {
      const re = new RegExp(`(?:^|;\\s*)${name.replace(/[\\^$.*+?()[\]{}|]/g, '\\$&')}=([^;]+)`);
      const m = cookies.match(re);
      if (m) return { token: decodeURIComponent(m[1]), salt: name };
    }
    return null;
  }
}
