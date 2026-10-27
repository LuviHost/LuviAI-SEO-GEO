/**
 * Google Places API (New) istemcisi — herkese acik isletme verisi (profil sahibinin izni gerekmez).
 *
 * MALIYET (Ekim 2026, https://developers.google.com/maps/billing-and-pricing/pricing): field mask'teki EN YUKSEK
 * katman faturalanir. Bu yuzden maskeler bilincli dar tutuldu:
 *  - Arama: id + displayName + formattedAddress → Text Search Pro ($32/1000, ayda 5.000 ucretsiz)
 *  - Detay: rating/userRatingCount/saatler/web/telefon → Place Details Enterprise ($20/1000, ayda 1.000 ucretsiz).
 *    reviews/editorialSummary (Enterprise+Atmosphere, $25) ISTENMEZ — denetim onlara ihtiyac duymuyor.
 * VERI KURALI: donen icerik (puan, saat...) saklanmaz; yalniz place_id saklanabilir (Maps Platform kosullari).
 */
import { googleJson } from './google-istek.js';
import type { PlaceDetay } from './gbp-denetim.js';

const TABAN = 'https://places.googleapis.com/v1';

/** Istek basina tahmini maliyet (USD) — gunluk harcama tavani bu degerlerle tutulur */
export const PLACES_MALIYET = { arama: 0.032, detay: 0.02 } as const;

const ARAMA_MASKE = 'places.id,places.displayName,places.formattedAddress';
const DETAY_MASKE = [
  'id', 'displayName', 'primaryType', 'primaryTypeDisplayName', 'types', 'businessStatus', 'googleMapsUri',
  'formattedAddress', 'addressComponents', 'rating', 'userRatingCount', 'regularOpeningHours', 'websiteUri',
  'nationalPhoneNumber', 'internationalPhoneNumber', 'photos',
].join(',');

export interface PlaceAday { placeId: string; ad: string; adres: string }

export function placesAnahtari(): string | null {
  return process.env.GOOGLE_PLACES_API_KEY?.trim() || null;
}

/** place_id bicimi (Places "ChIJ..." ya da yeni uzun kimlikler) — URL yoluna girdigi icin siki */
export function placeIdGecerli(id: unknown): id is string {
  return typeof id === 'string' && /^[A-Za-z0-9_-]{10,300}$/.test(id);
}

export async function placeAra(sorgu: string, anahtar: string): Promise<PlaceAday[]> {
  const r = await googleJson<{ places?: Array<{ id: string; displayName?: { text?: string }; formattedAddress?: string }> }>({
    method: 'POST',
    url: `${TABAN}/places:searchText`,
    headers: { 'X-Goog-Api-Key': anahtar, 'X-Goog-FieldMask': ARAMA_MASKE },
    body: { textQuery: sorgu.slice(0, 200), languageCode: 'tr', regionCode: 'TR', pageSize: 5 },
  });
  return (r.places ?? []).filter((p) => placeIdGecerli(p.id)).map((p) => ({ placeId: p.id, ad: p.displayName?.text ?? '', adres: p.formattedAddress ?? '' }));
}

export async function placeDetay(placeId: string, anahtar: string): Promise<PlaceDetay> {
  if (!placeIdGecerli(placeId)) throw new Error('Geçersiz işletme kimliği');
  return googleJson<PlaceDetay>({
    method: 'GET',
    url: `${TABAN}/places/${encodeURIComponent(placeId)}?languageCode=tr&regionCode=TR`,
    headers: { 'X-Goog-Api-Key': anahtar, 'X-Goog-FieldMask': DETAY_MASKE },
  });
}
