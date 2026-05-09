import { Injectable, Logger } from '@nestjs/common';
// @ts-ignore — google-play-scraper has untyped CJS
import gplay from 'google-play-scraper';
// @ts-ignore — app-store-scraper has untyped CJS
import store from 'app-store-scraper';

/**
 * Wrapper around google-play-scraper + app-store-scraper.
 * Senin tüm ham veri katmanın burası.
 */
@Injectable()
export class AsoScrapersService {
  private readonly log = new Logger(AsoScrapersService.name);

  // ─────────────────────────────────────────────
  //  App metadata fetch
  // ─────────────────────────────────────────────

  async getIosApp(opts: { id: string; country?: string; lang?: string }) {
    try {
      return await store.app({
        id: opts.id,
        country: opts.country ?? 'tr',
        lang: opts.lang ?? 'tr',
      });
    } catch (err: any) {
      this.log.warn(`iOS app fetch ${opts.id}: ${err.message}`);
      return null;
    }
  }

  async getAndroidApp(opts: { appId: string; country?: string; lang?: string }) {
    try {
      return await gplay.app({
        appId: opts.appId,
        country: opts.country ?? 'tr',
        lang: opts.lang ?? 'tr',
      });
    } catch (err: any) {
      this.log.warn(`Android app fetch ${opts.appId}: ${err.message}`);
      return null;
    }
  }

  // ─────────────────────────────────────────────
  //  Search & ranking
  // ─────────────────────────────────────────────

  async iosSearch(opts: { term: string; country?: string; num?: number }) {
    try {
      return await store.search({
        term: opts.term,
        country: opts.country ?? 'tr',
        num: opts.num ?? 100,
      });
    } catch (err: any) {
      this.log.warn(`iOS search "${opts.term}": ${err.message}`);
      return [];
    }
  }

  async androidSearch(opts: { term: string; country?: string; num?: number }) {
    try {
      return await gplay.search({
        term: opts.term,
        country: opts.country ?? 'tr',
        num: opts.num ?? 100,
      });
    } catch (err: any) {
      this.log.warn(`Android search "${opts.term}": ${err.message}`);
      return [];
    }
  }

  /**
   * App'in belirli bir keyword'de kaçıncı sırada olduğunu bul.
   * `null` = top N içinde yok.
   */
  async findRank(opts: {
    term: string;
    appIdent: string;
    androidPackage?: boolean;
    country?: string;
    num?: number;
    storeType: 'IOS' | 'ANDROID';
  }): Promise<{ rank: number | null; total: number }> {
    const num = opts.num ?? 100;
    const results = opts.storeType === 'IOS'
      ? await this.iosSearch({ term: opts.term, country: opts.country, num })
      : await this.androidSearch({ term: opts.term, country: opts.country, num });

    const idx = results.findIndex((r: any) => {
      if (opts.storeType === 'IOS') {
        return String(r.id) === opts.appIdent || r.appId === opts.appIdent;
      }
      return r.appId === opts.appIdent;
    });
    return { rank: idx >= 0 ? idx + 1 : null, total: results.length };
  }

  // ─────────────────────────────────────────────
  //  Suggestions / autocomplete
  // ─────────────────────────────────────────────

  async iosSuggest(opts: { term: string; country?: string }) {
    try {
      // app-store-scraper doesn't have suggest, fallback to search top results' titles
      return await store.suggest({
        term: opts.term,
        country: opts.country ?? 'tr',
      });
    } catch (err: any) {
      this.log.warn(`iOS suggest "${opts.term}": ${err.message}`);
      return [];
    }
  }

  async androidSuggest(opts: { term: string; country?: string }) {
    try {
      return await gplay.suggest({
        term: opts.term,
        country: opts.country ?? 'tr',
      });
    } catch (err: any) {
      this.log.warn(`Android suggest "${opts.term}": ${err.message}`);
      return [];
    }
  }

  // ─────────────────────────────────────────────
  //  Similar apps (rakip bulma)
  // ─────────────────────────────────────────────

  async iosSimilar(opts: { id: string; country?: string }) {
    try {
      return await store.similar({ id: opts.id, country: opts.country ?? 'tr' });
    } catch (err: any) {
      this.log.warn(`iOS similar ${opts.id}: ${err.message}`);
      return [];
    }
  }

  async androidSimilar(opts: { appId: string; country?: string }) {
    try {
      return await gplay.similar({ appId: opts.appId, country: opts.country ?? 'tr' });
    } catch (err: any) {
      this.log.warn(`Android similar ${opts.appId}: ${err.message}`);
      return [];
    }
  }

  // ─────────────────────────────────────────────
  //  Reviews
  // ─────────────────────────────────────────────

  async iosReviews(opts: { id: string; country?: string; page?: number }) {
    try {
      return await store.reviews({
        id: opts.id,
        country: opts.country ?? 'tr',
        page: opts.page ?? 1,
        sort: store.sort.RECENT,
      });
    } catch (err: any) {
      this.log.warn(`iOS reviews ${opts.id}: ${err.message}`);
      return [];
    }
  }

  async androidReviews(opts: { appId: string; country?: string; num?: number }) {
    try {
      const res: any = await gplay.reviews({
        appId: opts.appId,
        country: opts.country ?? 'tr',
        sort: (gplay as any).sort?.NEWEST ?? 2, // 2 = NEWEST
        num: opts.num ?? 100,
      } as any);
      return res?.data ?? res ?? [];
    } catch (err: any) {
      this.log.warn(`Android reviews ${opts.appId}: ${err.message}`);
      return [];
    }
  }
}
