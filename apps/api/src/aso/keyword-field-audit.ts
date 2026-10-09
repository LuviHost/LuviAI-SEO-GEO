import { foldForMatch } from '../common/text-normalize.js';

/**
 * App Store anahtar kelime alani denetimi (saf).
 *
 * Kural kaynaklari (iki-kaynak kurali; her bulgu `source` alaninda soyler):
 *  - Apple App Store Connect referansi (Platform version information):
 *    "up to 100 bytes", her kelime 2 karakterden uzun, uygulama ve sirket
 *    adi zaten aranir → tekrar etme, baska uygulama/sirket adi yasak.
 *  - Apple "Search" rehberi (developer.apple.com/app-store/search):
 *    "100 characters", virgulle ve BOSLUKSUZ ayir, ad/alt baslik/kategori
 *    kelimelerini tekrarlama, cogullar tekrar sayilir, "app"/"game" gibi
 *    genel terimler, rakip uygulama adlari reddedilme sebebi.
 *  - rorkai/App-Store-Connect-CLI (MIT) `validation/keyword_audit.go`:
 *    bos segment, standart disi ayrac, tekrar, ad/alt baslik ortusmesi.
 *  - appeeky/aso-skills (MIT): virgul sonrasi bosluk israfi, tekil kullan,
 *    "app" ve kategori adi koyma.
 *
 * SINIR: Apple'in iki belgesi celisiyor (100 bayt vs 100 karakter). ASC
 * API'si 168 bayt / 91 karakterlik Arapca alani KABUL etti (asc CLI #1399,
 * 2026-04; CLI bu yuzden bayttan karaktere gecti). Bu yuzden hata = 100
 * KARAKTER asimi; 100 bayt asimi yalniz bilgi notu.
 *
 * Bilincli olarak ALINMAYAN tek kaynakli kurallar: "en az N karakter bos
 * birakma" esigi, yereller arasi tekrar, dolgu kelime listeleri, Turkce
 * cogul eki (Apple'in Turkce davranisi belgelenmemis).
 */

export const KEYWORD_FIELD_LIMIT = 100;

export type KwSeverity = 'error' | 'warning' | 'info';
export type KwCode =
  | 'OVER_LIMIT'
  | 'BYTES_OVER_100'
  | 'EMPTY_SEGMENT'
  | 'SPACES_AROUND_COMMA'
  | 'NONCANONICAL_SEPARATOR'
  | 'DUPLICATE_TERM'
  | 'PLURAL_DUPLICATE'
  | 'SHORT_TERM'
  | 'OVERLAP_NAME'
  | 'OVERLAP_SUBTITLE'
  | 'OVERLAP_COMPANY'
  | 'COMPETITOR_NAME'
  | 'GENERIC_TERM'
  | 'CATEGORY_TERM';

export interface KeywordFieldFinding {
  code: KwCode;
  severity: KwSeverity;
  message: string;
  terms: string[];
  source: string;
}

export interface KeywordFieldAuditInput {
  keywords: string;
  appName?: string | null;
  subtitle?: string | null;
  companyName?: string | null;
  competitorNames?: string[];
  categoryNames?: string[];
}

export interface KeywordFieldAudit {
  characters: number;
  bytes: number;
  limit: number;
  remaining: number;
  terms: string[];
  findings: KeywordFieldFinding[];
  /** Mekanik temizlik: virgul ayrac, bosluksuz, bos segment ve birebir tekrar yok. Anlami degistirmez. */
  cleanedField: string;
  cleanedCharacters: number;
  summary: { error: number; warning: number; info: number };
}

const SRC_APPLE_REF = 'Apple App Store Connect referansı';
const SRC_APPLE_SEARCH = 'Apple Search rehberi';

/** Gürültü azaltma: ortusme raporunda dolgu kelimeleri sayilmaz (urun parametresi) */
const STOPWORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'for', 'of', 'to', 'in', 'on', 'with', 'by', 'at', 'from', 'your', 'my',
  've', 'ile', 'icin', 'için', 'bir', 'bu', 'da', 'de', 'en',
]);
const GENERIC = new Set(['app', 'apps', 'application', 'game', 'games', 'uygulama', 'uygulamalar', 'oyun', 'oyunlar']);
const COMPANY_SUFFIXES = new Set(['inc', 'llc', 'ltd', 'co', 'corp', 'gmbh', 'as', 'aş', 'a', 's', 'ş', 'sti', 'şti', 'limited', 'sirketi', 'şirketi']);

/** Apple'in "karakter"i: kod noktasi (asc CLI'nin Arapca dogrulamasi da rune sayar) */
export const countCharacters = (s: string) => [...(s ?? '')].length;
export const countBytes = (s: string) => new TextEncoder().encode(s ?? '').length;

