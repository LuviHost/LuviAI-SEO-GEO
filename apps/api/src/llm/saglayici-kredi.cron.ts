import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { acquireCronLock } from '../common/cron-lock.js';
import { SaglayiciKrediService } from './saglayici-kredi.service.js';
import { UYARI_KV, uyariGerekli, uyariMetni, type UyariKaydi } from './saglayici-kredi.js';

/**
 * Saat basi saglayici kredi kontrolu → kurucuya zil + e-posta (bkz. saglayici-kredi.ts "Uyari").
 * NEDEN: Gemini kredisi 25.11'de bitti, iki gun kimse fark etmedi (hata yalniz sunucu kaydindaydi).
 * Alici ilk ADMIN hesap (kurucu; ucretsiz test ve LinkedIn bildirimleriyle ayni kural).
 * API ve worker ayni AppModule'u yukler: saatlik kilit tek prosesin calismasini saglar.
 */
@Injectable()
export class SaglayiciKrediCron {
  private readonly log = new Logger(SaglayiciKrediCron.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly kredi: SaglayiciKrediService,
    private readonly notifications: NotificationsService,
  ) {}

  @Cron('7 * * * *', { timeZone: 'Europe/Istanbul' })
  async run(simdi: Date = new Date()): Promise<void> {
    if (!(await acquireCronLock(this.prisma, 'saglayici-kredi', 'hourly'))) return;
    try {
      const { satirlar } = await this.kredi.tablo({ tazele: true });
      let admin: { id: string } | null | undefined;
      for (const s of satirlar) {
        const key = UYARI_KV + s.id;
        const row = await this.prisma.kvStore.findUnique({ where: { key } }).catch(() => null);
        let onceki: UyariKaydi | null = null;
        try { onceki = row?.value ? JSON.parse(row.value) : null; } catch { onceki = null; }

        if (s.durum === 'CALISIYOR') {
          // Duzeldi: sonraki kesintide beklemeden uyarilsin
          if (row) await this.prisma.kvStore.delete({ where: { key } }).catch(() => undefined);
          continue;
        }
        if (!uyariGerekli(s.durum, onceki, simdi)) continue;

        if (admin === undefined) {
          admin = await this.prisma.user.findFirst({ where: { role: 'ADMIN' }, orderBy: { createdAt: 'asc' }, select: { id: true } });
        }
        if (!admin) { this.log.warn('Kredi uyarisi icin ADMIN kullanici yok'); return; }
        const m = uyariMetni({ ...s, tahmin: s.tahmin ? { tutar: s.tahmin.tutar, paraBirimi: s.tahmin.paraBirimi } : null });
        await this.notifications.create({
          userId: admin.id,
          type: 'SYSTEM',
          title: m.title,
          body: m.body,
          link: '/admin/spend',
          refKind: 'saglayici_kredi',
          refId: s.id,
          channels: ['inapp', 'email'],
        });
        const value = JSON.stringify({ durum: s.durum, at: simdi.toISOString() } satisfies UyariKaydi);
        await this.prisma.kvStore.upsert({ where: { key }, create: { key, value }, update: { value } });
        this.log.warn(`Kredi uyarisi gonderildi: ${s.id} (${s.durum})`);
      }
    } catch (err: any) {
      this.log.error(`Kredi kontrolu basarisiz: ${String(err?.message ?? err).slice(0, 300)}`);
    }
  }
}
