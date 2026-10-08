import { CanActivate, ExecutionContext, Injectable, NotFoundException } from '@nestjs/common';
import type { Request } from 'express';
import { PrismaService } from '../prisma/prisma.service.js';

/**
 * `sites/:siteId/aso/*` rotalarinda URL'deki alt kaynagin (TrackedApp,
 * TrackedAppKeyword) GERCEKTEN o siteye ait oldugunu dogrular.
 *
 * NEDEN: Global SiteAccessGuard yalnizca `:siteId` sahipligine bakar.
 * AsoController ise `getApp(appId)`, `deleteApp(appId)`,
 * `removeKeyword(keywordId)` gibi servis cagrilarini siteId'siz yapiyordu →
 * kendi sitesi olan herhangi bir kullanici, kimligini bildigi BASKA bir
 * kullanicinin uygulamasini okuyup silebiliyordu (IDOR).
 *
 * Eslesmeyen kaynakta 403 yerine 404: varligini da sizdirmayalim.
 * Global guard'lardan (AuthGuard → SiteAccessGuard) SONRA calisir.
 */
@Injectable()
export class AsoResourceGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<Request>();
    const params = (req.params ?? {}) as Record<string, string | undefined>;
    const siteId = params.siteId;
    if (!siteId) return true;

    if (params.appId) {
      const app = await this.prisma.trackedApp.findUnique({
        where: { id: params.appId },
        select: { siteId: true },
      });
      if (!app || app.siteId !== siteId) throw new NotFoundException('Uygulama bulunamadi');
    }

    if (params.keywordId) {
      const kw = await this.prisma.trackedAppKeyword.findUnique({
        where: { id: params.keywordId },
        select: { trackedApp: { select: { siteId: true } } },
      });
      if (!kw || kw.trackedApp.siteId !== siteId) throw new NotFoundException('Anahtar kelime bulunamadi');
    }

    return true;
  }
}