const collapse = (s: string) => s.replace(/\s+/g, ' ').trim();
const wordsOf = (s: string | null | undefined): string[] =>
  foldForMatch(s ?? '').split(/[^\p{L}\p{N}]+/u).filter(Boolean);
const containsPhrase = (hay: string[], needle: string[]) =>
  needle.length > 0 && ` ${hay.join(' ')} `.includes(` ${needle.join(' ')} `);
const uniq = <T,>(xs: T[]) => [...new Set(xs)];

interface Scan { segments: string[]; terms: string[]; empty: boolean; noncanonical: boolean; wastedSpaces: number }

function scan(value: string): Scan {
  const v = (value ?? '').replace(/\r\n/g, '\n');
  const noncanonical = /[，、;；\n\r]/.test(v);
  const segments = v.trim() === '' ? [] : v.split(/[,，、;；\n\r]/);
  let wastedSpaces = 0;
  const terms: string[] = [];
  let empty = false;
  for (const seg of segments) {
    const c = collapse(seg);
    if (!c) { empty = true; continue; }
    wastedSpaces += countCharacters(seg) - countCharacters(c);
    terms.push(c);
  }
  return { segments, terms, empty, noncanonical, wastedSpaces };
}

export function auditKeywordField(input: KeywordFieldAuditInput): KeywordFieldAudit {
  const raw = input.keywords ?? '';
  const characters = countCharacters(raw);
  const bytes = countBytes(raw);
  const s = scan(raw);
  const findings: KeywordFieldFinding[] = [];
  const add = (code: KwCode, severity: KwSeverity, message: string, terms: string[], source: string) =>
    findings.push({ code, severity, message, terms, source });

  // ── Uzunluk ──
  if (characters > KEYWORD_FIELD_LIMIT) {
    add('OVER_LIMIT', 'error', `${characters} karakter — sınır ${KEYWORD_FIELD_LIMIT}. App Store Connect kaydetmez.`, [], `${SRC_APPLE_SEARCH} + asc CLI`);
  } else if (bytes > KEYWORD_FIELD_LIMIT) {
    add('BYTES_OVER_100', 'info',
      `${bytes} bayt (${characters} karakter). Apple'ın bir belgesi "100 bayt" diyor; ASC'nin 100 karakter altını kabul ettiği gözlendi. Kaydedilir, yine de reddedilirse bayt sınırı sebeptir.`,
      [], `${SRC_APPLE_REF} + asc CLI #1399`);
  }

  // ── Bicim (karakter israfi) ──
  if (s.empty) add('EMPTY_SEGMENT', 'warning', 'Boş segment var (",," ya da baştaki/sondaki virgül) — karakter israfı.', [], 'asc CLI + appeeky');
  if (s.wastedSpaces > 0) {
    add('SPACES_AROUND_COMMA', 'warning', `${s.wastedSpaces} gereksiz boşluk (virgül çevresinde ya da çift boşluk) — Apple "virgülle ve boşluksuz ayır" diyor.`, [], `${SRC_APPLE_SEARCH} + appeeky`);
  }
  if (s.noncanonical) add('NONCANONICAL_SEPARATOR', 'warning', 'Virgül dışında ayraç var (; 、 ， ya da satır sonu) — yalnız virgül kullan.', [], `${SRC_APPLE_SEARCH} + asc CLI`);

  // ── Tekrar ──
  const seen = new Map<string, string>();
  const dups: string[] = [];
  const unique: string[] = [];
  for (const t of s.terms) {
    const k = wordsOf(t).join(' ') || foldForMatch(t);
    if (seen.has(k)) dups.push(t);
    else { seen.set(k, t); unique.push(t); }
  }
  if (dups.length) add('DUPLICATE_TERM', 'warning', `Aynı terim birden fazla kez: ${uniq(dups).join(', ')}.`, uniq(dups), `${SRC_APPLE_SEARCH} + asc CLI`);

  const fieldWords = uniq(unique.flatMap((t) => wordsOf(t)));
  const wordSet = new Set(fieldWords);
  const plurals: string[] = [];
  for (const w of fieldWords) {
    if (w.length < 3) continue;
    for (const p of [`${w}s`, `${w}es`, w.endsWith('y') ? `${w.slice(0, -1)}ies` : '']) {
      if (p && wordSet.has(p)) plurals.push(`${w}/${p}`);
    }
  }
  if (plurals.length) {
    add('PLURAL_DUPLICATE', 'info', `Tekil ve çoğul birlikte: ${plurals.join(', ')} — Apple çoğulu tekrar sayar, tekil yeterli.`, plurals, `${SRC_APPLE_SEARCH} + appeeky`);
  }

  const short = unique.filter((t) => countCharacters(t) <= 2);
  if (short.length) add('SHORT_TERM', 'info', `2 karakter ya da daha kısa: ${short.join(', ')} — Apple her anahtar kelimenin 2 karakterden uzun olmasını ister.`, short, SRC_APPLE_REF);

  // ── Ad / alt baslik / sirket ortusmesi ──
  const overlap = (other: string | null | undefined) => {
    const ow = new Set(wordsOf(other).filter((w) => !STOPWORDS.has(w)));
    return fieldWords.filter((w) => ow.has(w));
  };
  const nameHits = overlap(input.appName);
  if (nameHits.length) {
    add('OVERLAP_NAME', 'warning', `Uygulama adında zaten var: ${nameHits.join(', ')} — ad zaten aranıyor, bu kelimeler alanda boşa yer kaplıyor.`, nameHits, `${SRC_APPLE_REF} + ${SRC_APPLE_SEARCH}`);
  }
  const subHits = overlap(input.subtitle).filter((w) => !nameHits.includes(w));
  if (subHits.length) {
    add('OVERLAP_SUBTITLE', 'warning', `Alt başlıkta zaten var: ${subHits.join(', ')} — tekrar etmeye gerek yok.`, subHits, `${SRC_APPLE_SEARCH} + asc CLI`);
  }
  const companyCore = wordsOf(input.companyName).filter((w) => !COMPANY_SUFFIXES.has(w));
  if (companyCore.length) {
    const hits = unique.filter((t) => containsPhrase(wordsOf(t), companyCore));
    if (hits.length) add('OVERLAP_COMPANY', 'warning', `Şirket adı alanda: ${hits.join(', ')} — şirket adı zaten aranıyor.`, hits, `${SRC_APPLE_REF} + appeeky`);
  }

  // ── Rakip uygulama adi ── (marka kismi: "Marka: aciklama" / "Marka - aciklama")
  const brandOf = (name: string | null | undefined) => wordsOf((name ?? '').split(/\s*[:：|–—]\s*|\s+-\s+/)[0]);
  const ownBrand = brandOf(input.appName).join(' ');
  const competitorHits: string[] = [];
  for (const name of input.competitorNames ?? []) {
    const brand = brandOf(name);
    if (brand.join('').length < 3 || brand.join(' ') === ownBrand) continue;
    for (const t of unique) {
      if (containsPhrase(wordsOf(t), brand)) competitorHits.push(`${t} (${collapse(name)})`);
    }
  }
  if (competitorHits.length) {
    add('COMPETITOR_NAME', 'warning',
      `Rakip uygulama adı: ${uniq(competitorHits).join(', ')} — Apple başka uygulama adlarına izin vermez, reddedilme sebebi. Genel bir kelimeyse sorun değil.`,
      uniq(competitorHits), `${SRC_APPLE_REF} + ${SRC_APPLE_SEARCH}`);
  }

  // ── Genel terim / kategori ──
  const generic = fieldWords.filter((w) => GENERIC.has(w));
  if (generic.length) add('GENERIC_TERM', 'info', `Çok genel: ${generic.join(', ')} — "app"/"oyun" gibi terimler yer kaplar, değer katmaz.`, generic, `${SRC_APPLE_SEARCH} + appeeky`);
  const catWords = new Set((input.categoryNames ?? []).flatMap((c) => wordsOf(c)).filter((w) => !STOPWORDS.has(w)));
  const catHits = fieldWords.filter((w) => catWords.has(w) && !GENERIC.has(w));
  if (catHits.length) add('CATEGORY_TERM', 'info', `Kategori adında var: ${catHits.join(', ')} — kategori zaten indeksleniyor.`, catHits, `${SRC_APPLE_SEARCH} + appeeky`);

  const cleanedField = unique.join(',');
  const order: Record<KwSeverity, number> = { error: 0, warning: 1, info: 2 };
  findings.sort((a, b) => order[a.severity] - order[b.severity]);
  return {
    characters,
    bytes,
    limit: KEYWORD_FIELD_LIMIT,
    remaining: Math.max(0, KEYWORD_FIELD_LIMIT - characters),
    terms: s.terms,
    findings,
    cleanedField,
    cleanedCharacters: countCharacters(cleanedField),
    summary: {
      error: findings.filter((f) => f.severity === 'error').length,
      warning: findings.filter((f) => f.severity === 'warning').length,
      info: findings.filter((f) => f.severity === 'info').length,
    },
  };
}
