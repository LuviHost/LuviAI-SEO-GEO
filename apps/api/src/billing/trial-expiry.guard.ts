import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { PaytrService } from './paytr.service.js';
import {
  isTrialExpired, trialAccess, LAPSED_CUSTOMER_READ_ONLY, TRIAL_EXPIRED_CODE, TRIAL_EXPIRED_READ_ONLY_MESSAGE, type TrialSubject,
} from './trial-policy.js';
import { AI_ACTION_KEY, TRIAL_READ_ONLY_EXEMPT_KEY } from './trial-read-only.decorator.js';

/** Salt okunur hesapta acik kalan HTTP yontemleri (goruntuleme, indirme, CORS on kontrolu) */
const READ_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

type TrialUser = TrialSubject & { id?: string };

/**
 * Bu hesap SU AN salt okunur mu? Kapi (TrialExpiryGuard) ve arac bazli denetim
 * (MCP tools/call) ayni karari kullanir. Ucuz on eleme (deneme dolmamis, yonetici,
 * ucretli plan) DB'ye gitmez; dolmus deneme icin satin alma durumu ve "hic odedi mi"
 * (ever-paid.ts; eski musteri kilitlenmez, LAPSED_CUSTOMER_READ_ONLY) sorulur.
 */
export async function trialReadOnlyNow(
  user: TrialUser | null | undefined,
  paytr: Pick<PaytrService, 'checkoutStatus' | 'hasEverPaid'>,
): Promise<boolean> {
  if (!user?.id || user.role === 'ADMIN' || !isTrialExpired(user)) return false;
  const [checkout, everPaid] = await Promise.all([
    paytr.checkoutStatus(user.id),
    // Bayrak acikken eski musteri de kilitlenir: sorguya gerek yok
    LAPSED_CUSTOMER_READ_ONLY ? Promise.resolve(false) : paytr.hasEverPaid(user.id),
  ]);
  return trialAccess(user, { checkoutOpen: checkout.open, everPaid }).readOnly;
}

/** Salt okunur hesabin yapay zeka / icerik yazma eylemine 403 govdesi (panel code ile modal acar) */
export function trialExpiredError(): ForbiddenException {
  return new ForbiddenException({ statusCode: 403, message: TRIAL_EXPIRED_READ_ONLY_MESSAGE, code: TRIAL_EXPIRED_CODE });
}

/**
 * Deneme suresi dolmus hesabi SUNUCUDA salt okunur yapar (sahip karari 21.10.2026,
 * kural trial-policy.ts trialAccess). Panel modali yalniz gorunumdur; asil kapi bu.
 *
 * Kural (yalniz trialReadOnlyNow ise; yani GERCEK deneme hesabi — hic PAID faturasi
 * yok —, suresi dolmus VE satin alma acik):
 *  - GET/HEAD/OPTIONS acik (gorme, CSV/Markdown indirme, rapor) — @AiAction() isaretli
 *    GET haric (yapay zeka maliyeti olan okuma).
 *  - DELETE acik — @AiAction() isaretli DELETE haric. NEDEN: silme / geri alma (API
 *    anahtari iptali, yayin hedefi, site, sohbet gecmisi, BYOK anahtari, ASA/ASC hesabi)
 *    yapay zeka harcamaz ve salt okunur hesap kendi verisini ve kimlik bilgilerini
 *    kaldirabilmeli (KVKK; sizan anahtari iptal edememek guvenlik acigi olurdu).
 *  - Diger her yontem 403 + code TRIAL_EXPIRED; @TrialReadOnlyExempt() isaretli uclar
 *    haric (odeme, hesap silme, auth, bildirimler, reklam baglantisini kesme, MCP
 *    tasima ucu — MCP'de arac bazinda denetlenir: mcp.controller.ts).
 * Satin alma kapaliyken (PayTR test modu, yonetici disinda kimse odeyemez) kilit
 * uygulanmaz: plan secemeyen kullanici kilitlenmez, yalniz 2 makale hakki kurali kalir.
 *
 * Global AuthGuard / SiteAccessGuard / PlanFeatureGuard'dan SONRA calisir (app.module
 * kayit sirasi); req.user tam User satiridir. Herkese acik uc (req.user yok) ve yonetici
 * muaf. Satin alma durumu ve odeme gecmisi yalniz suresi dolmus hesabin degistirici
 * isteginde sorulur (canli modda checkoutStatus DB'ye hic gitmez).
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
    const req = ctx.switchToHttp().getRequest<Request & { user?: TrialUser }>();
    const user = req.user;
    if (!user?.id || user.role === 'ADMIN') return true;
    // Ucuz on eleme: deneme dolmamissa ne yontem ne isaret okunur
    if (!isTrialExpired(user)) return true;

    const targets = [ctx.getHandler(), ctx.getClass()];
    const method = String(req.method ?? 'GET').toUpperCase();
    const aiAction = this.reflector.getAllAndOverride<boolean>(AI_ACTION_KEY, targets) === true;
    if (!aiAction) {
      if (READ_METHODS.has(method) || method === 'DELETE') return true;
      if (this.reflector.getAllAndOverride<boolean>(TRIAL_READ_ONLY_EXEMPT_KEY, targets) === true) return true;
    }

    if (!(await trialReadOnlyNow(user, this.paytr))) return true;
    throw trialExpiredError();
  }
}
