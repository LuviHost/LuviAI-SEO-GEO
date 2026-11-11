import { escapeRegex } from '../common/text-normalize.js';

/**
 * Alan adi eslesmesi — etiket sinirli (saf).
 *
 * NEDEN: alinti olcumu `metin.includes(host)` ile yapiliyordu: "ranksup.ai"
 * hem "notranksup.ai" hem "ranksup.ai.tr" icinde "alintilandi" sayiliyordu.
 * open-seo (MIT) ayni hatayi alan adinin bir ETIKET SINIRINDA bitmesini
 * zorunlu tutarak cozuyor; burada ayni kural (kod port edilmedi, yeniden yazildi).
 *
 *   ranksup.ai          ✓   blog.ranksup.ai   ✓ (alt alan = ayni site)
 *   "ranksup.ai."       ✓ (cumle sonu)        notranksup.ai     ✗
 *   ranksup.ai.tr       ✗ (baska alan)         x-ranksup.ai      ✗
 */

/**
 * Alinti olcum yontemi surumu — AiCitationSnapshot/AiCitationRun/GeoPromptRun
 * .matchVersion'a yazilir. 2 = etiket sinirli eslesme (bu dosya).
 * 3 = ChatGPT, Gemini ve Claude web aramali olculuyor (Ekim 2026); kaynak listesindeki
 *     alan adi da alinti sayilir. 2 ile 3 arasi karsilastirma "yontem degisti"
 *     olarak isaretlenir (citation-run-compare, ai-mention-alarm).
 * 4 = Alan adindan turetilmis JENERIK markada (eticaret.com → "eticaret") yalin
 *     kelime artik anilma/"soruda marka" sayilmaz; yalniz alan adi gecisi sayilir
 *     (brand-in-query.ts brandMatcher). Ayrica .com.tr gibi iki etiketli
 *     soneklerde yedek marka "com" yerine gercek kok (resolveSiteBrand). Bu surum
 *     ANILMA olcumunu da etkiler — 3 ile 4 arasi anilma kiyasi da "yontem degisti".
 *     Ayni surumun parcasi (v4 canliya cikmadan eklendi, ayrica surum yok):
 *       - koruma yalniz TEK jenerik kelimelik koke uygulanir; "Yapı Kredi"
 *         (yapikredi.com.tr) gibi bilesik kokler kelime modunda kalir
 *         (brand-in-query.ts brandMatchMode)
 *       - 'HATA:' satirlari skora/sayaclara girmez, tamami HATA olan saglayici
 *         olculemedi sayilir (citation-score.ts) — kayitli skorlar
 *         scripts/backfill-snapshot-unbranded.ts + backfill-citation-runs.ts ile
 *         yeniden hesaplanir
 * 5 = Grok (xAI Responses API + web_search) ve DeepSeek (Anthropic uyumlu uc +
 *     web_search) da web aramali olculuyor (Kasim 2026). Onceden ikisi yalniz
 *     egitim bilgisiyle cevapliyor, genc siteler yapisal olarak 0 aliyordu; 6
 *     asistanin ortalamasi (manset) da bu yuzden degisir → 4 ile 5 kiyaslanmaz.
 * 6 = (bu sabit hic 6 olmadi: 6, site olcumunun tekrarli surumunun numarasi — asagida.)
 * 7 = ChatGPT ve Gemini yeni modellerle olculuyor (11.11.2026): ChatGPT gpt-6 ailesi
 *     (Profesyonel ve ustu gpt-6-astra; Baslangic, deneme ve ucretsiz test gpt-6-luna),
 *     Gemini gemini-3.5-flash-lite. Eski modeller (gpt-4o-mini, gemini-2.5-flash) saglayicilarca
 *     kapatiliyor. Canli denemede yeni ChatGPT modelleri ayni sorularda farkli markalari andi —
 *     5 ile 7 arasi kiyas "yontem degisti" okunur. Ucretsiz test ayrica Claude'u hizli modelle
 *     (claude-haiku-5-5) olcer.
 */
export const CITATION_MATCH_VERSION = 7;

