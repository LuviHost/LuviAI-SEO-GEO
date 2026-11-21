/**
 * GOOGLE AI CEVAPLARINA UYGUNLUK — SAF degerlendirme, I/O yok.
 *
 * Bir sayfanin AI Bakisi (AI Overviews) ve AI Modu'nda kaynak gosterilebilmesi
 * icin Google'in tek teknik sarti: sayfa dizinde olmali ve arama sonucunda
 * snippet ile gosterilebilir olmali; ek bir teknik gereklilik yok
 * (developers.google.com/search/docs/appearance/ai-features).
 *
 * Robots meta tag belgesi (developers.google.com/search/docs/crawling-indexing/robots-meta-tag):
 *  - nosnippet: tum arama bicimlerinde (web, Gorseller, Discover, AI Bakisi,
 *    AI Modu) snippet gosterilmez ve icerik AI Bakisi / AI Modu'na dogrudan
 *    girdi olarak KULLANILMAZ.
 *  - max-snippet:0 = nosnippet; max-snippet:N, AI Bakisi / AI Modu'na girdi
 *    olarak kullanilabilecek metni de N karakterle sinirlar; -1 = sinir yok.
 *  - noindex: sayfa arama sonuclarinda gosterilmez. none = noindex, nofollow.
 *  - Meta adlari: "robots" tum tarayicilar, "googlebot" Google; digerlerini
 *    Google yok sayar. X-Robots-Tag'de onek yoksa kural tum tarayicilara,
 *    "googlebot:" onekiyle Google'a uygulanir. Celisen kurallarda daha
 *    kisitlayici olan gecerlidir.
 *
 * Google-Extended BU KONTROLDE YOK: Google'a gore Arama ozelliklerini (AI
 * Bakisi dahil) degil, Google'in diger sistemlerindeki egitim / grounding'i
 * yonetir. Bing / Copilot etiketleri (NoArchive, NoCache, ai-grounding) ayri
 * bir konudur ve burada degerlendirilmez.
 */

/** Taramanin sayfa basina sakladigi ham yonergeler */
export interface PageRobotsSignals {
  /** <meta name="robots|googlebot" content="..."> — ad kucuk harf, icerik oldugu gibi */
  metas: Array<{ name: string; content: string }>;
  /** X-Robots-Tag basligi (tekrar edenler ', ' ile birlesik); yoksa null */
  header: string | null;
}

export interface GoogleDirectives {
  noindex: boolean;
  /** nosnippet ya da max-snippet:0 */
  nosnippet: boolean;
  /** Pozitif max-snippet siniri (karakter); sinir yoksa null */
  maxSnippet: number | null;
  /** Kisitlayici yonergenin bulundugu yerler ("meta robots: noindex") */
  sources: string[];
}

/** Google'in okudugu meta adlari */
export const GOOGLE_META_NAMES: ReadonlySet<string> = new Set(['robots', 'googlebot']);

/** Iki noktali deger tasiyan yonergeler — X-Robots-Tag'de bot oneki sanilmasin */
const VALUED_DIRECTIVES = new Set([
  'max-snippet', 'max-image-preview', 'max-video-preview', 'unavailable_after', 'ai-training', 'ai-grounding',
]);

interface Token { token: string; source: string }

function splitTokens(content: string): string[] {
  return content.split(',').map((t) => t.trim().toLowerCase()).filter(Boolean);
}

function metaTokens(metas: PageRobotsSignals['metas']): Token[] {
  const out: Token[] = [];
  for (const m of metas) {
    const name = m.name.trim().toLowerCase();
    if (!GOOGLE_META_NAMES.has(name)) continue;
    for (const token of splitTokens(m.content)) out.push({ token, source: `meta ${name}` });
  }
  return out;
}

/**
 * "noindex", "googlebot: nosnippet", "bingbot: noindex, nofollow" — bot oneki
 * kendisinden sonraki yonergelere bir sonraki onege kadar uygulanir. Yalniz
 * oneksiz ve googlebot onekli yonergeler Google'a uygulanir.
 */
function headerTokens(header: string | null): Token[] {
  if (!header || !header.trim()) return [];
  const out: Token[] = [];
  let agent: string | null = null;
  for (const part of header.split(',')) {
    let token = part.trim();
    if (!token) continue;
    const m = /^([a-z0-9_.-]+)\s*:\s*(.*)$/i.exec(token);
    if (m && !VALUED_DIRECTIVES.has(m[1].toLowerCase())) {
      agent = m[1].toLowerCase();
      token = m[2].trim();
      if (!token) continue;
    }
    if (agent && agent !== 'googlebot') continue;
    out.push({ token: token.toLowerCase(), source: `X-Robots-Tag${agent ? ` (${agent})` : ''}` });
  }
  return out;
}

export function googleDirectives(signals: PageRobotsSignals): GoogleDirectives {
  const tokens = [...metaTokens(signals.metas), ...headerTokens(signals.header)];
  let noindex = false;
  let nosnippet = false;
  let maxSnippet: number | null = null;
  const sources: string[] = [];
  const note = (t: Token, label: string) => {
    const s = `${t.source}: ${label}`;
    if (!sources.includes(s)) sources.push(s);
  };
  for (const t of tokens) {
    if (t.token === 'noindex' || t.token === 'none') {
      noindex = true;
      note(t, t.token);
      continue;
    }
    if (t.token === 'nosnippet') {
      nosnippet = true;
      note(t, 'nosnippet');
      continue;
    }
    const ms = /^max-snippet\s*:\s*(-?\d+)$/.exec(t.token);
    if (ms) {
      const n = Number(ms[1]);
      if (n === 0) {
        nosnippet = true;
        note(t, 'max-snippet:0');
      } else if (n > 0) {
        // Celisen sinirlarda daha kisitlayici olan (kucuk) gecerli
        maxSnippet = maxSnippet === null ? n : Math.min(maxSnippet, n);
        note(t, `max-snippet:${n}`);
      }
    }
  }
  return { noindex, nosnippet, maxSnippet: nosnippet ? null : maxSnippet, sources };
}

/** Sayfa AI Bakisi / AI Modu'nda kaynak olamaz mi (noindex ya da snippet yasak) */
export function excludedFromGoogleAi(d: GoogleDirectives): boolean {
  return d.noindex || d.nosnippet;
}
