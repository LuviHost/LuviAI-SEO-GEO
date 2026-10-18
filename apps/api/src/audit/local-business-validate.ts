import { schemaTypesOf, isLocalBusinessType, FOOD_ESTABLISHMENT_TYPES } from './schema-org-types.js';

/**
 * LocalBusiness alan dogrulamasi (saf) — SEO bulgusu uretir, AXO puanina girmez.
 *
 * Kurallar Google'in Local Business yapilandirilmis veri belgesinden:
 *   https://developers.google.com/search/docs/appearance/structured-data/local-business
 *  - Zorunlu: address (PostalAddress), name.
 *  - Onerilen: telephone ("Be sure to include the country code and area code"),
 *    geo (enlem/boylam "The precision must be at least 5 decimal places"),
 *    openingHoursSpecification, priceRange ("must be shorter than 100
 *    characters"), url.
 *  - image LocalBusiness tablolarinda yok; yalniz restoran karuselinde zorunlu.
 *    Diger turlerde "istege bagli" diye raporlanir — zorunluymus gibi sunulmaz.
 * Alan tanimlari: https://schema.org/LocalBusiness
 */

export interface SchemaFinding {
  level: 'error' | 'warning' | 'recommendation';
  message: string;
}

const isObj = (v: unknown): v is Record<string, any> => !!v && typeof v === 'object' && !Array.isArray(v);
const first = (v: unknown) => (Array.isArray(v) ? v[0] : v);
const str = (v: unknown) => (typeof v === 'string' ? v.trim() : typeof v === 'number' ? String(v) : '');

/**
 * Ondalik basamak sayisi. JSON.parse 41.00820'yi 41.0082 yapar (sondaki sifir
 * kaybolur); ham JSON-LD metni verildiyse yazildigi haliyle sayilir.
 */
function decimals(value: unknown, field: 'latitude' | 'longitude', rawBlock?: string): number | null {
  if (typeof value === 'string') {
    const m = /^-?\d+(?:\.(\d+))?$/.exec(value.trim());
    return m ? (m[1]?.length ?? 0) : null;
  }
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  const raw = rawBlock ? new RegExp(`"${field}"\\s*:\\s*(-?\\d+(?:\\.(\\d+))?)`).exec(rawBlock) : null;
  if (raw && Number(raw[1]) === value) return raw[2]?.length ?? 0;
  const s = String(value);
  return s.includes('.') ? s.split('.')[1].length : 0;
}

/** Dugum LocalBusiness ailesindense bulgulari dondurur; degilse bos dizi */
export function validateLocalBusiness(node: unknown, rawBlock?: string): SchemaFinding[] {
  const types = schemaTypesOf(node);
  const lbType = types.find((t) => isLocalBusinessType(t) && t !== 'LocalBusiness') ?? types.find(isLocalBusinessType);
  if (!lbType || !isObj(node)) return [];
  const out: SchemaFinding[] = [];
  const add = (level: SchemaFinding['level'], message: string) => out.push({ level, message: `${lbType}: ${message}` });

  if (!str(node.name)) add('error', 'name eksik — Google için zorunlu alan.');

  const address = first(node.address);
  if (address === undefined || address === null || address === '') {
    add('error', 'address eksik — Google için zorunlu alan (PostalAddress).');
  } else if (typeof address === 'string') {
    add('warning', 'address düz metin; Google PostalAddress nesnesi bekler (streetAddress, addressLocality, postalCode, addressCountry).');
  } else if (isObj(address)) {
    const at = schemaTypesOf(address);
    if (at.length > 0 && !at.includes('PostalAddress')) add('warning', `address türü ${at[0]}; PostalAddress olmalı.`);
    const missing = ['streetAddress', 'addressLocality', 'addressRegion', 'postalCode', 'addressCountry'].filter((f) => !str(address[f]) && !isObj(address[f]));
    if (missing.length > 0) add('recommendation', `address içinde eksik alanlar: ${missing.join(', ')} — Google olabildiğince çok adres alanı eklenmesini önerir.`);
  }

  const phone = str(first(node.telephone));
  if (!phone) add('recommendation', 'telephone yok — müşterilerin aradığı ana numarayı ülke ve alan koduyla ekleyin (ör. +90 212 …).');
  else if (!/^(\+|00)/.test(phone)) add('warning', `telephone ülke koduyla yazılmamış ("${phone.slice(0, 30)}") — Google ülke ve alan kodunu istiyor, ör. +90 212 …`);

  const ohs = node.openingHoursSpecification;
  if (!ohs && !node.openingHours) {
    add('recommendation', 'openingHoursSpecification (çalışma saatleri) yok — Google önerilen alanlar arasında sayıyor.');
  } else if (ohs) {
    const specs = (Array.isArray(ohs) ? ohs : [ohs]).filter(isObj);
    const badTime = specs.some((s) => [s.opens, s.closes].some((t) => t !== undefined && !/^\d{2}:\d{2}(:\d{2})?$/.test(str(t))));
    if (badTime) add('warning', 'openingHoursSpecification: opens/closes saatleri hh:mm ya da hh:mm:ss biçiminde olmalı.');
    if (specs.some((s) => !s.dayOfWeek && !s.validFrom)) add('warning', 'openingHoursSpecification: dayOfWeek eksik olan kayıt var.');
  }

  const geo = first(node.geo);
  if (!isObj(geo)) {
    add('recommendation', 'geo (enlem/boylam) yok — Google önerilen alanlar arasında sayıyor.');
  } else {
    const lat = Number(geo.latitude);
    const lon = Number(geo.longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
      add('warning', 'geo: latitude/longitude geçerli sayı değil.');
    } else {
      const d = Math.min(decimals(geo.latitude, 'latitude', rawBlock) ?? 0, decimals(geo.longitude, 'longitude', rawBlock) ?? 0);
      if (d < 5) add('warning', `geo: enlem/boylam en az 5 ondalık basamak olmalı (Google); şu an ${d}.`);
    }
  }

  const price = str(node.priceRange);
  if (price.length >= 100) add('warning', `priceRange ${price.length} karakter — 100 karakterden kısa olmalı, aksi halde Google fiyat aralığını göstermez.`);

  const url = str(first(node.url));
  if (!url) add('recommendation', 'url yok — işletmenin çalışan sayfa adresini ekleyin.');
  else if (!/^https?:\/\//i.test(url)) add('warning', `url mutlak bir http(s) adresi değil ("${url.slice(0, 60)}").`);

  if (!node.image) {
    if (types.some((t) => FOOD_ESTABLISHMENT_TYPES.has(t))) add('recommendation', 'image yok — Google restoran karuseli için görsel zorunlu.');
    else add('recommendation', 'image yok (isteğe bağlı) — Google bunu yalnız restoran karuselinde zorunlu tutuyor.');
  }

  return out;
}
