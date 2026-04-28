import { CanActivate, ExecutionContext, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { PrismaService } from '../prisma/prisma.service.js';

/**
 * `sites/:siteId/*` rotalarinda site sahipligini dogrular.
 * Global AuthGuard'dan sonra calisir; req.user dolu olmalidir.
 * ADMIN rolu tum sitelere erisebilir.
 *
 * `@Public()` ile isaretli rotalari atla — siteId param'i olsa da sahiplik
 * kontrolu yapma (public endpoint'ler kimlik istemez).
 */
@Injectable()
export class SiteAccessGuard implements CanActivate {
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

    const req = ctx.switchToHttp().getRequest<Request & { user?: any }>();
    const siteId = (req.params as Record<string, string> | undefined)?.siteId;
    if (!siteId) return true; // siteId yoksa dogrulayacak bir sey yok

    const user = req.user;
    if (!user) return true; // AuthGuard zaten 401 atmis olmali; biz tekrar atmiyoruz

    const site = await this.prisma.site.findUnique({
      where: { id: siteId },
      select: { id: true, userId: true },
    });
    if (!site) throw new NotFoundException('Site bulunamadi');
    if (user.role !== 'ADMIN' && site.userId !== user.id) {
      throw new ForbiddenException('Bu site sana ait degil');
    }
    return true;
  }
}
