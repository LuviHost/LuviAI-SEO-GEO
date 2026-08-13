import { Injectable, Logger } from '@nestjs/common';
// @ts-ignore — google-play-scraper has untyped CJS
import gplay from 'google-play-scraper';
// @ts-ignore — app-store-scraper has untyped CJS
import store from 'app-store-scraper';
import { resolveStoreLocale, type StoreLocale } from './locale.js';

/**
 * Wrapper around google-play-scraper + app-store-scraper.
 * Senin tüm ham veri katmanın burası.
 *
 * DIL: Her magaza cagrisina `lang` gecilir. Her iki kutuphane de anahtari
 * `lang` diye okur (`language` DEGIL — app-store-scraper/lib/search.js ve
 * google-play-scraper/lib/search.js dogrulandi). Eskiden sadece `country`
 * geciyorduk, dolayisiyla kutuphaneler 'en-us'/'en' varsayiyordu ve
 * TR storefront'unda olctugumuz sira musterinin gordugu sira degildi.
 */
@Injectable()
export class AsoScrapersService {
  private readonly log = new Logger(AsoScrapersService.name);

  /**
   * Ulke + (istege bagli) acik dil talebinden lokali cozer.
   * Cagiranlar dil bilmek zorunda kalmasin diye tek kapi burasi.
   */
  locale(country?: string | null, langOverride?: string | null): StoreLocale {
    const resolved = resolveStoreLocale(country);
    if (!langOverride) return resolved;
    // Acik dil talebi varsa ona saygi duy, ama storefront ulkesini koru.
    const lower = String(langOverride).trim().toLowerCase().replace('_', '-');
    const [base, region] = lower.split('-');
    const measured = `${base}-${(region ?? resolved.country).toUpperCase()}`;
    return {
      country: resolved.country,
      appleSearchLang: measured.toLowerCase(),
      appleLookupLang: measured.toLowerCase().replace('-', '_'),
      googleLang: region ? measured : base,
      measuredLocale: measured,
    };
  }

  // ─────────────────────────────────────────────
  //  App metadata fetch
  // ─────────────────────────────────────────────

  async getIosApp(opts: { id: string; country?: string; lang?: string }) {
    const loc = this.locale(opts.country, opts.lang);
    try {
      return await store.app({
        id: opts.id,
        country: loc.country,
        // iTunes lookup API'si alt cizgili form belgeler ('tr_tr').
        lang: loc.appleLookupLang,
      });
    } catch (err: any) {
      this.log.warn(`iOS app fetch ${opts.id} (${loc.measuredLocale}): ${err.message}`);
      return null;
    }
  }

  async getAndroidApp(opts: { appId: string; country?: string; lang?: string }) {
    const loc = this.locale(opts.country, opts.lang);
    try {
      return await gplay.app({
        appId: opts.appId,
        country: loc.country,
        lang: loc.googleLang,
      });
    } catch (err: any) {
      this.log.warn(`Android app fetch ${opts.appId} (${loc.measuredLocale}): ${err.message}`);
      return null;
    }
  }

  // ─────────────────────────────────────────────
  //  Search & ranking
  // ─────────────────────────────────────────────

  async iosSearch(opts: { term: string; country?: string; lang?: string; num?: number }) {
    const loc = this.locale(opts.country, opts.lang);
    try {
      return await store.search({
        term: opts.term,
        country: loc.country,
        // Accept-Language basligina yaziliyor. DIKKAT: siralamayi bu DEGIL,
        // storefront (country) belirliyor — canli olculdu: 'kredi karti' ve
        // 'yemek siparisi' icin tr-tr ile en-us sonuc id sirasi BIREBIR AYNI.
        // Dilin etkisi donen metadata'nin dili (baslik/aciklama). Yani bu
        // duzeltme gecmis siralama kayitlarini gecersiz KILMAZ.
        lang: loc.appleSearchLang,
        num: opts.num ?? 100,
      });
    } catch (err: any) {
      this.log.warn(`iOS search "${opts.term}" (${loc.measuredLocale}): ${err.message}`);
      return [];
    }
  }

  async androidSearch(opts: { term: string; country?: string; lang?: string; num?: number }) {
    const loc = this.locale(opts.country, opts.lang);
    try {
      return await gplay.search({
        term: opts.term,
        country: loc.country,
        // Play tarafinda `hl` parametresine donusur, siralamayi etkiler.
        lang: loc.googleLang,
        num: opts.num ?? 100,
      });
    } catch (err: any) {
      this.log.warn(`Android search "${opts.term}" (${loc.measuredLocale}): ${err.message}`);
      return [];
    }
  }

