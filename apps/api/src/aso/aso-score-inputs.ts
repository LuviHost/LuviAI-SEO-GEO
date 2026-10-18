import { foldForMatch } from '../common/text-normalize.js';
import { AsoMetadataOptimizerService } from './aso-metadata-optimizer.service.js';
import type { MetadataInput, RatingsInput } from './aso-scorer.service.js';

/**
 * ASO saglik skoru girdileri — saklanan magaza verisinden (saf).
 *
 * Eskiden controller tek girdi uretiyordu: ad `ios.trackName ?? android.title`
 * (trackName saklanmiyor → iki magazali uygulamada hep Android adi), aciklama
 * ise once iOS'tan. Yani Android adi iOS aciklamasiyla puanlaniyordu ve iOS
 * aciklamasindaki anahtar kelime yogunlugu skora giriyordu — Apple aciklamayi
 * aramada kullanmadigi halde. Artik magaza basina ayri girdi var.
 */

export type ScoreStore = 'IOS' | 'ANDROID';

export interface StoreMetadataInput {
  store: ScoreStore;
  input: MetadataInput;
  /** Hesaplanan yogunluk (%); App Store'da hesaplanmaz cunku skora katilmaz */
  keywordDensity: number | null;
}

// Turkce harf guvenli yogunluk (\b ASCII'dir: "çiçek" sayilmiyordu) — tek kaynak optimizer'da
const density = new AsoMetadataOptimizerService();

export function storeMetadataInputs(
  meta: { ios?: any; android?: any } | null | undefined,
  linked: { ios: boolean; android: boolean },
  targetKeywords: string[],
): StoreMetadataInput[] {
  const keywords = targetKeywords.map((k) => k.trim()).filter(Boolean);
  const out: StoreMetadataInput[] = [];
  const build = (store: ScoreStore, src: any) => {
    const title = String(src?.title ?? '');
    const desc = String(src?.description ?? '');
    const titleFold = foldForMatch(title);
    const titleKwCount = keywords.filter((k) => titleFold.includes(foldForMatch(k))).length;
    const kwDensity = store === 'ANDROID' && keywords.length
      ? Math.round(Object.values(density.calculateKeywordDensity(desc, keywords)).reduce((a, b) => a + b, 0) * 10) / 10
      : store === 'ANDROID' ? 0 : null;
    out.push({
      store,
      keywordDensity: kwDensity,
      input: {
        title_keyword_count: titleKwCount,
        title_length: [...title].length,
        description_length: [...desc].length,
        description_quality: desc.length > 1500 ? 0.8 : desc.length > 500 ? 0.5 : 0.3,
        ...(store === 'ANDROID' ? { keyword_density: kwDensity ?? 0 } : {}),
        platform: store === 'IOS' ? 'ios' : 'android',
      },
    });
  };
  if (linked.ios && meta?.ios) build('IOS', meta.ios);
  if (linked.android && meta?.android) build('ANDROID', meta.android);
  return out;
}

/**
 * Puan girdisi. Iki duzeltme:
 *  - Ortalama: eskiden `iosRating ?? androidRating` — iki magazali uygulamada
 *    Android puani hic sayilmiyordu. Artik degerlendirme sayisiyla agirlikli.
 *  - Toplam: iOS `reviews` alani degerlendirme (userRatingCount) sayisi, ama
 *    Play'de `reviews` yalniz YAZILI yorum sayisi; degerlendirme sayisi
 *    `ratings`. Saklanan metadata'da varsa o kullanilir.
 */
export function ratingsInputFor(
  app: { iosRating: number | null; iosReviewCount: number | null; androidRating: number | null; androidReviewCount: number | null },
  meta: { android?: any } | null | undefined,
  recentReviews30d: number | null,
): RatingsInput {
  const finite = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  const androidRatings = finite(meta?.android?.ratings) ?? finite(app.androidReviewCount);
  const parts = [
    { rating: finite(app.iosRating), count: finite(app.iosReviewCount) },
    { rating: finite(app.androidRating), count: androidRatings },
  ].filter((p) => p.rating != null && p.rating > 0);
  const weighted = parts.filter((p) => (p.count ?? 0) > 0);
  const average = weighted.length
    ? weighted.reduce((a, p) => a + p.rating! * p.count!, 0) / weighted.reduce((a, p) => a + p.count!, 0)
    : parts[0]?.rating ?? 0;
  return {
    average_rating: Math.round(average * 100) / 100,
    total_ratings: (finite(app.iosReviewCount) ?? 0) + (androidRatings ?? 0),
    recent_reviews_30d: recentReviews30d,
  };
}
