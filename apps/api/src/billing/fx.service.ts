import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service.js';

/**
 * TCMB Kur Servisi — USD/TRY.
 *
 * Fiyatlarimiz USD kanonik (bkz. plans.ts); TL tutari HER ZAMAN gunun kuruyla
 * hesaplanir. Bu yuzden kurun dogru ve taze olmasi dogrudan gelir/marj meselesi.
 *
 * KAYNAK: TCMB resmi XML feed'i (https://www.tcmb.gov.tr/kurlar/today.xml).
 * TCMB'yi seciyoruz cunku Turkiye'de dovize endeksli faturalandirmada resmi
 * kur referansi budur — muhasebe/denetim tarafinda savunulabilir tek kaynak.
 * Feed hafta ici ~15:30 TRT'de guncellenir; hafta sonu/tatilde yayin yoktur.
 *
 * DAYANIKLILIK (onceki surumde eksikti):
 *  - Kur DB'ye (KvStore) yazilir → surec yeniden baslayinca kaybolmaz, coklu
 *    instance ayni degeri gorur. Onceden yalnizca bellekteydi; her restart
 *    fallback 40'a dusuyordu ve kimse fark etmiyordu.
 *  - Gunluk cron ile onceden tazelenir → ilk musteri istegi TCMB'yi beklemez.
 *  - Kur cekilemezse SON BILINEN deger kullanilir ve `stale: true` isaretlenir;
 *    UI bunu gosterebilsin diye disari aciyoruz. Sessizce yanlis fiyat
 *    gostermek, fiyat gostermemekten kotudur.
 */

const KV_KEY = 'fx:usdtry';
/** Bu sinirlarin disi = feed bozuk demektir, kabul etme */
const SANE_MIN = 5;
const SANE_MAX = 500;
const FALLBACK_USD_TRY = 42;

export interface FxRate {
  /** 1 USD kac TL */
  rate: number;
  /** Kurun TCMB'den cekildigi an */
  fetchedAt: string;
  source: 'TCMB' | 'fallback';
  /** true = TCMB'ye ulasilamadi, eski/varsayilan deger gosteriliyor */
  stale: boolean;
}

@Injectable()
export class FxService implements OnModuleInit {
  private readonly log = new Logger(FxService.name);

  private memo: FxRate | null = null;
  /** Bellek cache omru — DB'ye her istekte gitmemek icin kisa tutuluyor */
  private readonly MEMO_TTL_MS = 60 * 60 * 1000; // 1 saat
  private memoAt = 0;

  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit() {
    // Acilista DB'deki son kuru bellege al; yoksa (ilk kurulum) TCMB'yi dene.
    // Basarisiz olursa uygulama yine de acilir — fiyat sayfasi fallback gosterir.
    try {
      const stored = await this.readStored();
      if (stored) {
        this.memo = stored;
        this.memoAt = Date.now();
        this.log.log(`Kur DB'den yuklendi: 1 USD = ${stored.rate} TL (${stored.fetchedAt})`);
      } else {
        await this.refresh();
      }
    } catch (err: any) {
      this.log.warn(`Kur baslangic yuklemesi basarisiz: ${err.message}`);
    }
  }

  /**
   * Her gun 16:00 TRT — TCMB feed'i ~15:30'da guncellenir, yarim saat pay birakiyoruz.
   * Hafta sonu da calisir; TCMB yeni deger yayinlamazsa ayni deger yazilir, zarari yok.
   */
  @Cron('0 16 * * *', { timeZone: 'Europe/Istanbul' })
  async dailyRefresh() {
    this.log.log('Gunluk kur tazeleme basliyor (TCMB)');
    const r = await this.refresh();
    this.log.log(`Gunluk kur: 1 USD = ${r.rate} TL (${r.source}${r.stale ? ', BAYAT' : ''})`);
  }

  /** Guncel kur + meta. UI "1 USD = X TL (TCMB, tarih)" gosterebilsin diye meta da doner. */
  async getRate(): Promise<FxRate> {
    if (this.memo && Date.now() - this.memoAt < this.MEMO_TTL_MS) {
      return this.memo;
    }
    const stored = await this.readStored();
    if (stored) {
      this.memo = stored;
      this.memoAt = Date.now();
      return stored;
    }
    return this.refresh();
  }

