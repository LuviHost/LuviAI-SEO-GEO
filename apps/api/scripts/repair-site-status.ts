/**
 * Tek seferlik — yeniden tarama / beyin uretimi yuzunden ACTIVE'den dusmus
 * (AUDIT_COMPLETE / AUDIT_PENDING'de kalmis) ama kurulumu bitmis siteleri
 * ACTIVE'e geri alir. Kural, olcut ve disarida birakilanlar:
 * src/sites/site-status-repair.ts. Kok neden duzeltmesi: src/sites/site-status.ts
 * (bu betikten ONCE o kod canliya cikmali, yoksa ilk taramada yeniden duserler).
 *
 * CALISTIRMA (apps/api icinden; prod yazmasini kullanici kendi terminalinden yapar):
 *   npx tsx scripts/repair-site-status.ts           # kuru calisma (yalniz sayi + site kimligi)
 *   npx tsx scripts/repair-site-status.ts --apply   # yaz
 *
 * SALT OKUNUR DENETIM (yazmaz; sayilar kuru calismayla ayni cikmali):
 *   SELECT s.status, COUNT(*) AS site
 *   FROM sites s JOIN users u ON u.id = s.userId
 *   WHERE s.status IN ('AUDIT_COMPLETE', 'AUDIT_PENDING')
 *     AND u.deletionRequestedAt IS NULL
 *     AND (s.onboardingCompletedAt IS NOT NULL
 *          OR EXISTS (SELECT 1 FROM jobs j WHERE j.siteId = s.id
 *                     AND j.type = 'ONBOARDING_CHAIN' AND j.status = 'COMPLETED'))
 *   GROUP BY s.status;
 */
import { PrismaClient } from '@prisma/client';
import { runSiteStatusRepair } from '../src/sites/site-status-repair.js';

const APPLY = process.argv.includes('--apply');
const prisma = new PrismaClient();

runSiteStatusRepair(prisma as any, { apply: APPLY })
  .then((r) => { for (const l of r.lines) console.log(l); })
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
