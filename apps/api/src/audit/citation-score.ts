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
 * KURAL: yalnizca MARKASIZ (unbrandedOnly) ve OLCULEBILEN (HATA olmayan)
 * probe'lar sayilir. Citation tam puan, yalniz-anilma yarim puan. Sayilacak
 * probe kalmadiysa null — "skor 0" ile "olculecek soru yok / olculemedi" ayni
 * sey degildir.
 *
 * HATA SATIRLARI: saglayici hatasi ya da bos cevap probe'a 'HATA:' onekli
 * excerpt ile yazilir (ai-citation.service.ts probe* metotlari). Bunlar olcum
 * DEGILDIR. Eskiden markasiz havuzda "anilmadi" sayiliyordu: 5 sorunun 5'inde
 * 429 alan saglayici 0 puan, 1 basarili + 4 hatali probe 100 yerine 20
 * gorunuyordu. Bu kural CITATION_MATCH_VERSION 4 ile ayni surumde yayinlaniyor
 * (v4 henuz canlida degil, uretim v3) — bu yuzden ayrica surum artirilmadi:
 * v3 → v4 kiyasi zaten "yontem degisti" isaretli, kayitli skorlar da
 * scripts/backfill-snapshot-unbranded.ts ve backfill-citation-runs.ts ile AYNI
 * fonksiyondan yeniden hesaplanir.
 */
import { unbrandedOnly } from './brand-in-query.js';

export interface ScorableProbe {
  cited: boolean;
  brandMentioned: boolean;
  brandInQuery?: boolean;
  /** 'HATA:' onekliyse satir olcum degildir (isErrorProbe) */
  excerpt?: string | null;
}

/**
 * Saglayici hatasi / bos cevap satiri mi — 'HATA:' oneki. Kural tek yerde:
 * skor, sayaclar, kosum kaydi, isi haritasi ve backfill script'leri buradan
 * sorar; biri unutursa o metrik hatayi yine "gorunmedi" diye sayar.
 */
export function isErrorProbe(p: { excerpt?: unknown } | null | undefined): boolean {
  return typeof p?.excerpt === 'string' && p.excerpt.startsWith('HATA:');
}

/** Olculebilen (HATA olmayan) satirlar */
export function measuredOnly<T extends { excerpt?: unknown }>(rows: T[]): T[] {
  return rows.filter((r) => !isErrorProbe(r));
}

/**
 * Probe var ama HICBIRI olculemedi (hepsi HATA). Bos dizi icin false: soru
 * hic sorulmadiysa (sorgu yok, anahtar yok) durum baska yerde anlatilir.
 */
export function allProbesFailed(rows: Array<{ excerpt?: unknown }>): boolean {
  return rows.length > 0 && rows.every((r) => isErrorProbe(r));
}

export interface CitationCounts {
  /** null = sayilacak (markasiz + olculebilen) sorgu yok, skor hesaplanamaz ("0" DEGIL) */
  score: number | null;
  cited: number;
  mentioned: number;
  /**
   * Atif VAR ama marka adi cevapta ANILMADI: site cevabin malzemesi olmus,
   * onerisi olmamis ("kaynak oldun, oneri degilsin"). Yalniz marka anilmasini
   * olcen raporlarda gorunmez; ayri sayilir. (Yon: Featured atif raporu +
   * Surfer 5M atif analizi — 2 bagimsiz kaynak; sayilar tasinmaz.)
   */
  citedNotMentioned: number;
  /** markasiz ve olculebilen havuz buyuklugu — payda */
  poolSize: number;
}

/**
 * Skor + sayaclar tek geciste. Tracker (gunluk snapshot) ve gecmis-backfill
 * script'i BU fonksiyonu kullanir; sayac tanimi ("mentioned = anildi ama
 * alintilanmadi") baska yerde tekrarlanmaz.
 */
export function citationCounts(probes: ScorableProbe[]): CitationCounts {
  const pool = unbrandedOnly(measuredOnly(probes));
  const cited = pool.filter((p) => p.cited).length;
  const mentioned = pool.filter((p) => p.brandMentioned && !p.cited).length;
  const citedNotMentioned = pool.filter((p) => p.cited && !p.brandMentioned).length;
  return {
    score: pool.length === 0 ? null : Math.round(((cited * 100) + (mentioned * 50)) / pool.length),
    cited,
    mentioned,
    citedNotMentioned,
    poolSize: pool.length,
  };
}

export function citationScore(probes: ScorableProbe[]): number | null {
  return citationCounts(probes).score;
}

/**
 * Bir saglayicinin kayitli sonucu — canli olcum (runProvider) ve kosum/snapshot
 * backfill'i AYNI kurali uygulasin diye burada. Hic olculebilen probe yoksa
 * (hepsi HATA) saglayici "olculemedi"dir: available false, skor null, neden
 * ilk HATA satirinin kodu. Aksi halde available korunur, skor formulden gelir.
 */
export function providerOutcome(
  probes: ScorableProbe[],
  current: { available: boolean; reason?: string | null },
): { available: boolean; score: number | null; reason: string | null } {
  if (allProbesFailed(probes)) {
    return {
      available: false,
      score: null,
      reason: probes.find((p) => isErrorProbe(p))?.excerpt ?? current.reason ?? null,
    };
  }
  return {
    available: current.available,
    score: current.available ? citationScore(probes) : null,
    reason: current.reason ?? null,
  };
}
