/**
 * AI görünürlük hesabı — web landing'deki summarize() ile AYNI tanım
 * (apps/web/src/components/landing/checker-overlay.tsx):
 *
 *  - Kilitli (locked) sorular OLCULMEDI: skora, soru sayisina ve motor
 *    paydalarina girmez. Eskiden mobil 10 sorunun 7'sini "0/7" diye sayiyordu.
 *  - Sorunun kendisinde marka adi gecen (brandInQuery) sorularda asistanin markayi
 *    anmasi neredeyse totolojik: manset skora katilmaz. Olculen sorularin hepsi
 *    markaliysa (yedek) olculen sorularin tamami kullanilir — web ile ayni.
 *  - "Gosterdi" = cited || brandMentioned; sunucudaki citedCount ile ayni tanim
 *    (public-citation.service.ts). Eskiden mobil yalniz cited sayiyordu.
 *  - Olculmeyen saglayici (anahtar yok / saglayici hatasi) sunucuda ya hic
 *    gonderilmez ya da measured:false (eski taslak: available:false) ile
 *    isaretlenir. Iki bicimde de pay ve paydadan cikar; boylece "6 AI asistani"
 *    metni ile kutucuklar ve paydalar ayni seyi soyler (ornek: Meta/Llama yalniz
 *    GROQ_LLAMA_MODEL tanimliyken olculur).
 *
 * Sunucu tutarli oldugunda (citedCount = gosteren saglayici sayisi, totalProviders =
 * saglayici sayisi) sonuc web summarize() ile birebir aynidir; visibility.spec.ts
 * bunu web formuluyle karsilastirarak dogrular.
 *
 * Saf modul — React Native importu yok, vitest ile test edilir.
 */
import { PROVIDER_META, type AnalyzeResult, type ProbeResult, type ProviderKey, type QueryResult } from './api';
import { colors } from './theme';

export interface EngineStat {
  provider: ProviderKey;
  name: string;
  color: string;
  /** cevapta sitenin baglantisi gecti (alinti) */
  cited: number;
  /** baglanti yok, yalniz marka adi gecti */
  mentioned: number;
  /** cited + mentioned — markanin gorundugu cevap sayisi */
  shown: number;
  /** olculen cevap sayisi (skora giren sorular x bu motor) */
  total: number;
  /** gorunurluk orani % (shown / total) */
  rate: number;
}

export interface VisibilityDerived {
  /** manset skor 0-100: skora giren sorularda markayi gosteren cevaplarin orani */
  score: number;
  /** markanin gorundugu (soru x motor) cifti */
  shownPairs: number;
  /** bunlardan sitenin baglantisiyla alintilananlar */
  citedPairs: number;
  /** skora giren olculmus (soru x motor) cifti */
  totalPairs: number;
  /** motora gore, gosterme sayisina gore azalan */
  engines: EngineStat[];
  /** skora giren sorulardan en az bir motorun markayi gosterdigi soru sayisi */
  answeredQueries: number;
  /** skora giren soru sayisi */
  totalQueries: number;
  /** kilitsiz ve en az bir motorda olculmus soru sayisi */
  measuredQueries: number;
  /** ucretsiz testte olculmeyen (kilitli) soru sayisi */
  lockedQueries: number;
  /** olculmus ama marka adini iceren soru sayisi */
  brandedQueries: number;
  /** skor markasiz sorulardan mi, yoksa (hepsi markaliysa) tum olculen sorulardan mi */
  basis: 'unbranded' | 'all';
}

/** Saglayici bu soruda olculdu mu — alan yoksa olculmus sayilir (eski cevaplar) */
export function isMeasuredProvider(p: ProbeResult): boolean {
  return p.measured !== false && p.available !== false;
}

/** Cevapta marka gorundu mu: baglanti ya da marka adi (sunucu citedCount tanimi) */
export function isShown(p: ProbeResult): boolean {
  return !!(p.cited || p.brandMentioned);
}

/** Bir sorunun olculmus saglayicilari; kilitli soruda hic yok */
export function measuredProviders(q: QueryResult): ProbeResult[] {
  if (q.locked) return [];
  return (q.providers ?? []).filter(isMeasuredProvider);
}

/** Soru karti sayaci: kac olculmus motor markayi gosterdi / kac motor olculdu */
export function queryCounts(q: QueryResult): { shown: number; total: number } {
  const list = measuredProviders(q);
  return { shown: list.filter(isShown).length, total: list.length };
}

/** Skora giren sorular ve dayanak (web summarize(): open → scored → yedek open) */
export function scoringQueries(result: AnalyzeResult): {
  measured: QueryResult[];
  base: QueryResult[];
  basis: 'unbranded' | 'all';
} {
  const measured = (result.queries ?? []).filter((q) => !q.locked && measuredProviders(q).length > 0);
  const unbranded = measured.filter((q) => !q.brandInQuery);
  return unbranded.length > 0
    ? { measured, base: unbranded, basis: 'unbranded' }
    : { measured, base: measured, basis: 'all' };
}

/** Bir citation-check sonucundan motor bazlı gerçek görünürlük metriklerini çıkarır. */
export function deriveVisibility(result: AnalyzeResult): VisibilityDerived {
  const queries = result.queries ?? [];
  const { measured, base, basis } = scoringQueries(result);
  const acc = new Map<ProviderKey, { label: string; cited: number; mentioned: number; total: number }>();

  let shownPairs = 0;
  let citedPairs = 0;
  let totalPairs = 0;
  let answeredQueries = 0;

  for (const q of base) {
    let anyShown = false;
    for (const p of measuredProviders(q)) {
      const cur = acc.get(p.provider) ?? { label: p.label, cited: 0, mentioned: 0, total: 0 };
      cur.total += 1;
      totalPairs += 1;
      if (p.cited) {
        cur.cited += 1;
        citedPairs += 1;
      } else if (p.brandMentioned) {
        cur.mentioned += 1;
      }
      if (isShown(p)) {
        shownPairs += 1;
        anyShown = true;
      }
      acc.set(p.provider, cur);
    }
    if (anyShown) answeredQueries += 1;
  }

  const engines: EngineStat[] = Array.from(acc.entries())
    .map(([provider, s]) => {
      const meta = PROVIDER_META[provider];
      const shown = s.cited + s.mentioned;
      return {
        provider,
        name: meta?.name ?? s.label ?? provider,
        // Bilinmeyen saglayici: tema vurgu rengi
        color: meta?.color ?? colors.emberLite,
        cited: s.cited,
        mentioned: s.mentioned,
        shown,
        total: s.total,
        rate: s.total > 0 ? Math.round((shown / s.total) * 100) : 0,
      };
    })
    // Esitlikte sunucunun saglayici sirasi korunur (sort kararlidir)
    .sort((a, b) => b.shown - a.shown || b.cited - a.cited);

  return {
    score: totalPairs > 0 ? Math.round((shownPairs / totalPairs) * 100) : 0,
    shownPairs,
    citedPairs,
    totalPairs,
    engines,
    answeredQueries,
    totalQueries: base.length,
    measuredQueries: measured.length,
    lockedQueries: queries.filter((q) => q.locked).length,
    brandedQueries: measured.filter((q) => q.brandInQuery).length,
    basis,
  };
}

