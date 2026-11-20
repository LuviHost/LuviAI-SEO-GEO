import * as cheerio from 'cheerio';
import { agentToken, parseRobots, robotsAllows } from './robots-merge.js';

/**
 * MICROSOFT AI TERCIHLERI (Bing / Copilot) — SAF degerlendirme, I/O yok.
 *
 * Kaynak: Microsoft Bing, "Your content, your choice: clearer preferences for
 * training and grounding" (30.10.2026, blogs.bing.com/search). Ozet:
 *  - Iki bagimsiz tercih: AI Training (model egitimi) ve AI Grounding (AI
 *    cevabini kurarken icerigi kaynak olarak kullanma). Ikisi de varsayilan
 *    Allow; Bing arama sonuclarina uygunlugu DEGISTIRMEZ.
 *  - Egitim: robots.txt'te `User-Agent: __usage_ai-training` grubu (IETF AIPREF)
 *    ya da sayfa duzeyinde `<meta name="Bingbot" content="ai-training:disallow">`
 *    / `X-Robots-Tag: Bingbot: ai-training:disallow`.
 *  - Grounding: YALNIZ sayfa duzeyinde (robots.txt'te site geneli grounding
 *    tercihi yok) — `ai-grounding:disallow` ya da `ai-grounding:disallowextended`
 *    (yalniz Microsoft'un kendi urunleri; Web IQ / Foundry API gibi ucuncu
 *    taraf grounding haric). Microsoft: ikisi de AI deneyimlerinde gorunurlugu
 *    "onemli olcude azaltir".
 *  - Eski NoArchive / NoCache: 1 Subat 2027'de yeni tercihler devreye girer;
 *    1 Mart 2027'den sonra eski etiketler egitim / grounding tercihi olarak
 *    OKUNMAZ. Kisitlamayi surdurmek isteyen: yeni tercihi sayfalara yazar +
 *    15 Aralik 2026'dan itibaren Bing Webmaster Tools'ta gecici grounding
 *    tercihi kaydeder. Kaydetmezse sayfalar yeniden taranana kadar grounding'e
 *    ACIK sayilir.
 *
 * Yalniz ana sayfa olculur (taramanin zaten cektigi govde + basliklar); sayfa
 * duzeyindeki tercih baska sayfalarda farkli olabilir — metin bunu soyler.
 */

export type GroundingPref = 'disallow' | 'disallowextended' | 'allow';

export interface MicrosoftAiPreferences {
  /** Ana sayfada Bing'e de uygulanan NoArchive / NoCache — nerede bulundugu ("meta robots: noarchive") */
  legacy: string[];
  /** Sayfa duzeyi grounding tercihi (en kisitlayicisi); yoksa null = varsayilan Allow */
  grounding: { value: GroundingPref; source: string } | null;
  /** Sayfa duzeyi egitim tercihi; yoksa null */
  pageTraining: { value: 'disallow' | 'allow'; source: string } | null;
  /** robots.txt `__usage_ai-training` grubu: site geneli yasak, yol bazli yasak ya da yok */
  robotsTraining: 'site' | 'paths' | null;
}

/** Bing'e uygulanan meta adlari (robots = tum botlar) */
const BING_META_NAMES = new Set(['robots', 'bingbot', 'msnbot']);
/** Iki noktali deger tasiyan yonergeler — X-Robots-Tag'de bot oneki sanilmasin */
const VALUED_DIRECTIVES = new Set([
  'ai-training', 'ai-grounding', 'max-snippet', 'max-image-preview', 'max-video-preview', 'unavailable_after',
]);

const GROUNDING_RANK: Record<GroundingPref, number> = { disallow: 2, disallowextended: 1, allow: 0 };

interface Directive { token: string; source: string }

function splitTokens(content: string): string[] {
  return content.split(',').map((t) => t.trim().toLowerCase()).filter(Boolean);
}

/** `<meta name="robots|bingbot|msnbot" content="...">` yonergeleri */
function metaDirectives(html: string): Directive[] {
  const $ = cheerio.load(html);
  const out: Directive[] = [];
  $('meta[name][content]').each((_, el) => {
    const name = String($(el).attr('name') ?? '').trim().toLowerCase();
    if (!BING_META_NAMES.has(name)) return;
    for (const token of splitTokens(String($(el).attr('content') ?? ''))) {
      out.push({ token, source: `meta ${name}` });
    }
  });
  return out;
}

