import { Injectable, Logger, HttpException, HttpStatus } from '@nestjs/common';
import { createHash } from 'crypto';
import { PrismaService } from '../prisma/prisma.service.js';
import { AiCitationService, type CitationProbe } from './ai-citation.service.js';
import { brandHintFor, containsBrand } from './brand-in-query.js';
import { CITATION_MATCH_VERSION } from './host-match.js';
import { sanitizeProbeExcerpt } from './probe-retry.js';
import { compareCells, type TrendRow } from './comparable-trend.js';
import { NicheDetectorService } from '../sites/niche-detector.service.js';
import type { Audience } from '../llm/model-tier.js';
import { safeFetchText, SafeFetchError } from '../common/safe-fetch.js';
import { detectBlock } from '../common/block-detect.js';
import { assertPublicDomainResolves, normalizePublicDomainInput, type PublicResolver } from '../sites/site-url-policy.js';

/**
 * Public AI Citation Check — landing page demo (anonim).
 *
 * Maya-clone pattern:
 *   1. Ziyaretci domain girer (kobipratik.com)
 *   2. HTML fetch + brand + niche tespit
 *   3. Niche'e gore 3 deterministic prompt uretilir
 *   4. 6 LLM provider'a paralel sor (ENV anahtarlari)
 *   5. Per-prompt: hangi motorlar cite/mention etti (✓/✗ ikonu)
 *   6. Aggregate: share of voice (rakip ranking)
 *
 * Abuse kontrolu:
 *   - Sonuc 24h cache (PublicCitationCheck.domain unique)
 *   - IP rate-limit (PublicCitationService.checkRateLimit) → her IP 7 gunde 1 yeni test (onbellekten donus serbest)
 *   - Cloudflare Turnstile (controller'da, env-gated)
 *   - Bot UA bloklanir (controller)
 *
 * SSRF: kimlik dogrulamasiz uc — adres tamamen disaridan geliyor. Alan adi
 * siki normalize edilir (IP, port, kimlik bilgisi, tek etiketli ad, ic aga
 * cozulen ad reddedilir), sayfa safe-fetch ile okunur (her yonlendirme
 * denetlenir) ve headless Chrome bu akista ASLA calismaz.
 */

const TURKISH_NICHE_PROMPTS: Record<string, string[]> = {
  'e-ticaret': [
    'Turkiye\'de {NICHE} icin en iyi e-ticaret platformlari hangileri?',
    '{BRAND_HINT} alternatifi olarak hangi e-ticaret cozumleri var?',
    'KOBI\'ler icin {NICHE} alaninda en iyi yerli e-ticaret platformlari nelerdir?',
  ],
  'SaaS': [
    'Turkiye\'de {NICHE} ihtiyaclari icin en iyi SaaS cozumleri hangileri?',
    '{BRAND_HINT} alternatifi olarak hangi SaaS\'lar onerilir?',
    '{NICHE} otomasyonu icin en iyi yerli SaaS platformlari nelerdir?',
  ],
  'web hosting': [
    'Turkiye\'de en iyi web hosting saglayicilari hangileri?',
    'KOBI\'ler icin hangi hosting firmalari one cikiyor?',
    'WordPress + cPanel icin en uygun fiyatli yerli hosting firmalari nelerdir?',
  ],
  'finans': [
    'Turkiye\'de {NICHE} icin en guvenilir finansal platformlar hangileri?',
    'KOBI kredisi + POS hizmeti icin hangi bankalar/firmalar one cikiyor?',
    '{NICHE} alaninda dijital cozum sunan en iyi firmalar nelerdir?',
  ],
  'eğitim': [
    'Turkiye\'de online {NICHE} icin en iyi platformlar hangileri?',
    '{BRAND_HINT} alternatifi olarak hangi egitim platformlari onerilir?',
    'Sertifikali {NICHE} egitimi sunan en iyi yerli kurumlar nelerdir?',
  ],
  'sağlık': [
    'Turkiye\'de {NICHE} alaninda en guvenilir saglik platformlari hangileri?',
    'Online {NICHE} hizmeti veren en iyi firmalar nelerdir?',
    '{NICHE} icin onerilebilecek dijital saglik cozumleri nelerdir?',
  ],
  'gayrimenkul': [
    'Turkiye\'de en iyi gayrimenkul ilan siteleri hangileri?',
    '{NICHE} alaninda hangi platformlar dijital donusumde one cikiyor?',
    'Konut + ticari gayrimenkul aramada en iyi yerli platformlar nelerdir?',
  ],
  'turizm': [
    'Turkiye\'de {NICHE} icin en iyi online seyahat platformlari hangileri?',
    'Otel rezervasyonu + tur paketleri icin hangi firmalar one cikiyor?',
    '{NICHE} alaninda hangi yerli platformlar uluslararasi seviyede?',
  ],
  'restoran': [
    'Turkiye\'de {NICHE} icin en populer online siparis platformlari hangileri?',
    'Restoran yonetim sistemi (POS + rezervasyon) icin en iyi cozumler nelerdir?',
    '{NICHE} sektorunde dijital donusum saglayan platformlar hangileri?',
  ],
  'ajans': [
    'Turkiye\'de en iyi dijital pazarlama ajanslari hangileri?',
    '{NICHE} alaninda hangi ajanslar one cikiyor?',
    'KOBI\'ler icin uygun fiyatli ajans hizmetleri veren firmalar nelerdir?',
  ],
  'haber/medya': [
    'Turkiye\'de en cok okunan {NICHE} kaynaklari hangileri?',
    '{NICHE} alaninda en guvenilir haber siteleri nelerdir?',
    'Bagimsiz {NICHE} yayini yapan platformlar hangileri?',
  ],
  'teknoloji/yazılım': [
    'Turkiye\'de {NICHE} icin en iyi yazilim cozumleri hangileri?',
    '{BRAND_HINT} alternatifi olarak hangi yerli yazilim firmalari onerilir?',
    '{NICHE} alaninda one cikan Turk teknoloji firmalari nelerdir?',
  ],
  'hukuk': [
    'Turkiye\'de online hukuki danismanlik icin en iyi platformlar hangileri?',
    '{NICHE} alaninda dijital cozum sunan hukuk firmalari nelerdir?',
    'Avukat-muvekkil eslesmesi icin en guvenilir platformlar hangileri?',
  ],
  'danışmanlık': [
    'Turkiye\'de {NICHE} alaninda en iyi danismanlik firmalari hangileri?',
    'KOBI\'ler icin uygun fiyatli {NICHE} danismanlik hizmetleri veren firmalar nelerdir?',
    '{NICHE} dijital donusumu icin one cikan danismanlik markalari hangileri?',
  ],
  'otomotiv': [
    'Turkiye\'de {NICHE} alaninda en iyi online platformlar hangileri?',
    'Ikinci el arac alim-satim icin en guvenilir siteler nelerdir?',
    '{NICHE} sektorunde dijital cozum sunan firmalar hangileri?',
  ],
  'inşaat': [
    'Turkiye\'de {NICHE} alaninda one cikan firmalar hangileri?',
    'Yapi malzemesi + insaat hizmetleri icin en iyi platformlar nelerdir?',
    '{NICHE} sektorunde dijitallesen markalar hangileri?',
  ],
  'spor/fitness': [
    'Turkiye\'de online {NICHE} egitimi/uyelik icin en iyi platformlar hangileri?',
    'Spor salonu zincirleri icinde en cok tercih edilenler nelerdir?',
    'Ev tipi {NICHE} ekipmani satan en iyi firmalar hangileri?',
  ],
  'moda/giyim': [
    'Turkiye\'de {NICHE} alaninda en populer online magazalar hangileri?',
    'Kadin/erkek {NICHE} icin en cok tercih edilen yerli markalar nelerdir?',
    '{NICHE} kategorisinde dijital donusumde one cikan firmalar hangileri?',
  ],
  'üretim/sanayi': [
    'Turkiye\'de {NICHE} alaninda en iyi B2B platformlar hangileri?',
    'Uretici-tedarikci eslesme platformlari icinde en bilinenler nelerdir?',
    '{NICHE} dijital donusumu icin one cikan yerli cozumler hangileri?',
  ],
  'güzellik/bakım': [
    'Turkiye\'de {NICHE} alaninda en cok tercih edilen salonlar hangileri?',
    'Iyi bir kuafor, berber veya guzellik salonu secerken nelere dikkat etmeli?',
    '{BRAND_HINT} hakkinda yorumlar nasil, hizmetleri neler?',
  ],
  'yerel hizmetler': [
    'Turkiye\'de {NICHE} icin guvenilir firma nasil bulunur?',
    'Tesisat, elektrik veya temizlik icin eve gelen guvenilir ustalari nereden bulabilirim?',
    '{NICHE} alaninda one cikan yerel isletmeler hangileri?',
  ],
  'diğer': [
    '{BRAND_HINT} ne yapiyor? Kisaca aciklar misin?',
    'Turkiye\'de {NICHE} alaninda one cikan firmalar/platformlar hangileri?',
    '{NICHE} ihtiyaci olan KOBI\'lere hangi cozumleri onerirsin?',
  ],
};

