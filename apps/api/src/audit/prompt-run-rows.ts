import { citationMatchVersion } from './host-match.js';
import { sourceColumns } from './citation-sources.js';
import { isErrorProbe } from './citation-score.js';
import type { CitationProbe } from './ai-citation.service.js';

/**
 * GeoPromptRun satirlari — TEK YER (18.11.2026). Prompt Lab'in kendi olcumu (prompt-lab.service
 * persistRuns) ve GEO Lab sorularini soran site olcumu ("Yeniden Test", ai-citation.service
 * runForSite) ayni satiri yazar: GEO Lab'deki son sonuc, soru gecmisi ve icerik firsatlari iki
 * olcumu de gorur. Hata probe'u (ve Google'in cevap gostermedigi 'YOK:') satir olmaz.
 */
export function promptRunRows(
  siteId: string,
  promptId: string,
  fanoutId: string | null,
  date: Date,
  rows: Array<{ provider: string; probe: CitationProbe }>,
  tier?: 'standard' | 'premium',
) {
  return rows
    .filter((r) => !isErrorProbe(r.probe))
    .map(({ provider, probe }) => ({
      siteId,
      promptId,
      fanoutId,
      provider,
      date,
      cited: !!probe.cited,
      brandMentioned: !!probe.brandMentioned,
      // Hangi adla anildi (marka ailesi) — musteri raporunun ad kirilimi buradan sayar
      brandMatch: probe.brandMentioned && probe.brandMatch ? probe.brandMatch.slice(0, 80) : null,
      // Sorunun KENDISINDE marka geciyorsa bu satir manset gorunurluk metriklerine girmez.
      // Deger buildProbe'un damgasindan gelir — kural tek kod yolunda yasar.
      brandInQuery: probe.brandInQuery ?? false,
      position: probe.position ?? null,
      sentiment: probe.sentiment ?? null,
      excerpt: probe.excerpt?.slice(0, 2000) ?? null,
      citedPages: probe.citedPages?.length ? probe.citedPages : undefined,
      competitors: probe.competitors?.length ? (probe.competitors as any) : undefined,
      // Alintilanan dis kaynaklar (GEO Faz 2) — bkz. citation-sources.ts
      ...sourceColumns(probe),
      // Google AI Bakisi: ayni aramanin organik sirasi + bilgi paneli (google-ai-surfaces.ts)
      googleOrganic: probe.googleOrganic ? (probe.googleOrganic as any) : undefined,
      // Kademe de surumde (hizli model = +100): kademesi farkli iki satir kiyaslanmaz
      matchVersion: citationMatchVersion(tier),
    }));
}

/** Soru ozeti (GeoPrompt.lastCitedCount / lastTotalCount) — gecerli probe'lardan */
export function promptRunSummary(rows: Array<{ probe: CitationProbe }>): { cited: number; total: number } {
  const valid = rows.filter((r) => !isErrorProbe(r.probe));
  return { cited: valid.filter((r) => r.probe.cited).length, total: valid.length };
}

/**
 * Ana sorunun Google organik sirasi (GeoPromptGoogleOrganic). AI Bakisi
 * gostermeyen ('YOK:') satirlar da dahil — promptRunRows onlari atar, sira
 * en cok orada degerli. Yalniz ana soru (fan-out dali degil) ve yalniz
 * google_ai_overview satirinin ayni yanitindan okunan veri.
 */
export function organicRows(
  siteId: string,
  promptId: string,
  fanoutId: string | null,
  date: Date,
  rows: Array<{ provider: string; probe: CitationProbe }>,
) {
  if (fanoutId !== null) return [];
  return rows
    .filter((r) => r.provider === 'google_ai_overview' && r.probe.googleOrganic)
    .slice(0, 1)
    .map(({ probe }) => ({
      siteId,
      promptId,
      date,
      rank: probe.googleOrganic!.rank,
      knowledgePanel: probe.googleOrganic!.knowledgePanel,
      aiOverview: !probe.surfaceAbsent,
    }));
}
