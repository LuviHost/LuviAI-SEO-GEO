/**
 * GA4 donusum kontrolu — telefon tiklamasi ve form/randevu gonderimi
 * "onemli etkinlik" (key event) olarak olculuyor mu? (saf)
 *
 * NEDEN: yerel isletmenin SEO/GEO calismasinin karsiligi cogu zaman bir
 * telefon aramasi ya da randevu/iletisim formudur. GA4 bunlari kendiliginden
 * onemli etkinlik saymaz; olculmuyorsa raporlardaki "donusum" sayisi eksik
 * kalir. Bu modul yalniz OLCUMU denetler; siralamaya etkisi iddia edilmez.
 *
 * GA4 gercekleri (Google belgeleri, 2026-10 okundu):
 *  - Gelistirilmis olcum telefon tiklamasi icin ayri olay TOPLAMAZ. "Giden
 *    tiklama" (click) yalniz "mevcut alanin disina / baska bir web sitesine
 *    giden" baglantilar icin tanimli; tel: baglantilarindan soz edilmiyor.
 *    Form etkilesimleri acikken form_start ve form_submit otomatik toplanir.
 *    https://support.google.com/analytics/answer/9216061
 *  - generate_lead Google'in onerdigi olaydir: "submits a form or a request
 *    for information" / "measures when a lead has been generated (for
 *    example, through a form)". Randevu icin ayri onerilen olay yok.
 *    https://support.google.com/analytics/answer/9267735
 *    https://developers.google.com/analytics/devguides/collection/ga4/reference/events#generate_lead
 *  - Onemli etkinlik: Yonetici > Veri goruntuleme > Etkinlikler, olayin
 *    yanindaki yildiz; standart mulkte en fazla 30.
 *    https://support.google.com/analytics/answer/13128484
 *  - Data API: eventName boyutu, eventCount ve keyEvents metrikleri; "Marking
 *    an event as a key event affects reports from time of creation. It doesn't
 *    change historic data."
 *    https://developers.google.com/analytics/devguides/reporting/data/v1/api-schema
 *  - Admin API properties.keyEvents.list analytics.readonly kapsamiyla calisir.
 *    https://developers.google.com/analytics/devguides/config/admin/v1/rest/v1beta/properties.keyEvents/list
 */
import { foldForMatch } from '../common/text-normalize.js';

export type ConversionKind = 'phone' | 'form';

/**
 * tamam         — eslesen onemli etkinlik var ve donemde tetiklendi
 * tetiklenmedi  — onemli etkinlik olarak tanimli ama donemde hic gelmedi
 * anahtar_degil — benzer olay geliyor ama onemli etkinlik olarak isaretli degil
 * yok           — benzer olay hic yok
 */
export type ConversionStatus = 'tamam' | 'tetiklenmedi' | 'anahtar_degil' | 'yok';

export interface GaEventRow {
  eventName: string;
  eventCount: number;
  keyEvents: number;
}

export interface ConversionCheck {
  kind: ConversionKind;
  status: ConversionStatus;
  /** Eslesen onemli etkinlikler ve donemdeki olay sayisi */
  keyEvents: Array<{ name: string; count: number }>;
  /** Eslesen ama onemli etkinlik olmayan olaylar */
  candidates: Array<{ name: string; count: number }>;
}

