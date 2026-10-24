import { registrableDomain } from './host-match.js';

/**
 * Alintilanan kaynak alan adinin TURU — saf, tek yer (GEO Faz 3).
 *
 * NEDEN: "Alintilanan dis kaynaklar" raporu AI cevaplarinin kaynak gosterdigi
 * alan adlarini tur etiketiyle gruplar (forum, inceleme sitesi, haber ...) ve
 * her ture farkli bir "orada nasil yer alirsin" eylemi onerir. Listeler
 * yalniz burada tutulur; panel, MCP araci ve testler ayni kurali okur.
 *
 * ETIKET BIR SEZGISELDIR: liste kurate; listede olmayan site `other` olur ve
 * bir haber sitesi ya da forum da olabilir. Panel bunu acikca soyler.
 *
 * SIRA (ilk eslesen kazanir):
 *   1) own        — sitenin kendi host'u ve alt alanlari (host-match.urlHostMatches kurali)
 *   2) competitor — Brain'deki rakiplerin host'u ve alt alanlari. Rakip adresi bilinen
 *      bir PLATFORMDAYSA (trendyol.com/magaza/..., linkedin.com/company/...,
 *      apps.apple.com/...) yalniz o host + yol oneki rakip sayilir; platformun tamami degil
 *      (bkz. buildCompetitorMatchers).
 *   3) host duzeyi listeler (apps.apple.com, play.google.com, developers.google.com ...):
 *      ayni kayit edilebilir alan (google.com) altinda farkli turler olabildigi icin
 *   4) alt alan oneki sezgisi: docs./developer(s). → docs; forum./community. → forum
 *      (listedeki bir haber sitesinin forum.* alt alani forumdur)
 *   5) kayit edilebilir alan listeleri (reddit.com, g2.com, wikipedia.org ...)
 *   6) other
 *
 * Kayit edilebilir alan: host-match.registrableDomain — .com.tr gibi iki
 * etiketli sonekleri bilir (chip.com.tr, hurriyet.com.tr).
 */

export const SOURCE_TYPES = [
  'own', 'competitor', 'forum', 'review', 'social', 'video', 'encyclopedia', 'news', 'marketplace', 'docs', 'other',
] as const;
export type SourceType = (typeof SOURCE_TYPES)[number];

/** Forum / soru-cevap / sozluk siteleri — kayit edilebilir alan */
const FORUM_DOMAINS = [
  'reddit.com', 'quora.com', 'stackexchange.com', 'stackoverflow.com', 'superuser.com', 'serverfault.com',
  'askubuntu.com', 'mathoverflow.net',
  // Turkiye (donanimhaber.com ve technopat.net kokte haber sitesi; forum.* alt alani forum — onek sezgisi)
  'eksisozluk.com', 'r10.net', 'kizlarsoruyor.com', 'uludagsozluk.com', 'frmtr.com',
];

/** Kullanici yorumu / yazilim karsilastirma / sikayet siteleri */
const REVIEW_DOMAINS = [
  'g2.com', 'capterra.com', 'trustpilot.com', 'getapp.com', 'softwareadvice.com', 'producthunt.com',
  'alternativeto.net', 'toolradar.com', 'trustradius.com', 'saasworthy.com', 'sitejabber.com', 'yelp.com',
  'tripadvisor.com', 'tripadvisor.com.tr', 'slant.co',
  // Turkiye
  'sikayetvar.com',
];

const VIDEO_DOMAINS = ['youtube.com', 'youtu.be', 'vimeo.com', 'dailymotion.com'];

/** Sosyal aglar — markanin kendi hesabi uzerinden yer alinir */
const SOCIAL_DOMAINS = [
  'linkedin.com', 'x.com', 'twitter.com', 'facebook.com', 'instagram.com', 'tiktok.com', 'threads.net', 'pinterest.com',
];

const ENCYCLOPEDIA_DOMAINS = ['wikipedia.org', 'wikiwand.com', 'britannica.com', 'wikimedia.org'];

