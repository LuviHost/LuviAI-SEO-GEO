import type { PrismaService } from '../prisma/prisma.service.js';

/**
 * Cron cift-calisma kilidi.
 *
 * API ve worker prosesleri AYNI AppModule'u bootstrap ettigi icin
 * @nestjs/schedule her @Cron'u iki proseste birden tetikler. Pahali
 * (LLM cagrili) cron'lar icin bu cift maliyet + duplike veri demek.
 *
 * KvStore.key @id (primary key) oldugundan create() atomiktir: ayni
 * period anahtariyla ikinci create unique-violation ile duser → kaybeden
 * proses isi atlar. expiresAt eski kilitlerin temizlenebilmesi icindir.
 */
export async function acquireCronLock(
  prisma: PrismaService,
  name: string,
  granularity: 'hourly' | 'daily' | 'weekly',
): Promise<boolean> {
  const now = new Date();
  const stamp = granularity === 'hourly'
    // Saat basi cozunurluk — gun icinde tekrarlayan cron'lar (intel
    // toplama) icin. Kilit anahtari saatle degistigi surece ayni saatte
    // iki proses birden calisamaz.
    ? now.toISOString().slice(0, 13)
    : granularity === 'daily'
      ? now.toISOString().slice(0, 10)
      : `${now.getUTCFullYear()}-w${getIsoWeek(now)}`;
  const key = `cron-lock:${name}:${stamp}`;
  try {
    await prisma.kvStore.create({
      data: {
        key,
        value: `${process.pid}@${now.toISOString()}`,
        // Saatlik kilitler hizla birikir; 2 gun sonra temizlenebilir
        // olmalari yeterli (gunluk/haftalik 14 gun kalir).
        expiresAt: new Date(now.getTime() + (granularity === 'hourly' ? 2 : 14) * 86_400_000),
      },
    });
    return true;
  } catch {
    // Unique violation — diger proses kilidi aldi
    return false;
  }
}

function getIsoWeek(d: Date): number {
  const date = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dayNum = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  return Math.ceil((((date.getTime() - yearStart.getTime()) / 86_400_000) + 1) / 7);
}