/**
 * SITE olcumunun yontem surumu — runForSite'in yazdigi kayitlar:
 * AiCitationSnapshot.matchVersion, AiCitationRun.matchVersion ve denetimdeki
 * aiCitations.details.methodVersion. Eski kiyas engeli (citation-history-trend,
 * citation-run-compare, ai-mention-alarm, denetim karsilastirmasi) bu alanlara
 * baktigi icin v5 ile v6 olcumu "yontem degisti" diye ayrilir, fark hesaplanmaz.
 *
 * NEDEN AYRI SABIT: CITATION_MATCH_VERSION eslesme kuralini anlatir ve Prompt
 * Lab (GeoPromptRun), landing testi (public-citation) ve karne de onu yazar.
 * Tekrar yalniz site olcumune eklendi; ortak surum artsaydi tek tur kalan bu
 * yuzeylerde de sahte "yontem degisti" isareti cikardi (aboneye giden yeniden
 * test e-postasi, Prompt Lab kiyasi).
 *
 * 6 = her soru her asistana N kez sorulur (citation-repeat.ts, CITATION_TEKRAR,
 *     varsayilan 3; deneme planinda 1); skor tum tekrarlardan, gorunme
 *     sikligina %95 Wilson araligi (visibility-interval.ts). Panelde fark
 *     yalniz araliklar ortusmuyorsa "artti/azaldi" okunur.
 * 8 = 6'nin tekrarli olcumu + CITATION_MATCH_VERSION 7'nin modelleri (11.11.2026).
 *
 * KURAL: her zaman CITATION_MATCH_VERSION'dan BUYUK kalir (host-match.spec.ts).
 * Eslesme kurali bir daha degisirse ikisi birlikte, ayni yeni numaraya
 * cikarilir — ayni numara iki farkli yontemi anlatmasin (geo-rapor-html.ts
 * YONTEM_DEGISIKLIGI tablosu numarayla anlatir).
 */
export const SITE_MEASUREMENT_VERSION = 8;

/**
 * 'standard' MODEL KADEMESIYLE yapilan site olcumunun surumu = guncel surum + 100
 * (11.11.2026, uc paket). Baslangic paketi ve deneme hesabi Claude'u hizli modelle
 * (claude-haiku-5-5, temel web aramasi) ve dort asistanla olcer; Profesyonel ve ustu
 * gelismis modelle ve butun asistanlarla (billing/plan-engines.ts).
 *
 * NEDEN AYRI NUMARA: ayni hesabin iki olcumu farkli kademeyle yapildiysa (deploy gununde
 * mevcut deneme hesaplari Opus → Haiku; sonra paket degistiren her hesap) Claude'un skor
 * farki sitenin degil MODELIN farkidir. Surum ayni kalsa trend, kosum kiyasi ve dusus
 * alarmi (ai-mention-alarm) bunu "Claude görünürlüğü %X düştü" diye okurdu. Kiyas kodu
 * surumleri yalniz ESITLIKLE karsilastirir; farkli numara "yontem degisti" demektir.
 * Ofset: SITE_MEASUREMENT_VERSION bir daha artarsa iki kademe birlikte artar, cakismaz.
 * Kademe, surumun "yuzler" basamagidir: siteMeasurementBase / isStandardTierVersion ayirir
 * (geo-rapor-html yontemNotu iki degisikligi ayri anlatir).
 */
export const STANDARD_TIER_VERSION_OFFSET = 100;

export function siteMeasurementVersion(tier: 'standard' | 'premium' | null | undefined = 'premium'): number {
  return tier === 'standard' ? SITE_MEASUREMENT_VERSION + STANDARD_TIER_VERSION_OFFSET : SITE_MEASUREMENT_VERSION;
}

/** Surum 'standard' kademeyle mi damgalanmis (ofsetli) */
/**
 * Prompt Lab satirinin (GeoPromptRun.matchVersion) yontem surumu: CITATION_MATCH_VERSION,
 * hizli modellerle ('standard') olculduyse + STANDARD_TIER_VERSION_OFFSET.
 *
 * NEDEN (11.11.2026, bagimsiz inceleme): satirlar iki kademede de ayni surumle damgalaniyordu.
 * Dal (fan-out) sorulari her planda ayni uc asistana gider; Baslangic'tan Profesyonel'e gecen
 * hesabin dal hucreleri bire bir eslesir ve KPI kiyasi (ai-kpis compareCells, surum esitligi)
 * hizli model ile ust model farkini gercek bir artis / dusus diye gosterirdi. Site olcumu
 * ayni ayrimi siteMeasurementVersion ile yapar.
 */
export function citationMatchVersion(tier: 'standard' | 'premium' | null | undefined = 'premium'): number {
  return tier === 'standard' ? CITATION_MATCH_VERSION + STANDARD_TIER_VERSION_OFFSET : CITATION_MATCH_VERSION;
}

export function isStandardTierVersion(version: number): boolean {
  return version >= STANDARD_TIER_VERSION_OFFSET;
}

/** Kademe ofseti cikarilmis yontem surumu (106 → 6, 108 → 8, 8 → 8) */
export function siteMeasurementBase(version: number): number {
  return isStandardTierVersion(version) ? version - STANDARD_TIER_VERSION_OFFSET : version;
}

