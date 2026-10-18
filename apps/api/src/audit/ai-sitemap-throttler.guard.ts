import { Injectable, type ExecutionContext } from '@nestjs/common';
import type { ThrottlerLimitDetail } from '@nestjs/throttler';
import { ProxyThrottlerGuard } from '../common/proxy-throttler.guard.js';
import { clientIp } from '../common/client-ip.js';
import { siteBucketKey } from '../common/site-id.js';

/**
 * Herkese acik AI site haritasi (GET /sites/:siteId/audit/sitemap-ai.xml)
 * icin istemci IP'si basina hiz siniri.
 *
 * NEDEN: uc @Public — musteri robots.txt'ine ekledigi icin arama motoru
 * botlari kimliksiz okur. Uretim pahali olabilir (1000 makalelik sorgu, ana
 * sayfa okumasi); servis sonucu site basina 10 dk onbellekte tutar, bu guard
 * de tek istemcinin ayni haritayi durmadan istemesini keser.
 *
 * KOVA = IP + site: arama motoru botlari bizim host'umuzdaki pek cok
 * musterinin haritasini ayni IP'den okuyabilir; yalniz IP'ye bagli bir kova
 * mesru botu 429'a dusurur, Google da 429'u host'un tarama hizini dusurme
 * isareti sayar. Bot her haritayi gunde birkac kez okur; 10 dakikada 30 istek
 * bunu kesmez. Farkli siteleri tarayan tek IP'yi global ProxyThrottlerGuard
 * (varsayilan dakikada 60 istek, IP basina) sinirlar; site kimlikleri tahmin
 * edilemez (cuid). IP kurali common/client-ip.ts (CF-Connecting-IP, sonra
 * XFF'in sagdan ilk dis adresi). Depolama ThrottlerModule'un bellek deposu:
 * sinir API sureci basinadir.
 */
export const AI_SITEMAP_IP_THROTTLE = 'ai-sitemap-ip-site';

/** IP + site basina: 10 dakikada 30 istek */
export const AI_SITEMAP_IP_LIMIT = { limit: 30, ttl: 10 * 60_000 } as const;

/**
 * Kova anahtari icin site kimligi: yalniz kanonik kimlik (common/site-id.ts);
 * harf/bosluk varyanti ayni haritayi yeni bir kovayla isteyemesin. Kurala
 * uymayan tum yazimlar tek ortak kovayi paylasir.
 */
function siteKey(req: Record<string, any>): string {
  return siteBucketKey(req?.params?.siteId);
}

@Injectable()
export class AiSitemapThrottlerGuard extends ProxyThrottlerGuard {
  async onModuleInit(): Promise<void> {
    await super.onModuleInit();
    // Yalniz kendi kovamiz; 'default' sinirini global guard zaten uyguladi
    this.throttlers = [
      {
        name: AI_SITEMAP_IP_THROTTLE,
        ...AI_SITEMAP_IP_LIMIT,
        getTracker: (req) => `ip:${clientIp(req) || 'unknown'}|site:${siteKey(req)}`,
      },
    ];
  }

  protected async getErrorMessage(_context: ExecutionContext, detail: ThrottlerLimitDetail): Promise<string> {
    const minutes = Math.max(1, Math.ceil(detail.timeToBlockExpire / 60));
    return `Bu site haritası kısa sürede çok fazla istendi. Yaklaşık ${minutes} dakika sonra tekrar deneyin.`;
  }
}
