import { foldForMatch, escapeRegex } from '../common/text-normalize.js';
import { isGenericBrandWord } from './brand-in-query.js';

/**
 * RAKIP ADI ESLESMESI — saf, I/O yok (22.11.2026).
 *
 * NEDEN: rakip listesini cogu zaman marka beyni (LLM) uretiyor ve adi aciklamali yaziyor:
 * "Ingenico Turkey", "Hugin (Olivetti)", "Gittigidiyor (eBay Turkey)", "Udemy TR",
 * "Alere / Abbott Diagnostics". Olcum bu tam dizeyi aradigi icin cevaptaki "Ingenico",
 * "Hugin", "Udemy" sayilmiyordu: rakip anilmadi gorunuyor, markanin ses payi sisiyordu
 * (tokeninc.com: %83; 22 sitenin 15'inde ayni sorun, 124 addan 24'u).
 *
 * KURAL — rakip adindan eslesme terimleri turetilir, biri gecerse rakip anilmis sayilir:
 *  - "/", "+" ve bosluklu tire / uzun cizgi alternatif ayirir ("Alere / Abbott").
 *  - Parantez ICI yalniz alan adiysa ("useinsider.com") ya da "eski adiyla X" ise terim
 *    olur. Digerleri cogu zaman ana sirket ("Vallet (Halkbank)") ya da aciklama ("DIY"):
 *    ana sirketin anilmasi rakibin anilmasi DEGILDIR.
 *  - Sondaki ulke ve sirket ekleri atilir: Turkey, Türkiye, TR, A.Ş., Ltd, Inc, GmbH...
 *  - Ad gibi gorunmeyen parca terim olmaz: kucuk harfle baslayan ("genel SaaS POS"),
 *    tanim kelimesi tasiyan ("Yerli Alternatifler"), tamami gundelik kelime olan
 *    ("Dijital Ajans") ya da 3 karakterden kisa.
 *  - Hicbir terim cikmazsa eski davranis: tam ad aranir (kayit bos kalmasin).
 * Eslesme kelime sinirli ve Turkce-guvenli (marka kuraliyla ayni katlama).
 */

/** Rakip terimi icin en kisa uzunluk (eski kural: comp.length < 3 atlanir) */
const MIN_TERM_LEN = 3;

const WORD_CHARS = 'a-z0-9à-ſğüşöç';

/** Sondan atilan ulke / sirket ekleri (katlanmis bicimde karsilastirilir) */
const TRAILING_NOISE = new Set<string>([
  'turkey', 'türkiye', 'turkiye', 'tr', 'türk', 'a.ş.', 'a.ş', 'aş', 'a.s.', 'as', 'ltd', 'ltd.', 'şti', 'şti.', 'sti',
  'inc', 'inc.', 'llc', 'gmbh', 'co', 'co.', 'corp', 'corp.', 'group', 'grubu',
].map((w) => foldForMatch(w)));

/** Bu kelimeyi tasiyan parca bir ad degil, aciklamadir */
const DESCRIPTOR_WORDS = new Set<string>([
  'alternatif', 'alternatifler', 'alternatifleri', 'diğer', 'diger', 'yerli', 'genel', 'topluluk', 'toplulukları',
  'toplulugu', 'topluluğu', 'kullanım', 'kullanim', 'ekosistem', 'ekosistemi', 'girişim', 'girişimleri', 'kategori',
  'kategorisi', 'hibrit', 'benzeri', 'benzerleri', 'vb', 'vs', 'kanal', 'kanalı', 'doğrudan',
].map((w) => foldForMatch(w)));

