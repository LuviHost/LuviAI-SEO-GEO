import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { PaytrService } from './paytr.service.js';
import { isTrialExpired, trialAccess, TRIAL_EXPIRED_CODE, TRIAL_EXPIRED_READ_ONLY_MESSAGE, type TrialSubject } from './trial-policy.js';
import { AI_ACTION_KEY, TRIAL_READ_ONLY_EXEMPT_KEY } from './trial-read-only.decorator.js';

/** Salt okunur hesapta acik kalan HTTP yontemleri (goruntuleme, indirme, CORS on kontrolu) */
const READ_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Deneme suresi dolmus hesabi SUNUCUDA salt okunur yapar (sahip karari 21.10.2026,
 * kural trial-policy.ts trialAccess). Panel modali yalniz gorunumdur; asil kapi bu.
 *
 * Kural (yalniz trialAccess(...).readOnly ise; yani deneme dolmus VE satin alma acik):
 *  - GET/HEAD/OPTIONS acik (gorme, CSV/Markdown indirme, rapor) — @AiAction() isaretli
 *    GET haric (yapay zeka maliyeti olan okuma).
 *  - Diger her yontem 403 + code TRIAL_EXPIRED; @TrialReadOnlyExempt() isaretli uclar
 *    haric (odeme, hesap silme, auth, bildirimler).
 * Satin alma kapaliyken (PayTR test modu, yonetici disinda kimse odeyemez) kilit
 * uygulanmaz: plan secemeyen kullanici kilitlenmez, yalniz 2 makale hakki kurali kalir.
 *
 * Global AuthGuard / SiteAccessGuard / PlanFeatureGuard'dan SONRA calisir (app.module
 * kayit sirasi); req.user tam User satiridir. Herkese acik uc (req.user yok) ve yonetici
 * muaf. Satin alma durumu yalniz suresi dolmus hesap icin sorulur (canli modda DB'ye
 * hic gitmez: PaytrService.checkoutStatus).
 */
@Injectable()
export class TrialExpiryGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    // Somut sinif: Nest DI tipi emitDecoratorMetadata ile okur (Pick<> Object olurdu)
    private readonly paytr: PaytrService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    if (ctx.getType() !== 'http') return true;
    const req = ctx.switchToHttp().getRequest<Request & { user?: TrialSubject & { id?: string } }>();
    const user = req.user;
    if (!user?.id || user.role === 'ADMIN') return true;
    // Ucuz on eleme: deneme dolmamissa ne yontem ne isaret okunur
    if (!isTrialExpired(user)) return true;

    const targets = [ctx.getHandler(), ctx.getClass()];
    const method = String(req.method ?? 'GET').toUpperCase();
    const aiRead = this.reflector.getAllAndOverride<boolean>(AI_ACTION_KEY, targets) === true;
    if (READ_METHODS.has(method) && !aiRead) return true;
    if (!aiRead && this.reflector.getAllAndOverride<boolean>(TRIAL_READ_ONLY_EXEMPT_KEY, targets) === true) return true;

    const checkout = await this.paytr.checkoutStatus(user.id);
    if (!trialAccess(user, { checkoutOpen: checkout.open }).readOnly) return true;
    throw new ForbiddenException({ statusCode: 403, message: TRIAL_EXPIRED_READ_ONLY_MESSAGE, code: TRIAL_EXPIRED_CODE });
  }
}
