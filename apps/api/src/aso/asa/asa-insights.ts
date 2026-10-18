import type { AsaApiVersion, AsaDateRange, AsaImpressionShareRow, AsaSearchTermPopularityRow } from './asa-types.js';
import { formatYmd } from './asa-types.js';

/**
 * Apple Ads Insights cevaplarini musteriye gosterilecek bicime getirir.
 *
 * KURAL: Apple'in populerlik ve gosterim payi degerleri GORELI puandir; asla
 * "arama hacmi" diye sunulmaz. Her cevap ayni etiketi tasir.
 *   https://developer.apple.com/documentation/apple-ads-platform-api/insights-endpoints
 */

export const ASA_RELATIVE_SCORE_LABEL = 'göreli skor (Apple Ads)';

/** Apple'in populerlik sorgusunda kabul ettigi tur degerleri (dokumandaki liste). */
export const ASA_POPULARITY_GENRES = [
  'BUSINESS', 'EDUCATION', 'ENTERTAINMENT', 'FINANCE', 'FOOD_DRINK', 'GAMES',
  'HEALTH_FITNESS', 'LIFESTYLE', 'NEW_PUBLICATION', 'PHOTO_VIDEO',
  'PRODUCTIVITY_UTILITIES', 'SHOPPING', 'SOCIAL_NETWORKING', 'SPORTS', 'TRAVEL',
] as const;

export function insightsUnavailable(version: AsaApiVersion) {
  return {
    available: false as const,
    apiVersion: version,
    reason:
      'Bu veri RanksUp’ta yalnızca Apple Ads Platform API bağlantısıyla alınıyor; sunucu şu an Campaign Management API v5 kullanıyor.',
  };
}

/**
 * Populerlik penceresi: tamamlanmis son iki Pazar-Cumartesi haftasi. Apple
 * haftalik veriyi pazartesi 07:00 UTC'de bir onceki hafta icin uretir; iki
 * hafta istenir ki Apple bir hafta gec kalirsa da sonuc bos donmesin (terim
 * basina en yeni hafta tutulur).
 */
export function popularityWindow(now: Date = new Date()): AsaDateRange {
  const sevenAm = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 7, 0, 0);
  const dow = new Date(sevenAm).getUTCDay(); // 0 Pazar … 1 Pazartesi
  let monday = sevenAm - ((dow + 6) % 7) * 86_400_000;
  if (monday > now.getTime()) monday -= 7 * 86_400_000;
  const saturday = monday - 2 * 86_400_000;
  const sundayTwoWeeksBack = saturday - 13 * 86_400_000;
  return { startDate: formatYmd(new Date(sundayTwoWeeksBack)), endDate: formatYmd(new Date(saturday)) };
}

/** Gosterim payi penceresi: dun dahil son N gun (Apple DAILY icin en fazla 30 gun, UTC). */
export function impressionShareWindow(days: number, now: Date = new Date()): AsaDateRange {
  const n = Math.min(Math.max(Math.floor(days) || 7, 1), 30);
  const end = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) - 86_400_000;
  return { startDate: formatYmd(new Date(end - (n - 1) * 86_400_000)), endDate: formatYmd(new Date(end)) };
}

export function buildPopularityResponse(
  rows: AsaSearchTermPopularityRow[],
  ctx: { country: string; genre: string | null; window: AsaDateRange; requestedTerms: string[] },
) {
  // Terim+tur basina en yeni hafta
  const latest = new Map<string, AsaSearchTermPopularityRow>();
  for (const r of rows) {
    const key = `${r.searchTerm}\u0000${r.genre ?? ''}`;
    const prev = latest.get(key);
    if (!prev || (r.period ?? '') > (prev.period ?? '')) latest.set(key, r);
  }
  const terms = [...latest.values()]
    .sort((a, b) => (b.popularity1to100 ?? -1) - (a.popularity1to100 ?? -1))
    .map((r) => ({
      term: r.searchTerm,
      genre: r.genre,
      week: r.period,
      relativeScore: r.popularity1to100,
      relativeScoreInGenre: r.popularityInGenre,
      relativeTier1to5: r.popularity1to5,
      rankInGenre: r.rankInGenre,
    }));
  const found = new Set(terms.map((t) => t.term.toLocaleLowerCase('tr-TR')));
  const notFound = ctx.requestedTerms.filter((t) => !found.has(t.toLocaleLowerCase('tr-TR')));
  return {
    available: true as const,
    label: ASA_RELATIVE_SCORE_LABEL,
    note: 'Puanlar Apple Ads’in göreli ölçekleridir (1–100 ve 1–5); mutlak arama hacmi değildir.',
    country: ctx.country,
    genre: ctx.genre,
    period: ctx.window,
    terms,
    notFound,
    notFoundNote: notFound.length > 0 ? 'Apple bu terimler için bu dönemde puan döndürmedi; Apple yalnızca eşiğin üzerindeki terimleri raporlar.' : null,
  };
}

function shareText(low: number | null, high: number | null): string | null {
  if (low === null || high === null) return null;
  // Apple %91-100 araligini tek kova olarak verir (low 0.91, high 1)
  if (high >= 1 && low >= 0.9 && low < 1) return '%91–100';
  return `%${Math.round(high * 100)}`;
}

export function buildImpressionShareResponse(
  rows: AsaImpressionShareRow[],
  ctx: { country: string | null; adamId: string; window: AsaDateRange },
) {
  return {
    available: true as const,
    label: ASA_RELATIVE_SCORE_LABEL,
    note: 'Gösterim payı, reklamınızın bu terimdeki gösterim fırsatlarından aldığı paydır; Apple %91–100 aralığını tek dilim olarak verir. Arama hacmi değildir.',
    country: ctx.country,
    adamId: ctx.adamId,
    period: ctx.window,
    rows: rows.map((r) => ({
      date: r.date,
      term: r.searchTerm,
      country: r.countryOrRegion,
      shareLow: r.lowShare,
      shareHigh: r.highShare,
      shareText: shareText(r.lowShare, r.highShare),
      rank: r.rank,
      relativeTier1to5: r.popularity1to5,
    })),
  };
}