/**
 * Haber yayinlari — KURATE (yalniz bilinen yayin kuruluslari). Toplayici ve
 * icerik ciftlikleri bilerek yok: "basin bulteni gonder" eylemi yalniz gercek
 * bir yayina onerilmeli.
 */
const NEWS_DOMAINS = [
  // Turkiye — teknoloji / is
  'webrazzi.com', 'webtekno.com', 'shiftdelete.net', 'chip.com.tr', 'log.com.tr', 'egirisim.com',
  'donanimarsivi.com', 'bloomberght.com', 'dunya.com', 'ekonomim.com', 'donanimhaber.com', 'technopat.net',
  // Turkiye — genel
  'hurriyet.com.tr', 'milliyet.com.tr', 'sabah.com.tr', 'sozcu.com.tr', 'ntv.com.tr', 'cnnturk.com',
  'haberturk.com', 'aa.com.tr', 'trthaber.com', 'cumhuriyet.com.tr', 't24.com.tr', 'posta.com.tr',
  'star.com.tr', 'yenisafak.com', 'dha.com.tr', 'iha.com.tr',
  // Global
  'bbc.com', 'bbc.co.uk', 'reuters.com', 'apnews.com', 'techcrunch.com', 'theverge.com', 'wired.com',
  'engadget.com', 'arstechnica.com', 'venturebeat.com', 'zdnet.com', 'cnet.com', 'forbes.com',
  'bloomberg.com', 'cnbc.com', 'wsj.com', 'ft.com', 'nytimes.com', 'theguardian.com',
  'businessinsider.com', 'washingtonpost.com', 'economist.com',
];

/** Uygulama magazalari ve pazar yerleri (kayit edilebilir alan) */
const MARKETPLACE_DOMAINS = [
  'trendyol.com', 'hepsiburada.com', 'n11.com', 'ciceksepeti.com', 'amazon.com', 'amazon.com.tr',
  'amazon.de', 'amazon.co.uk', 'etsy.com', 'ebay.com', 'aliexpress.com',
];

/**
 * HOST duzeyi siniflar — ayni kayit edilebilir alan altinda farkli turler
 * (play.google.com magaza, developers.google.com belge). Rapor bu host'lari
 * ayri satir olarak gruplar (bkz. sourceKeyHost).
 */
const HOST_TYPES: Readonly<Record<string, SourceType>> = {
  'apps.apple.com': 'marketplace',
  'itunes.apple.com': 'marketplace',
  'play.google.com': 'marketplace',
  'chromewebstore.google.com': 'marketplace',
  'marketplace.visualstudio.com': 'marketplace',
  'developers.google.com': 'docs',
  'support.google.com': 'docs',
  'developer.apple.com': 'docs',
  'support.apple.com': 'docs',
  'platform.openai.com': 'docs',
  'help.openai.com': 'docs',
  'learn.microsoft.com': 'docs',
  'developer.mozilla.org': 'docs',
  'news.ycombinator.com': 'forum',
  // docs. oneki sezgisinin istisnasi: Google Dokumanlar belge paylasimidir, teknik belge degil
  'docs.google.com': 'other',
};

/**
 * Bu kayit edilebilir alanlarin alt alanlari AYRI satir olarak gruplanir
 * (apple.com altinda magaza, belge ve kurumsal site ayni sey degil).
 */
const PLATFORM_DOMAINS = new Set(['google.com', 'apple.com', 'microsoft.com', 'openai.com', 'mozilla.org', 'visualstudio.com']);

/**
 * Barindirma / blog platformlari: her alt alan BASKA bir yayinci
 * (ali.github.io ile veli.github.io ayni site degil). Alt alanlar tam host'la
 * ayri satir olur; tur bilinmedigi icin `other`.
 */
