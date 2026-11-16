/**
 * /compare sayfasindaki RanksUp asistan sayilari ve adlari — ELLE YAZILMAZ (16.11.2026, sahip:
 * "değiştir"). Eskiden metinlerde sabit "6 asistan" vardi; Muse (`meta`) canlida olculurken
 * Profesyonel'in gercek kapsami 7 idi. Sayilar /billing/plans yanitindaki plan `engines`
 * listesinden (o an olculen saglayicilar, anahtara bagli) uretilir.
 *
 * Google AI Modu / AI Bakisi asistan SAYILMAZ (hucrede ayri yazilir). Yanit gelmezse yedek kapsam
 * her zaman olculen asistanlardir (Muse'suz 6 / 4): dogrulanamayan asistan vaat edilmez.
 *
 * Ayri dosya: hem sunucu (page.tsx) hem istemci (compare-view.tsx) cagirir.
 */

export type CompareScope = {
  /** Profesyonel planin asistan sayisi (Google yuzeyleri haric) */
  pro: number;
  /** Baslangic planinin asistan sayisi */
  bas: number;
  /** Muse su an olculuyor mu (Profesyonel kapsaminda) */
  muse: boolean;
};

export const DEFAULT_COMPARE_SCOPE: CompareScope = { pro: 6, bas: 4, muse: false };

const isGoogle = (e: string) => e === 'google_ai_mode' || e === 'google_ai_overview';

export function compareScopeFrom(plans: ReadonlyArray<{ id: string; engines?: string[] }>): CompareScope {
  const asistan = (id: string) => plans.find((p) => p.id === id)?.engines?.filter((e) => !isGoogle(e));
  const pro = asistan('pro');
  const bas = asistan('starter');
  if (!pro?.length || !bas?.length) return DEFAULT_COMPARE_SCOPE;
  return { pro: pro.length, bas: bas.length, muse: pro.includes('meta') };
}

/**
 * Metindeki yer tutuculari doldurur:
 *  {PRO} Profesyonel sayisi · {BAS} Baslangic sayisi
 *  {EK}  Profesyonel'de eklenenler ("Grok ve DeepSeek" / "Grok, DeepSeek ve Muse")
 *  {TUM} butun asistanlar ("ChatGPT, Claude, Gemini, Perplexity, Grok, DeepSeek ve Muse")
 */
export function fillCompareScope(text: string, locale: 'tr' | 'en', s: CompareScope): string {
  const ve = locale === 'en' ? 'and' : 've';
  const ek = s.muse ? `Grok, DeepSeek ${ve} Muse` : `Grok ${ve} DeepSeek`;
  const tum = `ChatGPT, Claude, Gemini, Perplexity, ${s.muse ? `Grok, DeepSeek ${ve} Muse` : `Grok ${ve} DeepSeek`}`;
  return text
    .replaceAll('{PRO}', String(s.pro))
    .replaceAll('{BAS}', String(s.bas))
    .replaceAll('{EK}', ek)
    .replaceAll('{TUM}', tum);
}