const looksLikeDomain = (s: string) => /^[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(s.trim());

/** "Ingenico Turkey" → "Ingenico"; "Sovos Türkiye" → "Sovos"; ek tek basina kalirsa bos */
function stripTrailingNoise(part: string): string {
  const words = part.split(/\s+/).filter(Boolean);
  while (words.length > 1 && TRAILING_NOISE.has(foldForMatch(words[words.length - 1]))) words.pop();
  return words.join(' ');
}

/** Parca bir ad gibi mi (bkz. dosya basi KURAL) */
function looksLikeName(part: string): boolean {
  if (looksLikeDomain(part)) return true;
  const first = part.charAt(0);
  // Kucuk harfle baslayan parca aciklamadir ("genel SaaS POS"); "iyzico", "inPOS" gibi kucuk
  // harfli markalar TEK kelimedir — tek kelimeye izin var, cok kelimeliye yok
  const lowerStart = first === first.toLocaleLowerCase('tr') && first !== first.toLocaleUpperCase('tr');
  if (lowerStart && /\s/.test(part)) return false;
  const words = foldForMatch(part).split(/\s+/);
  if (words.some((w) => DESCRIPTOR_WORDS.has(w))) return false;
  // Tamami gundelik kelime olan COK kelimeli parca ("Dijital Ajans") ad degildir. Tek kelimeye
  // uygulanmaz: tek kelimelik rakip neredeyse her zaman markadir ve ek sezgiseli yanilir
  // ("Havas" = "hava" + "s" sayiliyordu).
  if (/\s/.test(part) && isGenericBrandWord(part)) return false;
  return true;
}

/**
 * Rakip adindan aranacak terimler (katlanmis, tekil). Ornekler:
 *   "Ingenico Turkey"                → ["ingenico"]
 *   "Gittigidiyor (eBay Turkey)"     → ["gittigidiyor"]
 *   "Insider (useinsider.com)"       → ["insider", "useinsider.com"]
 *   "ProDapt (eski adıyla Telesis)"  → ["prodapt", "telesis"]
 *   "Alere / Abbott Diagnostics"     → ["alere", "abbott diagnostics"]
 */
export function competitorTerms(name: string): string[] {
  const raw = (name || '').replace(/\s+/g, ' ').trim();
  if (!raw) return [];
  const adaylar: string[] = [];

  // Parantez icleri: yalniz alan adi ya da "eski adiyla X"
  for (const m of raw.matchAll(/\(([^()]*)\)/g)) {
    const ic = m[1].trim();
    const eski = /^(?:eski\s+ad[ıi]yla|eski\s+ad[ıi]|formerly|önceki\s+ad[ıi]yla)\s+(.+)$/i.exec(ic);
    if (eski) adaylar.push(eski[1]);
    else if (looksLikeDomain(ic)) adaylar.push(ic);
  }
  const govde = raw.replace(/\([^()]*\)/g, ' ').replace(/\s+/g, ' ').trim();
  for (const parca of govde.split(/\s*\/\s*|\s*\+\s*|\s+[—–-]\s+|\s*[—–]\s*/)) {
    if (parca.trim()) adaylar.push(parca.trim());
  }

  const out: string[] = [];
  for (const aday of adaylar) {
    const temiz = stripTrailingNoise(aday.trim());
    if (!temiz || !looksLikeName(temiz)) continue;
    const folded = foldForMatch(temiz).trim();
    if (folded.length < MIN_TERM_LEN || out.includes(folded)) continue;
    out.push(folded);
  }
  if (out.length === 0) {
    // Turetilecek bir sey yok: eski davranis, tam ad
    const tam = foldForMatch(raw).trim();
    return tam.length >= MIN_TERM_LEN ? [tam] : [];
  }
  return out;
}

export interface CompetitorHit {
  /** Toplam gecis (terimlerin tum eslesmeleri) */
  mentions: number;
  /** Ilk eslesmenin indeksi — eski kuralla ayni anlam (sol sinir karakteri dahil) */
  index: number;
  /** Adin metindeki gercek baslangici */
  start: number;
  /** Ilk eslesen terimin uzunlugu */
  length: number;
}

/** Katlanmis metinde rakibin (terimlerinden herhangi biri) gecisi; yoksa null */
export function competitorHitInFolded(folded: string, terms: readonly string[]): CompetitorHit | null {
  let mentions = 0;
  let best: CompetitorHit | null = null;
  for (const term of terms) {
    const re = new RegExp(`(?:^|[^${WORD_CHARS}])(${escapeRegex(term)})(?=$|[^${WORD_CHARS}])`, 'g');
    for (const m of (folded || '').matchAll(re)) {
      mentions++;
      const index = m.index ?? 0;
      const start = index + m[0].length - m[1].length;
      if (!best || start < best.start) best = { mentions: 0, index, start, length: term.length };
    }
  }
  return best ? { ...best, mentions } : null;
}