const HOSTING_DOMAINS = new Set([
  'github.io', 'blogspot.com', 'wordpress.com', 'substack.com', 'medium.com', 'netlify.app', 'vercel.app', 'pages.dev',
]);

function index(list: readonly string[], type: SourceType, into: Map<string, SourceType>) {
  for (const d of list) into.set(d, type);
}

const DOMAIN_TYPES = new Map<string, SourceType>();
index(FORUM_DOMAINS, 'forum', DOMAIN_TYPES);
index(REVIEW_DOMAINS, 'review', DOMAIN_TYPES);
index(VIDEO_DOMAINS, 'video', DOMAIN_TYPES);
index(SOCIAL_DOMAINS, 'social', DOMAIN_TYPES);
index(ENCYCLOPEDIA_DOMAINS, 'encyclopedia', DOMAIN_TYPES);
index(NEWS_DOMAINS, 'news', DOMAIN_TYPES);
index(MARKETPLACE_DOMAINS, 'marketplace', DOMAIN_TYPES);

/** Testler ve dokumantasyon icin listelerin salt-okunur gorunumu */
export const SOURCE_TYPE_LISTS: Readonly<Record<Exclude<SourceType, 'own' | 'competitor' | 'other'>, readonly string[]>> = {
  forum: FORUM_DOMAINS,
  review: REVIEW_DOMAINS,
  social: SOCIAL_DOMAINS,
  video: VIDEO_DOMAINS,
  encyclopedia: ENCYCLOPEDIA_DOMAINS,
  news: NEWS_DOMAINS,
  marketplace: MARKETPLACE_DOMAINS,
  docs: Object.keys(HOST_TYPES).filter((h) => HOST_TYPES[h] === 'docs'),
};

/** "https://WWW.Ornek.com/x" | "ornek.com" → "ornek.com"; cozulemezse null */
export function hostOf(urlOrHost: string | null | undefined): string | null {
  if (typeof urlOrHost !== 'string' || !urlOrHost.trim()) return null;
  const s = urlOrHost.trim();
  let host: string;
  try {
    host = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(s) ? s : `https://${s}`).hostname;
  } catch {
    return null;
  }
  host = host.toLowerCase().replace(/\.$/, '').replace(/^www\./, '');
  return host.includes('.') ? host : null;
}

/** host bu alan adinin kendisi ya da alt alani mi (etiket sinirli) */
export function hostWithin(host: string, domain: string): boolean {
  return host === domain || host.endsWith(`.${domain}`);
}

/**
 * Rakip eslestiricisi. pathPrefix null → host ve alt alanlari; dolu → yalniz
 * bu host (alt alan degil) ve yol oneki (segment sinirli).
 */
export interface CompetitorMatcher {
  host: string;
  pathPrefix: string | null;
  /** Rapor satiri anahtari: "rakip.com" ya da "trendyol.com/magaza/rakip-m-1" */
  key: string;
}

export interface SourceTypeContext {
  /** Sitenin host'u (www'siz) — alt alanlari da "own" sayilir */
  ownHost: string | null;
  /** buildCompetitorMatchers ciktisi */
  competitors: readonly CompetitorMatcher[];
}

/**
 * Host bilinen bir platform mu (rakip adresi platformdaysa platformun tamami
 * rakip sayilmamali): host duzeyi siniflar, tur listeleri, platform alanlari
 * ve barindirma platformunun KOKU (medium.com/@rakip). Barindirma alt alani
 * (rakip.github.io) ayri yayinci oldugu icin platform sayilmaz.
 */
export function isPlatformHost(host: string): boolean {
  const registrable = registrableDomain(host);
  if (Object.keys(HOST_TYPES).some((h) => hostWithin(host, h))) return true;
  if (DOMAIN_TYPES.has(registrable) || PLATFORM_DOMAINS.has(registrable)) return true;
  return HOSTING_DOMAINS.has(registrable) && host === registrable;
}

