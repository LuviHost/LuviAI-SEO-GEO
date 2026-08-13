import { CanActivate, ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { decode } from 'next-auth/jwt';
import { PrismaService } from '../prisma/prisma.service.js';
import { ApiKeysService } from '../api-keys/api-keys.service.js';

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
    private readonly apiKeys: ApiKeysService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>('isPublic', [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (isPublic) return true;

    const req = ctx.switchToHttp().getRequest<Request>();

    // ── API Key check (Authorization: Bearer luvi_xxx) ──
    const authHeader = req.headers.authorization;
    if (authHeader?.startsWith('Bearer ') && authHeader.slice(7).startsWith('luvi_')) {
      const token = authHeader.slice(7);
      const apiKey = await this.apiKeys.validate(token);
      if (!apiKey) throw new UnauthorizedException('API key gecersiz');
      const user = await this.prisma.user.findUnique({ where: { id: apiKey.userId } });
      if (!user) throw new UnauthorizedException('User bulunamadi');

      // ── Scope zorlamasi ──
      // Onceden scopes yari dekoratifti: guard yalnizca "mutasyon mu" diye
      // bakip HERHANGI bir ':write' scope'unu yeterli sayiyordu. Yani
      // 'social:write' tasiyan anahtar DELETE /sites cagirabiliyor, okuma
      // scope'lari ise hic denetlenmiyordu.
      //
      // Artik yol -> kaynak eslesmesi yapilir ve gereken scope kaynak bazinda
      // hesaplanir: GET '<kaynak>:read', mutasyon '<kaynak>:write'. '*' her
      // seyi acar; ':write' ayni kaynagin ':read'ini de kapsar.
      //
      // Yol bilinen bir kaynaga eslesmiyorsa (requiredScope null) mevcut
      // entegrasyonlari kirmamak icin ESKI davranisa duseriz: mutasyon icin
      // herhangi bir ':write' yeter, GET serbest.
      //
      // /mcp harici tutulur — MCP transport'u POST'tur ama salt-okuma
      // tool'lari da tasir; yazma denetimi tool bazinda McpController'da
      // yapilir (mutating tool + read-only key = ret).
      const method = req.method.toUpperCase();
      const isMutating = !['GET', 'HEAD', 'OPTIONS'].includes(method);
      const path = (req.path ?? req.url ?? '');
      const isMcpTransport = /\/mcp\/?$/.test(path.split('?')[0] ?? '');
      if (!isMcpTransport) {
        const required = this.apiKeys.requiredScope(method, path);
        if (required) {
          if (!this.apiKeys.hasScopeForRoute(apiKey.scopes, required)) {
            throw new ForbiddenException(`Bu API anahtarinda "${required}" scope'u yok. Anahtari bu scope ile yeniden uret.`);
          }
        } else if (isMutating) {
          // Bilinmeyen kaynak — geriye donuk uyum icin kaba kural korunur.
          const canWrite = apiKey.scopes.includes('*') || apiKey.scopes.some((s) => s.endsWith(':write'));
          if (!canWrite) {
            throw new ForbiddenException('Bu API anahtari salt-okunur (yalnizca :read scope). Yazma islemi icin :write scope\'lu anahtar uret.');
          }
        }
      }

      (req as any).user = user;
      (req as any).apiKey = apiKey;
      return true;
    }

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
