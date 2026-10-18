import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service.js';
import { acquireCronLock } from './cron-lock.js';

/** Sweep'in kullandigi Prisma yuzeyi — testte sahtelenebilir */
export interface KvSweepDb {
  kvStore: {
    findMany(args: { where: { expiresAt: { lt: Date } }; select: { key: true }; take: number }): Promise<Array<{ key: string }>>;
    deleteMany(args: { where: { key: { in: string[] }; expiresAt: { lt: Date } } }): Promise<{ count: number }>;
  };
}

/** Tek DELETE'te en fazla bu kadar anahtar: uzun satir kilidi ve dev IN listesi olmasin */
export const KV_SWEEP_BATCH = 1000;
/** Bir turda en fazla bu kadar parti (200 bin satir); kalan ertesi gun */
export const KV_SWEEP_MAX_BATCHES = 200;

/**
 * Suresi dolmus (expiresAt gecmis) kv_store satirlarini partiler halinde siler.
 *
 * Silme kosulunda expiresAt TEKRAR denetlenir: okuma ile silme arasinda
 * yenilenen bir satir (ornegin haftalik olcum hakki yeniden ayrildi) silinmez.
 * expiresAt'i NULL olan satirlar (kur onbellegi, olcum kayitlari, ayarlar)
 * `lt` kosuluna hic girmez.
 */
export async function sweepExpiredKv(
  db: KvSweepDb,
  now: Date = new Date(),
  opts: { batch?: number; maxBatches?: number } = {},
): Promise<{ deleted: number; batches: number; more: boolean }> {
  const batch = opts.batch ?? KV_SWEEP_BATCH;
  const maxBatches = opts.maxBatches ?? KV_SWEEP_MAX_BATCHES;
  let deleted = 0;
  for (let i = 0; i < maxBatches; i++) {
    const rows = await db.kvStore.findMany({ where: { expiresAt: { lt: now } }, select: { key: true }, take: batch });
    if (rows.length === 0) return { deleted, batches: i, more: false };
    const res = await db.kvStore.deleteMany({ where: { key: { in: rows.map((r) => r.key) }, expiresAt: { lt: now } } });
    deleted += res.count;
    if (rows.length < batch) return { deleted, batches: i + 1, more: false };
  }
  return { deleted, batches: maxBatches, more: true };
}

/**
 * kv_store suresi dolan kayit temizligi — her gun 04:50 (Istanbul), cift-calisma kilidiyle.
 *
 * NEDEN: kv_store'a yazan kodun cogu expiresAt veriyor (onizleme 60 KB'a kadar
 * sitemap/llms icerigi, Prompt Lab yerel sonucu — sitenin telefonu/adresi —,
 * erisim durumu, site NAP'i, cron kilitleri, bildirim kilitleri) ama bu
 * tarihte satiri silen bir is YOKTU; yalniz OAuth state ve ASC plan onekleri
 * kullanildikca temizleniyordu. Koddaki saklama sureleri (orn. Prompt Lab
 * yerel sonucu 120 gun) uygulanmiyor, tablo sinirsiz buyuyordu.
 *
 * Silmek davranisi degistirmez: suresi dolan kaydi okuyanlar onu zaten yok
 * sayar (crawl-access, auto-fix onizlemesi, ASC plani, OAuth state, arama
 * firsati onbellegi) ya da kaydin bitis zamani anahtarindaki doneme denk gelir
 * (cron-lock, cite-notif, crawler-err gunluk kilitleri; olcum hakki 7 gun).
 *
 * API ve worker ayni AppModule'u yukledigi icin @Cron iki proseste tetiklenir;
 * gunluk kilit (common/cron-lock.ts) yalniz birinin calismasina izin verir.
 */
@Injectable()
export class KvSweepCron {
  private readonly log = new Logger(KvSweepCron.name);

  constructor(private readonly prisma: PrismaService) {}

  @Cron('50 4 * * *', { timeZone: 'Europe/Istanbul' })
  async run(): Promise<void> {
    if (!(await acquireCronLock(this.prisma, 'kv-sweep', 'daily'))) return;
    try {
      const r = await sweepExpiredKv(this.prisma);
      if (r.deleted > 0 || r.more) {
        this.log.log(`kv_store: suresi dolan ${r.deleted} kayit silindi (${r.batches} parti)${r.more ? ' — kalanlar ertesi gun' : ''}`);
      }
    } catch (err: any) {
      this.log.error(`kv_store temizligi basarisiz: ${String(err?.message ?? err).slice(0, 300)}`);
    }
  }
}