/** Yol karsilastirmasi icin: kucuk harf, sondaki egik cizgiler atilir ("/" → "") */
function normPath(p: string): string {
  return p.toLowerCase().replace(/\/+$/, '');
}

/**
 * Rakip adreslerinden eslestiriciler. Platformdaki rakip yol onekiyle eslenir;
 * yolsuz platform adresi (sadece "trendyol.com") yok sayilir — tum platformu
 * rakip yapardi.
 */
export function buildCompetitorMatchers(urls: readonly string[]): CompetitorMatcher[] {
  const out = new Map<string, CompetitorMatcher>();
  for (const raw of urls) {
    const host = hostOf(raw);
    if (!host) continue;
    if (!isPlatformHost(host)) {
      out.set(host, { host, pathPrefix: null, key: host });
      continue;
    }
    let path = '';
    try {
      path = normPath(new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(raw.trim()) ? raw.trim() : `https://${raw.trim()}`).pathname);
    } catch {
      continue;
    }
    if (!path) continue;
    const key = `${host}${path}`;
    out.set(key, { host, pathPrefix: path, key });
  }
  return [...out.values()];
}

function pathOf(urlOrHost: string | null | undefined): string {
  if (typeof urlOrHost !== 'string') return '';
  try {
    return normPath(new URL(urlOrHost.trim()).pathname);
  } catch {
    return '';
  }
}

function competitorMatch(host: string, path: string, c: CompetitorMatcher): boolean {
  if (c.pathPrefix === null) return hostWithin(host, c.host);
  return host === c.host && (path === c.pathPrefix || path.startsWith(`${c.pathPrefix}/`));
}

export interface SourceClassification {
  type: SourceType;
  /**
   * Raporun gruplama anahtari: cogunlukla kayit edilebilir alan; kendi site,
   * rakip, host duzeyi siniflar ve platform alt alanlari icin host.
   */
  key: string;
}

function docsOrForumPrefix(host: string, registrable: string): SourceType | null {
  if (host === registrable) return null;
  const first = host.slice(0, host.length - registrable.length - 1).split('.').pop() ?? '';
  if (/^(docs|developers?|dev-docs|devdocs)$/.test(first)) return 'docs';
  if (/^(forum|forums|community|topluluk)$/.test(first)) return 'forum';
  return null;
}

/**
 * Kaynak URL'inin (ya da host'unun) turu ve gruplama anahtari.
 * `fallbackDomain`: URL cozulemezse probe'daki domain alani.
 */
export function classifySource(
  urlOrHost: string | null | undefined,
  ctx: SourceTypeContext,
  fallbackDomain?: string | null,
): SourceClassification | null {
  const host = hostOf(urlOrHost) ?? hostOf(fallbackDomain);
  if (!host) return null;
  const registrable = registrableDomain(host);

  if (ctx.ownHost && hostWithin(host, ctx.ownHost)) return { type: 'own', key: ctx.ownHost };
  const path = pathOf(urlOrHost);
  for (const c of ctx.competitors) {
    if (competitorMatch(host, path, c)) return { type: 'competitor', key: c.key };
  }

  for (const [h, type] of Object.entries(HOST_TYPES)) {
    if (hostWithin(host, h)) return { type, key: h };
  }

  // Barindirma platformu alt alani: ayri yayinci, tam host'la ayri satir
  if (HOSTING_DOMAINS.has(registrable) && host !== registrable) return { type: 'other', key: host };

  const byDomain = DOMAIN_TYPES.get(registrable);
  const prefixType = docsOrForumPrefix(host, registrable);
  // forum.donanimhaber.com zaten forum olan alanin parcasi — ayni satirda kalir
  if (prefixType) return { type: prefixType, key: prefixType === byDomain ? registrable : host };

  if (byDomain) return { type: byDomain, key: registrable };

  // Platform alanlarinin bilinmeyen alt alani (orn. blog.google.com) ayri satir
  return { type: 'other', key: PLATFORM_DOMAINS.has(registrable) ? host : registrable };
}