  /** Geriye donuk uyumluluk — sadece sayi isteyen eski cagrilar icin */
  async getUsdToTryRate(): Promise<number> {
    return (await this.getRate()).rate;
  }

  /**
   * USD fiyati gunun kuruyla TL'ye cevirir.
   * Yuvarlama: en yakin tam TL'ye (kurus gostermek fiyat sayfasinda gurultu).
   */
  async usdToTry(usdAmount: number): Promise<number> {
    const { rate } = await this.getRate();
    return Math.round(usdAmount * rate);
  }

  /** TL tutari USD'ye cevirir (raporlama icin) */
  async tryToUsd(tryAmount: number): Promise<number> {
    const { rate } = await this.getRate();
    return Math.round((tryAmount / rate) * 100) / 100;
  }

  /** Cache'i atlayip TCMB'den yeniden ceker ve kalici yazar */
  async refresh(): Promise<FxRate> {
    const fresh = await this.fetchFromTcmb().catch((err) => {
      this.log.warn(`TCMB kur cekilemedi: ${err.message}`);
      return null;
    });

    if (fresh) {
      const value: FxRate = {
        rate: fresh,
        fetchedAt: new Date().toISOString(),
        source: 'TCMB',
        stale: false,
      };
      await this.writeStored(value);
      this.memo = value;
      this.memoAt = Date.now();
      return value;
    }

    // Cekemedik — son bilinen degeri BAYAT olarak isaretleyip dondur.
    const stored = await this.readStored();
    const value: FxRate = stored
      ? { ...stored, stale: true }
      : { rate: FALLBACK_USD_TRY, fetchedAt: new Date().toISOString(), source: 'fallback', stale: true };

    this.memo = value;
    this.memoAt = Date.now();
    return value;
  }

  // ────────────────────────────────────────────────────────────
  //  Ic yardimcilar
  // ────────────────────────────────────────────────────────────
  private async fetchFromTcmb(): Promise<number> {
    const res = await fetch('https://www.tcmb.gov.tr/kurlar/today.xml', {
      signal: (AbortSignal as any).timeout?.(8_000),
      headers: { 'User-Agent': 'RanksUp/1.0 (+https://ranksup.ai)' },
    });
    if (!res.ok) throw new Error(`TCMB HTTP ${res.status}`);
    const xml = await res.text();

    const usdBlock = xml.match(/<Currency[^>]*CurrencyCode="USD"[\s\S]*?<\/Currency>/i);
    if (!usdBlock) throw new Error('XML icinde USD blogu yok');

    // ForexSelling = doviz satis. Musteriden TL tahsil edip USD maliyet
    // odedigimiz icin SATIS kuru dogru referans (alis kuru marji asindirir).
    const sell = usdBlock[0].match(/<ForexSelling>([\d.]+)<\/ForexSelling>/);
    const raw = sell?.[1];
    if (!raw) throw new Error('ForexSelling alani yok');

    const rate = parseFloat(raw);
    if (!Number.isFinite(rate) || rate < SANE_MIN || rate > SANE_MAX) {
      throw new Error(`Anormal kur degeri: ${raw}`);
    }
    return rate;
  }

  private async readStored(): Promise<FxRate | null> {
    try {
      const row = await this.prisma.kvStore.findUnique({ where: { key: KV_KEY } });
      if (!row?.value) return null;
      const parsed = JSON.parse(row.value) as FxRate;
      if (!Number.isFinite(parsed?.rate) || parsed.rate < SANE_MIN || parsed.rate > SANE_MAX) return null;
      return parsed;
    } catch {
      return null;
    }
  }

  private async writeStored(value: FxRate) {
    try {
      await this.prisma.kvStore.upsert({
        where: { key: KV_KEY },
        create: { key: KV_KEY, value: JSON.stringify(value) },
        update: { value: JSON.stringify(value) },
      });
    } catch (err: any) {
      this.log.warn(`Kur DB'ye yazilamadi: ${err.message}`);
    }
  }
}
