/**
 * Gorunurluk gecmisi — olcum yontemi surumune duyarli trend ve manset (saf).
 *
 * NEDEN: getHistory (ai-citation-tracker.service.ts) snapshot'larin
 * matchVersion'ina bakmadan ilk-son farki, onceki 7 gune gore farki ve
 * "RanksUp Etkisi" kartinin baslangicini hesapliyordu. CITATION_MATCH_VERSION
 * 4 jenerik alan-adi markasinda yalin kelime anilmasini saymiyor; v3 → v4
 * gecisi bu yuzden "gorunurluk dustu" diye okunuyordu (emlak.com: 38 → 0),
 * oysa ai-kpis, alarm ve rapor ayni durumu "yontem degisti" diye isaretliyor.
 *
 * KURAL (comparable-trend.ts ile ayni ruh):
 *  - Her saglayicinin serisi, SON noktasiyla ayni surumde olan son kesitine
 *    (currentVersionSegment) indirilir; fark, ortalama ve baslangic yalniz bu
 *    kesitten hesaplanir.
 *  - Kesit disinda kalan (eski yontemli) nokta varsa methodChanged = true ve
 *    methodChangedAt = kesitin ilk gunu. Kesitte iki ayri olcum yoksa fark yok.
 *  - Manset: yalniz en guncel surumde olculen saglayicilar; karsilastirma
 *    penceresinde (son 2x7 gun) eski yontemli olcum varsa deltaVsPrev null.
 */
import { buildHeadline, providerHeadline, type Headline, type SeriesPoint } from './citation-headline.js';

export interface VersionedPoint extends SeriesPoint {
  cited: number;
  mentioned: number;
  /** Olcum yontemi surumu (AiCitationSnapshot.matchVersion; eski kayitta 1) */
  matchVersion: number;
}

export interface ProviderTrend {
  provider: string;
  /** Kesitteki ilk OLCULEN skor (baslangic); olculen nokta yoksa null */
  first: number | null;
  /** Kesitin son noktasinin skoru — son kosum olculemediyse null */
  last: number | null;
  /** last - first; iki ayri olcum yoksa ya da biri null ise null */
  delta: number | null;
  last7Avg: number | null;
  runCount: number;
  firstDate: string | null;
  lastDate: string | null;
  /** Son noktanin olcum yontemi surumu */
  matchVersion: number | null;
  /** Pencerede eski yontemle olculmus nokta var — kiyas yalniz kesit icinde */
  methodChanged: boolean;
  /** Guncel yontemin pencerede ilk gorundugu gun (methodChanged degilse null) */
  methodChangedAt: string | null;
}

export interface VersionedHeadline extends Headline {
  /** Karsilastirma penceresinde yontem degisti — deltaVsPrev bu durumda null */
  methodChanged: boolean;
  methodChangedAt: string | null;
  /** Mansete giren olcumlerin yontem surumu */
  matchVersion: number | null;
}

const DAY_MS = 86_400_000;
const dayIndex = (date: string) => Math.floor(Date.parse(`${date}T00:00:00Z`) / DAY_MS);

/** Serinin sonundaki, son noktayla ayni surumlu kesintisiz kesit (seri tarih sirali) */
export function currentVersionSegment<T extends { matchVersion: number }>(series: T[]): T[] {
  if (series.length === 0) return [];
  const v = series[series.length - 1].matchVersion;
  let i = series.length - 1;
  while (i > 0 && series[i - 1].matchVersion === v) i--;
  return series.slice(i);
}

/** Saglayici trendi — yalniz guncel yontem kesitinden */
export function providerTrend(provider: string, series: VersionedPoint[], windowDays = 7): ProviderTrend {
  const seg = currentVersionSegment(series);
  const methodChanged = seg.length > 0 && seg.length < series.length;
  const base = seg.find((p) => typeof p.score === 'number') ?? null;
  const latest = seg.length > 0 ? seg[seg.length - 1] : null;
  const first = base?.score ?? null;
  const last = latest?.score ?? null;
  const delta = base && latest && base !== latest && first !== null && last !== null ? last - first : null;
  const h = providerHeadline(seg, windowDays);
  return {
    provider,
    first,
    last,
    delta,
    last7Avg: h.last7Avg,
    runCount: h.runCount,
    firstDate: base?.date ?? null,
    lastDate: latest?.date ?? null,
    matchVersion: latest?.matchVersion ?? null,
    methodChanged,
    methodChangedAt: methodChanged ? seg[0].date : null,
  };
}

/**
 * Manset — yalniz guncel yontemle olculen kesitlerden. Donen `segments`
 * oynaklik hesabinda da kullanilir: yontem degisimi "oynaklik" diye okunmasin.
 */
export function versionedHeadline(
  byProvider: Record<string, VersionedPoint[]>,
  windowDays = 7,
): { headline: VersionedHeadline; segments: Record<string, VersionedPoint[]> } {
  const lastVersions = Object.values(byProvider)
    .map((s) => s[s.length - 1]?.matchVersion)
    .filter((v): v is number => typeof v === 'number');
  const latest = lastVersions.length > 0 ? Math.max(...lastVersions) : null;

  const segments: Record<string, VersionedPoint[]> = {};
  let methodChanged = false;
  let methodChangedAt: string | null = null;
  for (const [provider, series] of Object.entries(byProvider)) {
    const seg = currentVersionSegment(series);
    // Yeni yontemle hic olculmemis saglayicinin eski yontemli ortalamasi
    // guncel mansete karistirilmaz.
    if (seg.length === 0 || seg[0].matchVersion !== latest) continue;
    segments[provider] = seg;

    const valid = seg.filter((p) => typeof p.score === 'number');
    if (valid.length === 0) continue;
    // providerHeadline'in pencereleri kesitin son gecerli gunune gore kurulur:
    // [son - 2w + 1, son]. Bu aralikta eski yontemli gecerli olcum varsa onceki
    // haftayla kiyas yontem farkini da tasir.
    const anchor = Math.max(...valid.map((p) => dayIndex(p.date)));
    const older = series.slice(0, series.length - seg.length)
      .some((p) => typeof p.score === 'number' && dayIndex(p.date) >= anchor - 2 * windowDays + 1);
    if (older) {
      methodChanged = true;
      if (!methodChangedAt || seg[0].date < methodChangedAt) methodChangedAt = seg[0].date;
    }
  }

  const h = buildHeadline(segments, windowDays);
  return {
    headline: {
      ...h,
      deltaVsPrev: methodChanged ? null : h.deltaVsPrev,
      methodChanged,
      methodChangedAt,
      matchVersion: latest,
    },
    segments,
  };
}
