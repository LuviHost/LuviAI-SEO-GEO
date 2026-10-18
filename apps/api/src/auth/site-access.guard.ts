import { CanActivate, ExecutionContext, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { PrismaService } from '../prisma/prisma.service.js';
import { isCanonicalSiteId } from '../common/site-id.js';

export const SITE_NOT_FOUND_MESSAGE = 'Site bulunamadı';

/**
 * `sites/:siteId/*` rotalarinda site sahipligini dogrular.
 * Global AuthGuard'dan sonra calisir; req.user dolu olmalidir.
 * ADMIN rolu tum sitelere erisebilir.
 *
 * `@Public()` ile isaretli rotalari atla — siteId param'i olsa da sahiplik
 * kontrolu yapma (public endpoint'ler kimlik istemez).
 *
 * KANONIK KIMLIK: `:siteId` common/site-id.ts kuralina uymuyorsa (or. buyuk
 * harfli ya da sonu bosluklu yazim) 404 — @Public rotalar DAHIL ve DB'ye
 * gitmeden. NEDEN: sites tablosunun harmanlamasi harf/aksan/bosluk farkini
 * yok sayar; varyant ayni siteyi bulur ama rota duzeyindeki hiz siniri
 * guard'lari (PersonaChatThrottlerGuard, SiteUserThrottlerGuard,
 * AiSitemapThrottlerGuard) ham parametreyle sayar ve her varyant yeni bir
 * kova acardi. Global guard'lar rota guard'larindan ONCE calisir (Nest sirasi:
 * global, sonra sinif, sonra metot), yani bu denetim tum site kovalarinin
 * onundedir.
 * Satir bulunduktan sonra da `site.id` parametreyle BIREBIR ayni olmali.
 */
@Injectable()
export class SiteAccessGuard implements CanActivate {
  constructor(
    private readonly prisma: PrismaService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<Request & { user?: any }>();
    const siteId = (req.params as Record<string, string> | undefined)?.siteId;
    if (siteId !== undefined && !isCanonicalSiteId(siteId)) {
      throw new NotFoundException(SITE_NOT_FOUND_MESSAGE);
    }

    const isPublic = this.reflector.getAllAndOverride<boolean>('isPublic', [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (isPublic) return true;

    if (!siteId) return true; // siteId yoksa dogrulayacak bir sey yok

    const user = req.user;
    if (!user) return true; // AuthGuard zaten 401 atmis olmali; biz tekrar atmiyoruz

    const site = await this.prisma.site.findUnique({
      where: { id: siteId },
      select: { id: true, userId: true },
    });
    // Harmanlama esitligi yetmez: bulunan satirin kimligi birebir ayni degilse yok say
    if (!site || site.id !== siteId) throw new NotFoundException(SITE_NOT_FOUND_MESSAGE);
    if (user.role !== 'ADMIN' && site.userId !== user.id) {
      throw new ForbiddenException('Bu site sana ait degil');
    }
    return true;
  }
}
