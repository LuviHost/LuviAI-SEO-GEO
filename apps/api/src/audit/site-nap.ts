/**
 * Sitenin kendi NAP'i (telefon + adres) — okuma, saklama, cozumleme.
 *
 * KAYNAK: yalnizca musterinin KENDI kayitli sitesi. Baska site, harita ya da
 * rehber taranmaz; AI cevabindaki adreslere gidilmez.
 *   1) Denetim taramasi zaten tum sayfalari okuyor; JSON-LD bloklari ve tel:
 *      baglantilari (CrawledPage.telLinks) bellekte. recordSiteNapFromCrawl()
 *      o veriyi kv_store'a yazar (audit.service cagirir — tarama verisi baska
 *      yerde kalici degil).
 *   2) Kayit yoksa (denetim henuz bu surumle kosmadi) ya da eskiyse yerel
 *      olcum aninda sitenin anasayfasi (gerekirse bagli iletisim sayfasi) bir
 *      kez okunur: SSRF korumali safeFetchText, durust RanksUpBot kimligi,
 *      robots.txt'teki RanksUpBot grubuna uyulur, engel sayfasi icerik sanilmaz.
 *
 * Depo: kv_store `site-nap:<siteId>` — sema degisikligi yok.
 */
import * as cheerio from 'cheerio';
import { safeFetchText, SafeFetchError, type SafeTextOptions, type SafeTextResult } from '../common/safe-fetch.js';
import { detectBlock, unblockHint } from '../common/block-detect.js';
import { isAllowedForRanksUpBot, parseRanksUpBotGroup, ROBOTS_PARSE_LIMIT, type RanksUpRobotsPolicy } from '../sites/ranksup-robots.js';
import { hasUsableNap, mergeSiteNap, siteNapFromPage, type SiteNap } from './local-nap.js';

export const SITE_NAP_KEY_PREFIX = 'site-nap:';

const DAY_MS = 24 * 60 * 60 * 1000;
/** Okunan NAP bu sureden eskiyse olcumde yeniden okunur */
export const SITE_NAP_FRESH_MS = 14 * DAY_MS;
/** Basarisiz okumadan sonra tekrar deneme araligi — her olcumde siteye yuklenmeyelim */
export const SITE_NAP_RETRY_MS = DAY_MS;
/** Kullanici "yeniden oku" dediginde iki okuma arasi en az */
export const SITE_NAP_REFRESH_COOLDOWN_MS = 10 * 60 * 1000;

export type SiteNapStatus = 'ok' | 'empty' | 'unavailable';

export interface StoredSiteNap extends SiteNap {
  /** ok = telefon ya da ilce/il bulundu; empty = sayfa okundu, NAP yok; unavailable = okunamadi */
  status: SiteNapStatus;
  origin: 'audit' | 'homepage';
  /**
   * tel: baglantilari tarandi mi. Tarayici telLinks toplamadan once yazilan
   * denetim kayitlari yalniz JSON-LD tasir (false). Telefon bulunamayan
   * kayitta olcum anasayfaya bir kez bakar (resolveSiteNap).
   */
  telScanned: boolean;
  /** Okunan sayfa adresleri */
  pages: string[];
  /** unavailable/empty icin kullaniciya gosterilecek Turkce neden */
  reason: string | null;
  /** NAP'in okundugu an (ISO) */
  collectedAt: string;
  /** Son okuma denemesi (ISO) ve hatasi — eski kayit korunurken de yazilir */
  attemptedAt: string;
  attemptError: string | null;
}

/** Prisma'nin yalnizca kvStore ucu — testte sahtelenebilir */
export interface SiteNapKv {
  kvStore: {
    findUnique(args: { where: { key: string } }): Promise<{ value: string; updatedAt?: Date } | null>;
    upsert(args: {
      where: { key: string };
      create: { key: string; value: string; expiresAt: Date | null };
      update: { value: string; expiresAt: Date | null };
    }): Promise<unknown>;
  };
}

export type SiteNapFetcher = (url: string, opts?: SafeTextOptions) => Promise<SafeTextResult>;

export const siteNapKey = (siteId: string) => `${SITE_NAP_KEY_PREFIX}${siteId}`;

function isStored(v: unknown): v is StoredSiteNap {
  const s = v as StoredSiteNap | null;
  return !!s && Array.isArray(s.phones) && Array.isArray(s.addresses) && typeof s.status === 'string' && typeof s.collectedAt === 'string';
}