/**
 * TEASER MODELI (2026-08)
 *
 * Landing'de tum rapor bedava akiyordu; ziyaretcinin kayit olmak icin sebebi
 * kalmiyordu. Artik niche-detector 10 soru URETIR, hepsi LISTELENIR, ama
 * yalnizca ilki(leri) OLCULUR.
 *
 * Kritik nokta: kilitli sorgular icin LLM cagrisi HIC YAPILMAZ. Bu yuzden
 *   - maliyet duser (acik sorgu sayisi x calisan saglayici kadar cagri; toplam
 *   10 sorunun kilitli 7'si icin hic cagri yapilmiyor),
 *   - sizdirilacak veri yoktur (CSS blur olsa devtools'tan okunurdu).
 */
const TEASER_TOTAL_QUERIES = 10;
const FREE_UNLOCKED_QUERIES = Math.max(
  1,
  parseInt(process.env.PUBLIC_CITATION_FREE_QUERIES ?? '3', 10) || 3,
);

/** niche-detector sorularina uygulanan uzunluk suzgeci — sabit soru setine de ayni kural. */
const QUERY_MIN_LEN = 8;
const QUERY_MAX_LEN = 160;

const DAY_MS = 24 * 60 * 60 * 1000;
/** Ucretsiz test hakkinin penceresi (sahip karari 25.10.2026: ziyaretci haftada 1 test) */
export const PUBLIC_CHECK_WINDOW_MS = 7 * DAY_MS;

/**
 * Anonim testin GUNLUK harcama tavani (USD) — havuz tavanlarindan ayri; ucretli
 * musterilerin olcum butcesini yemez. Sahip karari 25.10.2026: 10 USD.
 * Gecersiz env (NaN, 0, negatif) varsayilana duser.
 */
export function publicDailyBudgetUsd(): number {
  const n = parseFloat(process.env.PUBLIC_CITATION_DAILY_BUDGET_USD ?? '10');
  return Number.isFinite(n) && n > 0 ? n : 10;
}

export const PUBLIC_BUDGET_MESSAGE =
  'Bugünkü ücretsiz test kotası doldu. Yarın tekrar deneyebilir ya da 14 gün ücretsiz deneme hesabı açıp siteni hemen 6 asistanda ölçebilirsin.';

/** "1 Kasım" — hak yenilenme tarihi, Istanbul saatiyle */
function trDay(d: Date): string {
  return new Intl.DateTimeFormat('tr-TR', { timeZone: 'Europe/Istanbul', day: 'numeric', month: 'long' }).format(d);
}

/**
 * Kayitli sonucun saglayici alintilarini guvenli bicime cevirir.
 *
 * NEDEN: hata satirlari eskiden 'HATA: HTTP 429: {...saglayici govdesi...}'
 * olarak yaziliyordu (org/hesap kimligi, istek kimligi, istem yankisi). Yeni
 * olcumler yalniz 'HATA: <kod>' uretiyor, ama 24 saatlik onbellekte eski
 * bicimde kayit kalabilir ve bu uc anonim. Okuma aninda sanitizeProbeExcerpt
 * uygulanir; HATA olmayan alinti ve zaten guvenli satir aynen kalir.
 */
/**
 * matchVersion alani olmayan kayitlarin sayildigi olcum yontemi surumu.
 *
 * NEDEN 3: alan CITATION_MATCH_VERSION 4 ile birlikte eklendi; ondan once
 * yazilan her public kayit 3 ya da daha eski yontemle olculdu. Hangisi oldugu
 * bilinmiyor ama 4 olmadigi kesin: alansiz iki kayit eskisi gibi birbiriyle
 * karsilastirilir, alansiz kayit ile v4 kaydi karsilastirilmaz.
 */
export const LEGACY_PUBLIC_MATCH_VERSION = 3;

/** Kayitli public sonucun olcum yontemi surumu (alan yoksa LEGACY_PUBLIC_MATCH_VERSION). */
export function publicResultMatchVersion(result: unknown): number {
  const v = (result as { matchVersion?: unknown } | null | undefined)?.matchVersion;
  return typeof v === 'number' && Number.isInteger(v) && v > 0 ? v : LEGACY_PUBLIC_MATCH_VERSION;
}

function withSafeExcerpts<T>(result: T): T {
  const r = result as any;
  if (!r || !Array.isArray(r.queries)) return result;
  return {
    ...r,
    queries: r.queries.map((q: any) => (q && Array.isArray(q.providers)
      ? {
          ...q,
          providers: q.providers.map((p: any) => (p && typeof p.excerpt === 'string'
            ? { ...p, excerpt: sanitizeProbeExcerpt(p.excerpt) }
            : p)),
        }
      : q)),
  } as T;
}

/** Satir/probe saglayici hatasi mi ('HATA: ...') — olcum degil (ai-citation hasRealProbes ile ayni kural). */
function isErrorExcerpt(excerpt: unknown): boolean {
  return typeof excerpt === 'string' && excerpt.startsWith('HATA:');
}

/**
 * measured alani eklenmeden yazilmis bir satir, saglayici HIC calismadan mi
 * olustu? Eski kayitlarda anahtari olmayan / kullanilamayan saglayici (uretimde
 * Meta Llama: GROQ_LLAMA_MODEL tanimsiz) her soruya alintisiz ve sonucsuz bir
 * satir olarak yaziliyordu. Gercek cevaptan gelen probe her zaman alinti tasir
 * (buildProbe: cevabin ilk 220 karakteri), bos cevap ise 'HATA:' satiridir.
 */
function legacyNeverRan(p: any): boolean {
  return typeof p?.measured !== 'boolean' && !p?.excerpt && !p?.cited && !p?.brandMentioned;
}

function measuredRow(q: any): any {
  const providers = (q.providers as any[])
    .filter((p) => p && !legacyNeverRan(p))
    .map((p) => (typeof p.measured === 'boolean' ? p : { ...p, measured: !isErrorExcerpt(p.excerpt) }));
  const counted = providers.filter((p) => p.measured);
  return {
    ...q,
    providers,
    citedCount: counted.filter((p) => p.cited || p.brandMentioned).length,
    totalProviders: counted.length,
  };
}

const isOpenRow = (q: any): boolean => !!q && q.locked !== true && Array.isArray(q.providers);

