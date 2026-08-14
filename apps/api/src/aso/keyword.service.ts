import { Injectable, Logger } from '@nestjs/common';
import { helpers as asoHelpers } from 'aso-v2';
import { AsoScrapersService } from './scrapers.service.js';

/**
 * Keyword research + scoring.
 * aso-v2 wrapper + asolytics-inspired competitor metrics.
 *
 * aso-v2 hakkinda iki dis mudahale var, ikisi de bilerek:
 *  1) patches/aso-v2@2.0.14.patch — dil parametresi scraper'a ulassin diye
 *     (executeRequest yalnizca `language` gonderiyordu, scraper `lang` okuyor).
 *  2) Kok package.json'da pnpm.overrides ile google-play-scraper ^10.1.3 —
 *     aso-v2 kendi bagimliligi olarak ^9.1.1 istiyor, o surumun search'u
 *     Google'in kaldirdigi /work/search adresini kullandigi icin her sorguya
 *     0 sonuc donuyordu. Override olmadan Android keyword skorlari bos
 *     arama sonucu uzerinden, yani sifir/anlamsiz hesaplanir.
 */
@Injectable()
export class AsoKeywordService {
  private readonly log = new Logger(AsoKeywordService.name);

  constructor(private readonly scrapers: AsoScrapersService) {}

  /**
   * Tek keyword için aso-v2 skorlamasını döndür.
   * Returns: { popularity, difficulty, traffic } (0-100 ölçek)
   */
  async scoreKeyword(opts: {
    keyword: string;
    store: 'IOS' | 'ANDROID';
    country?: string;
  }) {
    // Rank olcumu ile ayni lokal cozumleyicisini kullaniyoruz ki skorlama ve
    // siralama ayni pazari anlatsin.
    const loc = this.scrapers.locale(opts.country);
    try {
      const fn = opts.store === 'IOS' ? asoHelpers.analyzeITunesKeyword : asoHelpers.analyzeGPlayKeyword;
      // Magazaya gore farkli lang formati: Apple tarafinda tek bir deger hem
      // Accept-Language basligina hem de iTunes lookup'in `&lang=` parametresine
      // gidiyor (app-store-scraper/lib/search.js) — 'tr-tr' ikisinde de gecerli,
      // canli dogrulandi. Play tarafi ise `hl` bekliyor, yani sade 'tr'.
      const langForStore = opts.store === 'IOS' ? loc.appleSearchLang : loc.googleLang;
      const scores: any = await fn(opts.keyword, {
        country: loc.country,
        // aso-v2 dili yalnizca `language` anahtariyla scraper'a gonderiyordu,
        // oysa her iki scraper da `lang` okuyor — yani dil HIC ulasmiyordu ve
        // skorlar TR storefront'unda bile Ingilizce arayuzden hesaplaniyordu
        // (canli: 'kredi karti' aramasi Revolut/Nickel gibi Ingilizce basliklar
        // donduruyordu, Yapi Kredi/Bankkart degil). patches/aso-v2@2.0.14.patch
        // executeRequest'te mergedParams'a `lang`i da ekleyerek bunu duzeltiyor.
        // Buradaki anahtar `language` KALMALI: yama onu `lang`e kopyaliyor.
        language: langForStore,
      } as any);
      // aso-v2 response: { difficulty: { score, ...nested }, traffic: { score, suggest, ranked, installs, length } }
      // popularity field yok → traffic.suggest.score (autocomplete prominence) proxy
      const difficultyRaw = scores?.difficulty?.score ?? 0;
      const trafficRaw = scores?.traffic?.score ?? 0;
      const popularityRaw = scores?.traffic?.suggest?.score ?? scores?.traffic?.installs?.score ?? 0;
      // Yama sonrasi skorlar gercekten talep edilen lokalden geliyor, bu yuzden
      // measuredLocale'i artik doniyoruz — ayni keyword farkli lokalde farkli
      // skor verir, bu alan olmadan sonuc yorumlanamaz.
      this.log.debug(`Score "${opts.keyword}" [${loc.measuredLocale}]: pop=${popularityRaw} diff=${difficultyRaw} traffic=${trafficRaw}`);
      return {
        popularity: this.normalizeScore(popularityRaw),
        difficulty: this.normalizeScore(difficultyRaw),
        traffic: this.normalizeScore(trafficRaw),
        measuredLocale: loc.measuredLocale,
      };
    } catch (err: any) {
      this.log.warn(`Score "${opts.keyword}": ${err.message}`);
      return { popularity: null, difficulty: null, traffic: null, measuredLocale: loc.measuredLocale };
    }
  }

