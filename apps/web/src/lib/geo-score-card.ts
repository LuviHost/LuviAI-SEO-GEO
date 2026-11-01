/**
 * GEO skor karti yaniti (GET /sites/:id/audit/score-card,
 * apps/api/src/audit/geo-score-card.service.ts GeoScoreCard) ve gosterim kurallari.
 *
 * Olculemeyen sutun (score null + unmeasuredReason) 0 DEGILDIR: RanksUp'tan
 * yayinlanmis makale yoksa Yapisal Veri / Tazelik / Multi-Modal, son 9 gunde AI
 * olcumu yoksa AI Citation olculemez; genel skora girmez. Hicbir sutun
 * olculemezse genel skor ve harf notu null.
 */

export type GeoPillarStatus = 'great' | 'good' | 'warning' | 'critical' | 'unmeasured';

export interface GeoScoreCheck {
  id: string;
  name: string;
  ok: boolean;
  detail: string;
  unverified?: boolean;
}

export interface GeoScorePillar {
  id: string;
  name: string;
  weight: number;
  score: number | null;
  status: GeoPillarStatus;
  unmeasuredReason?: string;
  checks: GeoScoreCheck[];
}

export interface GeoScoreCardData {
  overallScore: number | null;
  grade: 'A+' | 'A' | 'B' | 'C' | 'D' | 'F' | null;
  pillars: GeoScorePillar[];
  recommendations: string[];
  measuredWeight?: number;
  totalWeight?: number;
  generatedAt: string;
}

export const UNMEASURED_LABEL = 'ölçülmedi';

/** Sutun olculdu mu (eski yanitlarda score her zaman sayi) */
export function isPillarMeasured(p: Pick<GeoScorePillar, 'score'>): p is GeoScorePillar & { score: number } {
  return typeof p.score === 'number' && Number.isFinite(p.score);
}

/** Sutun cipi / kart basligindaki deger: puan ya da "ölçülmedi" */
export function pillarScoreText(p: Pick<GeoScorePillar, 'score'>): string {
  return isPillarMeasured(p) ? String(p.score) : UNMEASURED_LABEL;
}

/** Olculemeyen sutunun gosterilecek nedeni */
export function pillarUnmeasuredReason(p: Pick<GeoScorePillar, 'unmeasuredReason'>): string {
  return p.unmeasuredReason?.trim() || 'Bu sütun ölçülemedi; genel skora katılmadı.';
}

/**
 * Ozet satiri: kac sutun olculdu. Hepsi olculduyse null (eski metin yeter).
 * Ornek: "6 sütundan 3'ü ölçüldü · ağırlıklı ortalama yalnız ölçülenlerden"
 */
export function measuredSummary(card: Pick<GeoScoreCardData, 'pillars'>): string | null {
  const total = card.pillars.length;
  const measured = card.pillars.filter(isPillarMeasured).length;
  if (measured === total) return null;
  if (measured === 0) return `${total} sütunun hiçbiri ölçülemedi`;
  return `${total} sütundan ${measured}'${olculduEki(measured)} ölçüldü · ağırlıklı ortalama yalnız ölçülenlerden`;
}

/** Turkce iyelik eki: 1'i, 2'si, 3'ü, 4'ü, 5'i, 6'sı */
function olculduEki(n: number): string {
  const ek: Record<number, string> = { 0: 'ı', 1: 'i', 2: 'si', 3: 'ü', 4: 'ü', 5: 'i', 6: 'sı', 7: 'si', 8: 'i', 9: 'u' };
  return ek[n % 10] ?? 'i';
}
