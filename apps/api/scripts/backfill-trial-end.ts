/**
 * Tek seferlik — bitiş tarihi olmayan deneme hesaplarına "dağıtımdan itibaren 14 gün"
 * (sahip kararı 21.10.2026). Kural ve kapsam: src/billing/trial-backfill.ts.
 *
 * CALISTIRMA (apps/api icinden; prod yazmasini kullanici kendi terminalinden yapar):
 *   npx tsx scripts/backfill-trial-end.ts           # kuru calisma (yalniz rapor)
 *   npx tsx scripts/backfill-trial-end.ts --apply   # yaz
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