/**
 * Sonucun satirlarini "yalniz olculen cevap sayilir" kuralina getirir.
 *
 * NEDEN: payda eskiden runPublicProbes'un dondurdugu TUM saglayicilardi —
 * anahtari olmayan/kullanilamayan saglayici (uretimde Meta Llama) ve HATA
 * probe'u da "anilmadi" sayiliyordu: 6 asistanin hepsinde anilan marka 6/7
 * (skor 86) goruyordu, metin "6 AI motoru" derken. Kural:
 *   - calismayan saglayicinin satiri yoktur (taze sonucta available=false
 *     atlanir; eski kayitta legacyNeverRan),
 *   - HATA satiri kalir ama measured=false — arayuz notr "olculemedi" cizer,
 *   - citedCount / totalProviders yalniz measured satirlardan,
 *   - kilitli satirin totalProviders'i calisan saglayici sayisidir.
 * citedCount'un payi degismez (HATA ve calismayan satir zaten cited=false),
 * yani gecmis kiyasi (getHistory toplami) bu normalizasyondan etkilenmez.
 * 24 saatlik onbellekten ve gecmisten okunan eski kayitlar da bundan gecer;
 * yeni kayitta islem degismez (idempotent).
 */
export function withMeasuredCounts<T>(result: T): T {
  const r = result as any;
  if (!r || !Array.isArray(r.queries)) return result;
  const mapped: any[] = r.queries.map((q: any) => (isOpenRow(q) ? measuredRow(q) : q));
  const ranCounts = mapped.filter(isOpenRow).map((q) => (q.providers as any[]).length);
  if (ranCounts.length === 0) return { ...r, queries: mapped } as T;
  const ran = Math.max(...ranCounts);
  return { ...r, queries: mapped.map((q) => (q?.locked === true ? { ...q, totalProviders: ran } : q)) } as T;
}

/** Sonucun olculen (kilitsiz) sorulari, sirasiyla. locked alani olmayan eski kayitta tum sorular olculdu. */
function openQueries(result: unknown): any[] {
  const qs = (result as { queries?: unknown } | null | undefined)?.queries;
  return Array.isArray(qs) ? qs.filter((q: any) => q && q.locked !== true && typeof q.query === 'string') : [];
}

/** Sonucun kademesi; alan yoksa 'anon' (onbellek kuraliyla ayni: teaser oncesi kayitlar anonimdi). */
function resultTier(result: unknown): 'anon' | 'member' {
  return (result as { access?: { tier?: unknown } } | null | undefined)?.access?.tier === 'member' ? 'member' : 'anon';
}

const queryKey = (q: string): string => q.trim().replace(/\s+/g, ' ').toLowerCase();

/** Iki sonucun olculen soru kumesi ayni mi (sira onemsiz). */
function sameQuestionSet(a: unknown, b: unknown): boolean {
  const ka = openQueries(a).map((q) => queryKey(q.query)).sort();
  const kb = openQueries(b).map((q) => queryKey(q.query)).sort();
  return ka.length > 0 && ka.length === kb.length && ka.every((k, i) => k === kb[i]);
}

/**
 * Karsilastirma hucreleri (comparable-trend.ts): hucre = saglayici x markasiz
 * olculen soru, deger = cevapta marka anildi ya da alan adi kaynak gosterildi
 * (citedCount ile ayni birim). HATA satiri ve calismayan saglayici hucre
 * uretmez. Damgasiz eski kayitta markali soru, getHistory'deki gibi host'suz
 * yeniden hesaplanir.
 */
function answerRows(result: unknown, brand: string, current: boolean, version: number): TrendRow[] {
  const rows: TrendRow[] = [];
  for (const q of openQueries(withMeasuredCounts(result))) {
    const branded = typeof q.brandInQuery === 'boolean' ? q.brandInQuery : containsBrand(q.query, brand);
    if (branded) continue;
    for (const p of Array.isArray(q.providers) ? q.providers : []) {
      if (!p?.measured) continue;
      rows.push({ cell: `${p.provider}|${queryKey(q.query)}`, current, value: p.cited || p.brandMentioned ? 1 : 0, version });
    }
  }
  return rows;
}

/** Retest kiyasi yapilmadiysa neden — e-posta notu buna gore secilir. */
export type RetestMethodChangeReason =
  /** Iki olcum farkli CITATION_MATCH_VERSION ile yapildi */
  | 'match_version'
  /** Biri anonim (3 soru), digeri uye (10 soru) kademesi */
  | 'tier'
  /** Olculen soru kumesi farkli */
  | 'question_set'
  /** Ayni sorular ama ortak (iki olcumde de yanit alinan) cevap orani esigin altinda */
  | 'providers'
  /** Abonelik tabani bulunamadi */
  | 'no_baseline';

/** Abone retest e-postasinin kiyasi — compareWithPast ile ayni temel alanlar. */
export interface RetestComparison {
  current?: { totalCited: number; total: number; createdAt: Date; matchVersion: number };
  past?: { totalCited: number; total: number; createdAt: Date; matchVersion: number };
  /** current - past (markanin anildigi cevap sayisi farki); methodChanged ise 0 */
  delta: number;
  /** delta / past.totalCited * 100; methodChanged ise 0 */
  deltaPct: number;
  /** true: iki olcum ayni kosulda degil — karsilastirilmadi */
  methodChanged: boolean;
  /** methodChanged ise neden; alan yoksa yontem surumu (compareWithPast) */
  methodChangeReason?: RetestMethodChangeReason;
  /** Kiyasa giren cevap sayisi (iki olcumde de yanit alinan saglayici x soru) */
  comparedAnswers?: number;
  /** true: bir olcumde yanit alinan ama otekinde alinamayan cevaplar kiyas disi kaldi */
  partialCoverage?: boolean;
}

/** Retest'in olcecegi sabit soru seti — abonelik tabanindan (baselineQuestionSet). */
export interface FixedQuestionSet {
  brand: string;
  niche: string;
  customNiche?: string;
  /** Olculecek sorular: tabanin olculen sorulari, ayni sirayla. */
  measured: Array<{ query: string; category?: string }>;
  /** Tabanda kilitli listelenen sorular — yine olculmez, yalniz listelenir. */
  locked: Array<{ query: string; category?: string }>;
}

export interface PublicCheckOptions {
  /**
   * Abone retest'i: soru listesi, marka ve nis TABANDAN aynen alinir; nis
   * tespiti ve soru uretimi calismaz, sayfa cekilmez. Yalniz ic cagiranlar
   * (abone retest'i) verir — HTTP ucu bu secenegi hic gecirmez.
   */
  fixed?: FixedQuestionSet;
  /**
   * IP basina 7 gunluk farkli alan adi siniri bu istekte daha DAR olsun
   * (yalniz 'manual'). Controller, Turnstile token'i olmadan gelen mobil
   * uygulama istegi icin verir (public-citation.controller.ts check()).
   * Genel sinirdan (PUBLIC_CITATION_IP_WEEKLY_LIMIT) buyuk deger yok sayilir:
   * siki kademe hicbir ayarda normal kademeden genis olamaz.
   */
  ipDailyLimit?: number;
}

/** Kayitli bir public kontrol satiri — retest tabani ve kiyas girdisi. */
export interface StoredPublicCheck {
  id?: string;
  createdAt: Date;
  brand: string;
  niche?: string | null;
  customNiche?: string | null;
  result: unknown;
}

/**
 * Taban kaydinin soru seti. Sorgu metinleri AYNEN alinir (yeniden suzulmez):
 * kume bir harf bile degisirse kiyas "soru seti degisti"ye duser.
 */
