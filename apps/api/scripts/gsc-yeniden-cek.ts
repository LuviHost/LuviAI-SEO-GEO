/**
 * GSC snapshot'larini dogru tanimla yeniden ceker — tum GSC bagli siteler.
 * Kural ve gerekce: src/analytics/gsc-yeniden-cek.ts.
 *
 * CALISTIRMA (apps/api icinden; prod yazmasini kullanici kendi terminalinden yapar):
 *   npx tsx scripts/gsc-yeniden-cek.ts                  # kuru calisma: GSC'den okur, kiyaslar, YAZMAZ
 *   npx tsx scripts/gsc-yeniden-cek.ts --apply          # yaz
 * Secenekler:
 *   --days=90          toplamlari yeniden yazilacak gun sayisi (en fazla 480; GSC 16 ay verir)
 *   --detail-days=30   gun gun ilk-N sayfa/sorgu detayi cekilecek son gun sayisi (gun basina 2 istek)
 *   --site=<siteId>    yalniz tek site
 *   --sleep-ms=2000    siteler arasi bekleme (GSC kota dostu)
 *
 * Tekrar calistirilabilir (upsert). Token / kimlik bilgisi yazdirilmaz.
 */
// dotenv once: @luviai/shared sifreleme anahtarini modul yuklenirken okur
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { GscOAuthService } from '../src/auth/gsc-oauth.service.js';
import { GscLiveService } from '../src/analytics/gsc-live.service.js';
import { AnalyticsService, GSC_MAX_HISTORY_DAYS } from '../src/analytics/analytics.service.js';
import { runGscRefetch } from '../src/analytics/gsc-yeniden-cek.js';

function arg(name: string, fallback: number): number {
  const raw = process.argv.find((a) => a.startsWith(`--${name}=`))?.split('=')[1];
  const n = raw ? parseInt(raw, 10) : NaN;
  return Number.isFinite(n) ? n : fallback;
}

const APPLY = process.argv.includes('--apply');
const DAYS = Math.max(1, Math.min(GSC_MAX_HISTORY_DAYS, arg('days', 90)));
const DETAIL_DAYS = Math.max(0, Math.min(DAYS, arg('detail-days', 30)));
const SLEEP_MS = Math.max(0, arg('sleep-ms', 2000));
const SITE = process.argv.find((a) => a.startsWith('--site='))?.split('=')[1];

const prisma = new PrismaClient();
const gscOAuth = new GscOAuthService(prisma as never);
const live = new GscLiveService(prisma as never, gscOAuth);
const analytics = new AnalyticsService(prisma as never, gscOAuth, live);

runGscRefetch(prisma as never, analytics, live, {
  apply: APPLY,
  days: DAYS,
  detailDays: DETAIL_DAYS,
  sleepMs: SLEEP_MS,
  siteId: SITE,
})
  .then((r) => {
    if (r.some((x) => x.status === 'error')) process.exitCode = 1;
  })
  .catch((err) => {
    console.error(String(err?.message ?? err).slice(0, 300));
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
