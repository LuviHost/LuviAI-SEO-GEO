import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service.js';
import { AsoScrapersService } from './scrapers.service.js';
import { acquireCronLock } from '../common/cron-lock.js';

/**
 * Daily rank tracker. Her takipli app + keyword için günde bir rank kontrolü yapar.
 */
@Injectable()
export class AsoTrackerService {
  private readonly log = new Logger(AsoTrackerService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly scrapers: AsoScrapersService,
  ) {}

  /**
   * Bir keyword için tek seferlik rank check + DB güncelle.
   */
  async checkRank(trackedAppKeywordId: string) {
    const kw = await this.prisma.trackedAppKeyword.findUniqueOrThrow({
      where: { id: trackedAppKeywordId },
      include: { trackedApp: true },
    });

    const appIdent = kw.store === 'IOS'
      ? kw.trackedApp.appStoreId
      : kw.trackedApp.playStoreId;

    if (!appIdent) {
      this.log.warn(`[${kw.id}] App identifier yok (${kw.store})`);
      return null;
    }

    // Lokal kaynagi TrackedApp.country (varsayilan "tr"). Dil buradan turetilir;
    // ayri bir dil alani tutmuyoruz ki olcum ile keyword skorlamasi ayrisamasin.
    const { rank, total, measurable, measuredLocale } = await this.scrapers.findRank({
      term: kw.keyword,
      appIdent,
      country: kw.trackedApp.country,
      storeType: kw.store as 'IOS' | 'ANDROID',
      num: 100,
    });

    // OLCUM YAPILAMADIYSA KAYIT YAZMA.
    // Arama 0 sonuc dondugunde bu "uygulama siralamada yok" demek degil,
    // "magaza tarafi cevap vermedi" demektir. Eskiden bu durumda position:null
    // yaziliyordu ve grafik gercek olmayan bir dususe geciyordu —
    // google-play-scraper 10.1.2'de search her sorgu icin 0 sonuc donerken
    // her Android keyword'u her gun "sirada yok" olarak kaydedilmisti.
    // Scraper 10.1.3 ile duzeldi, ancak koruma kaliyor: magaza tarafi yine
    // kirilirsa kayit atlanir ve grafik son GERCEK olcumde kalir — bu,
    // uydurma bir dususten dogrudur.
    if (!measurable) {
      this.log.warn(
        `[${kw.id}] "${kw.keyword}" (${kw.store}, ${measuredLocale}) olculemedi — ` +
        `magaza aramasi 0 sonuc dondu, kayit yazilmadi.`,
      );
      return { rank: kw.currentRank, previousRank: kw.previousRank, measurable: false, measuredLocale };
    }

    // Tarihsel kayıt
    await this.prisma.appRanking.create({
      data: {
        trackedAppKeywordId: kw.id,
        position: rank,
        totalResults: total,
      },
    });

    // Latest snapshot
    await this.prisma.trackedAppKeyword.update({
      where: { id: kw.id },
      data: {
        previousRank: kw.currentRank,
        currentRank: rank,
        bestRank: rank != null && (kw.bestRank == null || rank < kw.bestRank) ? rank : kw.bestRank,
        lastCheckedAt: new Date(),
      },
    });

    // measuredLocale'i cagirana donduruyoruz: ayni keyword farkli lokalde
    // farkli sira verir, bu bilgi olmadan sonuc yorumlanamaz.
    // NOT: app_rankings tablosunda lokal sutunu yok — gecmis kayitlarin hangi
    // dille olculdugu bilinemez (bkz. uyarilar).
    return { rank, total, measuredLocale };
  }

  /** Bir app'in tüm keyword'leri için sıralı rank check (rate limit uyumlu). */
  async checkAllForApp(trackedAppId: string) {
    const app = await this.prisma.trackedApp.findUniqueOrThrow({
      where: { id: trackedAppId },
      select: { country: true },
    });
    const measuredLocale = this.scrapers.locale(app.country).measuredLocale;

    const keywords = await this.prisma.trackedAppKeyword.findMany({
      where: { trackedAppId, isActive: true },
    });

    let success = 0;
    let failed = 0;
    for (const kw of keywords) {
      try {
        await this.checkRank(kw.id);
        success++;
        await new Promise(r => setTimeout(r, 1500)); // rate limit
      } catch (err: any) {
        this.log.warn(`[${kw.id}] ${err.message}`);
        failed++;
      }
    }
    return { success, failed, total: keywords.length, measuredLocale };
  }

  /**
   * Cron — her gece 03:30'da tum aktif app'lerin keyword'lerini kontrol eder.
   *
   * KILIT ZORUNLU: API ve worker AYNI AppModule'u bootstrap ediyor, yani bu
   * cron iki surecte birden tetikleniyor. checkAllForApp her olcumde
   * appRanking.create() cagirdigi icin (upsert degil) her kelime icin GUNDE
   * IKI SATIR yaziliyordu. Uretimde olculdu: 83 gunun 80'inde kelime basina
   * 2 satir; toplam 14.909 satir, olmasi gereken ~7.553. Ustelik her gece
   * App Store ve Play'e iki kat istek gidiyordu — hem gereksiz maliyet hem
   * rate limit riski.
   *
   * timeZone da eklendi: donem raporlari gun sinirina gore kesiyor, sunucu
   * UTC'de oldugu icin 03:30 UTC Turkiye'de 06:30'a denk geliyordu.
   */
  @Cron('30 3 * * *', { timeZone: 'Europe/Istanbul' })
  async dailyRankCheck() {
    if (!(await acquireCronLock(this.prisma, 'aso-rank-tracking', 'daily'))) {
      this.log.log('ASO rank tracking atlandi — kilit baska surecte');
      return;
    }
    this.log.log('🕒 ASO daily rank tracking başlıyor');
    const apps = await this.prisma.trackedApp.findMany({
      where: { isActive: true },
      select: { id: true, name: true },
    });
    this.log.log(`${apps.length} app taranacak`);

    for (const app of apps) {
      try {
        const r = await this.checkAllForApp(app.id);
        this.log.log(`[${app.name}] ${r.success}/${r.total} rank güncellendi (${r.measuredLocale})`);
        await new Promise(r => setTimeout(r, 5000)); // appler arası bekle
      } catch (err: any) {
        this.log.error(`[${app.id}] daily rank: ${err.message}`);
      }
    }
    this.log.log('✓ ASO daily rank tracking bitti');
  }
}