  /**
   * App'in belirli bir keyword'de kaçıncı sırada olduğunu bul.
   * `null` = top N içinde yok.
   *
   * `measuredLocale` doner: olcumun HANGI ulke+dil ile yapildigini cagiran
   * ve nihayetinde kullanici gorebilsin diye. Ayni keyword farkli lokalde
   * farkli sira verir; bu alan olmadan sonuc yorumlanamaz.
   */
  async findRank(opts: {
    term: string;
    appIdent: string;
    androidPackage?: boolean;
    country?: string;
    lang?: string;
    num?: number;
    storeType: 'IOS' | 'ANDROID';
  }): Promise<{ rank: number | null; total: number; measurable: boolean; measuredLocale: string; country: string }> {
    const num = opts.num ?? 100;
    const loc = this.locale(opts.country, opts.lang);

    // Ham girdiyi aynen aktariyoruz (cozulmus measuredLocale'i DEGIL): search
    // metotlari ayni cozumleyiciyi calistirinca birebir ayni `lang` uretsin diye.
    // Cozulmus degeri geri beslersek Android'de 'tr' yerine 'tr-TR' gonderilir
    // ve findRank ile duz androidSearch farkli lokalde olcum yapardi.
    const results = opts.storeType === 'IOS'
      ? await this.iosSearch({ term: opts.term, country: opts.country, lang: opts.lang, num })
      : await this.androidSearch({ term: opts.term, country: opts.country, lang: opts.lang, num });

    const idx = results.findIndex((r: any) => {
      if (opts.storeType === 'IOS') {
        return String(r.id) === opts.appIdent || r.appId === opts.appIdent;
      }
      return r.appId === opts.appIdent;
    });
    // "OLCULEMEDI" ile "SIRADA YOK" AYNI SEY DEGIL.
    // Arama hic sonuc dondurmediyse bu, uygulamanin siralamada olmadigi
    // anlamina gelmez — magaza tarafinda bir kirilma demektir. Bugun tam
    // olarak bu yasaniyor: google-play-scraper'in search'u her sorgu icin
    // 0 sonuc donuyor (canli olculdu: 'banka' tr/tr ve 'bank' us/en -> 0),
    // hata da firlatmadigi icin her Android keyword'u sessizce "sirada yok"
    // olarak kaydediliyordu ve musteriye olmayan bir dusus gosteriliyordu.
    // Cagiran taraf artik ikisini ayirt edebilsin.
    const measurable = results.length > 0;
    return {
      rank: idx >= 0 ? idx + 1 : null,
      total: results.length,
      measurable,
      measuredLocale: loc.measuredLocale,
      country: loc.country,
    };
  }

  // ─────────────────────────────────────────────
  //  Suggestions / autocomplete
  // ─────────────────────────────────────────────

  async iosSuggest(opts: { term: string; country?: string; lang?: string }) {
    const loc = this.locale(opts.country, opts.lang);
    try {
      // NOT: app-store-scraper/lib/suggest.js `lang`i HIC okumuyor; oneriler
      // yalnizca X-Apple-Store-Front (yani ulke) ile belirleniyor. Yine de
      // geciyoruz ki kutuphane ileride desteklerse davranis kendiliginden duzelsin.
      return await store.suggest({
        term: opts.term,
        country: loc.country,
        lang: loc.appleSearchLang,
      });
    } catch (err: any) {
      this.log.warn(`iOS suggest "${opts.term}" (${loc.measuredLocale}): ${err.message}`);
      return [];
    }
  }

  async androidSuggest(opts: { term: string; country?: string; lang?: string }) {
    const loc = this.locale(opts.country, opts.lang);
    try {
      return await gplay.suggest({
        term: opts.term,
        country: loc.country,
        lang: loc.googleLang,
      });
    } catch (err: any) {
      this.log.warn(`Android suggest "${opts.term}" (${loc.measuredLocale}): ${err.message}`);
      return [];
    }
  }

  // ─────────────────────────────────────────────
  //  Similar apps (rakip bulma)
  // ─────────────────────────────────────────────

  async iosSimilar(opts: { id: string; country?: string; lang?: string }) {
    const loc = this.locale(opts.country, opts.lang);
    try {
      // similar.js sonuclari common.lookup'a devrediyor, oradaki `&lang=`
      // alt cizgili formu bekliyor.
      return await store.similar({
        id: opts.id,
        country: loc.country,
        lang: loc.appleLookupLang,
      });
    } catch (err: any) {
      this.log.warn(`iOS similar ${opts.id} (${loc.measuredLocale}): ${err.message}`);
      return [];
    }
  }

  async androidSimilar(opts: { appId: string; country?: string; lang?: string }) {
    const loc = this.locale(opts.country, opts.lang);
    try {
      // similar.js'te yalnizca ILK istek (cluster URL'ini bulan) hl:'en'
      // sabitini kullaniyor; asil listeyi ceken ikinci istek opts.lang'i
      // GECIRIYOR. Yani dil gercekten etkili — hem metadata dili hem liste
      // sirasi degisiyor.
      return await gplay.similar({
        appId: opts.appId,
        country: loc.country,
        lang: loc.googleLang,
      });
    } catch (err: any) {
      this.log.warn(`Android similar ${opts.appId} (${loc.measuredLocale}): ${err.message}`);
      return [];
    }
  }

  // ─────────────────────────────────────────────
  //  Reviews
  // ─────────────────────────────────────────────

  async iosReviews(opts: { id: string; country?: string; lang?: string; page?: number }) {
    const loc = this.locale(opts.country, opts.lang);
    try {
      return await store.reviews({
        id: opts.id,
        country: loc.country,
        page: opts.page ?? 1,
        sort: store.sort.RECENT,
      });
    } catch (err: any) {
      this.log.warn(`iOS reviews ${opts.id} (${loc.measuredLocale}): ${err.message}`);
      return [];
    }
  }

  async androidReviews(opts: { appId: string; country?: string; lang?: string; num?: number }) {
    const loc = this.locale(opts.country, opts.lang);
    try {
      const res: any = await gplay.reviews({
        appId: opts.appId,
        country: loc.country,
        lang: loc.googleLang,
        sort: (gplay as any).sort?.NEWEST ?? 2, // 2 = NEWEST
        num: opts.num ?? 100,
      } as any);
      return res?.data ?? res ?? [];
    } catch (err: any) {
      this.log.warn(`Android reviews ${opts.appId} (${loc.measuredLocale}): ${err.message}`);
      return [];
    }
  }
}
