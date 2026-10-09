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
 */
export const CITATION_MATCH_VERSION = 2;

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
    let path = (m[1] || '/').replace(/[.,;:)\]]+$/, '').split('#')[0].split('?')[0] || '/';
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

