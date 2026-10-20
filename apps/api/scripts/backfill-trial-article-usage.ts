/**
 * Tek seferlik düzeltme — deneme hesaplarının makale sayacı (articlesUsedThisMonth)
 *
 * NEDEN GEREKLI (sahip kararı 20.10.2026): deneme hesabı yapay zekâyla TOPLAM 2 makale
 * üretir; onboarding'in ilk makalesi de bu haktan düşer ve takvim yazısı üretime
 * alınırken düşer (article-scheduler.service chargeArticle). Bu kuraldan önce
 * onboarding'in ilk makalesi ve takvim üretimi sayaca HİÇ yazılmıyordu. Bugünkü deneme
 * hesaplarının sayacı yalnız kendi başlattıkları üretimleri tutar: ilk makalesi ve
 * takvimden üretilmiş yazıları olan hesap, yeni kuralla 2 makale DAHA alabilirdi.
 *
 * Ne yapar: plan TRIAL olan her hesap için demo dışı sitelerinde üretime girmiş yazıları
 * sayar (durum SCHEDULED ya da DRAFT değil: üretiliyor, editörde, onayda, yayında,
 * başarısız, arşiv; çeviriler de yapay zekâ çıktısıdır) ve sayacı
 * min(hak, max(sayaç, üretilen)) yapar. Sayaç yalnız ARTAR, hakkı aşmaz. Takvimde
 * bekleyen yazılara dokunmaz; onlar panelde kilitli görünür (articles/plan-lock.ts).
 *
 * LLM çağrısı YOK. Idempotent: ikinci koşu 0 hesap bulur.
 *
 * CALISTIRMA (apps/api icinden; prod yazmasini kullanici kendi terminalinden yapar):
 *   npx tsx scripts/backfill-trial-article-usage.ts           # kuru calisma (yalniz rapor)
 *   npx tsx scripts/backfill-trial-article-usage.ts --apply   # yaz
 */
import { PrismaClient } from '@prisma/client';
import { DEMO_SITE_URL } from '../src/articles/article-scheduler.service.js';
import { findPlan } from '../src/billing/plans.js';

const APPLY = process.argv.includes('--apply');
const prisma = new PrismaClient();

/** Deneme hakkı — plans.ts (QuotaService LIMITS.TRIAL ile aynı; plans-quota-sync.spec denetler) */
const TRIAL_LIMIT = findPlan('trial')?.articlesPerMonth ?? 2;

/** Saf kural: yeni sayaç (yalnız artar, hakkı aşmaz) */
function backfilledTrialUsage(current: number, generated: number, limit: number): number {
  return Math.max(current, Math.min(limit, generated));
}

async function main(): Promise<void> {
  const users = await prisma.user.findMany({
    where: { plan: 'TRIAL' as any },
    select: { id: true, email: true, articlesUsedThisMonth: true },
  });
  let changed = 0;
  for (const u of users) {
    const generated = await prisma.article.count({
      where: {
        site: { userId: u.id, url: { not: DEMO_SITE_URL } },
        status: { notIn: ['SCHEDULED', 'DRAFT'] as any },
      },
    });
    const next = backfilledTrialUsage(u.articlesUsedThisMonth, generated, TRIAL_LIMIT);
    if (next === u.articlesUsedThisMonth) continue;
    changed++;
    console.log(`  ${u.email}: sayaç ${u.articlesUsedThisMonth} → ${next} (üretime girmiş yazı: ${generated}, hak: ${TRIAL_LIMIT})`);
    if (APPLY) {
      // Koşullu: arada sayaç değiştiyse (yeni üretim) daha küçük değerle ezilmez
      await prisma.user.updateMany({
        where: { id: u.id, plan: 'TRIAL' as any, articlesUsedThisMonth: { lt: next } },
        data: { articlesUsedThisMonth: next },
      });
    }
  }
  console.log(`${users.length} deneme hesabı incelendi, ${changed} hesabın sayacı ${APPLY ? 'güncellendi' : 'güncellenecek (kuru çalışma; yazmak için --apply)'}.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
