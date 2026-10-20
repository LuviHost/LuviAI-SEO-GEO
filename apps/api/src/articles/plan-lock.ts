import type { PrismaService } from '../prisma/prisma.service.js';
import type { QuotaService } from '../billing/quota.service.js';
import { DEMO_SITE_URL, hasAllowanceCharge } from './article-scheduler.service.js';

/**
 * PLANA KILITLI TAKVIM YAZISI (lockedByPlan) — deneme hesabinin takviminde duran,
 * makale hakki yetmedigi icin URETILMEYECEK yazi. Panel bu alani okur, kendisi
 * tahmin etmez (web lib/plan-lock.ts).
 *
 * NEDEN: deneme hesabi toplam 2 makale uretir (QuotaService LIMITS.TRIAL, omur
 * boyu, ay basi sifirlanmaz). Onboarding takvime 8'e kadar konu yerlestirir;
 * hakki asan konular SCHEDULED kalir ve plan yukseltilene kadar uretilmez
 * (takvim yazisi uretime alinirken haktan duser: article-scheduler.service
 * chargeArticle). Panel onlari siradan "Takvimde" yazisi gibi gosterirse musteri
 * yazinin zamani gelince yazilacagini sanar; "Simdi uret" 403 doner.
 *
 * KURAL (saatlik taramanin sirasiyla ayni: scheduledAt, id artan): yalniz plan
 * TRIAL (suresi dolan deneme ve dusurulen abonelik de plan TRIAL'dir). Hakki
 * henuz dusulmemis (isaretsiz) SCHEDULED, hic yayinlanmamis, demo disi yazilar
 * siralanir; ilk `kalan hak` kadari uretilecek (kilitli degil), gerisi kilitli.
 * Hak doluysa (kalan 0) hepsi kilitli. Isaretli yazi (hakki dusulmus, takvime
 * geri donmus) kilitli degildir: uretilecek. Ucretli planda kilit yok: hak her
 * ay yenilenir, tarama bekleyen yaziyi yeni ayda alir.
 *
 * Plan yukseltilince (paytr.service activateSubscription) plan TRIAL olmaktan
 * cikar, kilit kalkar; vadesi gecmis yazilari hemen uretime almak icin kullanici
 * icin tarama kuyruga atilir (scheduled-kick.ts).
 */

/** Kilit hesabinda okunan yazi alanlari */
export interface PlanLockCandidate {
  id: string;
  scheduledAt: Date | string | null;
  agentOutputs?: unknown;
}

/**
 * Saf kural: kilitli yazi kimlikleri. `candidates` kullanicinin demo disi
 * sitelerindeki hic yayinlanmamis SCHEDULED yazilaridir (sira onemsiz, burada
 * siralanir).
 */
export function planLockedIds(input: {
  plan: string | null | undefined;
  used: number;
  limit: number;
  candidates: ReadonlyArray<PlanLockCandidate>;
}): Set<string> {
  const locked = new Set<string>();
  if (input.plan !== 'TRIAL') return locked;
  const remaining = Math.max(0, input.limit - Math.max(0, input.used));
  const time = (c: PlanLockCandidate) => {
    const t = c.scheduledAt ? new Date(c.scheduledAt).getTime() : NaN;
    // Tarihsiz yazi (eski veri) taramaya hic girmez; en sona
    return Number.isFinite(t) ? t : Number.POSITIVE_INFINITY;
  };
  const uncharged = input.candidates
    .filter((c) => !hasAllowanceCharge(c.agentOutputs))
    .sort((a, b) => time(a) - time(b) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  uncharged.slice(remaining).forEach((c) => locked.add(c.id));
  return locked;
}

/**
 * Bir kullanicinin kilitli takvim yazilari (DB). Ucretli planda tek sorgu (kullanici
 * satiri) yapar. Kilitler okunamazsa bos kume: liste ucu dusmez, panel yaziyi
 * siradan takvim yazisi gibi gosterir (uretim kurali yine sunucuda: hak doluysa
 * uretilmez).
 */
export async function loadPlanLockedIds(
  prisma: Pick<PrismaService, 'user' | 'article'>,
  quota: Pick<QuotaService, 'articleLimitFor'>,
  userId: string,
): Promise<Set<string>> {
  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { plan: true, articlesUsedThisMonth: true },
    });
    if (!user || user.plan !== 'TRIAL') return new Set();
    const candidates = await prisma.article.findMany({
      where: {
        status: 'SCHEDULED' as any,
        publishedAt: null,
        site: { userId, url: { not: DEMO_SITE_URL } },
      },
      select: { id: true, scheduledAt: true, agentOutputs: true },
    });
    // TRIAL'da ay basi sifirlamasi yok: sayac dogrudan okunabilir (QuotaService
    // maybeResetMonthlyQuota plan TRIAL'da donmeden cikar)
    return planLockedIds({
      plan: user.plan,
      used: user.articlesUsedThisMonth,
      limit: quota.articleLimitFor(user.plan),
      candidates,
    });
  } catch {
    return new Set();
  }
}

/** Yaziya lockedByPlan alanini ekler (yalniz SCHEDULED yazi kilitli olabilir) */
export function withPlanLock<T extends { id: string; status?: unknown }>(row: T, locked: ReadonlySet<string>): T & { lockedByPlan: boolean } {
  return { ...row, lockedByPlan: String(row.status) === 'SCHEDULED' && locked.has(row.id) };
}
