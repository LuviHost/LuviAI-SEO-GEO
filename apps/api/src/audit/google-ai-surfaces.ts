/**
 * Google AI Modu ve Google AI Bakisi — DataForSEO SERP uclarindan cevap okuma. Saf yardimcilar
 * (istek govdesi, cevap ayristirma); agi servis cagirir (ai-citation.service probeGoogleSurface).
 *
 * NEDEN (16.11.2026, sahip: "Google AI Modu ve AI Bakışı'nı ekleyelim; Türk müşteri Google'da
 * arıyor"): iki yuzeyin resmi API'si yok. DataForSEO Google arama sonucunu Turkiye konumundan
 * gercek tarayiciyla alip AI ogesini (`type: "ai_overview"`) metin + kaynak olarak veriyor.
 * 16.11.2026 denemesi (20 Turkce soru, Turkiye): AI Modu 20/20 cevap, AI Bakisi 15/20.
 *
 * UCLAR (docs.dataforseo.com, canli = sonuc ayni istekte):
 *  - AI Modu:   POST /v3/serp/google/ai_mode/live/advanced            (0.004 USD)
 *  - AI Bakisi: POST /v3/serp/google/organic/live/advanced
 *               + load_async_ai_overview: true                        (0.002 + 0.002 USD)
 * Kimlik: Basic, "login:parola"nin base64 hali (DATAFORSEO_AUTH).
 *
 * "AI BAKISI YOK" ≠ "ANILMADI": Google bu aramada AI Bakisi gostermediyse olculecek bir cevap
 * yoktur. Satir `YOK:` onekli ve `surfaceAbsent` damgali yazilir; skor, sayaclar ve rakip
 * hesaplari onu olcum saymaz (citation-score.ts isNonMeasurementProbe). Panel "Bu soruda Google
 * AI Bakışı yok" yazar.
 */

import type { Provider } from './ai-citation.service.js';
import type { RawSource } from './citation-sources.js';
import { urlHostMatches } from './host-match.js';

export type GoogleSurface = Extract<Provider, 'google_ai_mode' | 'google_ai_overview'>;

export const DATAFORSEO_BASE = 'https://api.dataforseo.com/v3';

export const GOOGLE_SURFACE_PATH: Readonly<Record<GoogleSurface, string>> = {
  google_ai_mode: '/serp/google/ai_mode/live/advanced',
  google_ai_overview: '/serp/google/organic/live/advanced',
};

/** Konum ve dil — Turkiye / Turkce (DataForSEO location_code 2792) */
export const GOOGLE_LOCATION = { location_code: 2792, language_code: 'tr' } as const;

/** Satirin onekleri: `HATA:` olcum yapilamadi; `YOK:` bu yuzey bu soruda cevap gostermedi */
export const SURFACE_ABSENT_PREFIX = 'YOK:';

export const SURFACE_ABSENT_TEXT: Readonly<Record<GoogleSurface, string>> = {
  google_ai_mode: 'YOK: Google bu aramada AI Modu cevabı vermedi.',
  google_ai_overview: 'YOK: Google bu aramada AI Bakışı göstermedi.',
};

/** Istek govdesi (DataForSEO dizi bekler; tek gorev) */
/**
 * AI Bakisi istegi `resolve_goto_urls: true` tasir (27.11.2026). NEDEN: Google AI Bakisi kaynaklarini
 * google.com/goto yonlendirmesiyle veriyor; son 14 gunde 148 kaynagin 67'si (%45) bu bicimde ve alan
 * adi "google.com" kaydedilmisti — musterinin sitesi aralarindaysa "kaynak gosterilmedi" sayiliyordu.
 * Parametre DataForSEO'nun (dataforseo.com/update/get-final-destination-urls-with-serp-api) ve canli
 * denemede ayni aramada goto 7 → 0, ucret ayni (0,002 USD). AI Modu ucu parametreyi REDDEDIYOR
 * (40501 Invalid Field, ayni gun denendi) ve orada goto adresi gorulmedi: yalniz AI Bakisi.
 * Ayni cevaptaki organik siralama (parseOrganicSignal) da gercek adreslerle eslesir.
 */
export function surfaceRequestBody(surface: GoogleSurface, query: string): Array<Record<string, unknown>> {
  const g = { keyword: query.slice(0, 700), ...GOOGLE_LOCATION };
  return [surface === 'google_ai_overview' ? { ...g, load_async_ai_overview: true, resolve_goto_urls: true } : g];
}

/** Yanit ayristirma sonucu */
export type SurfaceParse =
  | { kind: 'answer'; text: string; sources: RawSource[] }
  | { kind: 'absent' }
  /** Gecici hata (yeniden denenir) ya da kalici hata (kimlik, bakiye) — `fatal` kalici */
  | { kind: 'error'; code: number | null; message: string; fatal: boolean };

/**
 * Kalici hata kodlari (yeniden denemenin anlami yok): 401xx kimlik / dogrulanmamis hesap,
 * 402xx bakiye yetersiz, 403xx yetki. 40101 (arama motoru ic hatasi) ve 50xxx gecicidir.
 */