/** Iki etiketli kayit edilebilir sonekler (kurate — PSL'nin bizi ilgilendiren kismi) */
const MULTI_PART_SUFFIXES = new Set([
  'com.tr', 'net.tr', 'org.tr', 'gov.tr', 'edu.tr', 'k12.tr', 'gen.tr', 'biz.tr', 'info.tr',
  'web.tr', 'av.tr', 'bel.tr', 'pol.tr', 'tsk.tr', 'name.tr', 'tel.tr', 'dr.tr',
  'co.uk', 'org.uk', 'ac.uk', 'gov.uk', 'me.uk', 'ltd.uk', 'plc.uk',
  'com.au', 'net.au', 'org.au', 'co.jp', 'co.nz', 'com.br', 'com.mx', 'co.in', 'co.za', 'com.cy',
]);

/** "blog.ornek.com.tr" → "ornek.com.tr"; "a.b.co.uk" → "b.co.uk"; "x.ai" → "x.ai" */
export function registrableDomain(host: string): string {
  const labels = host.toLowerCase().replace(/^www\./, '').replace(/\.$/, '').split('.').filter(Boolean);
  if (labels.length <= 2) return labels.join('.');
  const lastTwo = labels.slice(-2).join('.');
  return MULTI_PART_SUFFIXES.has(lastTwo) ? labels.slice(-3).join('.') : lastTwo;
}

// Solda: alan adi karakteri ya da tire olmamali (nokta serbest → alt alan).
// Sagda: alan adi karakteri/tire olmamali VE ".etiket" ile devam etmemeli.
function hostRegex(host: string, flags = 'i'): RegExp {
  return new RegExp(`(?<![a-z0-9-])${escapeRegex(host.toLowerCase())}(?![a-z0-9-])(?!\\.[a-z0-9])`, flags);
}

/** Metinde (katlanmis/kucuk harf) alan adi etiket sinirinda geciyor mu */
export function hostMentioned(text: string, host: string): boolean {
  if (!text || !host) return false;
  return hostRegex(host).test(text);
}

/** hostMentioned ile ayni kural; ilk gecisin indeksi (yoksa null) — konum/ton penceresi icin */
export function hostMentionIndex(text: string, host: string): number | null {
  if (!text || !host) return null;
  const m = hostRegex(host).exec(text);
  return m ? m.index : null;
}

/** Bir alinti URL'i bu siteye mi ait (tam host ya da alt alan) */
export function urlHostMatches(url: string, host: string): boolean {
  if (!url || !host) return false;
  let h: string;
  try { h = new URL(url).hostname.toLowerCase(); }
  catch {
    try { h = new URL(`https://${url}`).hostname.toLowerCase(); } catch { return false; }
  }
  h = h.replace(/^www\./, '');
  const want = host.toLowerCase().replace(/^www\./, '');
  return h === want || h.endsWith(`.${want}`);
}

/** Metindeki bu siteye ait URL'lerin yollari ("ranksup.ai/blog/x" → "/blog/x") */
export function citedPathsFor(text: string, host: string, max = 50): string[] {
  if (!text || !host) return [];
  const re = new RegExp(`(?:https?:\\/\\/)?(?:[a-z0-9-]+\\.)*(?<![a-z0-9-])${escapeRegex(host.toLowerCase())}(\\/[\\w\\-./?#=&%+]*)`, 'gi');
  const seen = new Set<string>();
  const out: string[] = [];
  for (const m of text.matchAll(re)) {
    // Sol sinir: eslesmenin hemen solu alan adi karakteri olmamali ("notranksup.ai/x")
    const before = m.index! > 0 ? text[m.index! - 1] : '';
    if (/[a-z0-9-]/i.test(before)) continue;
    const path = (m[1] || '/').replace(/[.,;:)\]]+$/, '').split('#')[0].split('?')[0] || '/';
    if (path.length >= 200 || seen.has(path)) continue;
    seen.add(path);
    out.push(path);
    if (out.length >= max) break;
  }
  return out;
}

/**
 * Metindeki uygulama magazasi referanslari — TAM metinden (alinti degil).
 * 'ios:<id>' | 'android:<paket>' | 'iosslug:<slug>'. Kucuk liste; probe'da
 * saklanir ki ASO Prompt Lab 220 karakterlik alintiya mahkum kalmasin.
 * `id123` artik `id1234` ile eslesmez (rakam siniri).
 */
export function extractAppStoreRefs(text: string, max = 10): string[] {
  if (!text) return [];
  const out = new Set<string>();
  for (const m of text.matchAll(/(?:apps|itunes)\.apple\.com\/[^\s)"'<>]*?\bid(\d{6,12})(?!\d)/gi)) out.add(`ios:${m[1]}`);
  for (const m of text.matchAll(/apps\.apple\.com\/(?:[a-z]{2}\/)?app\/([a-z0-9-]{3,80})\//gi)) out.add(`iosslug:${m[1].toLowerCase()}`);
  for (const m of text.matchAll(/play\.google\.com\/store\/apps\/details\?(?:[^\s)"'<>]*&)?id=([a-z0-9_.]{3,150})/gi)) out.add(`android:${m[1].toLowerCase()}`);
  return [...out].slice(0, max);
}

