import { containsBrand, brandMatchMode, MIN_BRAND_LEN } from '../audit/brand-in-query.js';
import { foldForMatch } from '../common/text-normalize.js';

/** brand-in-query.ts WORD_CHARS ile ayni sinif */
const NON_WORD = /[^a-z0-9à-ſğüşöç]+/;
const NON_WORD_G = /[^a-z0-9à-ſğüşöç]+/g;

/**
 * Organik sorguda marka geciyor mu — containsBrand + BOSLUKLU YAZIM.
 *
 * NEDEN: kullanicilar markayi arama kutusuna bitisik ya da ayri yazar
 * ("ornekpratik" / "ornek pratik"). containsBrand kelime sinirli birebir
 * eslesme yapar; marka "Ornekpratik" iken "ornek pratik giris" markasiz
 * sayiliyordu (ve tersi). Burada ardisik sorgu kelimeleri birlestirilip
 * markanin bitisik haline TAM esit mi diye bakilir — kelime siniri korunur
 * ("ornekpratikci" yine markasiz). Yalniz organik ayrimda: AI olcumunun
 * eslesme surumu (CITATION_MATCH_VERSION) degismesin diye ortak kurala
 * eklenmedi. Jenerik alan-adi modunda (emlak ← emlak.com) uygulanmaz.
 */
export function brandInOrganicQuery(query: string, brand: string, host?: string | null): boolean {
  if (containsBrand(query, brand, host)) return true;
  if (host && brandMatchMode(brand, host) === 'domain') return false;
  const b = foldForMatch(brand || '').replace(NON_WORD_G, '');
  if (b.length < MIN_BRAND_LEN) return false;
  const tokens = foldForMatch(query || '').split(NON_WORD).filter(Boolean);
  for (let i = 0; i < tokens.length; i++) {
    let acc = '';
    for (let j = i; j < tokens.length && acc.length < b.length; j++) {
      acc += tokens[j];
      if (acc === b) return true;
    }
  }
  return false;
}

/**
 * Organik (GSC) trafikte markali / markasiz ayrimi — tek formul.
 *
 * NEDEN: Faz 1'de AI probe'larinda sorguda marka gecen satirlar mansetten
 * cikarildi (brandInQuery). Ayni ayrim organik tarafta yoktu: GSC sorgulari
 * ham yaziliyor, "tiklama" tek toplam gosteriliyordu. Oysa markali sorgu
 * (insanlar adini yazip seni ariyor) HAFIZA olcer, markasiz sorgu KESIF —
 * ikisini ayni sayida toplamak "SEO kanalin var mi?" sorusunu gizler.
 * Google da ayni ayrimi Search Console'a filtre olarak ekledi (Kas 2025,
 * tum sitelere Mar 2026) ama API'de dimension olarak belgelenmedi; bu yuzden
 * kendi tespitimizle (brand-in-query.ts — AI tarafiyla AYNI kural) boluyoruz.
 *
 * KAYNAK: panel ve rapor once GSC'nin donem sorgu agregasini (tum sorgular,
 * gsc-live.service.ts) verir. Ona ulasilamazsa AnalyticsSnapshot.queryDetails
 * (gun basina ilk 100 sorgu, tiklama sirali) ORNEKLEM olarak kullanilir; UI
 * hangisi oldugunu soyler (`source`).
 *
 * HOST: marka alan adindan turetilmis jenerik bir kelimeyse ("emlak" ←
 * emlak.com) yalin kelime sayilmaz, yalniz alan adi gecisi markali sayilir
 * (brand-in-query.ts JENERIK MARKA KORUMASI). Host verilmezse "emlak
 * ilanlari" gibi her sektor aramasi markali kovaya duser ve markasiz pay
 * sistematik olarak dusuk cikar.
 */

export interface OrganicQueryRow {
  query: string;
  clicks: number;
  impressions: number;
}

export interface BrandBucket {
  clicks: number;
  impressions: number;
  queries: number;
}

export interface OrganicBrandSplit {
  branded: BrandBucket;
  unbranded: BrandBucket;
  /** markasiz tiklama / toplam tiklama (orneklem); tiklama yoksa null */
  unbrandedClickSharePct: number | null;
  /** orneklemdeki benzersiz sorgu sayisi */
  sampledQueries: number;
}

const EMPTY: BrandBucket = { clicks: 0, impressions: 0, queries: 0 };

/**
 * containsBrand'in `host` argumani icin site adresinden host. AI olcumunun
 * damgasiyla (AiCitationService.extractHost → buildProbe) AYNI normalizasyon:
 * www'suz, kucuk harf; adres ayristirilamazsa ham metin. Ayrisirsa ayni sorgu
 * GSC ayriminda bir turlu, AI olcumunde baska turlu siniflanir.
 */
export function brandHostFromUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  try { return new URL(url).hostname.replace(/^www\./, '').toLowerCase(); }
  catch { return url.toLowerCase(); }
}

/** Ayni sorgu birden fazla gunde/sayfada gecer — sorgu bazinda topla */
export function aggregateQueries(rows: OrganicQueryRow[]): OrganicQueryRow[] {
  const map = new Map<string, OrganicQueryRow>();
  for (const r of rows) {
    const q = (r.query ?? '').trim();
    if (!q) continue;
    const cur = map.get(q) ?? { query: q, clicks: 0, impressions: 0 };
    cur.clicks += Number(r.clicks ?? 0);
    cur.impressions += Number(r.impressions ?? 0);
    map.set(q, cur);
  }
  return [...map.values()];
}

/**
 * @param host sitenin host'u (brandHostFromUrl) — verilirse jenerik marka
 *   korumasi uygulanir; AI tarafiyla ayni karar icin her zaman verilmeli.
 */
export function splitQueriesByBrand(rows: OrganicQueryRow[], brand: string, host?: string | null): OrganicBrandSplit {
  const agg = aggregateQueries(rows);
  const branded = { ...EMPTY };
  const unbranded = { ...EMPTY };
  for (const r of agg) {
    const b = brandInOrganicQuery(r.query, brand, host) ? branded : unbranded;
    b.clicks += r.clicks;
    b.impressions += r.impressions;
    b.queries += 1;
  }
  const totalClicks = branded.clicks + unbranded.clicks;
  return {
    branded,
    unbranded,
    unbrandedClickSharePct: totalClicks > 0 ? Math.round((unbranded.clicks / totalClicks) * 1000) / 10 : null,
    sampledQueries: agg.length,
  };
}

/**
 * Gunluk seri: queryDetails'i dolu her snapshot icin markasiz tiklama payi.
 * Bos listeli gunler (backfill yalnizca son gune liste ilistirir) atlanir.
 */
export function dailyUnbrandedShare(
  snapshots: Array<{ date: Date; queryDetails: unknown }>,
  brand: string,
  host?: string | null,
): Array<{ date: string; unbrandedSharePct: number | null; sampledQueries: number }> {
  const out: Array<{ date: string; unbrandedSharePct: number | null; sampledQueries: number }> = [];
  for (const s of snapshots) {
    const rows = Array.isArray(s.queryDetails) ? (s.queryDetails as OrganicQueryRow[]) : [];
    if (rows.length === 0) continue;
    const split = splitQueriesByBrand(rows, brand, host);
    out.push({ date: s.date.toISOString().slice(0, 10), unbrandedSharePct: split.unbrandedClickSharePct, sampledQueries: split.sampledQueries });
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}