/**
 * X-Robots-Tag: "noarchive", "bingbot: noindex, nofollow", "googlebot: noarchive".
 * Bot oneki kendisinden sonraki yonergelere, bir sonraki onege kadar uygulanir
 * (Google / Bing belgelerindeki bicim). Yalniz oneksiz, bingbot ve msnbot sayilir.
 */
function headerDirectives(headers: Record<string, string>): Directive[] {
  const raw = Object.entries(headers).filter(([k]) => k.toLowerCase() === 'x-robots-tag').map(([, v]) => v).join(', ');
  if (!raw.trim()) return [];
  const out: Directive[] = [];
  let agent: string | null = null;
  for (const part of raw.split(',')) {
    let token = part.trim();
    if (!token) continue;
    const m = /^([a-z0-9_-]+)\s*:\s*(.*)$/i.exec(token);
    if (m && !VALUED_DIRECTIVES.has(m[1].toLowerCase())) {
      agent = m[1].toLowerCase();
      token = m[2].trim();
      if (!token) continue;
    }
    if (agent && agent !== 'bingbot' && agent !== 'msnbot') continue;
    out.push({ token: token.toLowerCase(), source: `X-Robots-Tag${agent ? ` (${agent})` : ''}` });
  }
  return out;
}

function robotsTrainingOf(robotsText: string | null): MicrosoftAiPreferences['robotsTraining'] {
  if (!robotsText) return null;
  const parsed = parseRobots(robotsText);
  // Yalniz acikca yazilmis kullanim grubu: "User-agent: *" bir egitim tercihi degil
  const groups = parsed.groups.filter((g) => g.agents.some((a) => agentToken(a) === '__usage_ai-training'));
  if (groups.length === 0) return null;
  if (!robotsAllows(parsed, '__usage_ai-training', '/')) return 'site';
  const anyDisallow = groups.some((g) => g.members.some((m) => m.key === 'disallow' && m.value.trim() !== ''));
  return anyDisallow ? 'paths' : null;
}

export function assessMicrosoftAiPreferences(input: {
  html: string | null;
  headers: Record<string, string>;
  robotsText: string | null;
}): MicrosoftAiPreferences {
  const directives = [...(input.html ? metaDirectives(input.html) : []), ...headerDirectives(input.headers)];
  const legacy: string[] = [];
  let grounding: MicrosoftAiPreferences['grounding'] = null;
  let pageTraining: MicrosoftAiPreferences['pageTraining'] = null;

  for (const d of directives) {
    if (d.token === 'noarchive' || d.token === 'nocache') {
      const label = `${d.source}: ${d.token}`;
      if (!legacy.includes(label)) legacy.push(label);
      continue;
    }
    const g = /^ai-grounding\s*:\s*(disallowextended|disallow|allow)$/.exec(d.token);
    if (g) {
      const value = g[1] as GroundingPref;
      if (!grounding || GROUNDING_RANK[value] > GROUNDING_RANK[grounding.value]) grounding = { value, source: d.source };
      continue;
    }
    const t = /^ai-training\s*:\s*(disallow|allow)$/.exec(d.token);
    if (t && (!pageTraining || t[1] === 'disallow')) pageTraining = { value: t[1] as 'disallow' | 'allow', source: d.source };
  }

  return { legacy, grounding, pageTraining, robotsTraining: robotsTrainingOf(input.robotsText) };
}

/** Yeni (Ekim 2026) tercihlerden biri yayinda mi — varsa Microsoft eski etiketi yok sayar */
export function hasNewMicrosoftPreference(p: MicrosoftAiPreferences): boolean {
  return !!p.grounding || !!p.pageTraining || !!p.robotsTraining;
}

/**
 * Uyari gerektiren durum: grounding kapali (AI gorunurlugu duser) ya da yeni
 * tercih yazilmadan eski NoArchive / NoCache duruyor (Mart 2027'de anlamini yitirir).
 */
export function microsoftPrefsNeedAttention(p: MicrosoftAiPreferences): boolean {
  const groundingOff = p.grounding?.value === 'disallow' || p.grounding?.value === 'disallowextended';
  return groundingOff || (p.legacy.length > 0 && !hasNewMicrosoftPreference(p));
}