/** "click_to_call" → [click, to, call]; "phoneClick" → [phone, click]; Turkce harfler katlanir */
export function eventTokens(name: string): string[] {
  const spaced = String(name || '').replace(/([a-z0-9])([A-Z])/g, '$1 $2');
  return foldForMatch(spaced)
    .replace(/ç/g, 'c').replace(/ğ/g, 'g').replace(/ş/g, 's').replace(/ö/g, 'o').replace(/ü/g, 'u')
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

const PHONE_TOKENS = new Set(['tel', 'phone', 'phones', 'telephone', 'telefon', 'call', 'calls', 'calling', 'callback', 'arama', 'ara', 'aramasi', 'cagri', 'gsm']);
/** Bitisik yazilmis kaliplar: "clicktocall", "telefontiklama", "hemenara" */
const PHONE_COMPACT = ['phone', 'telefon', 'clicktocall', 'callnow', 'calllink', 'callbutton', 'callclick', 'telclick', 'tellink', 'hemenara'];
/** "arama"/"ara" Turkcede site aramasi da demek — bu kelimelerle birlikte telefon sayilmaz */
const SEARCH_TOKENS = new Set(['search', 'site', 'result', 'results', 'sonuc', 'sonuclari', 'sonuclar', 'query', 'kelime', 'filtre', 'filter', 'urun']);

const FORM_TOKENS = new Set([
  'lead', 'form', 'submit', 'submitted', 'gonder', 'gonderim', 'gonderildi', 'contact', 'iletisim',
  'randevu', 'booking', 'book', 'booked', 'appointment', 'reservation', 'rezervasyon', 'teklif',
  'quote', 'basvuru', 'talep', 'enquiry', 'inquiry',
]);
/** Gonderim degil, goruntuleme/baslatma: "form_start", "contact_page_view" */
const NOT_SUBMISSION = new Set(['start', 'started', 'view', 'page', 'open', 'opened', 'visible', 'scroll', 'impression', 'focus', 'baslat', 'baslangic']);
/** Telefon/form disi iletisim kanallari — ayri konu, burada sayilmaz */
const OTHER_CHANNELS = new Set(['whatsapp', 'wa', 'telegram', 'mail', 'email', 'mailto', 'eposta', 'instagram']);

/** Olay adi telefon tiklamasina mi, form/randevu gonderimine mi benziyor */
export function classifyEventName(name: string): ConversionKind | null {
  const tokens = eventTokens(name);
  if (!tokens.length) return null;
  const compact = tokens.join('');
  if (compact === 'generatelead') return 'form';
  if (tokens.some((t) => OTHER_CHANNELS.has(t))) return null;

  const hasSearch = tokens.some((t) => SEARCH_TOKENS.has(t));
  const phoneByToken = tokens.some((t) => PHONE_TOKENS.has(t) && !((t === 'arama' || t === 'ara' || t === 'aramasi') && hasSearch));
  const phoneByCompact = PHONE_COMPACT.some((c) => compact.includes(c));
  if (phoneByToken || phoneByCompact) return 'phone';

  if (hasSearch) return null;
  if (tokens.some((t) => NOT_SUBMISSION.has(t))) return null;
  if (tokens.some((t) => FORM_TOKENS.has(t))) return 'form';
  return null;
}

/**
 * Rapor satirlari (son N gun, eventName bazinda) + Admin API'deki tanimli
 * onemli etkinlikler → iki kontrol. `configuredKeyEvents` null ise Admin API
 * okunamadi: tanimli ama hic tetiklenmemis olaylar gorunmez.
 */
export function buildConversionChecks(input: { rows: GaEventRow[]; configuredKeyEvents: string[] | null }): ConversionCheck[] {
  const byName = new Map<string, GaEventRow>();
  for (const r of input.rows) {
    if (!r?.eventName) continue;
    const cur = byName.get(r.eventName);
    byName.set(r.eventName, cur
      ? { eventName: r.eventName, eventCount: cur.eventCount + (r.eventCount || 0), keyEvents: cur.keyEvents + (r.keyEvents || 0) }
      : { eventName: r.eventName, eventCount: r.eventCount || 0, keyEvents: r.keyEvents || 0 });
  }
  const configured = new Set(input.configuredKeyEvents ?? []);
  const kinds: ConversionKind[] = ['phone', 'form'];

  return kinds.map((kind) => {
    const keyNames = new Set<string>();
    for (const name of configured) if (classifyEventName(name) === kind) keyNames.add(name);
    // Raporda keyEvents > 0 → donemin bir kisminda onemli etkinlikti (isaretleme sonradan yapilmis olabilir)
    for (const r of byName.values()) if (r.keyEvents > 0 && classifyEventName(r.eventName) === kind) keyNames.add(r.eventName);

    const keyEvents = [...keyNames]
      .map((name) => ({ name, count: byName.get(name)?.eventCount ?? 0 }))
      .sort((a, b) => b.count - a.count);
    const candidates = [...byName.values()]
      .filter((r) => !keyNames.has(r.eventName) && r.eventCount > 0 && classifyEventName(r.eventName) === kind)
      .map((r) => ({ name: r.eventName, count: r.eventCount }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);

    const status: ConversionStatus = keyEvents.some((k) => k.count > 0)
      ? 'tamam'
      : keyEvents.length
        ? 'tetiklenmedi'
        : candidates.length
          ? 'anahtar_degil'
          : 'yok';
    return { kind, status, keyEvents: keyEvents.slice(0, 5), candidates };
  });
}
