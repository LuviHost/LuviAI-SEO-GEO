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
  'notion.site',
]);

/**
 * Profil / kod / portfolyo platformlari — kaynak turu `other` ama bir rakibin
 * buradaki adresi (github.com/rakip) platformun TAMAMINI rakip yapmamali.
 */
const PROFILE_DOMAINS = new Set([
  'github.com', 'gitlab.com', 'bitbucket.org', 'behance.net', 'dribbble.com', 'notion.so', 'linktr.ee', 'about.me',
  'crunchbase.com', 'huggingface.co', 'npmjs.com', 'pypi.org',
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
 * bu (kanonik) host ve yol oneki (segment sinirli). param dolu → kimlik sorgu
 * dizgesinde (Play Store ?id=, facebook profile.php?id=, YouTube watch?v=):
 * o parametre de esit olmali.
 */
export interface CompetitorMatcher {
  host: string;
  pathPrefix: string | null;
  param?: { name: string; value: string };
  /** Rapor satiri anahtari: "rakip.com", "trendyol.com/magaza/rakip-m-1", "play.google.com/store/apps/details?id=com.rakip" */
  key: string;
}

export interface SourceTypeContext {
  /** Sitenin host'u (www'siz) — alt alanlari da "own" sayilir */
  ownHost: string | null;
  /** buildCompetitorMatchers ciktisi */
  competitors: readonly CompetitorMatcher[];
}

const isPlatformDomain = (registrable: string) =>
  DOMAIN_TYPES.has(registrable) || PLATFORM_DOMAINS.has(registrable) || PROFILE_DOMAINS.has(registrable);

/**
 * Host bilinen bir platform mu (rakip adresi platformdaysa platformun tamami
 * rakip sayilmamali): host duzeyi siniflar, tur listeleri, platform ve profil
 * alanlari, barindirma platformunun KOKU (medium.com/@rakip). Barindirma alt
 * alani (rakip.github.io) ayri yayinci oldugu icin platform sayilmaz.
 */
export function isPlatformHost(host: string): boolean {
  const registrable = registrableDomain(host);
  if (Object.keys(HOST_TYPES).some((h) => hostWithin(host, h))) return true;
  if (isPlatformDomain(registrable)) return true;
  return HOSTING_DOMAINS.has(registrable) && host === registrable;
}

/** Ayni platformun takma alt alanlari: www, m, mobile ve dil/ulke onekleri (tr, tr-tr, en-gb) */
const ALIAS_LABEL = /^(www|m|mobile|[a-z]{2}(-[a-z]{2})?)$/;

/**
 * Platform host'unun kanonik bicimi: tr.linkedin.com, m.youtube.com,
 * mobile.twitter.com → kayit edilebilir alan. Host duzeyi siniflar
 * (apps.apple.com) kendi host'unda kalir; anlamli alt alan (blog.google.com) korunur.
 */
export function canonicalPlatformHost(host: string): string {
  const fixed = Object.keys(HOST_TYPES).find((h) => hostWithin(host, h));
  if (fixed) return fixed;
  const registrable = registrableDomain(host);
  if (!isPlatformDomain(registrable) || host === registrable) return host;
  const sub = host.slice(0, host.length - registrable.length - 1).split('.');
  return sub.every((l) => ALIAS_LABEL.test(l)) ? registrable : host;
}

/** Yol karsilastirmasi icin: kucuk harf, sondaki egik cizgiler atilir ("/" → "") */
function normPath(p: string): string {
  return p.toLowerCase().replace(/\/+$/, '');
}

/**
 * Kimligi sorgu dizgesinde tasiyan platform yollari. required: parametre
 * yoksa adres kimliksizdir (rakip eslestiricisi kurulmaz).
 */
function identityParam(host: string, path: string): string | null {
  if (host === 'play.google.com') return 'id';
  if (host === 'facebook.com' && path === '/profile.php') return 'id';
  if (host === 'youtube.com' && path === '/watch') return 'v';
  if (host === 'youtube.com' && path === '/playlist') return 'list';
  return null;
}

interface PlatformIdentity { host: string; path: string; param?: { name: string; value: string }; identifiable: boolean }

function parseUrl(raw: string): URL | null {
  const t = raw.trim();
  try {
    return new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(t) ? t : `https://${t}`);
  } catch {
    return null;
  }
}

/**
 * Platform adresinin kimligi: kanonik host + normalize yol (+ kimlik
 * parametresi). App Store'da magaza ulkesi onemsiz: /tr/app/x/id123 ≡
 * /us/app/y/id123 → "/id123".
 */
function platformIdentity(u: URL): PlatformIdentity {
  const host = canonicalPlatformHost(u.hostname.toLowerCase().replace(/\.$/, '').replace(/^www\./, ''));
  let path = normPath(u.pathname);
  if (host === 'apps.apple.com' || host === 'itunes.apple.com') {
    const m = path.match(/\/id(\d{5,})(?:\/|$)/);
    path = m ? `/id${m[1]}` : '';
  }
  const name = identityParam(host, path);
  if (name) {
    const value = (u.searchParams.get(name) ?? '').trim().toLowerCase();
    return value ? { host, path, param: { name, value }, identifiable: true } : { host, path, identifiable: false };
  }
  return { host, path, identifiable: path !== '' };
}

/**
 * Rakip adreslerinden eslestiriciler. Platformdaki rakip kimligiyle (yol
 * oneki, gerekiyorsa kimlik parametresi) eslenir; kimliksiz platform adresi
 * (sadece "trendyol.com", "play.google.com/store/apps") yok sayilir — tum
 * platformu rakip yapardi.
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
    const u = parseUrl(raw);
    if (!u) continue;
    const id = platformIdentity(u);
    if (!id.identifiable) continue;
    const key = `${id.host}${id.path}${id.param ? `?${id.param.name}=${id.param.value}` : ''}`;
    out.set(key, { host: id.host, pathPrefix: id.path, ...(id.param ? { param: id.param } : {}), key });
  }
  return [...out.values()];
}

function competitorMatch(host: string, url: URL | null, c: CompetitorMatcher): boolean {
  if (c.pathPrefix === null) return hostWithin(host, c.host);
  if (!url) return false;
  const id = platformIdentity(url);
  if (id.host !== c.host) return false;
  if (c.param) return id.path === c.pathPrefix && id.param?.value === c.param.value;
  return id.path === c.pathPrefix || id.path.startsWith(`${c.pathPrefix}/`);
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
  const url = typeof urlOrHost === 'string' && /^https?:\/\//i.test(urlOrHost.trim()) ? parseUrl(urlOrHost) : null;
  for (const c of ctx.competitors) {
    if (competitorMatch(host, url, c)) return { type: 'competitor', key: c.key };
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
