import { Injectable, Logger } from '@nestjs/common';

/**
 * FxService — USD/TRY kur dönüşümü.
 *
 * Plan fiyatları TRY bazlıdır (BASE_PLANS). EN/diğer diller için USD karşılığı
 * bu servisle dinamik hesaplanır. Kaynak: TCMB günlük kur (today.xml), 24 saat cache.
 * Ağ hatası / parse hatası durumunda son bilinen kura, o da yoksa FALLBACK_RATE'e düşer.
 */
@Injectable()
export class FxService {
  private readonly log = new Logger(FxService.name);

  /** TCMB erişilemezse kullanılacak makul varsayılan (1 USD ≈ X TRY). */
  private static readonly FALLBACK_RATE = 41;
  private static readonly TTL_MS = 24 * 60 * 60 * 1000; // 24 saat
  private static readonly TCMB_URL = 'https://www.tcmb.gov.tr/kurlar/today.xml';

  private cachedRate: number | null = null;
  private cachedAt = 0;

  /** 1 USD = ? TRY. 24 saat cache'li; hata olursa son bilinen değere / fallback'e düşer. */
  async getUsdToTryRate(): Promise<number> {
    const now = Date.now();
    if (this.cachedRate !== null && now - this.cachedAt < FxService.TTL_MS) {
      return this.cachedRate;
    }

    try {
      const rate = await this.fetchTcmbUsdRate();
      this.cachedRate = rate;
      this.cachedAt = now;
      return rate;
    } catch (err: any) {
      this.log.warn(`TCMB kuru alınamadı (${err?.message ?? err}); ${this.cachedRate ?? FxService.FALLBACK_RATE} kullanılıyor`);
      // Süresi geçmiş olsa bile son bilinen değeri tercih et, yoksa fallback.
      return this.cachedRate ?? FxService.FALLBACK_RATE;
    }
  }

  /** TRY tutarını USD'ye çevirir (2 ondalık). */
  async tryToUsd(tryAmount: number): Promise<number> {
    if (!tryAmount || tryAmount <= 0) return 0;
    const rate = await this.getUsdToTryRate();
    return Math.round((tryAmount / rate) * 100) / 100;
  }

  /** TCMB today.xml'den USD ForexSelling değerini çeker. */
  private async fetchTcmbUsdRate(): Promise<number> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    try {
      const res = await fetch(FxService.TCMB_URL, {
        signal: controller.signal,
        headers: { 'User-Agent': 'RanksUp-Fx/1.0 (+https://ranksup.ai)' },
      });
      if (!res.ok) throw new Error(`TCMB HTTP ${res.status}`);
      const xml = await res.text();

      // <Currency CurrencyCode="USD"> ... <ForexSelling>41,1234</ForexSelling> ... </Currency>
      const usdBlock = xml.match(/<Currency[^>]*CurrencyCode="USD"[\s\S]*?<\/Currency>/i)?.[0];
      const raw = usdBlock?.match(/<ForexSelling>([\d.,]+)<\/ForexSelling>/i)?.[1]
        ?? usdBlock?.match(/<BanknoteSelling>([\d.,]+)<\/BanknoteSelling>/i)?.[1];
      if (!raw) throw new Error('USD ForexSelling parse edilemedi');

      const rate = parseFloat(raw.replace(',', '.'));
      if (!Number.isFinite(rate) || rate <= 0) throw new Error(`Geçersiz kur: ${raw}`);
      return rate;
    } finally {
      clearTimeout(timeout);
    }
  }
}
