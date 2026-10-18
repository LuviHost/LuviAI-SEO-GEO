import { Inject, Injectable, Optional, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import {
  InjectThrottlerOptions,
  InjectThrottlerStorage,
  type ThrottlerLimitDetail,
  type ThrottlerModuleOptions,
  type ThrottlerStorage,
} from '@nestjs/throttler';
import { ProxyThrottlerGuard } from '../common/proxy-throttler.guard.js';
import { clientIp } from '../common/client-ip.js';
import { isCanonicalSiteId, siteBucketKey } from '../common/site-id.js';
import { PrismaService } from '../prisma/prisma.service.js';

/**
 * Herkese acik persona sohbet ucu (POST /sites/:siteId/audit/persona/chat)
 * icin hiz siniri.
 *
 * NEDEN: uc @Public — musteri sitesine gomulu widget'tan gelen her ziyaretci
 * mesaji RanksUp'in Anthropic anahtariyla bir model cagrisi demek. Tek siniri
 * global IP limitiydi (varsayilan 60 istek/dk); bir betik tek IP'den saatte
 * binlerce cagri yaptirabiliyordu. Kimlik yok, bu yuzden kullanici kovasi
 * (SiteUserThrottlerGuard) kullanilamaz; iki ayri kova sayilir:
 *
 *  1. ZIYARETCI + SITE (PERSONA_CHAT_IP_THROTTLE): istemci IP'si
 *     common/client-ip.ts kuralindan (CF-Connecting-IP, sonra XFF'in sagdan ilk
 *     dis adresi). Insan sohbeti 10 dakikada 20 mesaji asmaz.
 *  2. SITE TOPLAMI (PERSONA_CHAT_SITE_THROTTLE): IP degistiren (dagitik)
 *     istemci de bir sitenin gunluk model harcamasini sinirsiz buyutemesin.
 *     Varsayilan gunde 300 mesaj; PERSONA_CHAT_SITE_DAILY_LIMIT ile degisir.
 *     Bedeli: sinir dolunca o sitenin widget'i gun sonuna kadar 429 doner.
 *
 * Iki kovada da site parcasi yalniz VAR OLAN site icin kendi kimligidir;
 * kurala uymayan ya da DB'de olmayan kimlikler ortak kovalarda sayilir
 * (UNKNOWN_SITE_BUCKET, siteKey).
 *
 * Global ProxyThrottlerGuard (kimlik dogrulamadan once) yine calisir; bu guard
 * rota duzeyinde (@UseGuards) ve kendi kova adlariyla sayar, 'default' kovasi
 * ikinci kez sayilmaz. Depolama ThrottlerModule.forRoot'un bellek deposudur:
 * sinirlar API sureci basinadir (birden cok surec varsa carpilir).
 */
export const PERSONA_CHAT_IP_THROTTLE = 'persona-ip-site';
export const PERSONA_CHAT_SITE_THROTTLE = 'persona-site';

/** Ziyaretci IP'si + site basina: 10 dakikada 20 mesaj */
export const PERSONA_CHAT_IP_LIMIT = { limit: 20, ttl: 10 * 60_000 } as const;

const DAY_MS = 24 * 60 * 60_000;

/** Site basina gunluk toplam; gecersiz/eksik ortam degiskeninde 300 */
export function personaChatSiteLimit(env: NodeJS.ProcessEnv = process.env): { limit: number; ttl: number } {
  const n = Number(env.PERSONA_CHAT_SITE_DAILY_LIMIT);
  return { limit: Number.isInteger(n) && n > 0 ? n : 300, ttl: DAY_MS };
}

/**
 * Veritabaninda OLMAYAN her (kanonik) site kimliginin paylastigi tek kova.
 *
 * NEDEN: kovalar site kimligiyle sayilir ve uc @Public; SiteAccessGuard bu
 * rotada yalniz bicimi denetler (DB'ye gitmez). Uydurma kanonik kimlikler
 * ('x1', 'x2', ...) her istekte iki YENI kova aciyordu: hem IP+site hem site
 * kovasi. @nestjs/throttler 6 bellek deposu (ThrottlerStorageService) bir
 * anahtari hic silmez ve her sayilan istek icin kova suresi (site kovasinda
 * 24 saat) kadar yasayan bir zamanlayici kurar (kurulu 6.5.0
 * dist/throttler.service.js: `_storage` Map'inden silme yok,
 * setExpirationTime istek basina setTimeout; persona-chat-throttler.guard.spec
 * eski guard'da istek basina 2 yeni anahtar olctu). Yani tek IP bile (global
 * 60/dk icinde) depoyu gunde ~86 bin anahtar + zamanlayici buyutup sureci
 * PM2'nin bellek sinirina itebiliyordu, ustelik her uydurma kimlik taze bir
 * gunluk butceyle basliyordu. Artik bilinmeyen kimlikler tek kovada sayilir:
 * depo en fazla (gercek site sayisi + birkac ortak kova) site anahtari tutar.
 */
export const UNKNOWN_SITE_BUCKET = '!bilinmeyen';

/** Site varlik onbellegi: en fazla bu kadar kimlik (asilinca en eski atilir) */
export const SITE_EXISTENCE_CACHE_MAX = 5_000;
/** Var olan site 10 dk, olmayan 1 dk hatirlanir (yeni acilan site en gec 1 dk'da kendi kovasina gecer) */
const SITE_EXISTS_TTL_MS = 10 * 60_000;
const SITE_MISSING_TTL_MS = 60_000;

type SiteLookup = Pick<PrismaService, 'site'>;

@Injectable()
export class PersonaChatThrottlerGuard extends ProxyThrottlerGuard {
  private readonly siteExistence = new Map<string, { exists: boolean; until: number }>();
  /** Iki kova ayni istek icin site anahtarini bir kez hesaplasin (tek DB sorgusu) */
  private readonly siteKeyOfRequest = new WeakMap<object, Promise<string>>();

  constructor(
    @InjectThrottlerOptions() options: ThrottlerModuleOptions,
    @InjectThrottlerStorage() storageService: ThrottlerStorage,
    reflector: Reflector,
    // Acik belirtec: vitest dekorator metadata'si uretmez; tsc ise Pick<> icin
    // Object yazardi. PrismaModule global; yoksa (elle kurulan guard) eski davranis.
    @Optional() @Inject(PrismaService) private readonly prisma?: SiteLookup,
  ) {
    super(options, storageService, reflector);
  }

  async onModuleInit(): Promise<void> {
    await super.onModuleInit();
    // Yalniz kendi kovalarimiz; 'default' sinirini global guard zaten uyguladi
    this.throttlers = [
      {
        name: PERSONA_CHAT_IP_THROTTLE,
        ...PERSONA_CHAT_IP_LIMIT,
        getTracker: async (req) => `ip:${clientIp(req) || 'unknown'}|site:${await this.siteKey(req)}`,
      },
      {
        name: PERSONA_CHAT_SITE_THROTTLE,
        ...personaChatSiteLimit(),
        getTracker: async (req) => `site:${await this.siteKey(req)}`,
      },
    ];
  }

  /**
   * Kova anahtari icin site parcasi.
   *  - Kurala uymayan yazim (common/site-id.ts) tek ortak kovada: harmanlama
   *    harf farkini yok saydigi icin 'CMSQ...' ayni sitenin modelini yeni ve
   *    bos bir gunluk butceyle cagiriyordu.
   *  - Kanonik ama DB'de olmayan kimlik UNKNOWN_SITE_BUCKET'ta (yukaridaki neden).
   *  - Var olan site kendi kimligiyle.
   */
  private siteKey(req: Record<string, any>): Promise<string> {
    const known = this.siteKeyOfRequest.get(req);
    if (known) return known;
    const key = this.resolveSiteKey(req?.params?.siteId);
    if (req && typeof req === 'object') this.siteKeyOfRequest.set(req, key);
    return key;
  }

  private async resolveSiteKey(raw: unknown): Promise<string> {
    const key = siteBucketKey(raw);
    if (!isCanonicalSiteId(raw) || !this.prisma) return key;
    return (await this.siteExists(raw)) ? key : UNKNOWN_SITE_BUCKET;
  }

  private async siteExists(siteId: string): Promise<boolean> {
    const now = Date.now();
    const hit = this.siteExistence.get(siteId);
    if (hit && hit.until > now) return hit.exists;
    let exists: boolean;
    try {
      const row = await this.prisma!.site.findUnique({ where: { id: siteId }, select: { id: true } });
      // Harmanlama esitligi yetmez: bulunan satirin kimligi birebir ayni olmali (site-id.ts)
      exists = !!row && row.id === siteId;
    } catch {
      // DB hatasi: eski davranis (sitenin kendi kovasi) ve onbellege yazilmaz;
      // servis ayni istekte DB'ye gidip hatayi zaten gosterir
      return true;
    }
    this.siteExistence.delete(siteId);
    if (this.siteExistence.size >= SITE_EXISTENCE_CACHE_MAX) {
      // Map ekleme sirasini korur: ilk anahtar en eski kayit
      const oldest = this.siteExistence.keys().next().value;
      if (oldest !== undefined) this.siteExistence.delete(oldest);
    }
    this.siteExistence.set(siteId, { exists, until: now + (exists ? SITE_EXISTS_TTL_MS : SITE_MISSING_TTL_MS) });
    return exists;
  }

  protected async getErrorMessage(_context: ExecutionContext, detail: ThrottlerLimitDetail): Promise<string> {
    if (detail.tracker.startsWith('site:')) {
      return 'Bu sitenin sohbet asistanı bugünkü mesaj sınırına ulaştı. Lütfen daha sonra tekrar deneyin.';
    }
    const minutes = Math.max(1, Math.ceil(detail.timeToBlockExpire / 60));
    return `Kısa sürede çok fazla mesaj gönderildi. Yaklaşık ${minutes} dakika sonra tekrar deneyin.`;
  }
}
