/**
 * Google Places API (New) istemcisi — herkese acik isletme verisi (profil sahibinin izni gerekmez).
 *
 * MALIYET (Ekim 2026, https://developers.google.com/maps/billing-and-pricing/pricing): field mask'teki EN YUKSEK
 * katman faturalanir. Bu yuzden maskeler bilincli dar tutuldu:
 *  - Arama: kimlik/ad/adres/kategori/foto + puan/yorum sayisi/web → Text Search Enterprise ($35/1000, ayda 1.000
 *    ucretsiz). NEDEN Enterprise: ayni adli subeler (kampusler) yalniz yaziyla ayirt edilemiyordu; puan + web sitesi
 *    eslesmesi dogru profili secmenin en guclu ipucu. Pro'ya gore fark istek basina $0.003.
 *  - Foto: Place Details Photos ($7/1000, ayda 1.000 ucretsiz) — aday basina 1 kucuk kare, tavan kapisindan gecer.
 *  - Detay: rating/userRatingCount/saatler/web/telefon → Place Details Enterprise ($20/1000, ayda 1.000 ucretsiz).
 *    reviews/editorialSummary (Enterprise+Atmosphere, $25) ISTENMEZ — denetim onlara ihtiyac duymuyor.
 * VERI KURALI: donen icerik (puan, saat...) saklanmaz; yalniz place_id saklanabilir (Maps Platform kosullari).
 */
import { googleJson } from './google-istek.js';
import type { PlaceDetay } from './gbp-denetim.js';

const TABAN = 'https://places.googleapis.com/v1';

/** Istek basina tahmini maliyet (USD) — gunluk harcama tavani bu degerlerle tutulur */
export const PLACES_MALIYET = { arama: 0.035, detay: 0.02, foto: 0.007 } as const;

const ARAMA_MASKE = [
  'places.id', 'places.displayName', 'places.formattedAddress', 'places.primaryTypeDisplayName', 'places.businessStatus',
  'places.googleMapsUri', 'places.photos', 'places.rating', 'places.userRatingCount', 'places.websiteUri',
].join(',');
const DETAY_MASKE = [
  'id', 'displayName', 'primaryType', 'primaryTypeDisplayName', 'types', 'businessStatus', 'googleMapsUri',
  'formattedAddress', 'addressComponents', 'rating', 'userRatingCount', 'regularOpeningHours', 'websiteUri',
  'nationalPhoneNumber', 'internationalPhoneNumber', 'photos',
].join(',');

export interface PlaceFoto {
  url: string;
  /** Google kosulu: authorAttributions doluysa fotografin yaninda gosterilir */
  yazar: { ad: string; uri: string | null } | null;
}

export interface PlaceAday {
  placeId: string;
  ad: string;
  adres: string;
  kategori: string | null;
  puan: number | null;
  yorumSayisi: number;
  /** Web sitesinin alan adi (www'suz) */
  web: string | null;
  mapsUri: string | null;
  kapali: boolean;
  foto: PlaceFoto | null;
  /** Panelde: profilin web sitesi bu sitenin alan adiyla ayni */
  siteEslesme?: boolean;
}

/** Arama sonucundaki ilk fotografin kaynak adi — foto ayri cagriyla (ve ayri butceyle) alinir */
export type PlaceAdayHam = PlaceAday & { fotoAdi: string | null; fotoYazar: PlaceFoto['yazar'] };

interface HamPlace {
  id: string;
  displayName?: { text?: string };
  formattedAddress?: string;
  primaryTypeDisplayName?: { text?: string };
  businessStatus?: string;
  googleMapsUri?: string;
  rating?: number;
  userRatingCount?: number;
  websiteUri?: string;
  photos?: Array<{ name?: string; authorAttributions?: Array<{ displayName?: string; uri?: string }> }>;
}

const FOTO_ADI = /^places\/[A-Za-z0-9_-]{10,300}\/photos\/[A-Za-z0-9_-]{10,1000}$/;