export function isFatalDataForSeoCode(code: number | null | undefined): boolean {
  if (typeof code !== 'number') return false;
  if (code === 40101 || code === 40102) return false;
  // JSON olmayan HTTP yaniti (servis HTTP durumunu koda koyar): 401 kimlik, 402 bakiye, 403 yetki
  if (code === 401 || code === 402 || code === 403) return true;
  return (code >= 40100 && code < 40500) || code === 40200 || code === 40201 || code === 40210;
}

/** Bir AI ogesinin metni: `markdown` (AI Modu ve AI Bakisi), yoksa alt ogelerin metinleri */
function aiText(item: any): string {
  if (typeof item?.markdown === 'string' && item.markdown.trim()) return item.markdown;
  if (typeof item?.text === 'string' && item.text.trim()) return item.text;
  const parts: string[] = [];
  for (const sub of Array.isArray(item?.items) ? item.items : []) {
    if (typeof sub?.markdown === 'string') parts.push(sub.markdown);
    else if (typeof sub?.text === 'string') parts.push(sub.text);
    else if (typeof sub?.title === 'string') parts.push(sub.title);
  }
  return parts.join('\n');
}

/** Kaynaklar: `references[]` (url, title); yinelenen adres bir kez */
function aiSources(item: any): RawSource[] {
  const seen = new Set<string>();
  const out: RawSource[] = [];
  for (const r of Array.isArray(item?.references) ? item.references : []) {
    const url = typeof r?.url === 'string' ? r.url : null;
    if (!url || seen.has(url)) continue;
    seen.add(url);
    out.push({ url, title: typeof r?.title === 'string' ? r.title : null });
  }
  return out;
}

/** DataForSEO yanitini ayristirir */
export function parseSurfaceResponse(data: unknown): SurfaceParse {
  const d = data as any;
  const top = typeof d?.status_code === 'number' ? d.status_code : null;
  if (top !== 20000) {
    return { kind: 'error', code: top, message: String(d?.status_message ?? 'bilinmeyen yanıt').slice(0, 200), fatal: isFatalDataForSeoCode(top) };
  }
  const task = Array.isArray(d?.tasks) ? d.tasks[0] : null;
  // Gorevsiz 20000 (16.11.2026 denemesinde goruldu): sonuc yok, gecici say
  if (!task) return { kind: 'error', code: null, message: 'görev sonucu dönmedi', fatal: false };
  const code = typeof task.status_code === 'number' ? task.status_code : null;
  if (code !== 20000) {
    return { kind: 'error', code, message: String(task.status_message ?? 'bilinmeyen hata').slice(0, 200), fatal: isFatalDataForSeoCode(code) };
  }
  const items: any[] = Array.isArray(task?.result?.[0]?.items) ? task.result[0].items : [];
  const ai = items.find((i) => i?.type === 'ai_overview');
  const text = ai ? aiText(ai).trim() : '';
  if (!text) return { kind: 'absent' };
  return { kind: 'answer', text, sources: aiSources(ai) };
}

/**
 * Ayni Google sonuc sayfasinin ORGANIK kismi (24.11.2026, geo.new karsilastirmasi):
 * AI Bakisi istegi (organic/live/advanced) zaten tum sonuc sayfasini donduruyor;
 * yalniz `ai_overview` okunup gerisi atiliyordu. Ek istek ve ek ucret yok.
 *  - rank: sitenin bu aramadaki en iyi organik sirasi (`rank_group`); donen
 *    sonuclarda yoksa null ("ilk sayfada degil"). DataForSEO varsayilan derinligi
 *    ilk sayfa sonuclaridir.
 *  - knowledgePanel: sayfada bilgi paneli (`knowledge_graph`) varsa basligi.
 * Bilgi Paneli Google'in Knowledge Graph'indan otomatik olusur, istenerek
 * actirilamaz (support.google.com/knowledgepanel/answer/9163198): sonuc olarak
 * gosterilir, skora girmez.
 */
export interface GoogleOrganicSignal {
  rank: number | null;
  knowledgePanel: string | null;
}

export function parseOrganicSignal(data: unknown, host: string): GoogleOrganicSignal | null {
  const d = data as any;
  if (d?.status_code !== 20000) return null;
  const task = Array.isArray(d?.tasks) ? d.tasks[0] : null;
  if (!task || task.status_code !== 20000) return null;
  const items: any[] = Array.isArray(task?.result?.[0]?.items) ? task.result[0].items : [];
  if (items.length === 0) return null;
  let rank: number | null = null;
  for (const i of items) {
    if (i?.type !== 'organic' || typeof i?.url !== 'string') continue;
    const r = typeof i.rank_group === 'number' ? i.rank_group : null;
    if (r !== null && urlHostMatches(i.url, host) && (rank === null || r < rank)) rank = r;
  }
  const kg = items.find((i) => i?.type === 'knowledge_graph');
  const title = typeof kg?.title === 'string' && kg.title.trim() ? kg.title.trim().slice(0, 120) : null;
  return { rank, knowledgePanel: kg ? (title ?? '') : null };
}