export async function readSiteNap(prisma: SiteNapKv, siteId: string): Promise<StoredSiteNap | null> {
  const row = await prisma.kvStore.findUnique({ where: { key: siteNapKey(siteId) } });
  if (!row) return null;
  try {
    const parsed = JSON.parse(row.value);
    return isStored(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export async function recordSiteNap(prisma: SiteNapKv, siteId: string, nap: StoredSiteNap): Promise<void> {
  // Okunamayan kayit kisa yasar; bulunan NAP eskise de bir sure "son bilinen" olarak kalir
  const ttl = nap.status === 'unavailable' ? 2 * SITE_NAP_RETRY_MS : 2 * SITE_NAP_FRESH_MS;
  const value = JSON.stringify(nap);
  const expiresAt = new Date(Date.parse(nap.attemptedAt) + ttl);
  const key = siteNapKey(siteId);
  await prisma.kvStore.upsert({ where: { key }, create: { key, value, expiresAt }, update: { value, expiresAt } });
}

// ────────────────────────────────────────────────────────────
//  DENETIM TARAMASINDAN
// ────────────────────────────────────────────────────────────

/**
 * CrawledPage'in burada gereken kismi. telLinks dizisi varsa sayfanin tel:
 * baglantilari tarandi demektir (site-crawler.service.ts extractPageData).
 */
export interface NapCrawledPage {
  url: string;
  jsonLdBlocks?: unknown[];
  telLinks?: string[];
}

/** Taranan sayfalarin JSON-LD ve tel: bulgulari */
export function napFromCrawledPages(pages: NapCrawledPage[], now = new Date()): StoredSiteNap {
  const parts: SiteNap[] = [];
  const found: string[] = [];
  let telScanned = false;
  for (const p of pages.slice(0, 200)) {
    if (Array.isArray(p.telLinks)) telScanned = true;
    const nap = siteNapFromPage({ jsonLdBlocks: p.jsonLdBlocks ?? [], telHrefs: p.telLinks ?? [] });
    if (nap.phones.length || nap.addresses.length) {
      parts.push(nap);
      if (found.length < 5) found.push(p.url);
    }
  }
  const merged = mergeSiteNap(parts);
  const iso = now.toISOString();
  const usable = hasUsableNap(merged);
  // Neden metni gercekte neye bakildigini soylesin: tel: taranmadiysa yalniz JSON-LD
  const reason = usable
    ? null
    : telScanned
      ? 'Taranan sayfalarda LocalBusiness yapılandırılmış verisi (telefon/adres) ya da tel: bağlantısı bulunamadı.'
      : 'Taranan sayfalarda telefon ya da adres içeren LocalBusiness yapılandırılmış verisi bulunamadı.';
  return {
    ...merged,
    status: usable ? 'ok' : 'empty',
    origin: 'audit',
    telScanned,
    pages: found,
    reason,
    collectedAt: iso,
    attemptedAt: iso,
    attemptError: null,
  };
}

/**
 * Denetim tarandiktan sonra tek satirla cagrilir. Hata yutulmaz — cagiran
 * .catch ile loglar; denetimin kendisini dusurmemeli.
 */
export async function recordSiteNapFromCrawl(prisma: SiteNapKv, siteId: string, pages: NapCrawledPage[]): Promise<void> {
  await recordSiteNap(prisma, siteId, napFromCrawledPages(pages));
}

// ────────────────────────────────────────────────────────────
//  ANASAYFA OKUMASI
// ────────────────────────────────────────────────────────────

export interface ParsedNapPage {
  jsonLdBlocks: unknown[];
  telHrefs: string[];
  /** Ayni sitedeki iletisim sayfasi adaylari (mutlak adres) */
  contactLinks: string[];
}

const CONTACT_PATH = /(?:^|\/)(?:iletisim|iletişim|contact(?:-us)?|bize-ulasin|bize-ulaşın|ulasim|ulaşım|adres|adresimiz|subeler|şubeler|magazalar|mağazalar)(?:[/._-]|$)/i;

function siteKey(host: string): string {
  return host.toLowerCase().replace(/^www\./, '');
}

/** HTML'den JSON-LD bloklari, tel: baglantilari ve iletisim sayfasi adaylari */
export function parseNapHtml(html: string, pageUrl: string): ParsedNapPage {
  const $ = cheerio.load(html);
  const jsonLdBlocks: unknown[] = [];
  $('script[type="application/ld+json"]').each((_, el) => {
    const raw = $(el).html();
    if (!raw) return;
    try { jsonLdBlocks.push(JSON.parse(raw)); } catch { /* gecersiz JSON-LD — denetim ayrica raporluyor */ }
  });
  const telHrefs: string[] = [];
  const contactLinks: string[] = [];
  let base: URL | null = null;
  try { base = new URL(pageUrl); } catch { /* goreli link cozulemez */ }
  $('a[href]').each((_, el) => {
    const href = ($(el).attr('href') ?? '').trim();
    if (!href) return;
    if (/^tel:/i.test(href)) {
      if (telHrefs.length < 20 && !telHrefs.includes(href)) telHrefs.push(href);
      return;
    }
    if (!base || contactLinks.length >= 3) return;
    try {
      const u = new URL(href, base);
      if ((u.protocol !== 'http:' && u.protocol !== 'https:') || siteKey(u.hostname) !== siteKey(base.hostname)) return;
      u.hash = '';
      let path = u.pathname;
      try { path = decodeURIComponent(path); } catch { /* ham yol */ }
      if (CONTACT_PATH.test(path) && u.href !== base.href && !contactLinks.includes(u.href)) contactLinks.push(u.href);
    } catch { /* gecersiz href */ }
  });
  return { jsonLdBlocks, telHrefs, contactLinks };
}

function looksLikeHtmlDocument(text: string): boolean {
  return /^\s*(?:<!doctype html|<html[\s>]|<head[\s>]|<body[\s>])/i.test(text.slice(0, 1024));
}

function fetchErrorText(err: unknown): string {
  const code = err instanceof SafeFetchError ? err.code : 'network';
  switch (code) {
    case 'timeout': return 'Site zamanında yanıt vermedi.';
    case 'dns': return 'Site adresi çözümlenemedi (DNS).';
    case 'blocked_address':
    case 'protocol':
    case 'port': return 'Site adresi güvenli okuma kurallarına uymuyor.';
    case 'redirect': return 'Site çok fazla ya da güvensiz yönlendirme yaptı.';
    // Sunucu yanit verdi ama sikistirma cozulemedi — baglanti sorunu degil
    case 'content_encoding': return 'Site yanıtı çözülemedi (desteklenmeyen ya da bozuk sıkıştırma).';
    default: return 'Siteye bağlanılamadı.';
  }
}

type PageRead = { ok: true; url: string; page: ParsedNapPage } | { ok: false; reason: string };

async function readPage(url: string, policy: RanksUpRobotsPolicy | null, fetcher: SiteNapFetcher): Promise<PageRead> {
  if (!isAllowedForRanksUpBot(policy, url)) {
    return { ok: false, reason: 'robots.txt dosyası RanksUpBot\'un bu sayfayı okumasına izin vermiyor.' };
  }
  let res: SafeTextResult;
  try {
    res = await fetcher(url, { timeoutMs: 10_000, maxBytes: 1_500_000 });
  } catch (err) {
    return { ok: false, reason: fetchErrorText(err) };
  }
  // Engel sayfasi icerik sanilmaz; asmaya calismayiz — site sahibine izin yolunu soyleriz
  const block = detectBlock(res);
  if (block) return { ok: false, reason: `${block.reason} ${unblockHint(block)}` };
  if (!res.ok) return { ok: false, reason: `Sayfa HTTP ${res.status} döndürdü.` };
  if (res.binary) return { ok: false, reason: 'Adres HTML sayfası döndürmedi.' };
  // Yonlendirme sonrasi adres de robots kuralina tabi
  if (res.url !== url && !isAllowedForRanksUpBot(policy, res.url)) {
    return { ok: false, reason: 'robots.txt dosyası RanksUpBot\'un bu sayfayı okumasına izin vermiyor.' };
  }
  return { ok: true, url: res.url, page: parseNapHtml(res.text, res.url) };
}

/**
 * Sitenin anasayfasini (NAP eksikse bir iletisim sayfasini da) okur.
 * En fazla 3 istek: robots.txt + anasayfa + iletisim sayfasi.
 */
export async function readHomepageNap(siteUrl: string, fetcher: SiteNapFetcher = safeFetchText, now = new Date()): Promise<StoredSiteNap> {
  const iso = now.toISOString();
  const unavailable = (reason: string): StoredSiteNap => ({
    phones: [], addresses: [], sources: [], businessTypes: [],
    status: 'unavailable', origin: 'homepage', telScanned: false, pages: [],
    reason, collectedAt: iso, attemptedAt: iso, attemptError: reason,
  });

  let home: URL;
  try { home = new URL(siteUrl); } catch { return unavailable('Site adresi geçersiz.'); }

  // robots.txt: tarayiciyla ayni kural — okunamazsa kisit yok sayilir (site-crawler.service.ts)
  let policy: RanksUpRobotsPolicy | null = null;
  try {
    const r = await fetcher(`${home.origin}/robots.txt`, { maxBytes: ROBOTS_PARSE_LIMIT, timeoutMs: 8_000, skipBinary: false });
    if (r.ok && !looksLikeHtmlDocument(r.text)) policy = parseRanksUpBotGroup(r.text);
  } catch { /* robots.txt yok/okunamadi */ }

  const first = await readPage(home.href, policy, fetcher);
  if (!first.ok) return unavailable(first.reason);

  const parts: SiteNap[] = [siteNapFromPage({ jsonLdBlocks: first.page.jsonLdBlocks, telHrefs: first.page.telHrefs })];
  const pages = [first.url];
  const needsMore = !parts[0].phones.length || !parts[0].addresses.some((a) => a.district || a.city);
  if (needsMore && first.page.contactLinks.length) {
    const contact = await readPage(first.page.contactLinks[0], policy, fetcher);
    if (contact.ok) {
      parts.push(siteNapFromPage({ jsonLdBlocks: contact.page.jsonLdBlocks, telHrefs: contact.page.telHrefs }));
      pages.push(contact.url);
    }
  }
  const merged = mergeSiteNap(parts);
  const usable = hasUsableNap(merged);
  return {
    ...merged,
    status: usable ? 'ok' : 'empty',
    origin: 'homepage',
    telScanned: true,
    pages,
    reason: usable ? null : 'Sitende LocalBusiness yapılandırılmış verisi (telefon/adres) ya da tel: bağlantısı bulunamadı.',
    collectedAt: iso,
    attemptedAt: iso,
    attemptError: null,
  };
}

/** Denetim kaydi (JSON-LD) + anasayfa okumasi (tel:) birlesimi */
function combine(audit: StoredSiteNap, home: StoredSiteNap): StoredSiteNap {
  const merged = mergeSiteNap([audit, home]);
  const usable = hasUsableNap(merged);
  return {
    ...home,
    ...merged,
    status: usable ? 'ok' : 'empty',
    pages: [...new Set([...home.pages, ...audit.pages])].slice(0, 6),
    reason: usable ? null : home.reason,
  };
}

/**
 * Olcumde kullanilacak site NAP'i. Taze kayit varsa onu dondurur; yoksa
 * anasayfayi okur ve kaydeder. Okuma basarisizsa son bilinen kayit korunur
 * (deneme zamani yazilir, bir gun boyunca tekrar denenmez).
 */
export async function resolveSiteNap(
  prisma: SiteNapKv,
  site: { id: string; url: string },
  opts: { fetcher?: SiteNapFetcher; now?: Date; force?: boolean } = {},
): Promise<StoredSiteNap> {
  const now = opts.now ?? new Date();
  const cached = await readSiteNap(prisma, site.id).catch(() => null);
  if (cached && !opts.force) {
    const attemptAge = now.getTime() - Date.parse(cached.attemptedAt || cached.collectedAt);
    const age = now.getTime() - Date.parse(cached.collectedAt);
    const recentAttempt = attemptAge >= 0 && attemptAge < SITE_NAP_RETRY_MS;
    // Son okuma yeni ve basarisizsa siteye tekrar gitme (toplu olcumde her soru icin denenirdi)
    if (recentAttempt && (cached.status === 'unavailable' || cached.attemptError)) return cached;
    // Telefon bilinmiyorsa anasayfaya (gerekirse iletisim sayfasina) bir kez
    // bakilir. Denetim kaydi icin tel: tarandiysa da: tarama 100 sayfa
    // sinirinda once sitemap'i izler, yazisi cok sitede iletisim sayfasi
    // siraya girmeyebilir. Telefonu bulan denetim kaydi icin ek istek YOK.
    const incomplete = cached.phones.length === 0 && (cached.origin === 'audit' || !cached.telScanned);
    if (cached.status !== 'unavailable' && !incomplete && age >= 0 && age < SITE_NAP_FRESH_MS) return cached;
  }

  const read = await readHomepageNap(site.url, opts.fetcher ?? safeFetchText, now);
  let result: StoredSiteNap;
  if (read.status === 'unavailable') {
    result = cached && cached.status !== 'unavailable'
      ? { ...cached, attemptedAt: read.attemptedAt, attemptError: read.reason }
      : read;
  } else if (cached && cached.origin === 'audit' && cached.status !== 'unavailable') {
    result = combine(cached, read);
  } else {
    result = read;
  }
  await recordSiteNap(prisma, site.id, result).catch(() => undefined);
  return result;
}
