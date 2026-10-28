import { registrableDomain } from './host-match.js';

/**
 * AI cevaplarinin ALINTILADIGI kaynak URL'leri (GEO Faz 2) — saf.
 *
 * NEDEN: arama yapan saglayicilar (Claude web_search, Gemini googleSearch,
 * ChatGPT web_search, Perplexity sonar) cevapla birlikte kaynak listesi
 * donduruyor. Eskiden bu liste yalnizca "bizim alan adimiz listede mi"
 * sorusu icin kullanilip ATILIYORDU (withSources). Ileride "asistanlar bu
 * konuda hangi dis kaynaklari alintiliyor" raporu icin liste probe'a
 * normalize edilmis halde yazilir.
 *
 * KURALLAR:
 *  - Gurultu filtresi YOK: reddit/youtube/wikipedia da kaynaktir (rakip
 *    kesfindeki NOISE_DOMAINS yalniz SoV icindir, burada uygulanmaz).
 *  - Normalize: https, kucuk harf host, `www.` atilir, izleme parametreleri
 *    (utm_*, gclid, fbclid...) ve #fragment atilir, kullanici:sifre atilir.
 *  - Tekillestirilir (ilk gorulen sira korunur), probe basina en fazla
 *    MAX_SOURCES_PER_PROBE, URL ve baslik uzunlugu sinirli.
 *  - domain = kayit edilebilir alan (host-match.registrableDomain — .com.tr,
 *    .co.uk gibi iki etiketli sonekleri bilir).
 *  - Ek ag cagrisi YAPILMAZ (bkz. Gemini yonlendirme notu).
 *
 * Tam cevap metni hala SAKLANMAZ (ai-citation.service answerTexts notu);
 * kaynaklar herkese acik URL'lerdir.
 */

/**
 * Kaynak kaydi surumu — probe'a `sourcesVersion` olarak damgalanir.
 * Alan YOKSA kayit kaynaklar yakalanmadan once yazilmistir (eski satir).
 * Damga var + `sources` yok = saglayici kaynak listesi dondurmuyor
 * (Grok/DeepSeek/Llama — aramasiz). Damga var + `sources: []` = arama
 * yapildi, alintilanan kaynak yok.
 */
export const SOURCES_VERSION = 1;

export const MAX_SOURCES_PER_PROBE = 20;
export const MAX_SOURCE_URL_LEN = 300;
export const MAX_SOURCE_TITLE_LEN = 120;

// type (interface degil): Prisma InputJsonValue'ya dogrudan atanabilsin
export type CitationSource = {
  url: string;
  domain: string;
  title?: string;
  /**
   * true = gercek sayfa adresi bilinmiyor; url yalnizca sitenin kok adresi.
   * Gemini kaynaklari Google yonlendirme adresiyle gelir ve gercek sayfa
   * ek bir HTTP istegi olmadan cozulemez — bkz. geminiSources.
   */
  originOnly?: true;
};

/** Saglayicidan gelen ham kaynak (normalize edilmemis) */
export interface RawSource {
  url?: string | null;
  title?: string | null;
  /** Kesin alan adi biliniyorsa (Gemini web.domain / basligindan) */
  domain?: string | null;
  originOnly?: boolean;
}

/** Izleme parametreleri — sorgudan atilir (OpenAI kaynaklara utm_source=openai ekler) */
const TRACKING_PARAMS = new Set([
  'gclid', 'gclsrc', 'dclid', 'gbraid', 'wbraid', 'fbclid', 'msclkid', 'yclid', 'twclid',
  'ttclid', 'li_fat_id', 'igshid', 'mc_cid', 'mc_eid', '_ga', '_gl', 'srsltid',
]);

function isTrackingParam(name: string): boolean {
  const n = name.toLowerCase();
  return n.startsWith('utm_') || TRACKING_PARAMS.has(n);
}

