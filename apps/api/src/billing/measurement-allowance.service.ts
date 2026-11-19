import { HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  MEASUREMENT_WINDOW_MS,
  MONTHLY_MEASUREMENTS_PER_SITE,
  WEEKLY_MEASUREMENT_LIMIT_CODE,
  computeAllowance,
  computeSiteAllowance,
  currentMeasurementSession,
  formatTrDateTime,
  istanbulMonthKey,
  measurementSession,
  nextIstanbulMonthStart,
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
  /** Site basina hakta aylik sayacin anahtari ve bu rezervasyonun yazdigi sayi */
  monthKey?: string;
  monthValue?: string;
}

/**
 * Haftalik AI olcum hakki (bkz. measurement-allowance.ts).
 *
 * Depo: kv_store. Site basina hak (18.11.2026): `ai-olcum:<userId>:<siteId>` = sitenin son
 * sayilan olcumunun ISO zamani (expiresAt +7 gun) ve `ai-olcum-ay:<userId>:<siteId>:<YYYY-MM>` =
 * o ay yapilan olcum sayisi (Istanbul takvim ayi, en fazla MONTHLY_MEASUREMENTS_PER_SITE).
 * Siteye bagli olmayan olcum (kayitta alan adi testi) hesap anahtarindan duser:
 * `ai-olcum:<userId>`. Ayri tablo/migration gerekmez.
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

  private key(userId: string, siteId?: string | null): string {
    return siteId ? `ai-olcum:${userId}:${siteId}` : `ai-olcum:${userId}`;
  }

  private monthKey(userId: string, siteId: string, now: Date): string {
    return `ai-olcum-ay:${userId}:${siteId}:${istanbulMonthKey(now)}`;
  }

  private async monthlyUsed(key: string): Promise<{ used: number; raw: string | null }> {
    const row = await this.prisma.kvStore.findUnique({ where: { key } });
    const n = row ? parseInt(row.value, 10) : 0;
    return { used: Number.isFinite(n) && n > 0 ? n : 0, raw: row?.value ?? null };
  }

  /** siteId verilirse o sitenin hakki (pencere + aylik sayac); yoksa hesap anahtari */
  async status(user: AccountUser, siteId?: string | null): Promise<MeasurementAllowance> {
    if (!user?.id || user.role === 'ADMIN') {
      return { limited: false, allowed: true, lastMeasuredAt: null, nextAvailableAt: null };
    }
    const now = new Date();
    const row = await this.prisma.kvStore.findUnique({ where: { key: this.key(user.id, siteId) } });
    if (!siteId) return computeAllowance(row?.value, now);
    const { used } = await this.monthlyUsed(this.monthKey(user.id, siteId, now));
    return computeSiteAllowance(row?.value, used, now);
  }

  /**
   * Hakki atomik olarak ayirir; hak yoksa 429 WEEKLY_MEASUREMENT_LIMIT firlatir.
   * siteId verilirse once sitenin aylik sayaci denetlenir, pencere ayrilir, sayac artar.
   */
  async reserve(userId: string, siteId?: string | null): Promise<MeasurementReservation> {
    const now0 = new Date();
    if (siteId) {
      const mk = this.monthKey(userId, siteId, now0);
      const { used } = await this.monthlyUsed(mk);
      if (used >= MONTHLY_MEASUREMENTS_PER_SITE) throw this.monthlyLimitError(now0);
    }
    const window = await this.reserveWindow(this.key(userId, siteId), Boolean(siteId));
    if (!siteId) return window;
    try {
      const month = await this.incrementMonth(this.monthKey(userId, siteId, now0), now0);
      return { ...window, monthKey: month.key, monthValue: month.value };
    } catch (err) {
      await this.release(window);
      throw err;
    }
  }

  private async reserveWindow(key: string, perSite: boolean): Promise<MeasurementReservation> {
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
      throw this.limitError(computeAllowance(current.value, now), perSite);
    }
    throw this.limitError(computeAllowance(null, new Date()), perSite);
  }

  /** Aylik sayaci bir artirir (iyimser kosullu guncelleme); sinir doluysa 429 */
  private async incrementMonth(key: string, now: Date): Promise<{ key: string; value: string }> {
    // Sayac ay bitince gereksiz: bir sonraki ay basindan 40 gun sonra silinebilir
    const expiresAt = new Date(nextIstanbulMonthStart(now).getTime() + 40 * 24 * 60 * 60 * 1000);
    for (let attempt = 0; attempt < 3; attempt++) {
      const { used, raw } = await this.monthlyUsed(key);
      if (used >= MONTHLY_MEASUREMENTS_PER_SITE) throw this.monthlyLimitError(now);
      const value = String(used + 1);
      if (raw === null) {
        try {
          await this.prisma.kvStore.create({ data: { key, value, expiresAt } });
          return { key, value };
        } catch (err: any) {
          if (err?.code !== 'P2002') throw err;
          continue; // ayni anda olusturuldu — yeniden oku
        }
      }
      const res = await this.prisma.kvStore.updateMany({ where: { key, value: raw }, data: { value, expiresAt } });
      if (res.count === 1) return { key, value };
    }
    throw this.monthlyLimitError(now);
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
      if (r.monthKey && r.monthValue) {
        const n = parseInt(r.monthValue, 10) - 1;
        if (n > 0) {
          await this.prisma.kvStore.updateMany({ where: { key: r.monthKey, value: r.monthValue }, data: { value: String(n) } });
        } else {
          await this.prisma.kvStore.deleteMany({ where: { key: r.monthKey, value: r.monthValue } });
        }
      }
    } catch (err: any) {
      this.log.warn(`Olcum hakki iade edilemedi (${r.key}): ${err.message}`);
    }
  }

  /**
   * Bir kullanici eylemini olcum oturumu olarak calistirir: hakki ayirir,
   * fn'i baglam icinde calistirir, gercek olcum olmadiysa ya da hata
   * olduysa hakki iade eder. ADMIN muaf; ic ice oturumda tekrar ayirmaz.
   * siteId: olculen site (site basina hak); yoksa hesap anahtari.
   */
  async run<T>(user: AccountUser, fn: () => Promise<T>, siteId?: string | null): Promise<T> {
    if (currentMeasurementSession()) return fn();
    if (!user?.id) return fn(); // AuthGuard'siz cagri — servis ici yedek kontrol devralir
    if (user.role === 'ADMIN') {
      return measurementSession.run({ exempt: true, measured: false }, fn);
    }

    const reservation = await this.reserve(user.id, siteId);
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
  async reserveOutsideSession(user: AccountUser, siteId?: string | null): Promise<MeasurementReservation | null> {
    if (currentMeasurementSession()) return null;
    if (!user?.id || user.role === 'ADMIN') return null;
    return this.reserve(user.id, siteId);
  }

  private limitError(a: MeasurementAllowance, perSite: boolean): HttpException {
    const when = a.nextAvailableAt ? ` Bir sonraki ölçüm ${formatTrDateTime(a.nextAvailableAt)} itibarıyla açılır.` : '';
    const kural = perSite ? 'Her site 7 günde 1 kez ölçülebilir' : 'Her hesap 7 günde 1 ölçüm yapabilir';
    return new HttpException(
      {
        statusCode: HttpStatus.TOO_MANY_REQUESTS,
        code: WEEKLY_MEASUREMENT_LIMIT_CODE,
        message: `${perSite ? 'Bu site için bu haftaki' : 'Bu haftaki'} AI ölçüm hakkını kullandın. ${kural}.${when}`,
        nextAvailableAt: a.nextAvailableAt,
      },
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }

  private monthlyLimitError(now: Date): HttpException {
    const next = nextIstanbulMonthStart(now).toISOString();
    return new HttpException(
      {
        statusCode: HttpStatus.TOO_MANY_REQUESTS,
        code: WEEKLY_MEASUREMENT_LIMIT_CODE,
        message: `Bu site bu ay ${MONTHLY_MEASUREMENTS_PER_SITE} kez ölçüldü; bir site ayda en fazla ${MONTHLY_MEASUREMENTS_PER_SITE} kez ölçülür. Bir sonraki ölçüm ${formatTrDateTime(next)} itibarıyla açılır.`,
        nextAvailableAt: next,
      },
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }
}
