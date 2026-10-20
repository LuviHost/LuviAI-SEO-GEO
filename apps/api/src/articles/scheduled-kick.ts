import type { Logger } from '@nestjs/common';
import type { JobQueueService } from '../jobs/job-queue.service.js';

/**
 * Plan yukseltme sonrasi takvim taramasi — yalniz o kullanicinin yazilari.
 *
 * NEDEN: deneme hesabinin hakki asan takvim yazilari SCHEDULED bekler (panelde
 * kilitli: plan-lock.ts). Plan acilinca hak yenilenir (paytr.service
 * activateSubscription sayaci sifirlar) ama saatlik tarama en gec bir saat sonra
 * gelir; musteri odeme yaptiktan sonra vadesi coktan gecmis yazilarin hala
 * "bekliyor" kalmasini gormemeli. Kullanici icin tarama (PROCESS_SCHEDULED,
 * is verisinde userId) hemen kuyruga atilir: vadesi gecmis yazilar yeni hak
 * yettigince uretime alinir (article-scheduler.service processDueArticles,
 * ayni hak muhasebesi), digerleri kendi saatlerinde saatlik taramayla.
 *
 * Plan etkinlestirmesini ASLA bozmaz: kuyruk yoksa ya da hata verirse uyari
 * loglanir ve false doner (saatlik tarama yine alir).
 */
export const SCHEDULED_KICK_REASON = 'plan_upgrade';

export async function kickScheduledAfterUpgrade(
  jobs: Pick<JobQueueService, 'enqueue'> | null | undefined,
  userId: string,
  log: Pick<Logger, 'log' | 'warn'>,
): Promise<boolean> {
  if (!jobs || !userId) return false;
  try {
    await jobs.enqueue({
      type: 'PROCESS_SCHEDULED',
      userId,
      payload: { userId, reason: SCHEDULED_KICK_REASON },
    });
    log.log(`[${userId}] Plan yukseltildi: bekleyen takvim yazilari icin tarama kuyruga atildi`);
    return true;
  } catch (err: any) {
    log.warn(`[${userId}] Plan yukseltme sonrasi takvim taramasi kuyruga atilamadi (saatlik tarama alir): ${err?.message ?? err}`);
    return false;
  }
}
