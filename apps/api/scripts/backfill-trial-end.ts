/**
 * Tek seferlik — bitiş tarihi olmayan deneme hesaplarına "dağıtımdan itibaren 14 gün"
 * (sahip kararı 21.10.2026). Kural ve kapsam: src/billing/trial-backfill.ts.
 *
 * Ayrica (once) plan TRIAL + durum ACTIVE/PAST_DUE/CANCELED tutarsiz satirlarini
 * TRIAL/EXPIRED'a duzeltir (eskiden denemede "aboneligi iptal et" CANCELED yaziyordu).
 *
 * CALISTIRMA (apps/api icinden; prod yazmasini kullanici kendi terminalinden yapar):
 *   npx tsx scripts/backfill-trial-end.ts           # kuru calisma (yalniz rapor, sayilar)
 *   npx tsx scripts/backfill-trial-end.ts --apply   # yaz
 *
 * SALT OKUNUR DENETIM (yazmaz; once bununla bak, sayilar kuru calismayla ayni cikmali):
 *   SELECT u.subscriptionStatus,
 *          COUNT(*) AS hesap,
 *          SUM(u.trialEndsAt IS NOT NULL AND u.trialEndsAt <= NOW()) AS bitisi_gecmis,
 *          SUM(EXISTS (SELECT 1 FROM invoices i WHERE i.userId = u.id AND i.status = 'PAID')) AS odemis
 *   FROM users u
 *   WHERE u.plan = 'TRIAL'
 *     AND u.subscriptionStatus IN ('ACTIVE', 'PAST_DUE', 'CANCELED')
 *     AND u.deletionRequestedAt IS NULL
 *     AND u.role <> 'ADMIN'
 *   GROUP BY u.subscriptionStatus;
 * Kural: bitisi_gecmis ya da odemis → EXPIRED, digerleri → TRIAL (src/billing/trial-backfill.ts).
 */
import { PrismaClient } from '@prisma/client';
import { runTrialBackfill } from '../src/billing/trial-backfill.js';

const APPLY = process.argv.includes('--apply');
const prisma = new PrismaClient();

runTrialBackfill(prisma as any, { apply: APPLY })
  .then((r) => { for (const l of r.lines) console.log(l); })
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