export function alanAdi(uri: string | null | undefined): string | null {
  if (!uri) return null;
  try { return new URL(uri).hostname.toLowerCase().replace(/^www\./, '') || null; } catch { return null; }
}

/** Yalniz https Google adresleri (javascript:/baska alan adi istemciye gitmesin) */
function googleUri(uri: string | undefined, hostDesen: RegExp): string | null {
  if (!uri) return null;
  try {
    const u = new URL(uri);
    return u.protocol === 'https:' && hostDesen.test(u.hostname) ? u.toString() : null;
  } catch { return null; }
}

export function adayYap(p: HamPlace): PlaceAdayHam {
  const f = p.photos?.[0];
  const y = f?.authorAttributions?.find((a) => a.displayName);
  return {
    placeId: p.id,
    ad: p.displayName?.text ?? '',
    adres: p.formattedAddress ?? '',
    kategori: p.primaryTypeDisplayName?.text ?? null,
    puan: typeof p.rating === 'number' ? p.rating : null,
    yorumSayisi: p.userRatingCount ?? 0,
    web: alanAdi(p.websiteUri),
    mapsUri: googleUri(p.googleMapsUri, /(^|\.)google\.[a-z.]+$/),
    kapali: p.businessStatus === 'CLOSED_PERMANENTLY',
    foto: null,
    fotoAdi: f?.name && FOTO_ADI.test(f.name) ? f.name : null,
    fotoYazar: y ? { ad: String(y.displayName).slice(0, 80), uri: googleUri(y.uri, /(^|\.)google\.[a-z.]+$/) } : null,
  };
}

export function placesAnahtari(): string | null {
  return process.env.GOOGLE_PLACES_API_KEY?.trim() || null;
}

/** place_id bicimi (Places "ChIJ..." ya da yeni uzun kimlikler) — URL yoluna girdigi icin siki */
export function placeIdGecerli(id: unknown): id is string {
  return typeof id === 'string' && /^[A-Za-z0-9_-]{10,300}$/.test(id);
}

export async function placeAra(sorgu: string, anahtar: string): Promise<PlaceAdayHam[]> {
  const r = await googleJson<{ places?: HamPlace[] }>({
    method: 'POST',
    url: `${TABAN}/places:searchText`,
    headers: { 'X-Goog-Api-Key': anahtar, 'X-Goog-FieldMask': ARAMA_MASKE },
    body: { textQuery: sorgu.slice(0, 200), languageCode: 'tr', regionCode: 'TR', pageSize: 5 },
  });
  return (r.places ?? []).filter((p) => placeIdGecerli(p.id)).map(adayYap);
}

/**
 * Fotografin gosterilebilir adresi (skipHttpRedirect → JSON photoUri). Anahtar istemciye GITMEZ: photoUri
 * googleusercontent adresidir, anahtar icermez. Foto adi saklanamaz (suresi dolar) — her aramada tazesi kullanilir.
 */
export async function placeFotoUrl(fotoAdi: string, anahtar: string): Promise<string | null> {
  if (!FOTO_ADI.test(fotoAdi)) return null;
  const r = await googleJson<{ photoUri?: string }>({
    method: 'GET',
    url: `${TABAN}/${fotoAdi}/media?maxWidthPx=240&maxHeightPx=240&skipHttpRedirect=true`,
    headers: { 'X-Goog-Api-Key': anahtar },
    timeoutMs: 8_000,
  });
  return googleUri(r.photoUri, /(^|\.)googleusercontent\.com$/);
}

export async function placeDetay(placeId: string, anahtar: string): Promise<PlaceDetay> {
  if (!placeIdGecerli(placeId)) throw new Error('Geçersiz işletme kimliği');
  return googleJson<PlaceDetay>({
    method: 'GET',
    url: `${TABAN}/places/${encodeURIComponent(placeId)}?languageCode=tr&regionCode=TR`,
    headers: { 'X-Goog-Api-Key': anahtar, 'X-Goog-FieldMask': DETAY_MASKE },
  });
}
