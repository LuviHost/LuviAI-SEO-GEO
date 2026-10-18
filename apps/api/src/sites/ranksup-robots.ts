/**
 * robots.txt — YALNIZCA "User-agent: RanksUpBot" grubu (saf, ag yok).
 *
 * NEDEN VAR: tarayicimiz robots.txt'i hic okumuyordu. Site sahibi RanksUpBot'u
 * acikca durdurmak istese bile (Disallow: /) tarama devam ediyordu.
 *
 * BILEREK "*" GRUBUNU UYGULAMIYORUZ: siteyi RanksUp'a sahibi kendisi ekledi,
 * denetimi o istedi. "*" grubu genel arama motoru kurallaridir (Disallow:
 * /wp-admin/, /sepet, /arama gibi); bunlarin karsiligi zaten dislanan yol
 * mantigimizda var (site-crawler isExcludedPath: admin, api, giris, panel...).
 * Site sahibi bizi ozel olarak durdurmak isterse "User-agent: RanksUpBot"
 * grubu yazar — o gruba eksiksiz uyariz.
 *
 * Kurallar RFC 9309 (https://www.rfc-editor.org/rfc/rfc9309.html) ve Google
 * robots.txt belgesi (https://developers.google.com/search/docs/crawling-indexing/robots/robots_txt):
 *  - user-agent degeri buyuk/kucuk harf duyarsiz; yalnizca urun adi eslesir
 *    ("RanksUpBot/1.0" ve "RanksUpBot*" = "RanksUpBot", Google belgesi)
 *  - ayni ajana uyan birden fazla grup TEK grupta birlesir (RFC 2.2.1)
 *  - en uzun eslesen kural kazanir; esitlikte Allow (RFC 2.2.2)
 *  - "*" = 0+ karakter, sondaki "$" = adresin sonu (RFC 2.2.3)
 *  - /robots.txt her zaman serbest (RFC 2.2.2)
 *  - en az 500 KiB ayristirilir (RFC 2.5)
 */

export const RANKSUP_BOT_TOKEN = 'ranksupbot';

/** RFC 9309 2.5: ayristirma siniri en az 500 KiB olmali */
export const ROBOTS_PARSE_LIMIT = 512 * 1024;

export interface RobotsRule {
  allow: boolean;
  /** Normalize edilmis desen (yuzde kodlamasi tekdüze) */
  pattern: string;
  /** Ozgulluk — desen uzunlugu (RFC: en cok oktet) */
  length: number;
}

export interface RanksUpRobotsPolicy {
  rules: RobotsRule[];
}

/** RFC 3986 "unreserved" — yuzde kodluysa cozulur, digerleri kodlu kalir */
const UNRESERVED = /[A-Za-z0-9\-._~]/;

/**
 * Karsilastirma oncesi tekdüze bicim: ASCII disi karakterler yuzde kodlanir,
 * kodlanmis "unreserved" karakterler cozulur, kalan kodlar buyuk harfe cekilir.
 * Boylece "/foo/bar/%62%61%7A" ile "/foo/bar/baz" eslesir (RFC 9309 Sekil 4).
 */
export function normalizeRobotsPath(s: string): string {
  let out = '';
  for (const ch of s) {
    const code = ch.codePointAt(0)!;
    if (code > 0x7e || code < 0x21) {
      // Yarim vekil cifti (bozuk UTF-16) encodeURIComponent'i patlatir — atlanir
      try { out += encodeURIComponent(ch); } catch { /* gecersiz karakter */ }
    } else {
      out += ch;
    }
  }
  return out.replace(/%([0-9a-fA-F]{2})/g, (m, hex: string) => {
    const c = String.fromCharCode(parseInt(hex, 16));
    return UNRESERVED.test(c) ? c : `%${hex.toUpperCase()}`;
  });
}

/** "RanksUpBot/1.0" → "ranksupbot"; "*" → "" (urun adi degil) */
function agentToken(value: string): string {
  return /^[a-z_-]+/.exec(value.trim().toLowerCase())?.[0] ?? '';
}

