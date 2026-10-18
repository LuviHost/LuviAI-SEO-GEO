import { Logger } from '@nestjs/common';
import type { QuotaService } from './quota.service.js';

/**
 * Panel ve mobil ozetinin makale kotasi — ay basi sifirlamasi uygulanmis.
 *
 * NEDEN: User.articlesUsedThisMonth ay basinda kendiliginden sifirlanmaz;
 * sifirlama (QuotaService maybeResetMonthlyQuota) yalniz bir kota kontrolu
 * calistiginda olur. /me/dashboard ve /billing/users/:userId/current sayaci HAM okuyordu:
 * ucretli musteri 1 Kasim'da "Bu ay uretilen: 15" goruyordu (Ekim'in sayaci).
 * Web paneli de deneme hakkini '/1' diye sabit yaziyordu; gercek hak 2
 * (plans.ts trial.articlesPerMonth, QuotaService LIMITS.TRIAL).
 *
 * Kural TEK yerde kalsin diye limit ve sifirlama QuotaService.checkArticleQuota'dan
 * gelir (kota kontrolu yapan her islemle ayni yazim); sayac ardindan TAZE
 * satirdan okunur, kalan hak o satirdan hesaplanir.
 */
export interface ArticleQuotaView {
  /** Plan limiti: ucretli planlarda aylik, denemede omur boyu (sifirlanmaz) */
  limit: number;
  /** Kalan hak = max(0, limit - used) */
  remaining: number;
  /** Ay basi sifirlamasi uygulanmis sayac */
  used: number;
}

const log = new Logger('ArticleQuotaView');

/**
 * Ay basi sifirlamasini uygular ve plan limitini doner. Servis yoksa ya da
 * hata olursa null: ozet ucu dusmez, panel uydurma sayi gostermez.
 */
export async function resetAwareArticleLimit(
  quota: Pick<QuotaService, 'checkArticleQuota'> | null | undefined,
  userId: string,
): Promise<number | null> {
  if (!quota) return null;
  try {
    const { limit } = await quota.checkArticleQuota(userId);
    return Number.isFinite(limit) ? limit : null;
  } catch (err: any) {
    log.warn(`[${userId}] Makale kotasi okunamadi: ${err?.message ?? err}`);
    return null;
  }
}

/** Taze satirdaki sayac + limit → ozet; limit yoksa null */
export function articleQuotaView(limit: number | null, used: number | null | undefined): ArticleQuotaView | null {
  if (limit === null || typeof used !== 'number' || !Number.isFinite(used)) return null;
  return { limit, remaining: Math.max(0, limit - used), used };
}