  /** aso-v2 skorları 0-10 arası gelir; biz 0-100'e çekeriz (frontend için). */
  private normalizeScore(v: number): number {
    if (v == null || isNaN(v)) return 0;
    return Math.round(v * 10);
  }

  /**
   * Birden fazla keyword'ü toplu skorla.
   * aso-v2 her sorgu için API call yapar — paralel + rate limit var.
   */
  async batchScore(opts: {
    keywords: string[];
    store: 'IOS' | 'ANDROID';
    country?: string;
  }) {
    const out: Array<{ keyword: string; popularity: number | null; difficulty: number | null; traffic: number | null; measuredLocale: string }> = [];

    // 3'er paralel batch (aso-v2 rate limit'e takılmamak için)
    const BATCH = 3;
    for (let i = 0; i < opts.keywords.length; i += BATCH) {
      const batch = opts.keywords.slice(i, i + BATCH);
      const results = await Promise.all(
        batch.map(async (kw) => {
          const s = await this.scoreKeyword({ keyword: kw, store: opts.store, country: opts.country });
          return { keyword: kw, ...s };
        })
      );
      out.push(...results);
      // Rate limit nezaketi
      if (i + BATCH < opts.keywords.length) {
        await new Promise(r => setTimeout(r, 500));
      }
    }
    return out;
  }

  /**
   * Bir seed keyword'den autocomplete/suggest ile ilgili keyword'ler türet.
   */
  async suggestKeywords(opts: {
    seed: string;
    store: 'IOS' | 'ANDROID';
    country?: string;
    limit?: number;
  }): Promise<string[]> {
    const limit = opts.limit ?? 20;
    const suggestions = opts.store === 'IOS'
      ? await this.scrapers.iosSuggest({ term: opts.seed, country: opts.country })
      : await this.scrapers.androidSuggest({ term: opts.seed, country: opts.country });

    const terms: string[] = (suggestions ?? [])
      .map((s: any) => s.term ?? s)
      .filter((s: string) => s && s !== opts.seed)
      .slice(0, limit);
    return terms;
  }

  /**
   * Rakip app metadata'sından keyword çıkar.
   * app-agent pattern: rakip title + description'dan kelime frekansı analiz et.
   */
  async extractKeywordsFromCompetitor(opts: {
    competitorAppId: string;
    store: 'IOS' | 'ANDROID';
    country?: string;
  }): Promise<string[]> {
    const app = opts.store === 'IOS'
      ? await this.scrapers.getIosApp({ id: opts.competitorAppId, country: opts.country })
      : await this.scrapers.getAndroidApp({ appId: opts.competitorAppId, country: opts.country });

    if (!app) return [];

    const text = [
      app.title ?? '',
      app.description ?? '',
      app.subtitle ?? '',
      ...(Array.isArray(app.genres) ? app.genres : []),
    ].join(' ').toLowerCase();

    // Naive frekans analiz (Türkçe stop-words filtreli)
    const stopWords = new Set([
      've', 'ile', 'için', 'bu', 'bir', 'da', 'de', 'mi', 'ne', 'mı', 'mu',
      'the', 'a', 'an', 'and', 'or', 'but', 'is', 'are', 'in', 'on', 'at', 'to', 'for', 'of', 'with',
      'app', 'uygulama', 'aplikasyon',
    ]);

    const words = text
      .replace(/[^\p{L}\p{N}\s]/gu, ' ')
      .split(/\s+/)
      .filter(w => w.length >= 4 && !stopWords.has(w));

    const freq = new Map<string, number>();
    for (const w of words) freq.set(w, (freq.get(w) ?? 0) + 1);

    const top = Array.from(freq.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 30)
      .map(([w]) => w);

    // Bigram'lar da çıkar (2 kelimelik)
    const bigrams: string[] = [];
    for (let i = 0; i < words.length - 1; i++) {
      bigrams.push(`${words[i]} ${words[i + 1]}`);
    }
    const bigramFreq = new Map<string, number>();
    for (const b of bigrams) bigramFreq.set(b, (bigramFreq.get(b) ?? 0) + 1);
    const topBigrams = Array.from(bigramFreq.entries())
      .filter(([, c]) => c >= 2)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 15)
      .map(([w]) => w);

    return [...top, ...topBigrams];
  }
}
