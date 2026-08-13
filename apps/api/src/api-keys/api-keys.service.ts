import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service.js';

export const ALL_SCOPES = [
  'articles:read', 'articles:write',
  'sites:read', 'sites:write',
  'audit:read', 'audit:write',
  'ads:read', 'ads:write',
  'analytics:read',
  'social:read', 'social:write',
] as const;

export type Scope = typeof ALL_SCOPES[number];

/**
 * Scope belirtilmeden uretilen anahtarin varsayilan yetkisi: TUM okuma.
 *
 * Onceden ads:read burada YOKTU. Scope denetimi kaynak bazina cikinca bu
 * eksiklik, varsayilan anahtarla calisan entegrasyonlarin /ads listeleme
 * uclarini kaybetmesi anlamina geliyordu. Varsayilan "her seyi oku, hicbir
 * seyi yazma" olarak netlestirildi.
 */
export const DEFAULT_SCOPES: Scope[] = ALL_SCOPES.filter((s) => s.endsWith(':read'));

/**
 * Rota yolundaki segment -> scope kaynagi eslesmesi.
 *
 * Yalnizca ALL_SCOPES'ta GERCEKTEN var olan kaynaklar burada listelenir.
 * Listede olmayan bir segment (aso, topics, chat, ai-keys, action-plan,
 * publish-targets, spend, billing, admin, me ...) bilinmeyen kabul edilir ve
 * cagiran taraf eski davranisa duser — bkz. requiredScope().
 */
const ROUTE_RESOURCE: Record<string, string> = {
  sites: 'sites',
  articles: 'articles',
  audit: 'audit',
  ads: 'ads',
  analytics: 'analytics',
  social: 'social',
};