/**
 * robots.txt'ten RanksUpBot grubunu cikarir. Acik grup yoksa null — bu
 * durumda hicbir kisit uygulanmaz (yukaridaki "*" gerekcesi).
 */
export function parseRanksUpBotGroup(robotsTxt: string, token: string = RANKSUP_BOT_TOKEN): RanksUpRobotsPolicy | null {
  const rules: RobotsRule[] = [];
  let matched = false;
  let inGroup = false;
  // Grup = ardisik user-agent satirlari + kurallari; kuraldan sonra gelen
  // user-agent yeni grup baslatir. Sitemap gibi grup disi satirlar grubu bitirmez.
  let lastWasAgent = false;

  const text = robotsTxt.slice(0, ROBOTS_PARSE_LIMIT).replace(/^\uFEFF/, '');
  for (const raw of text.split(/\r\n|\r|\n/)) {
    const line = raw.replace(/#.*$/, '').trim();
    if (!line) continue;
    const idx = line.indexOf(':');
    if (idx < 0) continue;
    const key = line.slice(0, idx).trim().toLowerCase();
    const value = line.slice(idx + 1).trim();

    if (key === 'user-agent') {
      if (!lastWasAgent) inGroup = false;
      if (agentToken(value) === token) {
        inGroup = true;
        matched = true;
      }
      lastWasAgent = true;
      continue;
    }
    if (key === 'allow' || key === 'disallow') {
      lastWasAgent = false;
      // Bos deger ("Disallow:") hicbir adresle eslesmez — Google: tamamen serbest
      if (!inGroup || !value) continue;
      // "/" ya da "*" ile baslamayan deger: sahibinin niyeti yol oldugu icin "/" eklenir
      const withSlash = value.startsWith('/') || value.startsWith('*') ? value : `/${value}`;
      const pattern = normalizeRobotsPath(withSlash);
      rules.push({ allow: key === 'allow', pattern, length: pattern.length });
    }
  }
  return matched ? { rules } : null;
}

/**
 * "*" joker + sondaki "$" ile eslesme, desen adresin BASINDAN uyar.
 * Duzenli ifade yerine dogrusal yildiz-geri-donus algoritmasi: robots.txt'i
 * site sahibi yazar; "/*a*a*a*a*b" gibi bir desen regex'te katastrofik geri
 * izlemeye yol acabilir.
 */
export function robotsPatternMatches(pattern: string, path: string): boolean {
  let p = pattern;
  const anchored = p.endsWith('$');
  if (anchored) p = p.slice(0, -1);
  else p += '*';

  let i = 0;
  let j = 0;
  let star = -1;
  let mark = 0;
  while (i < path.length) {
    if (j < p.length && p[j] !== '*' && p[j] === path[i]) {
      i++;
      j++;
    } else if (j < p.length && p[j] === '*') {
      star = j++;
      mark = i;
    } else if (star !== -1) {
      j = star + 1;
      i = ++mark;
    } else {
      return false;
    }
  }
  while (j < p.length && p[j] === '*') j++;
  return j === p.length;
}

/** Bu adresi RanksUpBot isteyebilir mi? policy null → kisit yok. */
export function isAllowedForRanksUpBot(policy: RanksUpRobotsPolicy | null, rawUrl: string): boolean {
  if (!policy || policy.rules.length === 0) return true;
  let u: URL;
  try {
    u = new URL(rawUrl);
  } catch {
    return true;
  }
  if (u.pathname === '/robots.txt') return true;
  const target = normalizeRobotsPath(u.pathname + u.search);

  let best: RobotsRule | null = null;
  for (const r of policy.rules) {
    if (!robotsPatternMatches(r.pattern, target)) continue;
    if (!best || r.length > best.length || (r.length === best.length && r.allow && !best.allow)) best = r;
  }
  return best ? best.allow : true;
}