export function baselineQuestionSet(row: StoredPublicCheck): FixedQuestionSet | null {
  const res = (row.result ?? {}) as { queries?: unknown; brand?: unknown; niche?: unknown; customNiche?: unknown };
  const qs: any[] = Array.isArray(res.queries) ? res.queries : [];
  const usable = (q: any) => q && typeof q.query === 'string' && q.query.trim().length > 0 && q.query.length <= 500;
  const pick = (q: any) => ({ query: q.query as string, category: typeof q.category === 'string' ? q.category : undefined });
  const measured = qs.filter((q) => usable(q) && q.locked !== true).map(pick).slice(0, TEASER_TOTAL_QUERIES);
  const locked = qs.filter((q) => usable(q) && q.locked === true).map(pick).slice(0, Math.max(0, TEASER_TOTAL_QUERIES - measured.length));
  const brand = String(row.brand || res.brand || '').trim().slice(0, 80);
  if (measured.length === 0 || !brand) return null;
  const niche = row.niche ?? (typeof res.niche === 'string' ? res.niche : null) ?? 'diğer';
  const customNiche = row.customNiche ?? (typeof res.customNiche === 'string' ? res.customNiche : null) ?? undefined;
  return { brand, niche, customNiche, measured, locked };
}

/**
 * Abone retest kiyasi: taze olcum ile abonelik tabani.
 *
 * Kiyas yalniz AYNI KOSULDA yapilir — aksi halde fark gorunurluk degil
 * kosul degisikligidir ve aboneye sahte dusus/artis e-postasi giderdi:
 *   - ayni olcum yontemi surumu (CITATION_MATCH_VERSION),
 *   - ayni kademe (anonim 3 soru ↔ uye 10 soru toplami kiyaslanmaz),
 *   - ayni olculen soru kumesi (retest tabanin sorularini yeniden sorar;
 *     eskiden her retest soru setini bastan uretiyordu),
 *   - ortak hucre orani esigi (comparable-trend.ts DEFAULT_MIN_COVERAGE):
 *     sayilar yalniz iki olcumde de yanit alinan saglayici x soru
 *     hucrelerinden — bir olcumde rate limit yiyen saglayici fark yaratmaz.
 * Sartlardan biri tutmazsa methodChanged=true, delta 0 ve neden kodu doner;
 * e-posta fark yerine notr not tasir.
 */
export function compareRetest(
  current: Pick<StoredPublicCheck, 'createdAt' | 'brand' | 'result'>,
  baseline: Pick<StoredPublicCheck, 'createdAt' | 'brand' | 'result'> | null,
): RetestComparison {
  const curVersion = publicResultMatchVersion(current.result);
  const curRows = answerRows(current.result, current.brand, true, curVersion);
  const curInfo = {
    totalCited: curRows.filter((r) => r.value > 0).length,
    total: curRows.length,
    createdAt: current.createdAt,
    matchVersion: curVersion,
  };
  if (!baseline) {
    return { current: curInfo, delta: 0, deltaPct: 0, methodChanged: true, methodChangeReason: 'no_baseline' };
  }
  const pastVersion = publicResultMatchVersion(baseline.result);
  const pastRows = answerRows(baseline.result, baseline.brand, false, pastVersion);
  const pastInfo = {
    totalCited: pastRows.filter((r) => r.value > 0).length,
    total: pastRows.length,
    createdAt: baseline.createdAt,
    matchVersion: pastVersion,
  };
  const notCompared = (reason: RetestMethodChangeReason): RetestComparison => ({
    current: curInfo, past: pastInfo, delta: 0, deltaPct: 0, methodChanged: true, methodChangeReason: reason,
  });
  if (curVersion !== pastVersion) return notCompared('match_version');
  if (resultTier(current.result) !== resultTier(baseline.result)) return notCompared('tier');
  if (!sameQuestionSet(current.result, baseline.result)) return notCompared('question_set');

  const trend = compareCells([...curRows, ...pastRows]);
  if (trend.state !== 'comparable' || trend.current === null || trend.previous === null) return notCompared('providers');
  // Her hucrede donem basina tek deger (0/1) var: ortalama x hucre = sayi
  const matched = trend.matchedCells;
  const curCount = Math.round(trend.current * matched);
  const pastCount = Math.round(trend.previous * matched);
  const delta = curCount - pastCount;
  return {
    current: { ...curInfo, totalCited: curCount, total: matched },
    past: { ...pastInfo, totalCited: pastCount, total: matched },
    delta,
    deltaPct: pastCount > 0 ? Math.round((delta / pastCount) * 100) : 0,
    methodChanged: false,
    comparedAnswers: matched,
    partialCoverage: matched < Math.max(curRows.length, pastRows.length),
  };
}

export interface PublicCheckResult {
  domain: string;
  brand: string;
  niche: string;
  customNiche?: string;
  queries: Array<{
    query: string;
    category?: string;
    /**
     * true = bu soru LISTELENDI ama OLCULMEDI. Kilitli satirda providers
     * bos gelir; hicbir sonuc verisi istemciye gonderilmez. CSS blur ile
     * gizlemek yeterli DEGIL — devtools'tan okunurdu.
     */
    locked?: boolean;
    /**
     * Yalniz bu olcumde CALISAN saglayicilar (anahtari olmayan/kullanilamayan
     * saglayici satir olarak gelmez). measured=false: saglayici bu soruda
     * hata verdi ('HATA: ...') — sayilara girmez, arayuz notr gosterir.
     */
    providers: Array<{
      provider: string;
      label: string;
      measured: boolean;
      cited: boolean;          // host URL geçti
      brandMentioned: boolean; // brand adı geçti
      excerpt?: string;
    }>;
    citedCount: number;     // kac motor cite etti / andi (yalniz measured satirlar)
    /** Bu soruda GERCEKTEN olculen saglayici sayisi; kilitli satirda calisan saglayici sayisi */
    totalProviders: number;
    /**
     * Sorunun kendisinde marka adi geciyor mu (BRAND kategorisi ve
     * {BRAND_HINT} sablonlari). Bu sorularda asistanin markayi anmasi
     * neredeyse totolojik — manset skora katilmaz, ayri gosterilir.
     */
    brandInQuery: boolean;
  }>;
  /** Teaser durumu — UI kilit rozetini ve CTA'yi buna gore cizer. */
  access: {
    tier: 'anon' | 'member';
    unlockedQueries: number;
    totalQueries: number;
    lockedQueries: number;
  };
  competitorRanking: Array<{
    name: string;
    mentions: number;
    pct: number;
    isBrand?: boolean;
  }>;
  totalLlmCalls: number;
  fromCache: boolean;
  cachedAt?: Date;
  /**
   * Olcum yontemi surumu (CITATION_MATCH_VERSION). Yeni sonucta daima dolu;
   * bu alandan once yazilmis (onbellekten donen) kayitta yok = v3 ya da daha
   * eski. Farkli surumlu iki sonuc karsilastirilmaz (compareWithPast).
   */
  matchVersion?: number;
  /** Bu olcumun PublicCitationCheck kaydi (taze sonucta, yazildiysa) — retest e-posta kaydina gecer. */
  checkId?: string;
}

@Injectable()
export class PublicCitationService {
  private readonly log = new Logger(PublicCitationService.name);
  private readonly CACHE_TTL_HOURS = 24;

  // IP rate limit: IP basina son 7 gunde max N farkli domain icin TAZE olcum
  // (sahip karari 25.10.2026: haftada 1; eskiden 24 saatte 3). Her taze test
  // 3 soru x 7 saglayici ucretli probe calistirir. Gecersiz env (NaN) kalan
  // hakki NaN yapip HER istegi reddederdi → varsayilan 1. Eski
  // PUBLIC_CITATION_IP_DAILY_LIMIT bilerek okunmaz: sunucuda 3 kalmissa
  // haftalik sinir sessizce 3'e cikardi.
  private readonly IP_WEEKLY_DOMAIN_LIMIT = (() => {
    const n = parseInt(process.env.PUBLIC_CITATION_IP_WEEKLY_LIMIT ?? '1', 10);
    return Number.isFinite(n) && n > 0 ? n : 1;
  })();

