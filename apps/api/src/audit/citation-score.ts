/**
 * Gorunurluk skoru — TEK formul.
 *
 * NEDEN AYRI DOSYA: ayni hesap iki yerden kosuyor: canli olcum
 * (AiCitationService.scoreFromProbes) ve gecmis snapshot'larin yeniden
 * hesaplanmasi (scripts/backfill-snapshot-unbranded.ts). Formul iki yerde
 * kopyalansaydi biri degistiginde gecmis ile bugun sessizce ayrisirdi —
 * tarihsel grafik "duzeltme mi oldu, gercek dusus mu" sorusuna cevap
 * veremezdi.
 *
 * KURAL: yalnizca MARKASIZ probe'lar sayilir (unbrandedOnly). Citation tam
 * puan, yalniz-anilma yarim puan. Markasiz probe kalmadiysa null — "skor 0"
 * ile "olculecek soru yok" ayni sey degildir.
 */
import { unbrandedOnly } from './brand-in-query.js';

export interface ScorableProbe {
  cited: boolean;
  brandMentioned: boolean;
  brandInQuery?: boolean;
}

export interface CitationCounts {
  /** null = markasiz sorgu yok, skor hesaplanamaz ("0" DEGIL) */
  score: number | null;
  cited: number;
  mentioned: number;
  /** markasiz havuz buyuklugu — payda */
  poolSize: number;
}

/**
 * Skor + sayaclar tek geciste. Tracker (gunluk snapshot) ve gecmis-backfill
 * script'i BU fonksiyonu kullanir; sayac tanimi ("mentioned = anildi ama
 * alintilanmadi") baska yerde tekrarlanmaz.
 */
export function citationCounts(probes: ScorableProbe[]): CitationCounts {
  const pool = unbrandedOnly(probes);
  const cited = pool.filter((p) => p.cited).length;
  const mentioned = pool.filter((p) => p.brandMentioned && !p.cited).length;
  return {
    score: pool.length === 0 ? null : Math.round(((cited * 100) + (mentioned * 50)) / pool.length),
    cited,
    mentioned,
    poolSize: pool.length,
  };
}

export function citationScore(probes: ScorableProbe[]): number | null {
  return citationCounts(probes).score;
}
