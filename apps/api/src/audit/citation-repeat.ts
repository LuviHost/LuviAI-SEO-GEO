/**
 * Site AI olcumunde tekrar sayisi (N) — saf.
 *
 * NEDEN: 08.11.2026 kanit denetimi "AI olcumu tek tura dayaniyor" — AI
 * cevaplari kosumdan kosuma cok oynak (kaynaklar visibility-interval.ts
 * basinda). Site olcumu (runForSite: "Yeniden Test", onboarding/sistem
 * olcumu, denetim icindeki AI testi, yol haritasi, sayfa bazli test) her
 * soruyu her asistana N kez, BIRBIRINDEN BAGIMSIZ istekle sorar; skor tum
 * tekrarlardan, gorunme sikligi %95 Wilson araligiyla verilir.
 *
 * KAPSAM DISI (bilerek): landing'deki ucretsiz test (public-citation),
 * kurum karnesi CLI'si, kurumsal mail olcumu (runPublicProbes) ve Prompt Lab /
 * urun radari (runQueries) tek tur kalir — bu modul yalniz runForSite'tan okunur.
 *
 * N: CITATION_TEKRAR ortam degiskeni, varsayilan 3, [1, 5] araligina kirpilir.
 *
 * ── MALIYET INCELEMESI (08.11.2026) ────────────────────────────────────────
 * Probe basina TAVAN (citation-providers.ts COST_PER_PROBE_USD), yapilandirilmis
 * 6 asistan: Claude 0.2 + Gemini 0.04 + ChatGPT 0.03 + Perplexity 0.0006 +
 * Grok 0.10 + DeepSeek 0.05 = 0.4206 USD / soru. 5 soruluk bir site olcumu:
 * N=1 → 2.10 USD, N=3 → 6.31 USD tavan (ek ~4.21 USD). Gercek fatura tavanin
 * altinda (tavan matematiksel ust sinir; ayrintisi citation-providers.ts).
 *
 *  - Haftalik olcum hakki (billing/measurement-allowance.ts): ISTEK basina 1
 *    — tekrar sayisindan bagimsiz. ENGELLEMEZ.
 *  - Aylik calistirma tavani (QuotaService citationTests; deneme 3): basarili
 *    runForSite +1 — tekrar sayisindan bagimsiz. ENGELLEMEZ.
 *  - Aylik AI harcama tavani (QuotaService SPEND_CAP_USD; deneme $3): yalniz
 *    LlmProviderService cagrilari aiCostThisMonthUsd'ye yazar; gorunurluk
 *    olcumu kendi istemcileriyle cagirir, bu tavana ne yazar ne bakar.
 *    Teknik olarak ENGELLEMEZ — ama tek bir N=3 olcumun tavan maliyeti (6.31)
 *    deneme planinin aylik AI butcesinin (3 USD) iki katindan fazla.
 *  - Gunluk havuz butcesinin KIRACI PAYI (ai-citation.service isOverBudget:
 *    gunluk tavan x 0.25): en dar asistan Claude — 30 x 0.25 = 7.5 USD/gun.
 *    N=3 olcum Claude icin 5 x 3 x 0.2 = 3.0 USD planlar. Yeni sitede ayni gun
 *    ONBOARDING denetimi (sistem, AI testi dahil) + otopilot baseline
 *    snapshot'i (sistem) = 6.0 USD; kullanicinin ILK "Yeniden Test"i 3.0 daha
 *    ister → 9.0 > 7.5 → Claude o testten DUSERDI. ENGELLER.
 *
 * KARAR:
 *  - Deneme planinda N=1 (tekrarSayisiFor). Gerekce: yukaridaki kiraci payi
 *    deneme hesabinin ilk gununde ilk testi bozuyor ve tek N=3 olcumu planin
 *    aylik AI butcesini asiyor; deneme kullanicisi tek turluk olcumu "ön
 *    sonuç" etiketi ve genis "±X" araligiyla gorur (belirsizlik saklanmaz).
 *  - Ucretli planlarda ayni gun cakismasi (yeni site + otopilot + ayni gun test)
 *    icin runProvider tekrar sayisini kiraci payina SIGAN kadar dusurur
 *    (en az 1) — N, N=1'in olcebildigi bir asistani hic dusurmez; az tekrarli
 *    asistanin araligi kendiliginden genis cikar.
 *  - Global gunluk tavan kapasitesi: Claude 30 USD / 3.0 = gunde ~10 tam N=3
 *    site olcumu (N=1'de ~30). Platform kapasitesi (plan degil); gerekirse
 *    AI_BUDGET_ANTHROPIC_USD ile buyutulur.
 */

export const CITATION_TEKRAR_VARSAYILAN = 3;
export const CITATION_TEKRAR_MIN = 1;
export const CITATION_TEKRAR_MAX = 5;

/** CITATION_TEKRAR → [1, 5]; tanimsiz ya da sayi degilse varsayilan (3) */
export function citationTekrar(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.CITATION_TEKRAR?.trim();
  if (!raw) return CITATION_TEKRAR_VARSAYILAN;
  const n = Number(raw);
  if (!Number.isFinite(n)) return CITATION_TEKRAR_VARSAYILAN;
  return Math.min(CITATION_TEKRAR_MAX, Math.max(CITATION_TEKRAR_MIN, Math.floor(n)));
}

/**
 * Site sahibinin planina gore tekrar sayisi. Deneme (TRIAL) her zaman 1 —
 * gerekce dosya basindaki MALIYET INCELEMESI. Plan adi buyuk/kucuk harf
 * duyarsiz (Prisma enum 'TRIAL', plans.ts 'trial').
 */
export function tekrarSayisiFor(plan: string | null | undefined, env: NodeJS.ProcessEnv = process.env): number {
  if (String(plan ?? '').toUpperCase() === 'TRIAL') return 1;
  return citationTekrar(env);
}