@Injectable()
export class ApiKeysService {
  private readonly log = new Logger(ApiKeysService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Yeni API key olustur (token sadece yaratimda gosterilir, sonra hash saklanir).
   */
  async create(userId: string, opts: { name: string; scopes?: string[]; expiresInDays?: number; rateLimit?: number }) {
    const tokenRaw = `luvi_${randomBytes(28).toString('base64url')}`;
    const keyHash = this.hash(tokenRaw);
    const prefix = tokenRaw.slice(0, 12);

    // Scope dogrulamasi — YETKI YUKSELTMEYI ENGELLER.
    // Bu kontrol yokken gelen dizi oldugu gibi kaydediliyordu: dar yetkili bir
    // anahtar POST /api-keys ile scopes:['*'] isteyip tam yetkili yeni bir
    // anahtar uretebiliyor, boylece kaynak bazli scope denetimini tamamen
    // atlayabiliyordu. '*' artik disaridan verilemez.
    const requested = opts.scopes;
    if (requested !== undefined) {
      if (!Array.isArray(requested)) {
        throw new BadRequestException('scopes bir dizi olmali');
      }
      const invalid = requested.filter((s) => !(ALL_SCOPES as readonly string[]).includes(s));
      if (invalid.length) {
        throw new BadRequestException(
          `Gecersiz scope: ${invalid.join(', ')}. Gecerli scope'lar: ${ALL_SCOPES.join(', ')}`,
        );
      }
    }

    const apiKey = await this.prisma.apiKey.create({
      data: {
        userId,
        name: opts.name,
        scopes: (requested ?? DEFAULT_SCOPES) as any,
        keyHash,
        prefix,
        rateLimit: opts.rateLimit ?? 60,
        expiresAt: opts.expiresInDays ? new Date(Date.now() + opts.expiresInDays * 86400000) : null,
      },
    });

    this.log.log(`[${userId}] API key created: ${apiKey.id}, prefix=${prefix}`);

    // Token sadece BIR DEFA donulur — kullanici bu noktada kopyalayip saklamali
    return {
      id: apiKey.id,
      name: apiKey.name,
      token: tokenRaw,
      prefix,
      scopes: apiKey.scopes,
      rateLimit: apiKey.rateLimit,
      expiresAt: apiKey.expiresAt,
      createdAt: apiKey.createdAt,
    };
  }

  async list(userId: string) {
    const keys = await this.prisma.apiKey.findMany({
      where: { userId, revokedAt: null },
      orderBy: { createdAt: 'desc' },
      select: { id: true, name: true, prefix: true, scopes: true, rateLimit: true, lastUsedAt: true, expiresAt: true, createdAt: true } as any,
    });
    return keys;
  }

  async revoke(userId: string, keyId: string) {
    // Ensure ownership
    const key = await this.prisma.apiKey.findUnique({ where: { id: keyId } });
    if (!key || key.userId !== userId) {
      throw new Error('API key bulunamadi');
    }
    return this.prisma.apiKey.update({
      where: { id: keyId },
      data: { revokedAt: new Date() },
    });
  }

  /**
   * Auth guard tarafindan cagrilir — token geldiyse user resolve et.
   * @returns { userId, scopes } veya null
   */
  async validate(token: string): Promise<{ userId: string; scopes: string[]; keyId: string } | null> {
    if (!token.startsWith('luvi_')) return null;
    const keyHash = this.hash(token);

    const key: any = await this.prisma.apiKey.findUnique({ where: { keyHash } });
    if (!key) return null;
    if (key.revokedAt) return null;
    if (key.expiresAt && new Date() > key.expiresAt) return null;

    // lastUsedAt async update — performans
    this.prisma.apiKey.update({ where: { id: key.id }, data: { lastUsedAt: new Date() } }).catch(() => {});

    return {
      userId: key.userId,
      scopes: Array.isArray(key.scopes) ? (key.scopes as string[]) : [],
      keyId: key.id,
    };
  }

  hasScope(userScopes: string[], required: string): boolean {
    return userScopes.includes(required) || userScopes.includes('*');
  }

  /**
   * Rota bazli scope kontrolu — hasScope uzerine tek kural ekler:
   * ':write' tasiyan anahtar ayni kaynagin ':read'ini de kapsar.
   * (Yazma yetkisi olup okuma yetkisi olmayan anahtar mantiksiz olurdu ve
   *  mevcut entegrasyonlari gereksiz yere kirardi.)
   */
  hasScopeForRoute(userScopes: string[], required: string): boolean {
    if (this.hasScope(userScopes, required)) return true;
    if (required.endsWith(':read')) {
      return this.hasScope(userScopes, `${required.slice(0, -':read'.length)}:write`);
    }
    return false;
  }

  /**
   * Istek yolundan scope kaynagini cikarir.
   *
   * Rotalarin cogu /api/sites/:siteId/<alt-kaynak> seklinde ic ice oldugu icin
   * duz "ilk segment" yetmez: /sites/abc/articles yolunun kaynagi 'sites' degil
   * 'articles'tir. Kural:
   *   /sites, /sites/:id                 -> 'sites'
   *   /sites/:id/<alt>/...               -> <alt> (eslesirse)
   *   /<kok>/...                         -> <kok> (eslesirse)
   * Eslesme yoksa null doner.
   */
  resolveResource(path: string): string | null {
    const clean = (path.split('?')[0] ?? '').replace(/\/+$/, '');
    const segs = clean.split('/').filter(Boolean);
    if (segs[0] === 'api') segs.shift(); // main.ts: setGlobalPrefix('api')
    if (!segs.length) return null;

    // /sites/:siteId/<alt-kaynak> — alt kaynak belirleyicidir
    if (segs[0] === 'sites' && segs.length >= 3) {
      return ROUTE_RESOURCE[segs[2]] ?? null;
    }
    return ROUTE_RESOURCE[segs[0]] ?? null;
  }

  /**
   * Metod + yol icin gereken scope adi. Bulunamazsa null.
   *
   * null iki durumda doner ve her ikisinde de cagiran taraf ESKI davranisa
   * dusmelidir (mutasyon icin herhangi bir ':write'):
   *  1. Yol bilinen bir kaynaga eslesmiyor (orn. /aso, /billing, /me).
   *  2. Hesaplanan scope ALL_SCOPES'ta yok — orn. 'analytics:write' diye bir
   *     scope uretilemiyor, dolayisiyla POST /sites/:id/analytics/snapshot-now
   *     icin onu sart kosmak ucu tamamen erisilmez yapardi.
   */
  requiredScope(method: string, path: string): string | null {
    const resource = this.resolveResource(path);
    if (!resource) return null;
    const isMutating = !['GET', 'HEAD', 'OPTIONS'].includes(method.toUpperCase());
    const scope = `${resource}:${isMutating ? 'write' : 'read'}`;
    return (ALL_SCOPES as readonly string[]).includes(scope) ? scope : null;
  }

  private hash(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }
}
