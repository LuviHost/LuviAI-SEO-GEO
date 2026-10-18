/**
 * "RanksUp Etkisi" kartlarinin AI gorunurluk (GEO) kiyasi — tek kural.
 * Kullananlar: before-after-card.tsx (gorunurluk sayfasi) ve
 * ranksup-impact-card.tsx (genel bakis).
 *
 * NEDEN: kartlar baslangici pencerenin ILK noktasindan aliyordu. Olcum yontemi
 * (CITATION_MATCH_VERSION) degisince eski ve yeni yontem kiyaslanip "gorunurluk
 * dustu" diye kirmizi gosteriliyordu (ornek: emlak.com, v3 → v4: 38 → 0).
 * API (ai-citation-tracker getHistory) trends[].first/last'i artik yalniz GUNCEL
 * yontem kesitinden verir ve methodChanged/methodChangedAt doner. Burada kiyas
 * yalniz kesitinde iki AYRI olcumu olan saglayicilarla yapilir — baslangic ve
 * son ayni saglayici kumesinden.
 */

export interface GeoTrendLike {
  provider: string;
  first: number | null;
  last: number | null;
  firstDate?: string | null;
  lastDate?: string | null;
  methodChanged?: boolean;
  methodChangedAt?: string | null;
}

export interface GeoPointLike {
  date: string;
  score: number | null;
  cited?: number;
  mentioned?: number;
  matchVersion?: number;
}

export interface GeoImpact {
  /**
   * none: veri yok · baseline: kiyas icin ikinci olcum yok · method-changed:
   * yontem guncellendi ve yeni yontemle ikinci olcum yok · compare: kiyas var
   */
  state: 'none' | 'baseline' | 'method-changed' | 'compare';
  methodChanged: boolean;
  methodChangedAt: string | null;
  spanDays: number;
  /** Kiyasa giren saglayicilarin baslangic / son ortalamasi */
  firstAvg: number | null;
  lastAvg: number | null;
  /** Yuzde degisim; baslangic 0 iken yuzde anlamsiz → null */
  growthPct: number | null;
  /** Skoru 0'dan buyuk (en az bir soruda anilan ya da alintilanan) saglayici */
  enginesStart: number;
  enginesNow: number;
  totalEngines: number;
  mentionsStart: number;
  mentionsNow: number;
  newEngines: string[];
}

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const mean = (xs: number[]) => (xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : null);
const days = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000);

export function geoImpact(data: any): GeoImpact {
  const trends: GeoTrendLike[] = Array.isArray(data?.trends) ? data.trends : [];
  const byProvider: Record<string, GeoPointLike[]> = data?.byProvider ?? {};
  const changeDates = [...trends.map((t) => t.methodChangedAt), data?.headline?.methodChangedAt]
    .filter((d): d is string => typeof d === 'string')
    .sort();
  const methodChanged = trends.some((t) => t.methodChanged === true) || data?.headline?.methodChanged === true;
  const methodChangedAt = changeDates[0] ?? null;

  const nowScores = trends.map((t) => t.last).filter(isNum);
  const base: GeoImpact = {
    state: 'none',
    methodChanged,
    methodChangedAt,
    spanDays: 0,
    firstAvg: null,
    lastAvg: mean(nowScores),
    growthPct: null,
    enginesStart: 0,
    enginesNow: trends.filter((t) => isNum(t.last) && t.last > 0).length,
    totalEngines: trends.length,
    mentionsStart: 0,
    mentionsNow: 0,
    newEngines: [],
  };
  if (trends.length === 0) return base;

  // Kiyaslanabilir: kesitte baslangic ve son iki AYRI olcum ve ikisi de olculmus.
  // Eski API cevabinda tarih alanlari yok — o zaman yalniz sayilara bakilir.
  const comparable = trends.filter((t) => isNum(t.first) && isNum(t.last)
    && !(t.firstDate && t.lastDate && t.firstDate === t.lastDate));
  if (comparable.length === 0) {
    return { ...base, state: methodChanged ? 'method-changed' : 'baseline' };
  }

  let firstDate: string | null = null;
  let lastDate: string | null = null;
  let mentionsStart = 0;
  let mentionsNow = 0;
  for (const t of comparable) {
    const series = byProvider[t.provider] ?? [];
    const startPt = (t.firstDate ? series.find((p) => p.date === t.firstDate) : series[0]) ?? null;
    const endPt = (t.lastDate ? series.find((p) => p.date === t.lastDate) : series[series.length - 1]) ?? null;
    const fd = t.firstDate ?? startPt?.date ?? null;
    const ld = t.lastDate ?? endPt?.date ?? null;
    if (fd && (!firstDate || fd < firstDate)) firstDate = fd;
    if (ld && (!lastDate || ld > lastDate)) lastDate = ld;
    mentionsStart += (startPt?.cited ?? 0) + (startPt?.mentioned ?? 0);
    mentionsNow += (endPt?.cited ?? 0) + (endPt?.mentioned ?? 0);
  }

  const spanDays = firstDate && lastDate ? days(firstDate, lastDate) : 0;
  // Iki olcum arasi 2 gunden kisaysa (ayni gun / ertesi gun tekrar) kiyas anlamli degil
  if (spanDays < 2) return { ...base, state: methodChanged ? 'method-changed' : 'baseline' };

  const firstAvg = mean(comparable.map((t) => t.first as number));
  const lastAvg = mean(comparable.map((t) => t.last as number));
  const growthPct = firstAvg !== null && lastAvg !== null
    ? (firstAvg > 0 ? Math.round(((lastAvg - firstAvg) / firstAvg) * 100) : (lastAvg > 0 ? null : 0))
    : null;

  return {
    ...base,
    state: 'compare',
    spanDays,
    firstAvg,
    lastAvg,
    growthPct,
    enginesStart: comparable.filter((t) => (t.first as number) > 0).length,
    enginesNow: comparable.filter((t) => (t.last as number) > 0).length,
    totalEngines: comparable.length,
    mentionsStart,
    mentionsNow,
    newEngines: comparable.filter((t) => (t.last as number) > 0 && (t.first as number) <= 0).map((t) => t.provider),
  };
}

/** "18 Ekim 2026" — yontem degisim tarihi icin */
export function formatTrDate(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(`${iso.slice(0, 10)}T00:00:00Z`);
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
}
