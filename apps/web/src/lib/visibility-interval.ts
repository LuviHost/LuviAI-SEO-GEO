/**
 * AI görünürlük ölçümünün belirsizliği — panel tarafı (saf; React yok).
 *
 * Kaynak: API citation-history yanıtındaki `olcum` bloğu
 * (apps/api/src/audit/visibility-interval.ts + ai-citation-tracker getHistory).
 * Site ölçümü her soruyu her asistana N kez sorar; skorun yanında görünme
 * sıklığının %95 Wilson aralığının yarı genişliği ("±X") ve "N tekrar × M
 * soru" gösterilir.
 *
 * KURAL (08.11.2026 kanıt denetimi): iki ölçüm arasındaki fark YALNIZ
 * aralıklar örtüşmüyorsa "arttı/azaldı" diye gösterilir; örtüşüyorsa ya da
 * aralık hesaplanamıyorsa (eski kayıt, kıyas yok) "anlamlı değişim yok".
 * Karar API'de verilir; burada yalnız okunur — kural iki yerde yazılmaz.
 */

export interface GorunmeAraligi {
  gorunen: number;
  olculen: number;
  /** 0-100 */
  oran: number;
  alt: number;
  ust: number;
  /** "±X" */
  yariGenislik: number;
}

export type AralikKarari = 'artti' | 'azaldi' | 'anlamli-degil';

export interface AralikKarsilastirmasi {
  karar: AralikKarari | null;
  once: GorunmeAraligi | null;
  sonra: GorunmeAraligi | null;
}

/** citation-history `olcum` bloğu; eski API'de yok */
export interface CitationOlcum {
  son: {
    date: string;
    runAt: string;
    tekrar: number;
    soruSayisi: number;
    gorunme: GorunmeAraligi | null;
    asistanlar: Record<string, GorunmeAraligi | null>;
  } | null;
  manset: { gorunme: GorunmeAraligi | null; olcumSayisi: number };
  haftalik: AralikKarsilastirmasi;
  etki: AralikKarsilastirmasi;
  asistanlar: Record<string, AralikKarsilastirmasi>;
  /** Güncel yöntemle tek ölçüm var */
  onSonuc: boolean;
}

export function olcumOf(data: unknown): CitationOlcum | null {
  const o = (data as { olcum?: unknown } | null | undefined)?.olcum;
  return o && typeof o === 'object' ? (o as CitationOlcum) : null;
}

/** "±8" — aralık yoksa null (gösterilmez) */
export function plusMinus(a: GorunmeAraligi | null | undefined): string | null {
  if (!a || !Number.isFinite(a.yariGenislik)) return null;
  return `±${Math.round(a.yariGenislik)}`;
}

/** Araç ipucu: "Görünme sıklığı %40 (%95 güven aralığı %25–%57; 15 cevabın 6'sı)" */
export function aralikAciklamasi(a: GorunmeAraligi | null | undefined): string | null {
  if (!a) return null;
  return `Görünme sıklığı %${Math.round(a.oran)} (%95 güven aralığı %${Math.round(a.alt)}–%${Math.round(a.ust)}; ${a.olculen} cevabın ${a.gorunen}'ında marka anıldı ya da siteye atıf verildi). ±${Math.round(a.yariGenislik)} bu aralığın yarı genişliği: AI cevapları turdan tura değiştiği için skor bu kadar oynayabilir.`;
}

/** "3 tekrar × 5 soru" */
export function tekrarSoruEtiketi(son: CitationOlcum['son'] | null | undefined): string | null {
  if (!son || !(son.soruSayisi > 0)) return null;
  return `${Math.max(1, son.tekrar)} tekrar × ${son.soruSayisi} soru`;
}

/** Fark yönü: yalnız örtüşmeyen aralıkta up/down; aksi hâlde flat ("anlamlı değişim yok") */
export function kararYonu(karar: AralikKarari | null | undefined): 'up' | 'down' | 'flat' {
  return karar === 'artti' ? 'up' : karar === 'azaldi' ? 'down' : 'flat';
}

export function kararMetni(karar: AralikKarari | null | undefined): string {
  return karar === 'artti' ? 'arttı' : karar === 'azaldi' ? 'azaldı' : 'anlamlı değişim yok';
}

/**
 * Probe'ları soruya göre gruplar (ilk görülme sırası korunur; grup içi tekrar
 * sırasıyla). Tekrarlı ölçümde aynı soru N kez gelir; panel soruyu bir kez yazıp
 * tekrarların sonucunu yan yana gösterir. `tekrar` alanı olmayan eski kayıtta
 * her grup tek elemanlıdır.
 */
export function sorularaGore<T extends { query?: unknown; tekrar?: unknown }>(probes: T[]): Array<{ query: string; probes: T[] }> {
  const gruplar = new Map<string, { query: string; probes: T[] }>();
  for (const p of probes) {
    const query = String(p?.query ?? '').trim();
    const k = query.toLowerCase();
    const g = gruplar.get(k) ?? { query, probes: [] };
    g.probes.push(p);
    gruplar.set(k, g);
  }
  const sira = (p: T) => (typeof p?.tekrar === 'number' ? p.tekrar : 1);
  return [...gruplar.values()].map((g) => ({ ...g, probes: [...g.probes].sort((a, b) => sira(a) - sira(b)) }));
}

/** Değişim ipucu: neden "anlamlı değil" dendiği */
export function kararAciklamasi(k: AralikKarsilastirmasi | null | undefined): string {
  if (!k || !k.once || !k.sonra) {
    return 'İki ölçümün güven aralığı hesaplanamadı (eski kayıt ya da kıyaslanacak ölçüm yok); fark değişim olarak okunmaz.';
  }
  const a = `%${Math.round(k.once.alt)}–%${Math.round(k.once.ust)}`;
  const b = `%${Math.round(k.sonra.alt)}–%${Math.round(k.sonra.ust)}`;
  return k.karar === 'anlamli-degil'
    ? `Görünme sıklığının güven aralıkları örtüşüyor (önce ${a}, sonra ${b}): fark AI cevaplarının doğal oynaklığı içinde.`
    : `Güven aralıkları örtüşmüyor (önce ${a}, sonra ${b}): değişim ölçüm oynaklığının dışında.`;
}
