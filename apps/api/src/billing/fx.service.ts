import { Injectable, Logger } from '@nestjs/common';

/**
 * TCMB Kur Servisi — Türkiye Cumhuriyet Merkez Bankası resmi XML feed'inden
 * günlük USD/TL kurunu çeker, 24 saat cache'ler.
 *
 * URL: https://www.tcmb.gov.tr/kurlar/today.xml
 * Feed günde 1 kez (saat 15:30 TRT) güncellenir.
 *
 * Hata/timeout durumunda son bilinen kur veya hardcoded fallback kullanılır.
 */
@Injectable()
export class FxService {
  private readonly log = new Logger(FxService.name);

  // Cache
  private cachedRate: number | null = null;
  private cachedAt: number = 0;
  private readonly TTL_MS = 24 * 60 * 60 * 1000; // 24 saat

  // Fallback: TCMB ulaşılamazsa
  private readonly FALLBACK_USD_TRY = 40;

  /**
   * 1 USD'nin TL karşılığı. Pricing'i USD'den TL'ye çevirme dışında
   * kullanma (TL → USD için 1/getRate()).
   */
  async getUsdToTryRate(): Promise<number> {
    const now = Date.now();

    // Cache hit
    if (this.cachedRate && now - this.cachedAt < this.TTL_MS) {
      return this.cachedRate;
    }

    try {
      const res = await fetch('https://www.tcmb.gov.tr/kurlar/today.xml', {
        signal: (AbortSignal as any).timeout?.(8_000),
      });
      if (!res.ok) throw new Error(`TCMB HTTP ${res.status}`);
      const xml = await res.text();

      // <Currency CurrencyCode="USD"> ... <ForexSelling>40.1234</ForexSelling> ...
      const usdBlock = xml.match(/<Currency[^>]*CurrencyCode="USD"[\s\S]*?<\/Currency>/i);
      if (!usdBlock) throw new Error('USD block bulunamadı');

      const sellMatch = usdBlock[0].match(/<ForexSelling>([\d.]+)<\/ForexSelling>/);
      if (!sellMatch) throw new Error('ForexSelling bulunamadı');

      const rate = parseFloat(sellMatch[1]);
      if (!isFinite(rate) || rate < 5 || rate > 200) {
        throw new Error(`Anormal kur: ${rate}`);
      }

      this.cachedRate = rate;
      this.cachedAt = now;
      this.log.log(`TCMB USD/TRY = ${rate.toFixed(4)} (cache 24h)`);
      return rate;
    } catch (err: any) {
      this.log.warn(`TCMB kur çekilemedi: ${err.message} — fallback ${this.FALLBACK_USD_TRY}`);
      // Eski cached varsa onu kullan, yoksa fallback
      return this.cachedRate ?? this.FALLBACK_USD_TRY;
    }
  }

  /**
   * TL fiyatı USD'ye çevirir (round to nearest .99 for psychology).
   */
  async tryToUsd(tryAmount: number): Promise<number> {
    const rate = await this.getUsdToTryRate();
    const raw = tryAmount / rate;
    // Psikolojik fiyatlama: nearest .99 ($19.99, $59.99 vs)
    const floored = Math.floor(raw);
    return floored + 0.99;
  }

  async refresh(): Promise<number> {
    this.cachedAt = 0;
    return this.getUsdToTryRate();
  }
}
