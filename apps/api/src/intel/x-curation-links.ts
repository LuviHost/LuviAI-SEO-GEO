import { INTEL_SOURCES } from './source-registry.js';

/**
 * X kurasyonu — link siniflandirma ve yayinciya atif (saf yardimcilar).
 *
 * TASARIM KARARI: Gonderi KAYNAK degil, KESIF KANALIDIR. Degerli olan
 * tweet degil, isaret ettigi makale (SEJ, Ahrefs, Search Central...). Makale
 * kendi yayincisinin kaynagina atfedilir (attributeTo) ki iki-kaynak kurali
 * bozulmasin: SEJ yazisi DM'den de gelse "sej" sayilir, "x" degil. Yayinci
 * katalogda yoksa dusuk agirlikli x-curated kovasina duser.
 */

export type XDmLinkKind = 'tco' | 'tweet' | 'external' | 'ignore';

export interface XDmLink {
  href: string;
  kind: XDmLinkKind;
  /** tweet ise status id */
  statusId?: string;
}

const IGNORE_HOSTS = new Set([
  'x.com', 'www.x.com', 'twitter.com', 'www.twitter.com', 'mobile.twitter.com',
  'pic.twitter.com', 'pbs.twimg.com', 'video.twimg.com', 'abs.twimg.com', 'help.x.com', 'help.twitter.com',
]);

/** Yayinci olmayan, bircok kisinin ortak kullandigi hostlar — atif eslemesine girmez */
const GENERIC_FEED_HOSTS = new Set([
  'feeds.feedburner.com', 'rsshub.app', 'medium.com', 'github.com', 'www.reddit.com', 'reddit.com',
  'hn.algolia.com', 'news.ycombinator.com', 'www.youtube.com', 'youtube.com', 'rss.app', 'feedpress.me',
]);

function hostOf(url: string): string | null {
  try { return new URL(url).hostname.toLowerCase().replace(/^www\./, ''); } catch { return null; }
}

/** DM sayfasindaki ham href'i siniflandir */
export function classifyHref(href: string): XDmLink {
  const host = hostOf(href);
  if (!host) return { href, kind: 'ignore' };
  if (host === 't.co') return { href, kind: 'tco' };
  const m = href.match(/^https?:\/\/(?:www\.|mobile\.)?(?:x|twitter)\.com\/([A-Za-z0-9_]+)\/status\/(\d+)/);
  if (m && m[1] !== 'i') return { href: `https://x.com/${m[1]}/status/${m[2]}`, kind: 'tweet', statusId: m[2] };
  if (IGNORE_HOSTS.has(host) || host.endsWith('.x.com') || host.endsWith('.twitter.com')) return { href, kind: 'ignore' };
  return { href, kind: 'external' };
}

