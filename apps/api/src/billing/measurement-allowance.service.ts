import { HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  MEASUREMENT_WINDOW_MS,
  WEEKLY_MEASUREMENT_LIMIT_CODE,
  computeAllowance,
  currentMeasurementSession,
  formatTrDateTime,
  measurementSession,
  type MeasurementAllowance,
  type MeasurementSessionStore,
} from './measurement-allowance.js';

type AccountUser = { id?: string; role?: string | null } | null | undefined;

export interface MeasurementReservation {
  key: string;
  /** Bu rezervasyonun yazdigi zaman damgasi — iade yalnizca hala bizimse yapilir */
  value: string;
  /** Rezervasyondan onceki deger (iadede geri yazilir) */
  prev: string | null;
}

/**
 * Haftalik AI olcum hakki (bkz. measurement-allowance.ts).
 *
 * Depo: kv_store `ai-olcum:<userId>` = son sayilan olcumun ISO zamani,
 * expiresAt = +7 gun. Ayri tablo/migration gerekmez.
 *
 * Hak olcum BASLAMADAN ayrilir (tek kosullu UPDATE — es zamanli iki istek
 * ikisi birden gecemez: cift tiklama, iki sekme). Olcum hata verir ya da hic
 * gercek sonuc uretmezse (tum saglayicilar hata, kota dolu, onbellekten donus)
 * hak iade edilir; kullanici bos bir denemeyle haftasini yakmaz.
 */
@Injectable()
export class MeasurementAllowanceService {
  private readonly log = new Logger(MeasurementAllowanceService.name);

  constructor(private readonly prisma: PrismaService) {}

  private key(userId: string): string {
    return `ai-olcum:${userId}`;
  }

  async status(user: AccountUser): Promise<MeasurementAllowance> {
    if (!user?.id || user.role === 'ADMIN') {
      return { limited: false, allowed: true, lastMeasuredAt: null, nextAvailableAt: null };
    }
    const row = await this.prisma.kvStore.findUnique({ where: { key: this.key(user.id) } });
    return computeAllowance(row?.value, new Date());
  }

  /**
   * Hakki atomik olarak ayirir; hak yoksa 429 WEEKLY_MEASUREMENT_LIMIT firlatir.
   */
  async reserve(userId: string): Promise<MeasurementReservation> {
    const key = this.key(userId);
    // Kayit, findUnique ile updateMany arasinda suresi dolup silinebilir —
    // o durumda olusturmayi bir kez daha dene.
    for (let attempt = 0; attempt < 2; attempt++) {
      const now = new Date();
      const value = now.toISOString();
      const expiresAt = new Date(now.getTime() + MEASUREMENT_WINDOW_MS);
      const cutoff = new Date(now.getTime() - MEASUREMENT_WINDOW_MS).toISOString();

      try {
        await this.prisma.kvStore.create({ data: { key, value, expiresAt } });
        return { key, value, prev: null };
      } catch (err: any) {
        if (err?.code !== 'P2002') throw err; // kayit var — asagida kosullu guncelle
      }

      const before = await this.prisma.kvStore.findUnique({ where: { key } });
      // ISO zaman damgalari sozluk sirasiyla da kronolojiktir: value < cutoff
      // = son olcum 7 gunden eski. Tek UPDATE, kosul satir kilidi altinda.
      const res = await this.prisma.kvStore.updateMany({
        where: { key, value: { lt: cutoff } },
        data: { value, expiresAt },
      });
      if (res.count === 1) return { key, value, prev: before?.value ?? null };

      const current = await this.prisma.kvStore.findUnique({ where: { key } });
      if (!current) continue;
      throw this.limitError(computeAllowance(current.value, now));
    }
    throw this.limitError(computeAllowance(null, new Date()));
  }

  /** Rezervasyonu geri alir — arada baska bir olcum hakki yazdiysa dokunmaz. */
  async release(r: MeasurementReservation): Promise<void> {
    try {
      if (r.prev) {
        const prevMs = Date.parse(r.prev);
        await this.prisma.kvStore.updateMany({
          where: { key: r.key, value: r.value },
          data: {
            value: r.prev,
            expiresAt: Number.isFinite(prevMs) ? new Date(prevMs + MEASUREMENT_WINDOW_MS) : null,
          },
        });
      } else {
        await this.prisma.kvStore.deleteMany({ where: { key: r.key, value: r.value } });
      }
    } catch (err: any) {
      this.log.warn(`Olcum hakki iade edilemedi (${r.key}): ${err.message}`);
    }
  }

  /**
   * Bir kullanici eylemini olcum oturumu olarak calistirir: hakki ayirir,
   * fn'i baglam icinde calistirir, gercek olcum olmadiysa ya da hata
   * olduysa hakki iade eder. ADMIN muaf; ic ice oturumda tekrar ayirmaz.
   */
  async run<T>(user: AccountUser, fn: () => Promise<T>): Promise<T> {
    if (currentMeasurementSession()) return fn();
    if (!user?.id) return fn(); // AuthGuard'siz cagri — servis ici yedek kontrol devralir
    if (user.role === 'ADMIN') {
      return measurementSession.run({ exempt: true, measured: false }, fn);
    }

    const reservation = await this.reserve(user.id);
    const store: MeasurementSessionStore = { exempt: true, measured: false };
    try {
      const out = await measurementSession.run(store, fn);
      if (!store.measured) await this.release(reservation);
      return out;
    } catch (err) {
      await this.release(reservation);
      throw err;
    }
  }

  /**
   * Oturum DISINDAKI kullanici tetikli olcum icin (worker'daki site denetimi,
   * sarmalanmamis bir uc): AI servisleri bunu cagirir. Oturum varsa ya da
   * kullanici ADMIN ise null (ayirma yok). Cagiran, gercek olcum olmazsa
   * release() eder.
   */
  async reserveOutsideSession(user: AccountUser): Promise<MeasurementReservation | null> {
    if (currentMeasurementSession()) return null;
    if (!user?.id || user.role === 'ADMIN') return null;
    return this.reserve(user.id);
  }

  private limitError(a: MeasurementAllowance): HttpException {
    const when = a.nextAvailableAt ? ` Bir sonraki ölçüm ${formatTrDateTime(a.nextAvailableAt)} itibarıyla açılır.` : '';
    return new HttpException(
      {
        statusCode: HttpStatus.TOO_MANY_REQUESTS,
        code: WEEKLY_MEASUREMENT_LIMIT_CODE,
        message: `Bu haftaki AI ölçüm hakkını kullandın. Her hesap 7 günde 1 ölçüm yapabilir.${when}`,
        nextAvailableAt: a.nextAvailableAt,
      },
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }
}