  /** Yalnizca test: gercek DNS yerine sahte cozumleyici. Uretimde bos → assertResolvesPublic. */
  urlResolver?: PublicResolver;

  constructor(
    private readonly prisma: PrismaService,
    private readonly ai: AiCitationService,
    private readonly niche: NicheDetectorService,
  ) {}

  /**
   * IP basina rate-limit kontrol — son 7 gun icinde ayni IP'den kac farkli domain
   * icin TAZE olcum yapildi (onbellekten donus kayit yazmaz, sayilmaz).
   * Hak doluysa resetIn, bir alan adinin pencereden cikacagi gun: alan adlari
   * en son testlerine gore yeniden eskiye siralanir; sayi cap'in altina, cap.
   * siradaki alan adinin son testi 7 gunu doldurunca iner.
   *
   * KAYITTAKI IP HASH'LIDIR (check() → hashIp). Sorgu eskiden ham IP ile
   * yapiliyordu: hicbir kayitla eslesmedigi icin "IP basina gunde 3 domain"
   * limiti HIC devreye girmiyordu (sinirsiz ucretli probe). Yalniz anonim
   * landing kayitlari (source 'manual') sayilir: uyenin tam rapor kilidi
   * (signup_baseline) kendi kotasina tabidir, landing hakkini yemez.
   */
  async checkRateLimit(ip: string, limit?: number): Promise<{ ok: boolean; remaining: number; resetIn?: string }> {
    if (!ip) return { ok: false, remaining: 0, resetIn: 'IP adresi okunamadı' };
    const cap = this.effectiveIpLimit(limit);
    const now = Date.now();
    const cutoff = new Date(now - PUBLIC_CHECK_WINDOW_MS);
    // distinct + createdAt desc → alan adi basina EN SON test satiri
    const distinctDomains: Array<{ domain: string; createdAt?: Date }> = await this.prisma.publicCitationCheck.findMany({
      where: { ip: this.hashIp(ip), source: 'manual', createdAt: { gte: cutoff } },
      select: { domain: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
      distinct: ['domain'],
    });
    const used = distinctDomains.length;
    const remaining = Math.max(0, cap - used);
    if (remaining > 0) return { ok: true, remaining, resetIn: undefined };
    const latest = distinctDomains
      .map((d) => (d.createdAt instanceof Date ? d.createdAt.getTime() : now))
      .sort((a, b) => b - a);
    const opensAt = new Date((latest[cap - 1] ?? now) + PUBLIC_CHECK_WINDOW_MS);
    return { ok: false, remaining: 0, resetIn: `${trDay(opensAt)} itibarıyla yenilenir` };
  }

  /** Istekteki IP siniri: verilen deger genel sinirdan buyukse genel sinir (siki kademe hep daha dar) */
  private effectiveIpLimit(limit?: number): number {
    if (typeof limit !== 'number' || !Number.isFinite(limit) || limit < 1) return this.IP_WEEKLY_DOMAIN_LIMIT;
    return Math.min(this.IP_WEEKLY_DOMAIN_LIMIT, Math.floor(limit));
  }

  /**
   * Alan adini normalize et — sema yoksa https, www. atilir (onbellek anahtari).
   * IP adresi, port, kimlik bilgisi, tek etiketli ad ve ozel adres REDDEDILIR
   * (site-url-policy.ts). Yalnizca sekil: ag istegi yok (gecmis ucu da kullanir).
   */
  private normalizeDomain(input: string): { url: string; host: string } {
    return normalizePublicDomainInput(input);
  }

  /**
   * HTML fetch + brand extract (NicheDetector pattern).
   * BURASI KIMLIK DOGRULAMASIZ PUBLIC UC — adres tamamen disaridan geliyor.
   * safeFetchText: ic adres ve ic adrese giden yonlendirme reddedilir, govde
   * okuma aninda 1 MB'ta kesilir (eskiden once indirilip sonra kirpiliyordu).
   */
  private async extractBrandFromHtml(url: string, host: string): Promise<{ brand: string; title: string; description: string }> {
    let html = '';
    try {
      const res = await safeFetchText(url, { maxBytes: 1024 * 1024, timeoutMs: 8000 });
      // Engel / dogrulama sayfasinin basligi marka diye okunmasin
      if (res.ok && !res.binary && !detectBlock(res)) html = res.text.slice(0, 100_000);
    } catch (err: any) {
      // Ic adres/IP mesaja sizmasin: yalnizca hata kodu loglanir
      this.log.warn(`Public HTML fetch fail (${host}): ${err instanceof SafeFetchError ? err.code : 'network'}`);
    }

    const title = (html.match(/<title[^>]*>([^<]+)</i)?.[1] ?? '').trim().slice(0, 200);
    const description = (html.match(/<meta\s+name=["']description["']\s+content=["']([^"']+)/i)?.[1]
      ?? html.match(/<meta\s+property=["']og:description["']\s+content=["']([^"']+)/i)?.[1]
      ?? '').trim().slice(0, 300);
    const ogSiteName = (html.match(/<meta\s+property=["']og:site_name["']\s+content=["']([^"']+)/i)?.[1] ?? '').trim();
    const ogTitle = (html.match(/<meta\s+property=["']og:title["']\s+content=["']([^"']+)/i)?.[1] ?? '').trim();
    const appName = (html.match(/<meta\s+name=["']application-name["']\s+content=["']([^"']+)/i)?.[1] ?? '').trim();

    // Hostname-based brand candidate (kobipratik.com -> "kobipratik")
    const hostRoot = (() => {
      const parts = host.split('.');
      if (parts.length === 0) return host;
      // 2-level TLD case (com.tr): "x.com.tr" -> "x"; otherwise "a.b.c" -> "b"
      if (parts.length >= 3 && /^(com|net|org|gov|edu)$/.test(parts[parts.length - 2])) {
        return parts[parts.length - 3];
      }
      return parts.length >= 2 ? parts[parts.length - 2] : host;
    })();
    const hostBrandPretty = hostRoot.charAt(0).toUpperCase() + hostRoot.slice(1);

    // Brand priority:
    //   1. og:site_name (the most authoritative)
    //   2. application-name
    //   3. title segment containing hostRoot (kesin marka match)
    //   4. hostname root (capitalised) — pazarlama basliklari brand degildir; site og:site_name koymadiysa
    //      title'in en kisa segmentini almak yerine hostname'i kullan (cunku "KOBI Nakit Ihtiyaci" gibi
    //      bir CTA brand olmaz)
    let brand = '';
    if (ogSiteName && ogSiteName.length >= 3 && ogSiteName.length <= 80) brand = ogSiteName;
    else if (appName && appName.length >= 3 && appName.length <= 80) brand = appName;
    else {
      const candidate = ogTitle || title;
      const segments = candidate.split(/\s*[|–—\-·:»]\s*/).map((s) => s.trim()).filter((s) => s.length >= 2 && s.length <= 60);
      const hostMatch = segments.find((s) => s.toLowerCase().includes(hostRoot.toLowerCase()));
      if (hostMatch) brand = hostMatch;
    }
    if (!brand || brand.length < 3) brand = hostBrandPretty;

    return { brand: brand.slice(0, 80), title, description };
  }

  /**
   * Niche'e gore 3 deterministic prompt uret.
   *
   * {BRAND_HINT}: marka alan adindan turetilmis jenerik bir kelimeyse
   * ("emlak" ← emlak.com) soruya yalin kelime yerine alan adi konur. Aksi
   * halde "Emlak alternatifi..." sorusu olcumde markasiz sayilir (matcher bu
   * markada yalniz alan adini arar) ve markali soru manset skora girer.
   */
  private buildQueries(niche: string, customNiche: string | undefined, brand: string, host: string): string[] {
    const template = TURKISH_NICHE_PROMPTS[niche] ?? TURKISH_NICHE_PROMPTS['diğer'];
    const nicheLabel = customNiche || niche;
    const brandHint = brandHintFor(brand, host);
    return template.map((t) =>
      t.replace(/\{NICHE\}/g, nicheLabel).replace(/\{BRAND_HINT\}/g, brandHint)
    );
  }

  /** Main entry — controller'in cagirdigi fonksiyon. */
  /**
   * Kesfedilen share-of-voice listesini IS MODELI FILTRESINDEN gecirir.
   * Marka her zaman korunur; adaylardan yalnizca gercek rakipler tutulur;
   * yuzdeler kalan set uzerinden yeniden hesaplanir.
   */
  private async filterCompetitors(
    shareOfVoice: Array<{ name: string; mentions: number; pct: number; isBrand?: boolean }>,
    ctx: { brand: string; host: string; niche?: string; customNiche?: string; audience: Audience },
  ): Promise<Array<{ name: string; mentions: number; pct: number; isBrand?: boolean }>> {
    if (!shareOfVoice.length) return [];

    const brandRow = shareOfVoice.find((s) => s.isBrand);
    const candidates = shareOfVoice.filter((s) => !s.isBrand);
    if (candidates.length === 0) return shareOfVoice;

    const keep = await this.ai.classifyRealCompetitors({
      brand: ctx.brand,
      host: ctx.host,
      niche: ctx.niche,
      customNiche: ctx.customNiche,
      candidates: candidates.map((c) => c.name),
      audience: ctx.audience,
    });

    const realComps = candidates.filter((c) => keep.has(c.name.toLowerCase().replace(/^www\./, '')));

    // Yuzdeleri yeniden hesapla: marka + gercek rakip mention'lari toplamiuzerinden
    const total = (brandRow?.mentions ?? 0) + realComps.reduce((a, c) => a + c.mentions, 0);
    const pct = (m: number) => (total > 0 ? Math.round((m / total) * 100) : 0);

    const out: Array<{ name: string; mentions: number; pct: number; isBrand?: boolean }> = [];
    if (brandRow) out.push({ ...brandRow, pct: pct(brandRow.mentions) });
    for (const c of realComps.sort((a, b) => b.mentions - a.mentions)) {
      out.push({ name: c.name, mentions: c.mentions, pct: pct(c.mentions) });
    }
    return out;
  }

  async check(
    domain: string,
    ip: string,
    source: 'manual' | 'retest_cron' | 'signup_baseline' = 'manual',
    opts: PublicCheckOptions = {},
  ): Promise<PublicCheckResult> {
    const { url, host } = this.normalizeDomain(domain);
    const fixed = opts.fixed;

    // Model kademesi: landing'den gelen anonim istek ve email abonesinin cron
    // retest'i 'anon' (ucuz model); kayit sonrasi baseline uyeye ait → 'member'.
    // Probe modeli bu ayrimdan ETKILENMEZ (olcum cetveli sabit, bkz. model-tier.ts).
    const audience: Audience = source === 'signup_baseline' ? 'member' : 'anon';

    // 1) Cache kontrol — 24h taze snapshot.
    //
    // KADEME TAM ESLESMELI, iki yonlu da tehlikeli:
    //   anon'a member snapshot'i verilirse → 10 sorunun TAMAMI bedava sizar,
    //     kilit anlamsizlasir (bir kisi acinca 24 saat herkese acik olurdu).
    //   member'a anon snapshot'i verilirse → 2 sorguluk eksik rapor gelir,
    //     ustelik kotasindan dusulmus olur.
    //
    // retest_cron ve sabit soru seti haric tutulur: amaci zaten TAZE olcum almak.
    if (!fixed && (source === 'manual' || source === 'signup_baseline')) {
      const cutoff = new Date(Date.now() - this.CACHE_TTL_HOURS * 60 * 60 * 1000);
      // En yeniyi alip kademesine bakmak YETMEZ: bir uye domaini actiginda en
      // yeni snapshot 'member' olur ve sonraki her anonim ziyaretci cache'i
      // kaciririp bastan tam olcum tetiklerdi. Son birkac kaydin icinden
      // kademesi TUTAN en yenisini sec.
      const recent = await this.prisma.publicCitationCheck.findMany({
        where: { domain: host, createdAt: { gt: cutoff } },
        orderBy: { createdAt: 'desc' },
        take: 5,
      });
      const cached = recent.find((c) => ((c.result as any)?.access?.tier ?? 'anon') === audience);
      if (cached) {
        // Eski bicimli hata satiri (ham saglayici metni) anonim cevaba gitmesin;
        // eski kayittaki calismayan saglayici satiri ve HATA paydasi da
        // ayni olcum kuralina getirilir (withMeasuredCounts).
        return { ...withMeasuredCounts(withSafeExcerpts(cached.result as any)), fromCache: true, cachedAt: cached.createdAt };
      }
    }

    // 2) Rate limit (cache miss durumunda manuel istekler icin). Token'siz
    // mobil istekte controller daha dar sinir verir (opts.ipDailyLimit).
    if (source === 'manual') {
      const limit = this.effectiveIpLimit(opts.ipDailyLimit);
      const rl = await this.checkRateLimit(ip, limit);
      if (!rl.ok) {
        const sinir = limit === 1 ? '1 alan adı' : `en fazla ${limit} farklı alan adı`;
        throw new HttpException(
          `Haftalık ücretsiz test hakkınız doldu: aynı IP adresinden 7 günde ${sinir} test edilebilir; hakkınız ${rl.resetIn ?? '7 gün içinde yenilenir'}. Daha sık ve 6 asistanda ölçüm için 14 gün ücretsiz deneme hesabı açabilirsiniz.`,
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
      // 2b) Gunluk anonim harcama tavani: bu test TAVAN maliyetiyle tavani
      // asacaksa probe calismaz. Eszamanli isteklerde en fazla birkac test
      // kadar asma olabilir (oku-sonra-yaz); defter test BITINCE yazilir.
      const planned = this.ai.plannedPublicCost(FREE_UNLOCKED_QUERIES);
      const spent = await this.ai.readPublicAnonSpent();
      if (spent + planned > publicDailyBudgetUsd()) {
        this.log.warn(`Anonim test gunluk tavani doldu: harcanan ${spent.toFixed(2)} + planlanan ${planned.toFixed(2)} > ${publicDailyBudgetUsd()} USD`);
        throw new HttpException(PUBLIC_BUDGET_MESSAGE, HttpStatus.TOO_MANY_REQUESTS);
      }
    }

    // 3) Alan adi SIMDI herkese acik bir adrese mi cozuluyor? Ilk ag
    // isteginden once: ic aga cozulen ad anlasilir bir hatayla reddedilir.
    // (Asil koruma yine safe-fetch'in baglanti anindaki denetimi.)
    await assertPublicDomainResolves(url, this.urlResolver);

    // 4-6) Marka, nis ve sorular
    let brand: string;
    let niche: string;
    let customNiche: string | undefined;
    let measured: Array<{ query: string; category?: string }>;
    let lockedQueries: Array<{ query: string; category?: string }>;
    if (fixed) {
      // ABONE RETEST'I — tabanin soru listesi, markasi ve nisi AYNEN. Eskiden
      // her retest nis tespitini yeniden calistirip soru setini bastan
      // uretiyordu; abone e-postasi farkli sorularin toplamini kiyasliyordu.
      // Sayfa cekilmez, nis tespiti (LLM) calismaz.
      brand = fixed.brand;
      niche = fixed.niche;
      customNiche = fixed.customNiche;
      measured = fixed.measured.slice(0, TEASER_TOTAL_QUERIES);
      lockedQueries = fixed.locked.slice(0, Math.max(0, TEASER_TOTAL_QUERIES - measured.length));
    } else {
      // 4) HTML fetch + brand
      const meta = await this.extractBrandFromHtml(url, host);

      // 5) Niche detect — model kademesi cagiran kitleye gore. 'anon' icin
      // NicheDetector headless Chrome'u ASLA calistirmaz.
      const detection = await this.niche.detectFromUrl(url, audience);

      // 6) Sorular — niche-detector 10 soru uretir. Uretemezse niche template'ine dus.
      const aiQueries = (detection.queries ?? [])
        .map((q) => ({ query: q.query.trim(), category: q.category as string | undefined }))
        .filter((q) => q.query.length >= QUERY_MIN_LEN && q.query.length <= QUERY_MAX_LEN);
      const allQueries: Array<{ query: string; category?: string }> =
        aiQueries.length >= 3
          ? aiQueries.slice(0, TEASER_TOTAL_QUERIES)
          : this.buildQueries(detection.niche, detection.customNiche, meta.brand, host)
              .map((q) => ({ query: q, category: undefined }));

      // TEASER KILIDI — anonim ziyaretci tum sorulari GORUR ama yalnizca ilk
      // birkaci OLCULUR. Kilitli sorgular icin LLM cagrisi HIC yapilmaz: hem
      // maliyet duser hem de sizdirilacak veri olmaz.
      const unlockedCount = audience === 'member'
        ? allQueries.length
        : Math.min(FREE_UNLOCKED_QUERIES, allQueries.length);
      brand = meta.brand;
      niche = detection.niche;
      customNiche = detection.customNiche;
      measured = allQueries.slice(0, unlockedCount);
      lockedQueries = allQueries.slice(unlockedCount);
    }

    // 7) Probe providers (paralel) — SADECE acik sorgular icin
    const providerResults = await this.ai.runPublicProbes({
      brand,
      host,
      queries: measured.map((q) => q.query),
      competitors: [],
    });

    if (source === 'manual') {
      const spentNow = providerResults.reduce((sum, r) => sum + (r.cost || 0), 0);
      await this.ai.addPublicAnonSpend(spentNow).catch(() => undefined);
    }

    // 8) Per-query aggregate + share-of-voice
    //
    // PAYDA = OLCULEN CEVAP (bkz. withMeasuredCounts): calismayan saglayici
    // (available=false — anahtar yok ya da model kaldirildi; uretimde Meta
    // Llama) satir olarak HIC yazilmaz; HATA probe'u satir olarak kalir ama
    // measured=false ve ne payda ne pay sayilir.
    const ran = providerResults.filter((pr) => pr.available);
    const allProbes: CitationProbe[] = [];
    const perQuery: PublicCheckResult['queries'] = measured.map((q) => {
      const providers = ran.map((pr) => {
        const probe = pr.probes.find((p) => p.query === q.query);
        const isMeasured = !!probe && !isErrorExcerpt(probe.excerpt);
        return {
          provider: pr.provider,
          label: pr.label,
          measured: isMeasured,
          cited: isMeasured && !!probe?.cited,
          brandMentioned: isMeasured && !!probe?.brandMentioned,
          // Onbellekten okunanla ayni kural (withSafeExcerpts) — anonim cikista tek suzgec
          excerpt: sanitizeProbeExcerpt(probe?.excerpt) ?? undefined,
        };
      });
      const counted = providers.filter((p) => p.measured);
      // Damga probe'dan okunur (buildProbe ayni marka ile vurdu) — burada
      // yeniden hesaplansaydi rozet ile skorun dislama kumesi iki ayri kod
      // yolundan gecerdi ve bir kural degisikliginde sessizce ayrisirlardi.
      // HATA probe'unda damga yoktur: damgali ilk probe aranir. Hic yoksa
      // metinden hesapla — host ile: buildProbe'un matcher'i jenerik markada
      // alan adini arar.
      const probeStamp = providerResults
        .flatMap((pr) => pr.probes)
        .find((p) => p.query === q.query && typeof p.brandInQuery === 'boolean')?.brandInQuery;
      return {
        query: q.query,
        category: q.category,
        locked: false,
        providers,
        citedCount: counted.filter((p) => p.cited || p.brandMentioned).length,
        totalProviders: counted.length,
        brandInQuery: probeStamp ?? containsBrand(q.query, brand, host),
      };
    });
    // Kilitli sorular: yalnizca METIN ve KATEGORI gider. providers bos —
    // istemciye sizacak bir sonuc verisi yok, cunku olcum hic yapilmadi.
    // totalProviders = bu olcumde calisan saglayici sayisi (kilit acilinca
    // soruyu kac asistanin olcecegi; arayuz yer tutucu sayisini buradan alir).
    for (const q of lockedQueries) {
      perQuery.push({
        query: q.query,
        category: q.category,
        locked: true,
        providers: [],
        citedCount: 0,
        totalProviders: ran.length,
        brandInQuery: containsBrand(q.query, brand, host),
      });
    }
    for (const pr of providerResults) allProbes.push(...pr.probes);
    const agg = this.ai.publicAggregate(allProbes, brand);

    // IS MODELI FILTRESI — bkz. ai-citation.classifyRealCompetitors.
    // Kesfedilen adaylar arasindan SADECE gercek rakipleri (ayni is modeli)
    // tut; saglayicilari/kaynaklari ele. Ornek: kredi karsilastirma platformu
    // icin bankalar saglayicidir, rakip degil. Filtreleme sonrasi yuzdeler
    // kalan set uzerinden yeniden hesaplanir.
    const competitorRanking = await this.filterCompetitors(
      agg.shareOfVoice ?? [],
      { brand, host, niche, customNiche, audience },
    );

    const result: PublicCheckResult = {
      domain: host,
      brand,
      niche,
      customNiche,
      queries: perQuery,
      competitorRanking,
      totalLlmCalls: ran.length * measured.length,
      fromCache: false,
      // JSON'a yazilir (sema degisikligi yok): abone retest'i ve gecmis kiyasi
      // farkli yontemle olculmus iki kaydi bu damgadan ayirt eder.
      matchVersion: CITATION_MATCH_VERSION,
      access: {
        tier: audience,
        unlockedQueries: measured.length,
        totalQueries: measured.length + lockedQueries.length,
        lockedQueries: lockedQueries.length,
      },
    };

    // 9) Snapshot yaz — her test ayri row (history korunur)
    const costUsd = providerResults.reduce((a, pr: any) => a + (pr.cost ?? 0), 0);
    try {
      const created = await this.prisma.publicCitationCheck.create({
        data: {
          domain: host,
          brand,
          niche,
          customNiche,
          result: result as any,
          totalCalls: result.totalLlmCalls,
          costUsd,
          ip: this.hashIp(ip),
          source,
        },
      });
      result.checkId = created.id;
    } catch (err: any) {
      this.log.warn(`Snapshot write fail for ${host}: ${err.message}`);
    }

    return result;
  }

  /**
   * Abone retest'inin TABANI: abonelik anina en yakin ANONIM kademeli kayit.
   *
   * Ziyaretci sonucu gorup abone olur; gordugu sonuc (taze ya da 24 saatlik
   * onbellek) abonelik anindan onceki en yeni anonim kayittir. Uye kaydi
   * (10 soru olculmus) atlanir: retest anonim kademede olcer ve kademesi
   * farkli iki sonuc karsilastirilmaz. Oncesinde anonim kayit yoksa abonelikten
   * SONRAKI ilk anonim kayit (cogunlukla ilk retest) taban olur; kayitlar
   * gecmise eklenmedigi icin sonraki retest'ler hep ayni tabani bulur.
   */
  async findRetestBaseline(domain: string, subscribedAt: Date): Promise<StoredPublicCheck | null> {
    const { host } = this.normalizeDomain(domain);
    const select = { id: true, createdAt: true, brand: true, niche: true, customNiche: true, result: true } as const;
    const isAnon = (r: { result: unknown }) => resultTier(r.result) === 'anon';
    const before = await this.prisma.publicCitationCheck.findMany({
      where: { domain: host, createdAt: { lte: subscribedAt } },
      orderBy: { createdAt: 'desc' },
      take: 10,
      select,
    });
    const hit = before.find(isAnon);
    if (hit) return hit;
    const after = await this.prisma.publicCitationCheck.findMany({
      where: { domain: host, createdAt: { gt: subscribedAt } },
      orderBy: { createdAt: 'asc' },
      take: 10,
      select,
    });
    return after.find(isAnon) ?? null;
  }

  /** Retest kiyasi — kurallar compareRetest'te (saf, test edilir). */
  compareWithBaseline(
    current: Pick<StoredPublicCheck, 'createdAt' | 'brand' | 'result'>,
    baseline: Pick<StoredPublicCheck, 'createdAt' | 'brand' | 'result'> | null,
  ): RetestComparison {
    return compareRetest(current, baseline);
  }

  /**
   * Domain icin son N snapshot'i don (en yeni basta).
   *
   * totalCitedScore = markasiz sorularda markanin anildigi ya da kaynak
   * gosterildigi CEVAP sayisi (saglayici x soru); motor sayisi degil.
   * matchVersion = kaydin olculdugu yontem surumu — farkli surumlu iki satir
   * arasindaki fark gorunurluk degil yontem degisikligi olabilir.
   */
  async getHistory(domain: string, limit = 12): Promise<Array<{
    id: string;
    createdAt: Date;
    source: string;
    totalCitedScore: number;
    queriesCount: number;
    totalProviders: number;
    matchVersion: number;
  }>> {
    const { host } = this.normalizeDomain(domain);
    const rows = await this.prisma.publicCitationCheck.findMany({
      where: { domain: host },
      orderBy: { createdAt: 'desc' },
      take: limit,
      // brand de lazim: marka adi gecen sorular skordan ayrilir ve bu ayrim
      // ESKI kayitlar icin de yapilabilsin diye kaydin kendi markasindan
      // yeniden hesaplanir (JSON'da brandInQuery alani olmayabilir).
      //
      // Cevap yalniz toplamlari tasir (alinti/excerpt YOK) — saglayici metni
      // bu uctan cikmaz, ayrica suzmek gerekmez.
      select: { id: true, createdAt: true, source: true, result: true, brand: true },
    });
    return rows.map((r) => {
      // Payda olculen saglayicilar (withMeasuredCounts): eski kayittaki
      // calismayan saglayici satiri totalProviders'a girmez. citedCount'un
      // payi degismez — toplam skor eski kayitlarla karsilastirilabilir kalir.
      const res = withMeasuredCounts(r.result as any);
      const queries: any[] = Array.isArray(res?.queries) ? res.queries : [];

      // MANSET: yalnizca markasiz sorular. Marka adi sorunun icinde geciyorsa
      // asistanin markayi anmasi neredeyse totolojik; ikisi toplanirsa skor
      // gorunurlugu degil soru bilesimini olcer.
      //
      // Kayitli alan varsa o kullanilir, yoksa sorgu metninden yeniden
      // hesaplanir — boylece bu degisiklikten ONCEKI kayitlar da ayni
      // olcutle degerlendirilir ve tarihsel karsilastirma bozulmaz.
      //
      // Yedek hesapta host BILEREK verilmez: alani olmayan kayit damgayi
      // ekleyen surumden (c78a4cb, 2026-08-21) once yazildi, yani
      // CITATION_MATCH_VERSION 4 oncesi — hem soru hem cevap tarafi
      // (brandMentioned → citedCount) yalin kelimeyle olculdu; ayni donemin
      // damgali kayitlari da oyle.
      // Host'lu yedek, jenerik turetilmis markada "emlak" gecen sorulari eski
      // (sisik) anilmayla markasiz havuza sokar ve gecmis skoru geriye donuk
      // degistirirdi. v4 kayitlari damgayi buildProbe'dan host'lu tasir.
      const isBranded = (q: any): boolean =>
        typeof q?.brandInQuery === 'boolean' ? q.brandInQuery : containsBrand(q?.query ?? '', r.brand ?? '');

      const unbranded = queries.filter((q) => !isBranded(q));
      const totalCited = unbranded.reduce((a, q) => a + (q.citedCount ?? 0), 0);
      const totalProviders = (queries[0]?.totalProviders ?? 0);
      return {
        id: r.id,
        createdAt: r.createdAt,
        source: r.source,
        totalCitedScore: totalCited,
        queriesCount: unbranded.length,
        totalProviders,
        matchVersion: publicResultMatchVersion(res),
      };
    });
  }

  /**
   * Su anki sonucu ile N gun once arasinda delta uret (alan adi gecmisi).
   *
   * ABONE RETEST'I BUNU KULLANMAZ: alan adinin en yeni iki kaydini kiyaslar,
   * soru setine ve kademeye bakmaz. Retest, abonelik tabaninin soru setini
   * yeniden sorar ve compareWithBaseline ile kiyaslar.
   *
   * YONTEM SURUMU: iki kayit farkli CITATION_MATCH_VERSION ile olculduyse
   * (alansiz eski kayit = v3 ya da daha eski) fark "gorunurluk degisti" degil
   * "olcum yontemi degisti"dir. v4 alan adindan turetilmis jenerik markada
   * ("emlak" ← emlak.com) yalin kelimeyi artik anilma saymiyor; v3 tabanla
   * kiyaslanan ilk v4 retest'i aboneye sahte "dusus" e-postasi gonderirdi.
   * Bu durumda methodChanged=true, delta ve deltaPct 0 doner (fark
   * hesaplanmaz); e-posta fark yerine yontem notu gosterir.
   */
  async compareWithPast(domain: string, daysAgo: number): Promise<{
    current?: { totalCited: number; total: number; createdAt: Date; matchVersion: number };
    past?: { totalCited: number; total: number; createdAt: Date; matchVersion: number };
    /** current - past totalCitedScore (markanin anildigi cevap sayisi farki); methodChanged ise 0 */
    delta: number;
    /** delta / past.totalCited * 100; methodChanged ise 0 */
    deltaPct: number;
    /** true: iki kayit farkli olcum yontemiyle olculdu — karsilastirilmadi */
    methodChanged: boolean;
  }> {
    const history = await this.getHistory(domain, 50);
    if (history.length === 0) return { delta: 0, deltaPct: 0, methodChanged: false };
    const current = history[0];
    const targetTime = Date.now() - daysAgo * 24 * 60 * 60 * 1000;
    // En yakin onceki snapshot (>= targetTime'dan eski)
    const past = history.slice(1).find((h) => h.createdAt.getTime() <= targetTime) || history[history.length - 1];
    const methodChanged = current.matchVersion !== past.matchVersion;
    const delta = methodChanged ? 0 : current.totalCitedScore - past.totalCitedScore;
    const deltaPct = !methodChanged && past.totalCitedScore > 0 ? Math.round((delta / past.totalCitedScore) * 100) : 0;
    // total = kaydin olculen saglayici sayisi (eskiden bos ise sabit 7 yaziliyordu)
    return {
      current: { totalCited: current.totalCitedScore, total: current.totalProviders, createdAt: current.createdAt, matchVersion: current.matchVersion },
      past: { totalCited: past.totalCitedScore, total: past.totalProviders, createdAt: past.createdAt, matchVersion: past.matchVersion },
      delta,
      deltaPct,
      methodChanged,
    };
  }

  /** IP'yi audit/rate-limit icin saklarken privacy icin hash'le. */
  private hashIp(ip: string): string {
    if (!ip) return '';
    const salt = process.env.IP_HASH_SALT ?? 'luviai-public-citation';
    return createHash('sha256').update(`${salt}:${ip}`).digest('hex').slice(0, 32);
  }
}