/** Metin icindeki http(s) URL'leri */
export function urlsInText(text: string): string[] {
  const out = new Set<string>();
  const re = /https?:\/\/[^\s<>"')\]]+/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) out.add(m[0].replace(/[.,;:!?]+$/, ''));
  return [...out];
}

/** Izleme parametrelerini at, karsilastirma ve kayit icin sade URL */
export function canonicalizeUrl(url: string): string {
  try {
    const u = new URL(url);
    u.hash = '';
    for (const k of [...u.searchParams.keys()]) {
      if (/^(utm_|fbclid|gclid|ref$|ref_src|s$|t$|mc_cid|mc_eid)/i.test(k)) u.searchParams.delete(k);
    }
    u.hostname = u.hostname.toLowerCase();
    if (u.pathname !== '/') u.pathname = u.pathname.replace(/\/+$/, '');
    return u.toString();
  } catch {
    return url;
  }
}

/** Katalogdaki RSS kaynaklarinin host → key haritasi (tam host ve temel alan adi) */
let hostMap: Map<string, string> | null = null;
function buildHostMap(): Map<string, string> {
  const map = new Map<string, string>();
  for (const s of INTEL_SOURCES) {
    if (s.kind !== 'rss') continue;
    const host = hostOf(s.target);
    if (!host || GENERIC_FEED_HOSTS.has(host)) continue;
    if (!map.has(host)) map.set(host, s.key);
    const base = baseDomain(host);
    if (base && !map.has(base)) map.set(base, s.key);
  }
  return map;
}

/** "developers.google.com" → "google.com"; iki etiketli hostlar aynen */
export function baseDomain(host: string): string | null {
  const parts = host.split('.').filter(Boolean);
  if (parts.length < 2) return null;
  // com.tr, co.uk gibi iki-parcali ust alanlar
  const twoPartTld = /^(com|co|org|net|gov|edu)\.[a-z]{2}$/.test(parts.slice(-2).join('.'));
  return parts.slice(twoPartTld ? -3 : -2).join('.');
}

/**
 * Makale URL'sini katalogdaki bir yayinciya esle. Once tam host, sonra temel
 * alan adi. Eslesme yoksa null → cagiran x-curated'e atar.
 */
export function sourceKeyForUrl(url: string): string | null {
  const host = hostOf(url);
  if (!host) return null;
  if (!hostMap) hostMap = buildHostMap();
  return hostMap.get(host) ?? (baseDomain(host) ? hostMap.get(baseDomain(host)!) ?? null : null);
}

/** Test/yeniden kurulum icin */
export function resetSourceHostMap(): void { hostMap = null; }

/**
 * Kurasyon hedefi: `https://x.com/i/bookmarks#folder=ranksup.ai`.
 * NEDEN HASH: X'in SPA'si klasor URL'sini (/i/history/bookmarks/<id>) soguk
 * yuklemede "Bir hata olustu — Yenile" ile aciyor (2026-08-27, iki deneme);
 * tiklama yolu (sayfa → "Yer Isaretleri" sekmesi → klasor adi) calisiyor.
 * Hash tarayiciya gitmez, servis adi okuyup tiklar.
 */
export function parseCurationTarget(target: string): { url: string; folder: string | null } {
  const [url, hash = ''] = target.trim().split('#');
  const m = hash.match(/(?:^|&)folder=([^&]+)/);
  return { url, folder: m ? decodeURIComponent(m[1]).trim() || null : null };
}

/** Gonderi sayfasindan okunan bir article satiri */
export interface ThreadRow {
  /** "/kullanici" (User-Name linki) */
  user: string | null;
  /** "/kullanici/status/123" */
  st: string | null;
  text: string;
  links: string[];
}

export interface ThreadSplit {
  author: string;
  /** Yazarin kendi devam gonderileri, kronolojik (ilk = ana gonderi) */
  thread: Array<{ url: string; text: string; links: string[] }>;
  /** Baskalarinin yanitlari — karsit kanit cogunlukla burada */
  replies: Array<{ user: string; text: string; links: string[] }>;
}

export const MAX_THREAD_REPLIES = 8;

/** Permalink'ten yazar handle'i: https://x.com/illyism/status/1 → "illyism" */
export function authorFromStatusUrl(url: string): string | null {
  const m = url.match(/^https?:\/\/(?:www\.|mobile\.)?(?:x|twitter)\.com\/([A-Za-z0-9_]+)\/status\/\d+/);
  return m ? m[1] : null;
}

/**
 * Sayfadan toplanan satirlari (birden fazla kaydirma adiminda birikmis,
 * status URL'siyle tekillestirilmis) yazar-devami ve yanit olarak ayirir.
 * Sanal liste ana gonderiyi asagi kaydirinca DOM'dan dusuruyor — bu yuzden
 * cagiran her adimda toplayip burada birlestirir.
 */
export function splitThread(rows: ThreadRow[], statusUrl: string): ThreadSplit {
  const author = (authorFromStatusUrl(statusUrl) ?? '').toLowerCase();
  const byStatus = new Map<string, ThreadRow>();
  for (const r of rows) {
    if (!r.st) continue;
    if (!byStatus.has(r.st)) byStatus.set(r.st, r);
  }
  const idOf = (st: string) => Number((st.match(/\/status\/(\d+)/) ?? [])[1] ?? 0);
  const uniq = [...byStatus.values()].sort((a, b) => idOf(a.st!) - idOf(b.st!));

  const thread: ThreadSplit['thread'] = [];
  const replies: ThreadSplit['replies'] = [];
  for (const r of uniq) {
    const handle = (r.user ?? '').replace(/^\//, '').toLowerCase();
    if (handle && handle === author) thread.push({ url: `https://x.com${r.st}`, text: r.text.trim(), links: r.links });
    else if (r.text.trim()) replies.push({ user: handle || '?', text: r.text.trim(), links: r.links });
  }
  return { author, thread, replies: replies.slice(0, MAX_THREAD_REPLIES) };
}

/** Analist icin tek metin: devam gonderileri numarali + yanitlar */
export function renderThread(split: ThreadSplit): string {
  const parts: string[] = [];
  split.thread.forEach((t, i) => parts.push(split.thread.length > 1 ? `${i + 1}/ ${t.text}` : t.text));
  if (split.replies.length) {
    parts.push('Yanitlar:');
    for (const r of split.replies) parts.push(`- @${r.user}: ${r.text}`);
  }
  return parts.join('\n\n');
}
