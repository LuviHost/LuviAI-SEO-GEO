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
 *   2) competitor — Brain'deki rakiplerin host'u ve alt alanlari
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
  'own', 'competitor', 'forum', 'review', 'video', 'encyclopedia', 'news', 'marketplace', 'docs', 'other',
] as const;
export type SourceType = (typeof SOURCE_TYPES)[number];

/** Forum / soru-cevap / sozluk siteleri — kayit edilebilir alan */
const FORUM_DOMAINS = [
  'reddit.com', 'quora.com', 'stackexchange.com', 'stackoverflow.com', 'superuser.com', 'serverfault.com',
  'askubuntu.com', 'mathoverflow.net', 'ycombinator.com',
  // Turkiye
  'eksisozluk.com', 'donanimhaber.com', 'technopat.net', 'r10.net', 'kizlarsoruyor.com', 'uludagsozluk.com',
  'frmtr.com',
];

/** Kullanici yorumu / yazilim karsilastirma / sikayet siteleri */
const REVIEW_DOMAINS = [
  'g2.com', 'capterra.com', 'trustpilot.com', 'getapp.com', 'softwareadvice.com', 'producthunt.com',
  'alternativeto.net', 'toolradar.com', 'trustradius.com', 'saasworthy.com', 'sitejabber.com', 'yelp.com',
  'tripadvisor.com', 'tripadvisor.com.tr', 'gartner.com', 'slant.co',
  // Turkiye
  'sikayetvar.com', 'capterra.com.tr',
];

const VIDEO_DOMAINS = ['youtube.com', 'youtu.be', 'vimeo.com', 'dailymotion.com', 'tiktok.com'];

const ENCYCLOPEDIA_DOMAINS = ['wikipedia.org', 'wikiwand.com', 'britannica.com', 'wikimedia.org'];

/**
 * Haber yayinlari — KURATE (yalniz bilinen yayin kuruluslari). Toplayici ve
 * icerik ciftlikleri bilerek yok: "basin bulteni gonder" eylemi yalniz gercek
 * bir yayina onerilmeli.
 */
const NEWS_DOMAINS = [
  // Turkiye — teknoloji / is
  'webrazzi.com', 'webtekno.com', 'shiftdelete.net', 'chip.com.tr', 'log.com.tr', 'egirisim.com',
  'donanimarsivi.com', 'bloomberght.com', 'dunya.com', 'ekonomim.com',
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

function index(list: readonly string[], type: SourceType, into: Map<string, SourceType>) {
  for (const d of list) into.set(d, type);
}

const DOMAIN_TYPES = new Map<string, SourceType>();
index(FORUM_DOMAINS, 'forum', DOMAIN_TYPES);
index(REVIEW_DOMAINS, 'review', DOMAIN_TYPES);
index(VIDEO_DOMAINS, 'video', DOMAIN_TYPES);
index(ENCYCLOPEDIA_DOMAINS, 'encyclopedia', DOMAIN_TYPES);
index(NEWS_DOMAINS, 'news', DOMAIN_TYPES);
index(MARKETPLACE_DOMAINS, 'marketplace', DOMAIN_TYPES);

/** Testler ve dokumantasyon icin listelerin salt-okunur gorunumu */
export const SOURCE_TYPE_LISTS: Readonly<Record<Exclude<SourceType, 'own' | 'competitor' | 'other'>, readonly string[]>> = {
  forum: FORUM_DOMAINS,
  review: REVIEW_DOMAINS,
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

export interface SourceTypeContext {
  /** Sitenin host'u (www'siz) — alt alanlari da "own" sayilir */
  ownHost: string | null;
  /** Rakiplerin host'lari (www'siz) */
  competitorHosts: readonly string[];
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
  for (const c of ctx.competitorHosts) {
    if (c && hostWithin(host, c)) return { type: 'competitor', key: c };
  }

  for (const [h, type] of Object.entries(HOST_TYPES)) {
    if (hostWithin(host, h)) return { type, key: h };
  }

  const byDomain = DOMAIN_TYPES.get(registrable);
  const prefixType = docsOrForumPrefix(host, registrable);
  // forum.donanimhaber.com zaten forum olan alanin parcasi — ayni satirda kalir
  if (prefixType) return { type: prefixType, key: prefixType === byDomain ? registrable : host };

  if (byDomain) return { type: byDomain, key: registrable };

  // Platform alanlarinin bilinmeyen alt alani (orn. blog.google.com) ayri satir
  return { type: 'other', key: PLATFORM_DOMAINS.has(registrable) ? host : registrable };
}