/** Google grounding yonlendirmesi: gercek URL bu adresin arkasinda (302) */
export function isGroundingRedirect(url: string): boolean {
  return /^https?:\/\/vertexaisearch\.cloud\.google\.com\/grounding-api-redirect\//i.test(url.trim());
}

// En az iki etiket, harfle biten TLD; IP ve bosluklu metin eslesmez
const HOSTNAME_RE = /^(?=.{4,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{1,62}$/;

/**
 * Kabul edilen ust alanlar (kurate). NEDEN: Gemini basligindan alan adi
 * cikarirken "Next.js", "Vue.js" gibi teknoloji adlari host kalibina uyuyor;
 * ".js" gercek bir TLD degil. Liste PSL'nin tamami degil — Turkiye pazarinda
 * kaynak olarak gorulen gTLD'ler + yaygin ccTLD'ler. Listede olmayan TLD'li
 * Gemini kaynagi atlanir (gercek URL'li saglayicilar bu listeye TABI DEGIL).
 */
const KNOWN_TLDS = new Set([
  // gTLD
  'com', 'net', 'org', 'edu', 'gov', 'mil', 'int', 'info', 'biz', 'io', 'ai', 'app', 'dev', 'co',
  'me', 'tv', 'gg', 'xyz', 'online', 'site', 'store', 'shop', 'news', 'blog', 'tech', 'cloud',
  'page', 'wiki', 'pro', 'mobi', 'name', 'agency', 'digital', 'media', 'academy', 'health',
  'finance', 'bank', 'insurance', 'law', 'travel', 'global', 'world', 'live', 'life', 'today',
  'center', 'group', 'company', 'solutions', 'services', 'network', 'software', 'systems', 'tools',
  'review', 'reviews', 'guide', 'expert', 'money', 'market', 'marketing', 'studio', 'design',
  'education', 'school', 'university', 'eu', 'asia', 'istanbul',
  // ccTLD
  'tr', 'uk', 'de', 'fr', 'es', 'it', 'nl', 'be', 'ch', 'at', 'pl', 'ru', 'ua', 'us', 'ca', 'mx',
  'br', 'ar', 'cl', 'jp', 'cn', 'kr', 'in', 'au', 'nz', 'za', 'ie', 'pt', 'se', 'no', 'dk', 'fi',
  'gr', 'cz', 'sk', 'hu', 'ro', 'bg', 'hr', 'rs', 'si', 'ee', 'lv', 'lt', 'cy', 'il', 'ae', 'sa',
  'qa', 'kw', 'eg', 'ma', 'ng', 'ke', 'id', 'my', 'sg', 'th', 'vn', 'ph', 'tw', 'hk', 'pk', 'az',
  'ge', 'kz', 'uz', 'by', 'md', 'lu', 'is', 'mt', 'al', 'ba', 'mk', 'ly', 'fm', 'to', 'sh',
]);

/**
 * "www.ornek.com.tr" → "ornek.com.tr"; host degilse ya da TLD bilinmiyorsa
 * null (orn. sayfa basligi, "Next.js").
 */
export function asHostname(raw: string | null | undefined): string | null {
  if (typeof raw !== 'string') return null;
  const h = raw.trim().toLowerCase().replace(/\.$/, '').replace(/^www\./, '');
  if (!HOSTNAME_RE.test(h)) return null;
  return KNOWN_TLDS.has(h.slice(h.lastIndexOf('.') + 1)) ? h : null;
}

/**
 * Gemini BASLIGI alan adi mi? asHostname + basligin tamami kucuk harf.
 * Alan adi olan basliklar Gemini'de kucuk harfle gelir ("bankateklifi.com");
 * "ASP.NET", "Socket.IO" gibi urun adlari buyuk harf tasir ve host
 * kalibina + gercek TLD'ye uysa da alan adi degildir.
 */
export function titleAsHostname(raw: string | null | undefined): string | null {
  if (typeof raw !== 'string') return null;
  const t = raw.trim();
  return t === t.toLowerCase() ? asHostname(t) : null;
}

const IPV4_RE = /^\d{1,3}(?:\.\d{1,3}){3}$/;

function domainOf(host: string): string {
  // IP ve koseli parantezli IPv6 icin "son iki etiket" anlamsiz
  if (IPV4_RE.test(host) || host.startsWith('[')) return host;
  return registrableDomain(host);
}

function cleanTitle(raw: string | null | undefined, host: string, domain: string): string | undefined {
  if (typeof raw !== 'string') return undefined;
  const t = raw.replace(/\s+/g, ' ').trim();
  if (!t) return undefined;
  const lower = t.toLowerCase().replace(/^www\./, '');
  // Gemini basligi cogu zaman alan adinin kendisi — tekrar yazmak bayt israfi
  if (lower === host || lower === domain) return undefined;
  return t.length > MAX_SOURCE_TITLE_LEN ? `${t.slice(0, MAX_SOURCE_TITLE_LEN - 1)}…` : t;
}

/**
 * Tek URL'i normalize eder; http(s) degilse ya da cozulemiyorsa null.
 * Sinir asiminda once sorgu dizgesi, sonra yol atilir (kirpilmis bir URL
 * kirik link olurdu; kok adres en azindan dogru siteyi gosterir).
 */
export function normalizeSourceUrl(raw: string): { url: string; host: string; originOnly?: true } | null {
  if (typeof raw !== 'string') return null;
  const s = raw.trim();
  if (!s || s.length > 4096) return null;
  let u: URL;
  try {
    u = new URL(/^[a-z][a-z0-9+.-]*:/i.test(s) ? s : `https://${s}`);
  } catch {
    return null;
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
  u.protocol = 'https:';
  u.username = '';
  u.password = '';
  u.hash = '';
  const host = u.hostname.toLowerCase().replace(/\.$/, '').replace(/^www\./, '');
  if (!host || (!host.includes('.') && !host.startsWith('['))) return null;
  u.hostname = host;
  for (const name of [...u.searchParams.keys()]) {
    if (isTrackingParam(name)) u.searchParams.delete(name);
  }
  // searchParams bosaldiysa URL sonda '?' birakmaz
  let url = u.toString();
  if (url.length > MAX_SOURCE_URL_LEN) {
    u.search = '';
    url = u.toString();
  }
  if (url.length <= MAX_SOURCE_URL_LEN) return { url, host };
  // Yol da sigmiyor: yalniz kok adres — gercek sayfa bilinmiyor (originOnly)
  url = `${u.origin}/`;
  if (url.length > MAX_SOURCE_URL_LEN) return null;
  return { url, host, originOnly: true };
}

/**
 * Ham kaynaklari normalize eder, tekillestirir ve sinirlar. Ayni URL ikinci
 * kez baslikla gelirse eksik baslik tamamlanir.
 */
export function normalizeSources(raw: readonly RawSource[], max = MAX_SOURCES_PER_PROBE): CitationSource[] {
  const out: CitationSource[] = [];
  const byUrl = new Map<string, CitationSource>();
  for (const r of raw) {
    if (!r) continue;
    let norm: { url: string; host: string; originOnly?: true } | null = null;
    if (r.originOnly) {
      const h = asHostname(r.domain);
      norm = h ? normalizeSourceUrl(`https://${h}/`) : null;
    } else if (typeof r.url === 'string') {
      norm = normalizeSourceUrl(r.url);
    }
    if (!norm) continue;
    // Gemini kok adresi ya da sigmayan uzun URL'in koke dusmesi: sayfa bilinmiyor
    const originOnly = !!r.originOnly || !!norm.originOnly;
    const domain = domainOf(norm.host);
    const title = cleanTitle(r.title, norm.host, domain);
    const existing = byUrl.get(norm.url);
    if (existing) {
      if (!existing.title && title) existing.title = title;
      // Ayni adres hem tam hem kok olarak geldiyse tam olan kazanir
      if (existing.originOnly && !originOnly) delete existing.originOnly;
      continue;
    }
    if (out.length >= max) continue;
    const src: CitationSource = { url: norm.url, domain };
    if (title) src.title = title;
    if (originOnly) src.originOnly = true;
    byUrl.set(norm.url, src);
    out.push(src);
  }
  return out;
}

// ── Saglayici cikarimlari (ham API govdesi → RawSource[]) ─────────────

/**
 * Claude (Messages API + web_search araci): metin bloklarinin
 * `citations[]` dizisi — `web_search_result_location` { url, title }.
 * Yalniz cevapta ALINTILANAN kaynaklar alinir; arama SONUCLARI
 * (web_search_tool_result) alinti sayilmaz — withSources ile ayni kural.
 */
export function anthropicSources(content: unknown): RawSource[] {
  if (!Array.isArray(content)) return [];
  return content
    .filter((b: any) => b?.type === 'text' && Array.isArray(b.citations))
    .flatMap((b: any) => b.citations)
    .filter((c: any) => typeof c?.url === 'string')
    .map((c: any) => ({ url: c.url, title: typeof c.title === 'string' ? c.title : null }));
}

/**
 * Claude web aramasi BASARISIZ mi? (28.10.2026: Lidio olcumunde Claude "Web aramasini denedim ama arama
 * araci hata verdi" diye cevap yazdi; bu cevap kaynaksiz, egitim bilgisinden — ama "marka anilmadi"
 * olarak sayilip skoru dusuruyordu.)
 * Hata, HTTP 200 icinde gelir: web_search_tool_result.content = { type: 'web_search_tool_result_error', error_code }.
 * En az bir arama BASARILIYSA (sonuc dizisi) olcum gecerlidir — 'max_uses_exceeded' gibi sonraki aramanin
 * hatasi cevabi bozmaz. Doner: hata kodu (basarisizsa) ya da null.
 */
export function anthropicSearchFailure(content: unknown): string | null {
  if (!Array.isArray(content)) return null;
  const sonuclar = content.filter((b: any) => b?.type === 'web_search_tool_result');
  if (sonuclar.some((b: any) => Array.isArray(b.content))) return null;
  const hata = sonuclar.find((b: any) => b?.content?.type === 'web_search_tool_result_error');
  if (!hata) return null;
  const kod = String((hata as any).content?.error_code ?? '');
  return /^[A-Za-z0-9_.:-]{1,40}$/.test(kod) ? kod : 'bilinmiyor';
}

/**
 * Gemini (googleSearch grounding): `groundingChunks[].web` { uri, title, domain? }.
 *
 * YONLENDIRME KARARI: Gemini API'de `uri` gercek sayfa degil,
 * `vertexaisearch.cloud.google.com/grounding-api-redirect/...` adresi
 * (suresi dolan, ~250 karakterlik jeton). Gercek sayfa yalnizca bu adrese
 * ek bir HTTP istegi atip 302'yi okuyarak cozulur; probe basina 5-10 ek
 * istek olcumu yavaslatir ve kodda baska yerde yapilmiyor — YAPILMAZ.
 * Bunun yerine alan adi `web.domain` (yalniz Vertex doldurur) ya da
 * basliktan (Gemini API'de baslik cogu zaman "ornek.com") alinir ve kaynak
 * sitenin kok adresiyle `originOnly: true` yazilir. Baslik alan adi degilse
 * (sayfa basligi; "Next.js"/"ASP.NET" gibi urun adlari — titleAsHostname:
 * tamami kucuk harf + bilinen TLD) kaynak alan adi bilinemedigi icin
 * ATLANIR. Yonlendirme
 * olmayan (gercek) uri oldugu gibi normalize edilir.
 */
export function geminiSources(chunks: unknown): RawSource[] {
  if (!Array.isArray(chunks)) return [];
  const out: RawSource[] = [];
  for (const c of chunks as any[]) {
    const web = c?.web;
    if (!web) continue;
    const uri = typeof web.uri === 'string' ? web.uri : '';
    const title = typeof web.title === 'string' ? web.title : null;
    if (uri && !isGroundingRedirect(uri)) {
      out.push({ url: uri, title });
      continue;
    }
    const domain = asHostname(web.domain) ?? titleAsHostname(title);
    if (domain) out.push({ originOnly: true, domain, title });
  }
  return out;
}

/**
 * ChatGPT (Responses API + web_search): output_text parcalarinin
 * `annotations[]` dizisindeki `url_citation` { url, title }.
 */
export function openaiSources(parts: unknown): RawSource[] {
  if (!Array.isArray(parts)) return [];
  return parts
    .flatMap((p: any) => (Array.isArray(p?.annotations) ? p.annotations : []))
    .filter((a: any) => a?.type === 'url_citation' && typeof a.url === 'string')
    .map((a: any) => ({ url: a.url, title: typeof a.title === 'string' ? a.title : null }));
}

/**
 * Perplexity (sonar): `citations: string[]` + (yeni API) `search_results:
 * [{ title, url }]`. Sira citations'tan gelir (cevaptaki [1], [2] numaralari);
 * basliklar search_results'tan eslenir, citations'ta olmayan sonuc sona eklenir.
 */
export function perplexitySources(data: unknown): RawSource[] {
  const d = data as any;
  const citations: string[] = Array.isArray(d?.citations) ? d.citations.filter((u: unknown) => typeof u === 'string') : [];
  const results: Array<{ url: string; title: string | null }> = (Array.isArray(d?.search_results) ? d.search_results : [])
    .filter((r: any) => typeof r?.url === 'string')
    .map((r: any) => ({ url: r.url, title: typeof r.title === 'string' ? r.title : null }));
  const titleOf = new Map(results.map((r) => [r.url, r.title]));
  return [
    ...citations.map((url) => ({ url, title: titleOf.get(url) ?? null })),
    ...results.filter((r) => !citations.includes(r.url)),
  ];
}

/**
 * GeoPromptRun kolonlari (Prompt Lab / ASO Prompt Lab) — iki yazma yolu
 * ayni kurali kullansin diye tek yerde. sources undefined → kolon NULL
 * (aramasiz saglayici); [] = arama yapildi, alinti yok. sourcesVersion
 * NULL = eski satir.
 */
export function sourceColumns(probe: { sources?: CitationSource[]; sourcesVersion?: number }): {
  sources: CitationSource[] | undefined;
  sourcesVersion: number | null;
} {
  return {
    sources: Array.isArray(probe.sources) ? probe.sources : undefined,
    sourcesVersion: typeof probe.sourcesVersion === 'number' ? probe.sourcesVersion : null,
  };
}

/**
 * Saglayici sonuclarindan probe kaynak listelerini cikarir (kopya; girdi
 * degismez). Kaynaklar YALNIZ AiCitationSnapshot.probes ve GeoPromptRun'da
 * tutulur — "alintilanan dis kaynaklar" raporu bu ikisini okur. Diger
 * yuzeyler kaynak tasimaz:
 *  - Audit.checks.aiCitations.providers: audit gecmisi/raporlar 100 satira
 *    kadar checks okuyor; kaynaklar her satiri ~20 KB buyuturdu
 *  - MCP/Chat run_prompt cevabi: 20 probe x 20 kaynak ajan baglamina
 *    15-30 KB (binlerce token) eklerdi
 * sourcesVersion damgasi kalir (kucuk; olcumun hangi surumle yapildigini soyler).
 */
export function providersWithoutSources<T>(providers: T): T {
  if (!Array.isArray(providers)) return providers;
  return providers.map((p: any) => (Array.isArray(p?.probes)
    ? {
      ...p,
      probes: p.probes.map((pr: any) => {
        if (!pr || typeof pr !== 'object' || !('sources' in pr)) return pr;
        const copy = { ...pr };
        delete copy.sources;
        return copy;
      }),
    }
    : p)) as T;
}
