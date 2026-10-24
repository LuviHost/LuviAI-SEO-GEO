/**
 * AI kaynakli ZIYARET siniflandirmasi — tek kaynak. Hem sunucu (AiReferrerService.record)
 * hem musteri sitesine gomulen tracker.js'in on suzgeci (buildTrackerJs) bu listeyi kullanir.
 *
 * Iki sinyal, sirayla:
 *  1) Referer'in HOST'u (document.referrer). Eskiden ham metinde regex araniyordu:
 *     /you\.com/ "playyou.com" ya da "?q=you.com" iceren her referer'i You.com sayiyordu,
 *     /perplexity\.ai/ "notperplexity.ai"yi Perplexity. Simdi URL ayristirilir ve host ya
 *     tam eslesir ya da listedeki alan adinin alt alan adidir (www.perplexity.ai).
 *  2) Inis URL'indeki utm_source. ChatGPT cevaptaki baglantilara `utm_source=chatgpt.com`
 *     ekler ve tarayici cogu zaman referer gondermez (uygulama, noreferrer); bu ziyaretler
 *     eskiden hic sayilmiyordu. utm_source TAM esitlikle ve yalniz alan adi bicimindeki
 *     degerlerle eslenir (bkz. AiSource.utmSources).
 *
 * anthropic.com KARARI (24.10.2026): yalniz claude.ai Claude sohbet referer'idir.
 * anthropic.com sirketin sitesi (blog, dokumantasyon, haberler); oradan gelen tiklama bir
 * AI cevabindan gelmez. Eski desen anthropic.com'u da "Claude" sayiyordu.
 *
 * GERIYE UYUMLULUK: anahtarlar (chatgpt, perplexity, claude, gemini, bing-copilot, you,
 * phind, poe) degismedi — ai_referrer_hits.referrer sutunundaki eski satirlar ayni
 * anlamda okunur; yeni anahtar eklenmedi.
 *
 * Nest importu yok — tracker.js uretimi ve spec dogrudan kullanir.
 */

export interface AiSource {
  /** ai_referrer_hits.referrer degeri — DEGISTIRMEYIN (kayitli veri bu anahtarla) */
  key: string;
  label: string;
  /** Referer host'u bunlardan biri ya da alt alan adi olmali */
  hosts: string[];
  /** Host eslesse bile yol + sorgu bu desene uymali (bing.com'un yalniz Copilot/sohbet sayfasi) */
  pathPattern?: RegExp;
  /**
   * utm_source degerleri (kucuk harf, tam esitlik). YALNIZ alan adi bicimi: 'openai',
   * 'claude', 'gemini', 'copilot', 'poe' gibi genel degerler sitenin KENDI kampanyalariyla
   * cakisir (ornegin "gemini" adli bir kampanya) ve asistanlarin bunlari ekledigine dair
   * kanit yok. Dogrulanan: ChatGPT baglantilara utm_source=chatgpt.com ekler. Digerleri
   * ayni kalibin alan adi karsiligi — cakisma riski yok, gelmezse zarari da yok.
   */
  utmSources: string[];
}

export const AI_SOURCES: readonly AiSource[] = [
  { key: 'chatgpt', label: 'ChatGPT', hosts: ['chatgpt.com', 'chat.openai.com'], utmSources: ['chatgpt.com', 'chat.openai.com'] },
  { key: 'perplexity', label: 'Perplexity', hosts: ['perplexity.ai'], utmSources: ['perplexity.ai'] },
  { key: 'claude', label: 'Claude', hosts: ['claude.ai'], utmSources: ['claude.ai'] },
  { key: 'gemini', label: 'Gemini', hosts: ['gemini.google.com', 'bard.google.com'], utmSources: ['gemini.google.com'] },
  {
    key: 'bing-copilot',
    label: 'Bing Copilot',
    hosts: ['copilot.microsoft.com', 'bing.com'],
    // copilot.microsoft.com her yolda; bing.com yalniz Copilot / sohbet sayfasinda (normal Bing aramasi AI degil)
    pathPattern: /copilot|^\/chat\b/i,
    utmSources: ['copilot.microsoft.com', 'copilot.com'],
  },
  { key: 'you', label: 'You.com', hosts: ['you.com'], utmSources: ['you.com'] },
  { key: 'phind', label: 'Phind', hosts: ['phind.com'], utmSources: ['phind.com'] },
  { key: 'poe', label: 'Poe', hosts: ['poe.com'], utmSources: ['poe.com'] },
];

/** Yalniz bu host icin pathPattern gecerli (copilot.microsoft.com her yolda sayilir) */
const PATH_CHECKED_HOSTS = new Set(['bing.com']);

function hostMatches(host: string, domain: string): boolean {
  return host === domain || host.endsWith(`.${domain}`);
}

function parseUrl(raw: string): URL | null {
  const s = raw.trim();
  if (!s) return null;
  try {
    return new URL(s);
  } catch {
    // Semasiz referer ("chatgpt.com/") — bazi istemciler boyle gonderir
    try {
      return /^[a-z0-9.-]+(?:[/:?#]|$)/i.test(s) ? new URL(`https://${s}`) : null;
    } catch {
      return null;
    }
  }
}

export type AiSourceMatch = { key: string; label: string; via: 'referrer' | 'utm' };

/** Referer URL'ini host'a gore siniflandirir; AI kaynagi degilse null */
export function classifyReferrer(referer: string): AiSourceMatch | null {
  const u = parseUrl(referer);
  if (!u || (u.protocol !== 'https:' && u.protocol !== 'http:')) return null;
  const host = u.hostname.toLowerCase().replace(/\.$/, '');
  for (const s of AI_SOURCES) {
    for (const d of s.hosts) {
      if (!hostMatches(host, d)) continue;
      if (s.pathPattern && PATH_CHECKED_HOSTS.has(d) && !s.pathPattern.test(`${u.pathname}${u.search}`)) continue;
      return { key: s.key, label: s.label, via: 'referrer' };
    }
  }
  return null;
}

/** Inis URL'indeki utm_source degerini siniflandirir (tam esitlik, buyuk/kucuk harf duyarsiz) */
export function classifyUtm(landingUrl: string): AiSourceMatch | null {
  const u = parseUrl(landingUrl);
  if (!u) return null;
  const raw = u.searchParams.get('utm_source');
  if (!raw) return null;
  const v = raw.trim().toLowerCase().replace(/^www\./, '');
  for (const s of AI_SOURCES) {
    if (s.utmSources.includes(v)) return { key: s.key, label: s.label, via: 'utm' };
  }
  return null;
}

/** Ziyaretin AI kaynagi: once referer host'u, yoksa inis URL'inin utm_source'u */
export function classifyAiVisit(referer: string, landingUrl: string): AiSourceMatch | null {
  return classifyReferrer(referer) ?? classifyUtm(landingUrl);
}

/**
 * tracker.js icin on suzgec verisi (JS sabiti olarak gomulur). Tarayici yalniz aday
 * ziyaretlerde beacon atar; kesin karari sunucu (classifyAiVisit) verir.
 */
export function trackerFilterData(): { hosts: Array<[string, string | null]>; utm: string[] } {
  const hosts: Array<[string, string | null]> = [];
  for (const s of AI_SOURCES) {
    for (const d of s.hosts) {
      hosts.push([d, s.pathPattern && PATH_CHECKED_HOSTS.has(d) ? s.pathPattern.source : null]);
    }
  }
  return { hosts, utm: AI_SOURCES.flatMap((s) => s.utmSources) };
}
