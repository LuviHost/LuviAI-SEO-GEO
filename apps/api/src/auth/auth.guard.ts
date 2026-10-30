import { CanActivate, ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { decode } from 'next-auth/jwt';
import { PrismaService } from '../prisma/prisma.service.js';
import { ApiKeysService } from '../api-keys/api-keys.service.js';
import { SESSION_ONLY_KEY } from './session-only.decorator.js';
import { extractSessionToken } from './session-cookie.js';
import { ownerHasPlanFeature } from '../billing/plan-site-filter.js';
import { FEATURE_MIN_PLAN, findPlan } from '../billing/plans.js';

/** Silme talebi olan hesabin istekleri — istemciler 401 ile oturumu kapatir */
export const DELETED_ACCOUNT_MESSAGE = 'Bu hesap için silme talebi alındı; hesaba erişim kapatıldı.';

/**
 * Plani REST API erisimini icermeyen hesabin anahtarla gelen istegi (403).
 * Plan adi plans.ts'ten: plan yeniden adlandirilirsa metin kendiliginden duzelir.
 */
export const API_KEY_PLAN_MESSAGE =
  `Bu API anahtarı şu an çalışmıyor: REST API erişimi ${findPlan(FEATURE_MIN_PLAN.apiAccess)?.name_tr ?? 'Kurumsal'} planına dahil ve hesabının mevcut planı bunu içermiyor. ` +
  'Anahtarların silinmedi; planını yükselttiğinde yeniden çalışır.';

/**
 * NextAuth session JWT'sini doğrular.
 *
 * Frontend (Next.js) NextAuth ile login olur, cookie'de "next-auth.session-token" döner.
 * API çağrılarında bu cookie veya Authorization header gelir.
 * Bu guard:
 *  1. Cookie/header'dan token çıkartır
 *  2. NEXTAUTH_SECRET ile decode eder
 *  3. User ID'yi DB'den lookup eder
 *  4. req.user'a koyar (controller'lar erişebilsin)
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly prisma: PrismaService,
    private readonly reflector: Reflector,
    private readonly apiKeys: ApiKeysService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>('isPublic', [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (isPublic) return true;

    const req = ctx.switchToHttp().getRequest<Request>();

    // ── API Key check (Authorization: Bearer luvi_xxx) ──
    const authHeader = req.headers.authorization;
    if (authHeader?.startsWith('Bearer ') && authHeader.slice(7).startsWith('luvi_')) {
      const token = authHeader.slice(7);
      const apiKey = await this.apiKeys.validate(token);
      if (!apiKey) throw new UnauthorizedException('API key gecersiz');
      const user = await this.prisma.user.findUnique({ where: { id: apiKey.userId } });
      if (!user) throw new UnauthorizedException('User bulunamadi');
      // Anahtarlar silme aninda iptal edilir; bu kontrol iptal kacsa bile erisimi keser
      if (user.deletionRequestedAt) throw new UnauthorizedException(DELETED_ACCOUNT_MESSAGE);

      const sessionOnly = this.reflector.getAllAndOverride<boolean>(SESSION_ONLY_KEY, [ctx.getHandler(), ctx.getClass()]);
      if (sessionOnly) {
        throw new ForbiddenException('Bu işlem yalnız RanksUp panelinden yapılabilir — API anahtarıyla değil.');
      }

      // ── Scope zorlamasi ──
      // Onceden scopes yari dekoratifti: guard yalnizca "mutasyon mu" diye
      // bakip HERHANGI bir ':write' scope'unu yeterli sayiyordu. Yani
      // 'social:write' tasiyan anahtar DELETE /sites cagirabiliyor, okuma
      // scope'lari ise hic denetlenmiyordu.
      //
      // Artik yol -> kaynak eslesmesi yapilir ve gereken scope kaynak bazinda
      // hesaplanir: GET '<kaynak>:read', mutasyon '<kaynak>:write'. '*' her
      // seyi acar; ':write' ayni kaynagin ':read'ini de kapsar.
      //
      // Yol bilinen bir kaynaga eslesmiyorsa (requiredScope null) mevcut
      // entegrasyonlari kirmamak icin ESKI davranisa duseriz: mutasyon icin
      // herhangi bir ':write' yeter, GET serbest.
      //
      // /mcp harici tutulur — MCP transport'u POST'tur ama salt-okuma
      // tool'lari da tasir; yazma denetimi tool bazinda McpController'da
      // yapilir (mutating tool + read-only key = ret).
      //
      // Desen YALNIZ transport yolunu tanir (/api/mcp, sonda tek '/'):
      // eskiden "/mcp ile biten her yol" muaf sayiliyordu; ileride
      // sites/:siteId/.../mcp gibi bir rota eklenirse scope denetimini sessizce
      // atlardi. Harf duyarsiz: Express /api/MCP'yi de ayni handler'a yollar
      // (resolveResource ile ayni kural).
      const method = req.method.toUpperCase();
      const isMutating = !['GET', 'HEAD', 'OPTIONS'].includes(method);
      const path = (req.path ?? req.url ?? '');
      const isMcpTransport = /^(?:\/api)?\/mcp\/?$/i.test(path.split('?')[0] ?? '');
      if (!isMcpTransport) {
        const required = this.apiKeys.requiredScope(method, path);
        if (required) {
          if (!this.apiKeys.hasScopeForRoute(apiKey.scopes, required)) {
            throw new ForbiddenException(`Bu API anahtarinda "${required}" scope'u yok. Anahtari bu scope ile yeniden uret.`);
          }
        } else if (isMutating) {
          // Bilinmeyen kaynak — geriye donuk uyum icin kaba kural korunur.
          const canWrite = apiKey.scopes.includes('*') || apiKey.scopes.some((s) => s.endsWith(':write'));
          if (!canWrite) {
            throw new ForbiddenException('Bu API anahtari salt-okunur (yalnizca :read scope). Yazma islemi icin :write scope\'lu anahtar uret.');
          }
        }
      }

      // ── Plan kapisi (apiAccess) ──
      // NEDEN: kapi yalniz anahtar URETIMINDE (api-keys.controller create)
      // idi. Kurumsal'da anahtar uretip sonra plani dusen (odeme yok / iptal
      // → TRIAL) hesabin anahtarlari calismaya devam ediyordu; yani REST API
      // fiilen her plana acikti. Her istekte sahibin GUNCEL plani bakilir
      // (user satiri zaten yukarida DB'den okundu, ek sorgu yok).
      // MCP tasima ucu haric: McpController kendi kapisini (mcpAccess) JSON-RPC
      // hatasi olarak doner; istemciler (Claude, Cursor) ciplak 403'u gostermez.
      // ADMIN sahipli anahtarlar (or. yonetimden uretilen salt-okunur onizleme
      // anahtari) rota kapilarindaki muafiyetle tutarli olarak calisir.
      // Scope denetiminden SONRA: yanlis scope / panel-only ucunda kullanici
      // once o daha ozgul nedeni gorsun.
      if (!isMcpTransport && !ownerHasPlanFeature(user, 'apiAccess')) {
        throw new ForbiddenException(API_KEY_PLAN_MESSAGE);
      }

      (req as any).user = user;
      (req as any).apiKey = apiKey;
      return true;
    }

    const extracted = this.extractToken(req);
    if (!extracted) throw new UnauthorizedException('Token yok');

    const secret = process.env.NEXTAUTH_SECRET ?? process.env.AUTH_SECRET ?? '';

    try {
      const decoded = await decode({
        token: extracted.token,
        secret,
        salt: extracted.salt,
      });
      if (!decoded?.sub) throw new UnauthorizedException('Geçersiz token');

      const user = await this.prisma.user.findUnique({ where: { id: decoded.sub as string } });
      if (!user) throw new UnauthorizedException('Kullanıcı bulunamadı');
      // Oturum JWT'si durumsuz (30 gun) — tek tek iptal edilemez; silme talebi
      // olan hesabin TUM oturumlari burada kapanir (web cerezi + mobil Bearer)
      if (user.deletionRequestedAt) throw new UnauthorizedException(DELETED_ACCOUNT_MESSAGE);

      (req as any).user = user;
      return true;
    } catch (err: any) {
      throw new UnauthorizedException(err.message);
    }
  }

  /**
   * Cookie veya Authorization header'dan token + salt çıkartır.
   * Cerez adlari ve salt kurali session-cookie.ts'te — OAuth callback'leri de
   * oturumu AYNI kuralla okur (iki liste ayrisirsa biri sessizce oturumsuz kalir).
   */
  private extractToken(req: Request): { token: string; salt: string } | null {
    return extractSessionToken(req);
  }
}
