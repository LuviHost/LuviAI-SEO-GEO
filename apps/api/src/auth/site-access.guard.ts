import { CanActivate, ExecutionContext, ForbiddenException, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import type { Request } from 'express';
import { PrismaService } from '../prisma/prisma.service.js';

/**
 * `sites/:siteId/*` rotalarinda site sahipligini dogrular.
 * Global AuthGuard'dan sonra calisir; req.user dolu olmalidir.
 * ADMIN rolu tum sitelere erisebilir.
 */
@Injectable()
export class SiteAccessGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<Request & { user?: any }>();
    const user = req.user;
    if (!user) throw new UnauthorizedException();

    const siteId = (req.params as Record<string, string> | undefined)?.siteId;
    if (!siteId) return true; // siteId yoksa dogrulayacak bir sey yok

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
