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
    // @Public() decorator varsa atla
    const isPublic = this.reflector.getAllAndOverride<boolean>('isPublic', [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (isPublic) return true;

    const req = ctx.switchToHttp().getRequest<Request>();

    const token = this.extractToken(req);
    if (!token) throw new UnauthorizedException('Token yok');

    try {
      const decoded = await decode({
        token,
        secret: process.env.NEXTAUTH_SECRET ?? '',
        salt: 'authjs.session-token', // next-auth v5 default salt
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

  private extractToken(req: Request): string | null {
    // Authorization: Bearer xxx
    const auth = req.headers.authorization;
    if (auth?.startsWith('Bearer ')) return auth.slice(7);

    // Cookie: next-auth.session-token=xxx
    const cookies = req.headers.cookie ?? '';
    const m = cookies.match(/(?:next-auth\.session-token|__Secure-next-auth\.session-token)=([^;]+)/);
    return m ? decodeURIComponent(m[1]) : null;
  }
}
