/**
 * GOOGLE DIZIN DURUMU (Search Console URL Inspection API) — saf secim + ozet.
 *
 * NEDEN: denetim yalniz sayfanin dizine KAPALI olup olmadigini (noindex /
 * nosnippet etiketi) okuyordu; sayfanin gercekten Google dizininde olup
 * olmadigini bilmiyordu. Etiketi temiz bir sayfa da "Tarandı - şu anda dizine
 * eklenmedi" olabilir. Bu bilgiyi yalniz Google verir.
 *
 * Kaynak (25.11.2026'da okundu):
 *  - developers.google.com/search/blog/2022/01/url-inspection-api — API,
 *    Search Console'daki URL denetiminin dizin durumunu dondurur.
 *  - developers.google.com/webmaster-tools/limits — URL denetimi: mulk basina
 *    gunde 2.000, dakikada 600 istek. Denetim basina en fazla INSPECT_MAX
 *    istek atilir; ucretsizdir.
 *  - developers.google.com/webmaster-tools/v1/urlInspection.index/UrlInspectionResult:
 *    indexStatusResult.verdict "URL dizinde mi" hukmudur; PASS = Search
 *    Console'da "Geçerli", FAIL = "Hata", NEUTRAL = "Hariç tutuldu", PARTIAL
 *    artik kullanilmiyor (eski cevap gelirse dizinde sayilir), VERDICT_UNSPECIFIED
 *    = bilinmiyor (hukum yok, `failed`). coverageState Google'in kendi metnidir;
 *    languageCode'un bu metni cevirdigi belgede YAZMIYOR — rapor metnine
 *    basilmaz, yalniz panel aciklamasinda ornek olarak gecer.
 *
 * Hangi adres sorulur: Google dizini adresi TAM yazilisiyla tutar ("/yol" ile
 * "/yol/" ayri adreslerdir). Sayfa kendi adresini canonical gosteriyorsa o
 * yazilis, yoksa sayfanin acildigi tam adres sorulur. Canonical'i BASKA bir
 * adresi gosteren sayfa sorulmaz (dizin disi kalmasi beklenen durumdur);
 * noindex sayfa da sorulmaz (zaten ayri bulgu: google_pages_noindex).
 */
import { googleDirectives, type PageRobotsSignals } from './google-ai-eligibility.js';
import { urlKey } from './canonical-target.js';

/** Denetim basina en fazla soru (gunluk 2.000 sinirinin cok altinda) */
export const INSPECT_MAX = 20;

export interface IndexInspectionRow {
  url: string;
  verdict: string;
  /** Google'in metni ("Tarandı - şu anda dizine eklenmedi" gibi); yoksa null */
  coverageState: string | null;
}

export interface IndexInspection {
  /** Sorunun soruldugu Search Console mulku */
  property: string;
  /** Hukum alinan adres sayisi */
  inspected: number;
  indexedCount: number;
  notIndexed: IndexInspectionRow[];
  /** Soruldu ama cevap alinamadi (hata, kota) */
  failed: number;
}

type InspectablePage = {
  url: string;
  finalUrl?: string;
  fetchedUrl?: string;
  canonical: string | null;
  robotsSignals?: PageRobotsSignals;
};

/** Adres bu Search Console mulkunun altinda mi (alan adi mulku: alt alanlar dahil) */
export function urlUnderProperty(url: string, property: string): boolean {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  const host = u.hostname.toLowerCase();
  if (property.startsWith('sc-domain:')) {
    const d = property.slice('sc-domain:'.length).trim().toLowerCase().replace(/\.+$/, '');
    return !!d && (host === d || host.endsWith(`.${d}`));
  }
  try {
    const p = new URL(property);
    if (p.protocol !== u.protocol || p.hostname.toLowerCase() !== host || p.port !== u.port) return false;
    return u.pathname.startsWith(p.pathname);
  } catch {
    return false;
  }
}

/** Sorulacak adresler: anasayfa once, tekil, en fazla `max` */
export function inspectionTargets(pages: ReadonlyArray<InspectablePage>, property: string, max = INSPECT_MAX): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const p of pages) {
    if (out.length >= max) break;
    if (p.robotsSignals && googleDirectives(p.robotsSignals).noindex) continue;
    const real = p.finalUrl ?? p.fetchedUrl ?? p.url;
    let target = real;
    if (p.canonical) {
      let c: URL;
      try {
        c = new URL(p.canonical.trim(), real);
      } catch {
        continue;
      }
      c.hash = '';
      const ck = urlKey(c.href);
      const own = [p.url, p.finalUrl, p.fetchedUrl].some((u) => u && urlKey(u) === ck);
      if (!own) continue; // baska adresi gosteren canonical: dizin disi kalmasi beklenir
      target = c.href;
    }
    if (!urlUnderProperty(target, property)) continue;
    if (seen.has(target)) continue;
    seen.add(target);
    out.push(target);
  }
  return out;
}

/** Kayitli dizin hukmu: URL dizinde mi */
export function isIndexedVerdict(verdict: string): boolean {
  return verdict === 'PASS' || verdict === 'PARTIAL';
}

export function summarizeInspection(property: string, rows: IndexInspectionRow[], failed: number): IndexInspection {
  const notIndexed = rows.filter((r) => !isIndexedVerdict(r.verdict));
  return { property, inspected: rows.length, indexedCount: rows.length - notIndexed.length, notIndexed, failed };
}
