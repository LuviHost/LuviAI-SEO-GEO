import { Injectable, type ExecutionContext } from '@nestjs/common';
import type { ThrottlerLimitDetail } from '@nestjs/throttler';
import { ProxyThrottlerGuard } from '../common/proxy-throttler.guard.js';
import { siteBucketKey } from '../common/site-id.js';

/**
 * Model cagiran pahali uclar icin SITE + KULLANICI basina hiz siniri.
 *
 * NEDEN: GET /sites/:siteId/audit/snippets istek basina 8'e kadar ucretli
 * model cagrisi yapar (snippet-generator.service.ts generateForPage); tek
 * siniri global IP limitiydi (varsayilan 60 istek/dk — dakikada ~480 model
 * cagrisi). Global ProxyThrottlerGuard kimlik dogrulamadan ONCE calisir
 * (kimliksiz flood DB'ye ulasmasin diye) ve kullaniciyi bilemez.
 *
 * Bu guard rota duzeyinde (@UseGuards) kullanilir: Nest once global
 * guard'lari (Throttler → Auth → SiteAccess → PlanFeature) isletir, yani
 * burada req.user ve site sahipligi dogrulanmis olur. Kova anahtari kullanici
 * + site + rota: IP degistirmek siniri asmaz, baska bir kullanici da senin
 * kovani tuketemez (kimliksiz istek bu guard'a hic ulasmaz).
 *
 * Sayac ayni ThrottlerStorage'da (ThrottlerModule.forRoot, global) ama kendi
 * adiyla tutulur: global 'default' kovasi ikinci kez sayilmaz. Limit / sure
 * rotadaki @Throttle({ [SITE_USER_THROTTLE]: { limit, ttl } }) ile verilir;
 * yoksa asagidaki varsayilan gecerlidir. Depolama sureci basinadir (bellek).
 */
export const SITE_USER_THROTTLE = 'site-user';

/** Varsayilan: saatte 20 istek (kullanici + site + rota basina) */
export const SITE_USER_THROTTLE_DEFAULT = { limit: 20, ttl: 60 * 60_000 } as const;

@Injectable()
export class SiteUserThrottlerGuard extends ProxyThrottlerGuard {
  async onModuleInit(): Promise<void> {
    await super.onModuleInit();
    // Yalniz kendi kovamiz; 'default' sinirini global guard zaten uyguladi
    this.throttlers = [{ name: SITE_USER_THROTTLE, ...SITE_USER_THROTTLE_DEFAULT }];
  }

  protected async getTracker(req: Record<string, any>): Promise<string> {
    const userId = req?.user?.id;
    // Kanonik kimlik (common/site-id.ts): ham parametreyle 'CMSQ...' ayni
    // sitenin saatlik model tavanini bos bir kovayla yeniden aciyordu
    const siteId = siteBucketKey(req?.params?.siteId);
    // Rota AuthGuard'dan sonra calisir; kullanici yoksa (beklenmez) IP'ye dus
    const who = userId ? `user:${userId}` : `ip:${await super.getTracker(req)}`;
    return `${who}|site:${siteId}`;
  }

  protected async getErrorMessage(_context: ExecutionContext, detail: ThrottlerLimitDetail): Promise<string> {
    const minutes = Math.max(1, Math.ceil(detail.timeToBlockExpire / 60));
    const windowMin = Math.max(1, Math.round(detail.ttl / 60_000));
    return `Bu site için kısa sürede çok fazla üretim isteği gönderildi (${windowMin} dakikada en fazla ${detail.limit}). Yaklaşık ${minutes} dakika sonra tekrar dene.`;
  }
}
