/**
 * Search Console donem etiketleri — "Son 30 gün" yazan her toplam, verinin
 * gercekte kapsadigi araligi da soylemeli.
 *
 * NEDEN: yeni baglanan sitede yalniz 15 gunluk veri vardi ama kartlar
 * "Tıklama (30 gün)" diyordu; toplam gercek 30 gunun yarisiydi.
 * API: GET /sites/:id/analytics/overview → coverage (gsc-aggregate.ts snapshotCoverage).
 */

export interface GscCoverage {
  requestedDays: number;
  coveredDays: number;
  from: string | null;
  to: string | null;
  windowFrom: string;
  windowTo: string;
  complete: boolean;
}

const AYLAR = ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'];
/** Ay adina gelen -den/-dan eki (kesme isaretiyle): "Ekim'den", "Mart'tan" */
const AYRILMA = ["'tan", "'tan", "'tan", "'dan", "'tan", "'dan", "'dan", "'tan", "'den", "'den", "'dan", "'tan"];

function parts(iso: string): [number, number, number] | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso ?? '');
  if (!m) return null;
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

/** "2026-10-16" → "16 Ekim" */
export function formatGscDay(iso: string): string {
  const p = parts(iso);
  return p ? `${p[2]} ${AYLAR[p[1] - 1]}` : iso;
}

/** "2026-10-16" → "16 Ekim'den" */
export function sinceGscDay(iso: string): string {
  const p = parts(iso);
  return p ? `${p[2]} ${AYLAR[p[1] - 1]}${AYRILMA[p[1] - 1]}` : iso;
}

/** "2026-10-02".."2026-10-31" → "2–31 Ekim"; ay farkliysa "16 Eylül – 15 Ekim" */
export function formatGscRange(from: string, to: string): string {
  const a = parts(from);
  const b = parts(to);
  if (!a || !b) return `${from} – ${to}`;
  if (a[0] === b[0] && a[1] === b[1]) return `${a[2]}–${b[2]} ${AYLAR[b[1] - 1]}`;
  if (a[0] === b[0]) return `${a[2]} ${AYLAR[a[1] - 1]} – ${b[2]} ${AYLAR[b[1] - 1]}`;
  return `${a[2]} ${AYLAR[a[1] - 1]} ${a[0]} – ${b[2]} ${AYLAR[b[1] - 1]} ${b[0]}`;
}

/**
 * Kart etiketi: tam kapsamda "Son 30 gün", eksikse
 * "Son 30 gün (veri 16 Ekim'den beri, 15 gün)". Kapsam bilgisi yoksa (eski
 * API) yalniz "Son N gün".
 */
export function coverageLabel(coverage: GscCoverage | null | undefined, days: number): string {
  const base = `Son ${days} gün`;
  if (!coverage || coverage.complete || !coverage.from) return base;
  return `${base} (veri ${sinceGscDay(coverage.from)} beri, ${coverage.coveredDays} gün)`;
}

/** Kartin altindaki tarih satiri: "2–31 Ekim" ya da veri yoksa null */
export function coverageRange(coverage: GscCoverage | null | undefined): string | null {
  if (!coverage?.from || !coverage.to) return null;
  return formatGscRange(coverage.from, coverage.to);
}

/**
 * Yukselen sorgu rozeti: isaret degerden gelir (eski kod "+" i elle
 * yaziyordu); onceki donemde yoksa "yeni".
 */
export function trendBadgeText(t: { growthPct: number | null | undefined; isNew?: boolean }): string {
  if (t.isNew || t.growthPct === null || t.growthPct === undefined) return 'yeni';
  const n = Math.round(t.growthPct);
  const abs = new Intl.NumberFormat('tr-TR', { maximumFractionDigits: 0 }).format(Math.abs(n));
  return `${n > 0 ? '+' : n < 0 ? '−' : ''}%${abs}`;
}
