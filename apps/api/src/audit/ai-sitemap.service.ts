import { Injectable, Logger } from '@nestjs/common';
import { load } from 'cheerio';
import { PrismaService } from '../prisma/prisma.service.js';
import { safeFetchText } from '../common/safe-fetch.js';
import { isCanonicalSiteId } from '../common/site-id.js';
import { resolveArticleUrl } from '../articles/article-url.util.js';
import {
  articleContentHash, entryRetired, liveEntries, liveEntryRef, liveEntrySlug, unseenWordPressDraftCopy, wordPressPlainLink, type LiveEntry,
} from '../articles/republish-policy.js';

/** ai:summary tavani — makale ozetleriyle ayni (meta aciklamanin ilk 200 karakteri) */
const SUMMARY_MAX_CHARS = 200;

/**
 * Ana sayfa ozeti onbellegi (surec ici). Site haritasi herkese acik; her
 * istek musterinin ana sayfasina bir istek demek olmasin. Okunamayan sonuc
 * daha kisa tutulur.
 */
const HOME_SUMMARY_TTL_MS = 6 * 60 * 60_000;
const HOME_SUMMARY_MISS_TTL_MS = 30 * 60_000;
const HOME_SUMMARY_MAX_ENTRIES = 500;

/**
 * Herkese acik uretilmis XML onbellegi (site basina, surec ici). Uc kimliksiz:
 * tarayici/bot trafigi her istekte 1000 makalelik sorgu ve XML uretimi
 * yaptirmasin. Kisa: yeni yayinlanan yazi en gec bu sure sonra listelenir.
 * Yanittaki Cache-Control ayni sureyi soyler (audit.controller).
 */
export const PUBLIC_SITEMAP_TTL_MS = 10 * 60_000;
const PUBLIC_SITEMAP_MAX_ENTRIES = 500;

/**
 * Editor olcegi: 16ab0d9 (3 Agustos 2026 23:25 +03:00) ile 60'tan 9 kategori x
 * 10 = 90'a cikti (pipeline.service EDITOR_MAX_SCORE). Panelin makale sayfasi
 * da ayni tarihi kullanir (editorScoreMax). Burada yalniz kayit tarihine
 * bakilir: ajan ciktilarini (agentOutputs) 1000 makale icin okumak agir.
 */
const EDITOR_SCALE_90_SINCE_MS = Date.parse('2026-08-03T20:25:08Z');

/**
 * Yalniz bu hedefler gercek .html dosyasi yazar ve kamusal adresi yazilan
 * dosyanin klasorunden cikar (articles/article-url.util.ts FILE_BASED_TARGETS
 * ile ayni liste). Adaptorleri ftp:// adresi, sunucu yolu ya da (cPanel) tahmini
 * bir genel adres dondurur — fileCopyPublicUrl.
 */
export const FILE_TARGET_TYPES: ReadonlySet<string> = new Set(['FTP', 'SFTP', 'CPANEL_API']);

/**
 * XML 1.0'in izin verdigi karakter mi (Char uretimi: sekme, satir sonu, CR,
 * U+0020-D7FF, U+E000-FFFD, U+10000-10FFFF). for...of kod noktasi gezer;
 * eslesmemis vekil tek basina gelir ve aralik disinda kalir.
 */
function isXmlChar(cp: number): boolean {
  return cp === 0x9 || cp === 0xa || cp === 0xd
    || (cp >= 0x20 && cp <= 0xd7ff)
    || (cp >= 0xe000 && cp <= 0xfffd)
    || (cp >= 0x10000 && cp <= 0x10ffff);
}

/**
 * Musteri metnini (baslik, ozet, soru) XML'e guvenle yazar: gecersiz
 * karakterler atilir, ozel karakterler kacislanir. Tek gecersiz karakter
 * tum site haritasini okunamaz yapardi (uc artik tarayicilara acik).
 */
export function xmlText(s: string): string {
  let clean = '';
  for (const ch of s) if (isXmlChar(ch.codePointAt(0) ?? 0)) clean += ch;
  return clean
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

/**
 * HTML'deki <meta name="description"> icerigi (bosluklar sadelesir, en fazla
 * 200 karakter); yoksa ya da bossa null.
 */
export function homepageMetaDescription(html: string): string | null {
  const content = load(html)('meta[name="description" i]').first().attr('content') ?? '';
  // XML 1.0'da gecersiz kontrol karakterleri (sekme/satir sonu disi) site
  // haritasini bozar; musterinin metninden gelebilir, atilir.
  const printable = Array.from(content, (ch) => (ch.charCodeAt(0) < 0x20 && !/\s/.test(ch) ? '' : ch)).join('');
  const text = printable.replace(/\s+/g, ' ').trim();
  return text ? text.slice(0, SUMMARY_MAX_CHARS) : null;
}

/** http(s) site adresi; ayristirilamazsa null */
export function parseSiteUrl(raw: unknown): URL | null {
  if (typeof raw !== 'string' || !raw.trim()) return null;
  try {
    const u = new URL(raw.trim());
    return u.protocol === 'https:' || u.protocol === 'http:' ? u : null;
  } catch {
    return null;
  }
}

const hostKey = (host: string) => host.toLowerCase().replace(/^www\./, '');

/**
 * Adres sitenin kendi host'unda mi (www farki yok sayilir)? Oyleyse sitenin
 * protokol + host'uyla yazilmis hali, degilse null.
 *
 * NEDEN AYNI HOST: harita RanksUp sunucusunda duruyor ve musterinin
 * robots.txt'indeki `Sitemap:` satiriyla gosteriliyor. Protokol bu "capraz
 * gonderimde" haritanin yalniz onu gosteren host'un adreslerini icermesini
 * ister; digerleri gecersiz sayilip atilir. Kaynaklar:
 * https://www.sitemaps.org/protocol.html#sitemaps_cross_submits ve
 * https://developers.google.com/search/docs/crawling-indexing/sitemaps/build-sitemap
 * ("include only URLs from that particular site").
 */
export function sameSiteUrl(site: URL, raw: unknown): string | null {
  if (typeof raw !== 'string' || !raw) return null;
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return null; // goreli yol, sunucu dosya yolu
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return null; // ftp:// vb.
  if (u.username || u.password || u.port !== site.port) return null;
  if (hostKey(u.hostname) !== hostKey(site.hostname)) return null;
  return `${site.protocol}//${site.host}${u.pathname}${u.search}`;
}

// ─────────────────────────────────────────────────────────────────────────
//  DOSYA HEDEFINDEKI KOPYANIN HERKESE ACIK ADRESI (tek kaynak)
//
//  FTP / SFTP / cPanel yayini dosyayi `${remotePath}/${slug}.html` olarak yazar
//  (packages/adapters ftp.ts, sftp.ts, cpanel-api.ts); sayfanin adresi o klasorden ve o
//  dosya adindan cikar (articles/article-url.util.ts resolveArticleUrl — yayinci sayfaya
//  ayni kuralla <link rel="canonical"> yazar). Adres, yayin kaydinda YAZIM ANINDA
//  kaydedilen konumdan kurulur; hedefin BUGUNKU klasor ayarindan ve yazinin BUGUNKU
//  slug'indan degil.
//
//  NEDEN: site haritasi, llms-full ve persona sohbeti adresi bugunku ayardan kuruyordu.
//  Musteri yeni yazilar icin klasoru degistirince (ya da yazinin slug'i degisince) eski
//  sayfa eski adreste yayinda kaliyor, ilan edilen adres ise 404 veriyordu; canlilik
//  denetimi ise kayitli yolu yokluyordu — ayni kopya icin iki ayri adres. Simdi canlilik
//  denetimi, sitemap-ai, llms-full / llms.txt, persona sohbeti (advertisedArticleEntry),
//  yayincinin canonical'i ve uretim hattinin JSON-LD'si bu islevleri kullanir.
// ─────────────────────────────────────────────────────────────────────────

/**
 * Dosya hedefinin kayitli uzak dosya yolunun klasoru (saf): FTP `ftp://host/yol/<slug>.html`,
 * SFTP `/yol/<slug>.html` (adaptorler `${remotePath}/${slug}.html` yazar — packages/adapters
 * ftp.ts, sftp.ts). http(s) adresi (cPanel'in genel adresi) dosya yolu degildir: null.
 */
export function recordedRemoteDir(recorded: string | undefined): string | null {
  if (!recorded) return null;
  let path: string;
  try {
    const u = new URL(recorded);
    if (u.protocol !== 'ftp:' && u.protocol !== 'ftps:' && u.protocol !== 'sftp:') return null;
    try { path = decodeURIComponent(u.pathname); } catch { path = u.pathname; }
  } catch {
    // Sema yok: SFTP'nin kaydettigi duz dosya yolu
    path = recorded.split(/[?#]/)[0];
  }
  const i = path.lastIndexOf('/');
  return i < 0 ? null : path.slice(0, i) || '/';
}

const configObject = (config: unknown): Record<string, unknown> =>
  config && typeof config === 'object' && !Array.isArray(config) ? (config as Record<string, unknown>) : {};

/**
 * Kopya hedefin BUGUNKU klasorunde mi (saf): adaptor bugunku ayarla kayitli dosya adini
 * yazsaydi kayda AYNI konumu yazardi. Karsilastirma ham dizeyle ve adaptorun kendi kuraliyla:
 *  - FTP (ftp.ts): `ftp://${host}${remotePath}/${ad}.html`, remotePath yoksa '/'; sunucu adi
 *    egik cizgi icermez. NEDEN dize: remotePath '/' ile baslamiyorsa ('blog') eski kayitlarda
 *    sunucu adi yola yapisiktir (`ftp://ftp.site.comblog/x.html`) ve adres ayristirmasi klasoru
 *    eksik okur. Bugunku adaptor bu durumda araya egik cizgi koyar (`ftp://ftp.site.com/blog/x.html`,
 *    yalniz kayit dizesi; yukleme yolu goreli kalir): iki bicim de bu klasorde sayilir.
 *  - SFTP (sftp.ts): `${remotePath}/${ad}.html`, remotePath yoksa '/'.
 *  - cPanel (cpanel-api.ts): `${genel adres}${/klasor}/${ad}` — klasorun bas/son egik
 *    cizgileri ve bastaki public_html atilir (bossa 'public_html/blog'), uzanti yazilmaz;
 *    genel adres ayardaki publicBaseUrl ya da cPanel sunucu adindan kurulan yolsuz adres.
 * Ayar degismediyse adres eskisi gibi bugunku ayardan kurulur (birebir ayni sonuc). Kayitli
 * konum yoksa (eski kayit) true: adres zaten bugunku ayardan kurulur.
 */
export function fileCopyAtConfiguredPath(type: unknown, recorded: string | undefined, config: unknown): boolean {
  if (!recorded) return true;
  const cfg = configObject(config);
  const file = recorded.slice(recorded.lastIndexOf('/') + 1);
  if (!file) return false;
  const t = String(type ?? '');
  if (t === 'FTP' || t === 'SFTP') {
    const remotePath = cfg.remotePath === undefined ? '/' : String(cfg.remotePath);
    const suffix = `${remotePath}/${file}`;
    if (t === 'SFTP') return recorded === suffix;
    if (!recorded.startsWith('ftp://')) return false;
    const hostBefore = (tail: string): boolean => {
      if (!recorded.endsWith(tail)) return false;
      const host = recorded.slice('ftp://'.length, recorded.length - tail.length);
      return host !== '' && !host.includes('/');
    };
    // Eski (yapisik) bicim ve egik cizgiyle baslayan remotePath; goreli remotePath'te bugunku
    // adaptorun normallestirilmis kaydi (packages/adapters ftp.ts recordedFtpUrl)
    return hostBefore(suffix) || (!suffix.startsWith('/') && hostBefore(`/${suffix}`));
  }
  if (t === 'CPANEL_API') {
    let dir = String(cfg.remotePath ?? 'public_html/blog').replace(/^\/+/, '').replace(/\/+$/, '');
    if (!dir) dir = 'public_html/blog';
    const clean = dir.replace(/^public_html\/?/, '').replace(/\/+$/, '');
    const suffix = `${clean ? `/${clean}` : ''}/${file}`;
    if (!recorded.endsWith(suffix)) return false;
    const base = recorded.slice(0, recorded.length - suffix.length);
    const configured = String(cfg.publicBaseUrl ?? '').trim().replace(/\/+$/, '');
    return configured ? base === configured : /^https?:\/\/[^/?#]+$/i.test(base);
  }
  return false;
}

/**
 * Kayitli konumdan klasor (saf; bulunamazsa null). FTP / SFTP: dosya yolunun klasoru
 * (recordedRemoteDir). cPanel: genel adresin yolu — dosyanin public_html'e gore yeri; ayardaki
 * publicBaseUrl'in kendi yolu varsa o atilir.
 */
function recordedFileDir(type: string, recorded: string, config: unknown): string | null {
  if (type !== 'CPANEL_API') return recordedRemoteDir(recorded);
  let u: URL;
  try {
    u = new URL(recorded);
  } catch {
    return recordedRemoteDir(recorded);
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return recordedRemoteDir(recorded);
  let encoded = u.pathname;
  const base = parseSiteUrl(String(configObject(config).publicBaseUrl ?? ''));
  const basePath = base ? base.pathname.replace(/\/+$/, '') : '';
  if (basePath && (encoded === basePath || encoded.startsWith(`${basePath}/`))) encoded = encoded.slice(basePath.length);
  let path: string;
  try { path = decodeURIComponent(encoded); } catch { path = encoded; }
  const i = path.lastIndexOf('/');
  return i < 0 ? null : path.slice(0, i) || '/';
}

/**
 * Dosya hedefindeki kopyanin herkese acik adresi (saf; sitede degilse ya da hedef dosya
 * hedefi degilse null):
 *  - kayitli adres sitenin kendi host'undaysa (cPanel'in genel adresi) o;
 *  - degilse yazilan dosyanin adresi: dosya adi KAYITTAKI konumdan (yazim anindaki slug),
 *    klasor kopya hedefin bugunku klasorundeyse (fileCopyAtConfiguredPath) bugunku ayardan,
 *    degilse kayitli konumun klasorunden;
 *  - kayitli konumu olmayan eski kayitta (ve entry verilmezse: yayinci bu yayinda YAZACAGI
 *    kopyanin adresini sorar) bugunku ayar + yazinin slug'i — eski davranis.
 * Bilinen sinir: remotePath'i '/' ile baslamayan FTP hedefinin klasoru sonradan degistiyse
 * eski (adaptor normallestirmesinden onceki) kayitta sunucu adi yola yapismistir; klasorun ilk
 * parcasi okunamaz (adres yine canlilik denetiminin yokladigi adrestir). Yeni kayitlarda
 * (packages/adapters ftp.ts recordedFtpUrl) sunucu adi ile yol arasinda egik cizgi vardir.
 */
export function fileCopyPublicUrl(
  site: URL,
  entry: { externalUrl?: unknown; url?: unknown } | null | undefined,
  target: { type?: unknown; config?: unknown },
  articleSlug: string,
): string | null {
  const type = String(target.type ?? '');
  if (!FILE_TARGET_TYPES.has(type)) return null;
  const recorded = entry ? liveEntryRef({ ...entry, targetId: '' }).externalUrl : undefined;
  const onSite = sameSiteUrl(site, recorded);
  if (onSite) return onSite;
  const name = recorded ? liveEntrySlug({ targetId: '', externalUrl: recorded }) : null;
  const dir = recorded && name && !fileCopyAtConfiguredPath(type, recorded, target.config)
    ? recordedFileDir(type, recorded, target.config)
    : null;
  const config = dir !== null ? { remotePath: dir } : target.config;
  const base = `${site.protocol}//${site.host}${site.pathname}`;
  return sameSiteUrl(site, resolveArticleUrl(base, name ?? articleSlug, { type, config }).url);
}

type PublishedEntry = {
  targetId?: unknown;
  targetType?: unknown;
  ok?: unknown;
  externalUrl?: unknown;
  url?: unknown;
  updatedAt?: unknown;
  /** Kopya WordPress cop kutusunda bulundu (sozlesme C3): canli degil */
  trashedAt?: unknown;
  /** Bu adreste yazinin DAHA ESKI bir metni yayinda (republish-policy refreshManualUpdateFlags) */
  manualUpdatePending?: unknown;
  /** Bu hedefe en son giden metnin izi (republish-policy articleContentHash) */
  contentHash?: unknown;
  /** Canlilik denetimi adresi bir kez canli gordu (republish-policy unseenWordPressDraftCopy) */
  liveSeenAt?: unknown;
  /** RanksUp'in son yaziminda WordPress'in bildirdigi yazi durumu (republish-policy recordedWordPressStatus) */
  remoteStatus?: unknown;
};
type TargetRef = { type: string; config: unknown };

/**
 * Artik canli olmayan kopya: cop kutusunda (trashedAt) ya da silinmis bulunan
 * (missingAt). Adresi 404 verir: site haritasi ve llms-full onu ilan etmez,
 * lastmod da ondan alinmaz. Kural tek kaynaktan (republish-policy entryRetired);
 * eskiden burada yalniz trashedAt'e bakan yerel bir kopya vardi ve silinmis
 * WordPress yazisinin olu adresi baska canli kopyasi olan yazida ilan ediliyordu.
 */
function entryNotLive(e: PublishedEntry): boolean {
  return entryRetired(e);
}

/**
 * Yayindaki makalenin bu sitedeki kamusal adresi; bilinmiyorsa null (harita
 * o makaleyi listelemez — uydurma adres 404 demektir).
 *
 *  1. Yayin hedefinin bildirdigi adres (publishedTo[].externalUrl) sitenin
 *     host'undaysa: WordPress kalici baglantisi, Ghost, cPanel genel adresi vb.
 *  2. Dosya yazan hedeflerde (FTP/SFTP/cPanel) yazilan dosyanin adresi — klasor ve
 *     dosya adi yazim aninda KAYDEDILEN konumdan (fileCopyPublicUrl); yayinci sayfaya
 *     ayni kuralla <link rel="canonical"> yazar (article-url.util.ts resolveArticleUrl).
 *  Digerleri (Contentful/Sanity/Strapi yonetim adresi, GitHub dosyasi,
 *  markdown zip, baska alan adi) listelenmez.
 *
 * Eskiden her makale icin `${site}/blog/${slug}.html` yaziliyordu: bu yol
 * yalniz bazi statik sitelerde var; WordPress ve digerlerinde 404'tu, yalniz
 * markdown zip olarak "yayinlanan" ve sitede hic olmayan yazilar da listede
 * gorunuyordu.
 */
export function articlePublicUrl(site: URL, slug: string, publishedTo: unknown, targets: Map<string, TargetRef>): string | null {
  return articlePublicEntry(site, slug, publishedTo, targets)?.url ?? null;
}

/**
 * articlePublicUrl ile ayni kural; adresi veren yayin kaydini da dondurur
 * (lastmod ve ozet metni o kayittan). Cop kutusundaki (trashedAt) ya da
 * silinmis (missingAt) kopya adres vermez: adres 404.
 *
 * opts.excludeUnseenDrafts: adresi henuz hic canli gorulmemis ve herkese acik oldugu
 * bilinmeyen WordPress kopyasi (republish-policy unseenWordPressDraftCopy) da adres
 * vermez. Adresi DISARIYA bildiren her yer kullanir (advertisedArticleEntry: site haritasi,
 * llms-full, persona sohbeti, yayincinin canonical'i, uretim hattinin JSON-LD'si); hedef
 * satirindan WordPress karari icin yalniz tip okunur (yoksa kayittaki targetType).
 */
export function articlePublicEntry(
  site: URL,
  slug: string,
  publishedTo: unknown,
  targets: Map<string, TargetRef>,
  opts: { excludeUnseenDrafts?: boolean } = {},
): { url: string; entry: PublishedEntry } | null {
  // Karar kayittaki WordPress durumundan (remoteStatus); hedef satirindan yalniz tip okunur
  const unseenDraft = (e: PublishedEntry) =>
    unseenWordPressDraftCopy(e as LiveEntry, typeof e.targetId === 'string' ? targets.get(e.targetId)?.type : undefined);
  const entries = (Array.isArray(publishedTo) ? publishedTo : []).filter(
    (e): e is PublishedEntry => !!e && typeof e === 'object' && (e as PublishedEntry).ok !== false && !entryNotLive(e as PublishedEntry)
      && !(opts.excludeUnseenDrafts === true && unseenDraft(e as PublishedEntry)),
  );
  for (const e of entries) {
    const onSite = sameSiteUrl(site, e.externalUrl) ?? sameSiteUrl(site, e.url);
    if (onSite) return { url: onSite, entry: e };
  }
  for (const e of entries) {
    const target = typeof e.targetId === 'string' ? targets.get(e.targetId) : undefined;
    if (!target || !FILE_TARGET_TYPES.has(target.type)) continue;
    // Kayittaki konumdan (klasor + dosya adi); bugunku klasor ayari ve slug yalniz eski kayitta
    const onSite = fileCopyPublicUrl(site, e, target, slug);
    if (onSite) return { url: onSite, entry: e };
  }
  return null;
}

/**
 * Site haritasinin (sitemap-ai.xml) ve llms-full / llms.txt'nin ILAN ettigi adres:
 * articlePublicEntry + WordPress taslak kopyasi kurali (excludeUnseenDrafts). Persona sohbeti,
 * yayincinin canonical'i (fullPageCanonicalUrl), uretim hattinin JSON-LD url'i ve canlilik
 * denetiminin "yeni ilan edilen adres" karari da bunu kullanir.
 *
 * NEDEN: WordPress hedef formunun varsayilani 'draft'; bu hedefe "yayinlanan" yazi
 * WordPress'te taslak olarak durur ve kayitli duz ?p=<id> adresi giris yapmamis
 * ziyaretciye 404 verir. Iki dosya bu olu adresi AI tarayicilarina ilan ediyordu. Kural
 * canlilik denetimiyle ayni (republish-policy unseenWordPressDraftCopy) ve KAYITTAKI
 * yazi durumuna (remoteStatus: RanksUp'in son yaziminda WordPress'in bildirdigi) bakar,
 * hedefin bugunku ayarina degil: durum 'publish' ise adres ilan edilir; taslak / bekleyen
 * / ozel yazi ya da durumu bilinmeyen eski kaydin duz ?p= adresi, adres bir kez canli
 * gorulene (liveSeenAt) kadar ilan edilmez. Durumu bilinmeyen eski kaydin guzel kalici
 * baglantisi eskisi gibi ilan edilir. Yazinin sitede baska bir adresi varsa (or. dosya
 * hedefi) o ilan edilir; yoksa site haritasi yaziyi listelemez, llms-full yayindaki
 * (PUBLISHED) yaziyi adressiz listeler (adresi cozulemeyen yazinin eski kurali).
 */
export function advertisedArticleEntry(
  site: URL,
  slug: string,
  publishedTo: unknown,
  targets: Map<string, TargetRef>,
): { url: string; entry: PublishedEntry } | null {
  return articlePublicEntry(site, slug, publishedTo, targets, { excludeUnseenDrafts: true });
}

/**
 * Bu yayinda `writing` hedefine yazilan TAM SAYFANIN (FTP / SFTP / cPanel / GitHub / Markdown
 * ZIP) <link rel="canonical"> adresi (saf; yazilmayacaksa null):
 *  1. Yazinin ilan edilen adresi (advertisedArticleEntry: site haritasi ve llms-full ile ayni
 *     kural). Yazilan kopyanin KENDI kaydi, adaptor bugunku klasore yazacagi icin yazimdan
 *     sonraki konumuyla sayilir: kayit baska klasoru gosteriyorsa (musteri klasoru degistirdi)
 *     o eski adres bu kopyanin adresi olmaz, yerine bugunku klasorden kurulan adres gelir.
 *  2. Ilan edilecek adres yoksa yazilan kopyanin KENDI adresi (self-canonical,
 *     fileCopyPublicUrl).
 *  3. O da bilinmiyorsa (GitHub, Markdown ZIP: sayfanin nerede sunulacagi bilinmez) null:
 *     kanonik baglanti yazilmaz.
 * NEDEN: canonical eskiden articlePublicUrl'den ya da varsayilan hedefin yol kuralindan
 * geliyordu. Hic canli gorulmemis WordPress taslaginin ?p= baglantisi (anonim ziyaretciye ve
 * tarayiciya 404) ya da kopyasi olmayan varsayilan hedefin yolu sayfanin kanonik adresi
 * oluyordu; 404'e isaret eden canonical sayfanin dizine alinmasina zarar verir. Kanonik
 * baglanti bildirmemek, var olmayan bir adresi bildirmekten iyidir.
 */
export function fullPageCanonicalUrl(
  site: URL,
  slug: string,
  publishedTo: unknown,
  targets: Map<string, TargetRef>,
  writing: { id: string; type: string; config?: unknown },
): string | null {
  const list = Array.isArray(publishedTo) ? publishedTo : [];
  const afterWrite = !FILE_TARGET_TYPES.has(writing.type) ? list : list.map((raw) => {
    if (!raw || typeof raw !== 'object' || (raw as PublishedEntry).targetId !== writing.id) return raw;
    const e = raw as PublishedEntry;
    const recorded = liveEntryRef({ ...e, targetId: writing.id }).externalUrl;
    // Konumu dusen kayit bugunku ayardan + yazinin slug'indan kurulur (fileCopyPublicUrl eski kayit kurali)
    return fileCopyAtConfiguredPath(writing.type, recorded, writing.config) ? raw : { ...e, externalUrl: undefined, url: undefined };
  });
  return advertisedArticleEntry(site, slug, afterWrite, targets)?.url ?? fileCopyPublicUrl(site, null, writing, slug);
}

/**
 * Kendi <link rel="canonical">'ini tasiyan TAM SAYFA yazan ve sitede canli sayilan hedefler
 * (fullPageCanonicalUrl'in yazildigi sayfalar): dosya hedefleri ve GitHub. Markdown ZIP disa
 * aktarimdir, sitede kopya sayilmaz.
 */
const FULL_PAGE_SITE_TYPES: ReadonlySet<string> = new Set([...FILE_TARGET_TYPES, 'GITHUB']);

/**
 * Bir kopyanin emekliye ayrilmasi (canlilik denetimi, yayincinin cop kutusu / silinmis
 * gozlemi) yazinin ILAN edilen adresini degistirdiyse, sayfasina canonical olarak o emekli
 * adresi yazmis canli tam sayfa kopyalarini (FTP / SFTP / cPanel / GitHub) "elle guncelleme
 * bekliyor" diye isaretler (saf; girdi degismez). before: emeklilikten onceki liste, after:
 * sonraki (yazilacak) liste.
 *
 * Kopyanin sayfasindaki canonical: yayincinin yazim aninda kayda gecirdigi canonicalUrl
 * (null: canonical yazilmadi). Alan olmayan eski kayitta bilinmez; emeklilikten onceki listeyle
 * bugun yazilacak canonical (fullPageCanonicalUrl) sayilir — sayfa o kopya ilan edilmeden once
 * yazildiysa gereksiz bir isaret cikabilir, zarari "bu hedefe yeniden yayinla" onerisidir.
 *
 * NEDEN: dosya kopyasinin canonical'i yazinin ilan edilen adresidir (or. WordPress kopyasi).
 * O kopya emekliye ayrilinca (adres 404) site haritasi ve llms-full dosya kopyasinin adresini
 * ilan etmeye baslar, dosya sayfasi ise hala 404 veren adresi kanonik bildirir: arama motoru
 * sayfayi o olu adresin kopyasi sayar. Sayfayi yalniz yeniden yazmak duzeltir; RanksUp dosya
 * hedefine kendiliginden yazmaz (musterinin karari), panel bu isaretle o hedefe yeniden yayini
 * onerir (manual-update.ts 'republishable'). Isaret mevcut "elle guncelleme" mekanizmasidir:
 * hedefe sonraki yazim ya da "Elle güncelledim" onu kaldirir. Kopyanin metni guncelse
 * (contentHash) site haritasi / llms-full metni yine ilan eder (publicArticleText kural 1).
 */
export function flagRetiredCanonicalCopies(input: {
  site: URL;
  slug: string;
  before: unknown;
  after: unknown;
  targets: Map<string, TargetRef>;
  now: string;
}): { publishedTo: unknown[]; flagged: string[] } {
  const list = Array.isArray(input.after) ? input.after : [];
  const unchanged = { publishedTo: list, flagged: [] as string[] };
  const old = advertisedArticleEntry(input.site, input.slug, input.before, input.targets);
  if (!old) return unchanged;
  const oldTargetId = typeof old.entry.targetId === 'string' ? old.entry.targetId : null;
  // Yalniz ilan edilen kopya artik canli degilse (emekliye ayrildi) ve ilan edilen adres degistiyse
  if (oldTargetId === null || liveEntries(list).some((e) => e.targetId === oldTargetId)) return unchanged;
  if (advertisedArticleEntry(input.site, input.slug, list, input.targets)?.url === old.url) return unchanged;
  const live = new Set(liveEntries(list));
  const flagged: string[] = [];
  const out = list.map((raw) => {
    if (!live.has(raw as LiveEntry)) return raw;
    const e = raw as LiveEntry;
    if (e.targetId === oldTargetId || e.manualUpdatePending === true) return raw;
    const target = input.targets.get(e.targetId);
    const type = String(target?.type ?? e.targetType ?? '');
    if (!FULL_PAGE_SITE_TYPES.has(type)) return raw;
    const canonical = Object.prototype.hasOwnProperty.call(e, 'canonicalUrl')
      ? (typeof e.canonicalUrl === 'string' ? e.canonicalUrl : null)
      : fullPageCanonicalUrl(input.site, input.slug, input.before, input.targets, { id: e.targetId, type, config: target?.config });
    if (canonical !== old.url) return raw;
    flagged.push(e.targetId);
    return {
      ...e,
      manualUpdatePending: true,
      manualUpdatePendingSince: typeof e.manualUpdatePendingSince === 'string' ? e.manualUpdatePendingSince : input.now,
    };
  });
  return flagged.length > 0 ? { publishedTo: out, flagged } : unchanged;
}

/**
 * Haritadaki <lastmod>: adresi veren canli kopyaya en son yazildigi an (yayin
 * kaydinin updatedAt'i: yerinde guncelleme, ayni yolun uzerine yazma ya da
 * musterinin "guncelledim" bildirimi); kayit bunu tasimiyorsa ilk yayin
 * tarihi, o da yoksa kayit tarihi.
 *
 * NEDEN: yerinde guncelleme artik publishedAt'i (ilk yayin) ilerletmiyor;
 * lastmod ilk yayinda kaliyor, guncellenen sayfa "degismedi" diye ilan
 * ediliyordu. Yazinin TUM kayitlarinin en yenisi degil, ADRESI VEREN kaydin
 * tarihi: baska bir hedefe (or. Markdown ZIP disa aktarimi) yazmak bu adresteki
 * sayfayi degistirmez, elle guncelleme bekleyen kopyanin tarihi de ilerlemez.
 * Kaynaklar: sitemaps.org protokolu ("The date of last modification of the
 * page"; haritanin uretildigi gun degil, sayfanin degistigi gun) ve Google
 * (lastmod "the date and time of the last significant update to the page",
 * yalniz tutarli ve dogrulanabilir sekilde dogruysa kullanilir) —
 * https://www.sitemaps.org/protocol.html,
 * https://developers.google.com/search/docs/crawling-indexing/sitemaps/build-sitemap
 */
export function articleLastmod(entry: { updatedAt?: unknown } | null | undefined, publishedAt: Date | null, createdAt: Date): Date {
  const t = typeof entry?.updatedAt === 'string' ? Date.parse(entry.updatedAt) : Number.NaN;
  if (Number.isFinite(t)) return new Date(t);
  return publishedAt ?? createdAt;
}

/**
 * Adresi veren kopyada GORUNEN metin — site haritasi ozeti ve llms-full icin (K6).
 *  - row: kayit metni bu adreste yayinda
 *  - live_snapshot: adreste yazinin yeniden yazimdan onceki metni var
 *    (agentOutputs.liveSnapshot — live-rewrite.ts snapshotToKeep)
 *  - unknown: adreste daha eski bir metin var ve RanksUp'ta kopyasi yok;
 *    metin ILAN EDILMEZ (adres yine listelenir)
 */
export interface PublicArticleText {
  source: 'row' | 'live_snapshot' | 'unknown';
  title: string | null;
  metaDescription: string | null;
  bodyMd: string | null;
  faqs: unknown;
}

/** publicArticleText'in okudugu makale alanlari (agentOutputs yalniz isaretli kopyada gerekir) */
export interface ArticleTextFields {
  title?: string | null;
  metaTitle?: string | null;
  metaDescription?: string | null;
  bodyMd?: string | null;
  faqs?: unknown;
  agentOutputs?: unknown;
}

const metinYaDaNull = (v: unknown): string | null => (typeof v === 'string' ? v : null);

/**
 * Adresi veren kayit "bu adreste yazinin DAHA ESKI metni yayinda" diye
 * isaretli mi (manualUpdatePending: RanksUp o kopyayi yerinde guncelleyemedi,
 * musteri elle guncellemeli — republish-policy refreshManualUpdateFlags).
 */
export function entryShowsOlderText(entry: PublishedEntry | null | undefined): boolean {
  return entry?.manualUpdatePending === true;
}

// ─────────────────────────────────────────────────────────────────────────
//  ONAY BEKLEYEN YENIDEN YAZIM (site haritasi + llms-full secimi)
//
//  NEDEN: yari otomatik modda yayindaki yazi yeniden yazilinca uretim hatti kaydi
//  READY_TO_PUBLISH / REVIZE_NEEDED'e ceker (pipeline.service), yeni metin onay
//  bekler; sitede ise ESKI metin yayinda kalir. Iki uretici yalniz PUBLISHED
//  okudugu icin yazi onaylanana kadar sitemap-ai.xml ve llms-full'dan
//  dusuyordu: sitede duran sayfa AI tarayicilarina hic ilan edilmiyordu. Artik
//  bu iki durumdaki yazi da listelenir — YALNIZ sitede canli (emekli olmayan)
//  bir adresi varsa ve metin o adresteki sayfanin metniyse (publicArticleText:
//  yeniden yazimdan onceki goruntu agentOutputs.liveSnapshot; bilinmiyorsa
//  metin ilan edilmez). Onaydaki yeni metin hicbir zaman ilan edilmez.
// ─────────────────────────────────────────────────────────────────────────

/** Yayindaki yazinin onay bekleyen yeniden yazimi bu durumlarda durur (pipeline.service, publisher REWRITTEN_SINCE_LIVE_STATUSES) */
export const PENDING_REVISION_STATUSES: ReadonlySet<string> = new Set(['READY_TO_PUBLISH', 'REVIZE_NEEDED']);

/** Yazi onay bekleyen bir yeniden yazimda mi (durum alani yoksa: hayir — eski cagiranlar yalniz PUBLISHED okur) */
export function isPendingRevision(status: unknown): boolean {
  return typeof status === 'string' && PENDING_REVISION_STATUSES.has(status);
}

/**
 * Site haritasi, llms-full ve canlilik denetiminin (articles/published-liveness.service.ts)
 * okudugu yazilar: PUBLISHED ve onay bekleyen yeniden yazimi olan, daha once yayinlanmis
 * (publishedAt dolu) yazi. Hic yayinlanmamis READY_TO_PUBLISH yazilar sorguya girmez;
 * onay bekleyenler yine de yalniz sitede canli adresi varsa listelenir (includePublicArticle).
 */
export function publicArticleFilter() {
  return {
    OR: [
      { status: 'PUBLISHED' as any },
      { status: { in: [...PENDING_REVISION_STATUSES] as any }, publishedAt: { not: null } },
    ],
  };
}

/** publicArticleFilter, tek site icin */
export function publicArticleWhere(siteId: string) {
  return { siteId, ...publicArticleFilter() };
}

/**
 * Sorgudan gelen yazi listelenir mi: PUBLISHED her zaman (adresi cozulemese de llms-full
 * onu linksiz listeler — eski davranis); onay bekleyen yeniden yazim yalniz sitede canli
 * bir adresi varsa (found): adresi olmayan yazinin ilan edilecek dogrulanmis bir metni yok.
 */
export function includePublicArticle(status: unknown, found: unknown): boolean {
  return !isPendingRevision(status) || !!found;
}

/**
 * Bu yazinin adresteki metni icin agir alanlar (govde, ajan ciktilari) gerekir mi:
 * adresi veren kopya eski metni gosteriyor ya da yazi onay bekleyen yeniden yazimda.
 */
export function needsOlderText(found: { entry: PublishedEntry } | null | undefined, status: unknown): boolean {
  return !!found && (entryShowsOlderText(found.entry) || isPendingRevision(status));
}

/**
 * Adresteki sayfanin metni. NEDEN: site haritasi ozeti ve llms-full her zaman
 * kayit metnini kullaniyordu; adresi veren kopya elle guncelleme bekliyorsa
 * o adresteki sayfa hala ESKI metni gosterir — AI'lara adresle birlikte
 * sayfada olmayan bir baslik/ozet/metin ilan ediliyordu.
 *
 * opts.pendingRevision: yazi onay bekleyen bir yeniden yazimda (READY_TO_PUBLISH /
 * REVIZE_NEEDED). Kayit metni onaydaki YENI metindir; adresteki sayfa onceki metni
 * gosterir. Kopya isaretli olmasa da ayni sira uygulanir.
 *
 * Isaretli kopyada (ya da onay bekleyen yeniden yazimda) sira:
 *  1. Kopyanin icerik izi (contentHash) kayit metninin iziyle ayniysa isaret
 *     bayattir: kayit metni.
 *  2. agentOutputs.liveSnapshot varsa ve kopyanin izi yoksa (eski kayit) ya da
 *     goruntunun iziyle ayniysa: goruntu (baslik, meta aciklama, govde, SSS).
 *  3. Aksi halde (goruntu yok ya da kopya ondan da eski bir metni gosteriyor —
 *     ust uste iki yeniden yazim): unknown. Yanlis metin ilan etmektense hic
 *     metin ilan edilmez.
 */
export function publicArticleText(row: ArticleTextFields, entry: PublishedEntry, opts: { pendingRevision?: boolean } = {}): PublicArticleText {
  const rowText: PublicArticleText = {
    source: 'row',
    title: row.title ?? null,
    metaDescription: row.metaDescription ?? null,
    bodyMd: row.bodyMd ?? null,
    faqs: row.faqs ?? null,
  };
  if (!entryShowsOlderText(entry) && opts.pendingRevision !== true) return rowText;
  const hash = typeof entry.contentHash === 'string' && entry.contentHash !== '' ? entry.contentHash : null;
  if (hash && hash === articleContentHash(row)) return rowText;
  const ao = row.agentOutputs;
  const snap = ao && typeof ao === 'object' && !Array.isArray(ao) ? (ao as Record<string, unknown>).liveSnapshot : null;
  if (snap && typeof snap === 'object' && !Array.isArray(snap)) {
    const s = snap as Record<string, unknown>;
    const text = {
      title: metinYaDaNull(s.title),
      metaTitle: metinYaDaNull(s.metaTitle),
      metaDescription: metinYaDaNull(s.metaDescription),
      bodyMd: metinYaDaNull(s.bodyMd),
    };
    if (!hash || hash === articleContentHash(text)) {
      return { source: 'live_snapshot', title: text.title, metaDescription: text.metaDescription, bodyMd: text.bodyMd, faqs: s.faqs ?? null };
    }
  }
  return { source: 'unknown', title: null, metaDescription: null, bodyMd: null, faqs: null };
}

/**
 * Adresi veren kopyasi isaretli makalelerin metin karsilastirmasi icin gereken
 * agir alanlari (govde, ajan ciktilari) YALNIZ o makaleler icin okur: 1000
 * makalelik haritada hepsinin agentOutputs'u onlarca MB olurdu.
 */
export async function loadOlderTextFields(
  prisma: { article: { findMany: (args: any) => Promise<Array<{ id: string; metaTitle?: string | null; bodyMd?: string | null; agentOutputs?: unknown }>> } },
  ids: string[],
): Promise<Map<string, { metaTitle?: string | null; bodyMd?: string | null; agentOutputs?: unknown }>> {
  const out = new Map<string, { metaTitle?: string | null; bodyMd?: string | null; agentOutputs?: unknown }>();
  if (ids.length === 0) return out;
  const rows = await prisma.article.findMany({
    where: { id: { in: ids } },
    select: { id: true, metaTitle: true, bodyMd: true, agentOutputs: true },
  });
  for (const r of rows) {
    if (typeof r?.id === 'string') out.set(r.id, { metaTitle: r.metaTitle, bodyMd: r.bodyMd, agentOutputs: r.agentOutputs });
  }
  return out;
}

/**
 * Kayitli adres hic canli gorulmemis duz ?p=<id> baglantisi mi? Oyleyse hedef satiri
 * okunur: kopyanin WordPress kopyasi olup olmadigi (advertisedArticleEntry) hedef
 * satirindaki tipten bilinir, kayitta targetType olmayan eski kayitta da.
 */
function plainLinkAwaitingSighting(e: PublishedEntry): boolean {
  const url = typeof e.externalUrl === 'string' && e.externalUrl ? e.externalUrl : typeof e.url === 'string' ? e.url : '';
  const seen = typeof e.liveSeenAt === 'string' && Number.isFinite(Date.parse(e.liveSeenAt));
  return !!url && !seen && wordPressPlainLink(url);
}

/**
 * Yayin hedefi ayarlarini yukler (kimlik bilgisi okunmaz) — yalniz gerekiyorsa: bir
 * yayin kaydinin sitedeki adresi yoksa (dosya yazan hedefin kanonik adresi icin) ya da
 * kayitli adres hic canli gorulmemis duz ?p= baglantisiysa (kopya WordPress kopyasi mi:
 * hedef tipi, advertisedArticleEntry). Site haritasi ve llms-full AYNI adres kuralini
 * kullansin diye ortak.
 */
export async function loadArticleTargets(
  prisma: { publishTarget: { findMany: (args: any) => Promise<Array<{ id: string; type: unknown; config: unknown }>> } },
  siteId: string,
  site: URL,
  articles: Array<{ publishedTo: unknown }>,
): Promise<Map<string, TargetRef>> {
  const needsTargets = articles.some((a) => Array.isArray(a.publishedTo) && (a.publishedTo as PublishedEntry[])
    .some((e) => !!e && typeof e === 'object' && typeof e.targetId === 'string'
      && ((!sameSiteUrl(site, e.externalUrl) && !sameSiteUrl(site, e.url)) || plainLinkAwaitingSighting(e))));
  const targets = new Map<string, TargetRef>();
  if (needsTargets) {
    const rows = await prisma.publishTarget.findMany({ where: { siteId }, select: { id: true, type: true, config: true } });
    for (const t of rows) targets.set(t.id, { type: String(t.type), config: t.config });
  }
  return targets;
}

/** Editor skoruna gore <priority> (0.4-0.9); skorun olcegi yazinin tarihinden */
export function articlePriority(editorScore: number | null, createdAt: Date): string {
  const max = createdAt.getTime() < EDITOR_SCALE_90_SINCE_MS ? 60 : 90;
  const score = editorScore ?? max * (5 / 6); // skoru yok: eski varsayilan 50/60 orani
  return Math.min(0.9, 0.4 + (score / max) * 0.5).toFixed(1);
}

/**
 * AI Sitemap (sitemap-ai.xml) — standart sitemap'ten ayri, AI arama
 * motorlari icin ek alanli site haritasi. HERKESE ACIK uctan sunulur
 * (GET /api/sites/:id/audit/sitemap-ai.xml) ve musterinin robots.txt'indeki
 * `Sitemap:` satiriyla gosterilir.
 *
 * Icerik:
 *   - Ana sayfa: <ai:summary> sitenin KENDI meta aciklamasi (okunamazsa yok)
 *   - Yayindaki makaleler: yalniz kamusal adresi bu sitede bilinenler
 *     (advertisedArticleEntry; cop kutusundaki / silinmis kopya ve hic canli gorulmemis
 *     WordPress taslak baglantisi adres vermez). Yeniden yazimi onay
 *     bekleyen yayindaki yazi da (READY_TO_PUBLISH / REVIZE_NEEDED, sitede canli
 *     adresi var) listelenir; metni adresteki eski metindir (publicArticleWhere); <ai:summary>
 *     ADRESTEKI sayfanin meta aciklamasinin ilk 200 karakteri (publicArticleText:
 *     kopya eski metni gosteriyorsa onceki goruntu, bilinmiyorsa yok),
 *     <ai:topics> AEO sorulari (yalniz kayit metni adresteyse), <priority> editor skoruna gore
 *   - <image:image> yalniz gorsel sitenin kendi host'undaysa: Google baska
 *     alan adindaki gorseli ancak iki alan adi da Search Console'da
 *     dogrulanmissa kabul eder (musteri RanksUp'in alan adini dogrulayamaz) —
 *     https://developers.google.com/search/docs/crawling-indexing/sitemaps/image-sitemaps
 *   - <lastmod> yalniz makalede (adresi veren kopyaya son yazim — articleLastmod;
 *     yoksa ilk yayin tarihi). Ana sayfaya "bugun" yazmak
 *     protokole aykiriydi: tarih sayfanin degistigi gun olmali, haritanin
 *     uretildigi gun degil (https://www.sitemaps.org/protocol.html, <lastmod>);
 *     Google da lastmod'u yalniz tutarli ve dogrulanabilir sekilde dogruysa
 *     kullanir (https://developers.google.com/search/docs/crawling-indexing/sitemaps/build-sitemap).
 */
@Injectable()
export class AiSitemapService {
  private readonly log = new Logger(AiSitemapService.name);
  /** SSRF korumali metin okuma (testte degistirilir) */
  protected fetchText = safeFetchText;
  private readonly homeSummaryCache = new Map<string, { value: string | null; expiresAt: number }>();
  private readonly publicXmlCache = new Map<string, { xml: string; expiresAt: number }>();
  /** Ayni sitenin es zamanli onbellek kacirmalari tek uretimi bekler */
  private readonly publicXmlInflight = new Map<string, Promise<string | null>>();

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Herkese acik uc icin XML. Site yoksa ya da sahibinin hesap silme talebi
   * varsa null (uc 404 doner). Sonuc PUBLIC_SITEMAP_TTL_MS onbellekte tutulur.
   */
  async getPublicXml(siteId: string): Promise<string | null> {
    // Yalniz kanonik kimlik (common/site-id.ts): onbellek ve uretim kilidi
    // kimlik dizesiyle anahtarlanir; harmanlama harf/bosluk farkini yok saydigi
    // icin her varyant ayni sitenin 1000 makalelik haritasini yeniden uretirdi.
    if (!isCanonicalSiteId(siteId)) return null;
    const now = Date.now();
    const cached = this.publicXmlCache.get(siteId);
    if (cached && cached.expiresAt > now) return cached.xml;
    const running = this.publicXmlInflight.get(siteId);
    if (running) return running;
    const task = this.buildPublic(siteId).finally(() => this.publicXmlInflight.delete(siteId));
    this.publicXmlInflight.set(siteId, task);
    return task;
  }

  private async buildPublic(siteId: string): Promise<string | null> {
    const site = await this.prisma.site.findUnique({
      where: { id: siteId },
      select: { id: true, url: true, user: { select: { deletionRequestedAt: true } } },
    });
    const siteUrl = parseSiteUrl(site?.url);
    // site.id birebir ayni olmali — kanonik bicim kuralina ek ikinci kapi
    if (!site || site.id !== siteId || site.user?.deletionRequestedAt || !siteUrl) {
      this.publicXmlCache.delete(siteId);
      return null;
    }
    const { xml } = await this.buildForSite(site.id, site.url, siteUrl);
    this.publicXmlCache.delete(siteId);
    this.publicXmlCache.set(siteId, { xml, expiresAt: Date.now() + PUBLIC_SITEMAP_TTL_MS });
    // Map ekleme sirasini korur: en eski kayit ilk anahtar
    while (this.publicXmlCache.size > PUBLIC_SITEMAP_MAX_ENTRIES) {
      const oldest = this.publicXmlCache.keys().next().value;
      if (oldest === undefined) break;
      this.publicXmlCache.delete(oldest);
    }
    return xml;
  }

  /** Onbelleksiz uretim (site yoksa Prisma hatasi firlar) */
  async build(siteId: string): Promise<{ xml: string; bytes: number; urls: number }> {
    const site = await this.prisma.site.findUniqueOrThrow({ where: { id: siteId }, select: { id: true, url: true } });
    const siteUrl = parseSiteUrl(site.url);
    if (!siteUrl) throw new Error(`Site adresi geçersiz: ${siteId}`);
    return this.buildForSite(site.id, site.url, siteUrl);
  }

  private async buildForSite(siteId: string, rawUrl: string, site: URL): Promise<{ xml: string; bytes: number; urls: number }> {
    const articles = await this.prisma.article.findMany({
      // PUBLISHED + sitede eski metniyle duran, yeniden yazimi onay bekleyen yazi (publicArticleWhere)
      where: publicArticleWhere(siteId),
      orderBy: { publishedAt: 'desc' },
      take: 1000,
      // Govde (bodyMd/bodyHtml) ve ajan ciktilari okunmaz: 1000 makalede onlarca MB
      // (adresi veren kopyasi eski metni gosteren makaleler icin ayrica — loadOlderTextFields)
      select: {
        id: true, slug: true, title: true, metaDescription: true, frontmatter: true, editorScore: true,
        publishedAt: true, createdAt: true, publishedTo: true, heroImageUrl: true, status: true,
      },
    });

    // Hedef ayari yalniz gerekiyorsa okunur (dosya yazan hedefin kanonik adresi, duz ?p=
    // kopyasinin hedef tipi); kimlik bilgisi (credentials) okunmaz
    const targets = await loadArticleTargets(this.prisma, siteId, site, articles);
    // Hic canli gorulmemis WordPress taslak baglantisi (?p=) ilan edilmez: adresi 404 verir
    const resolved = articles
      .map((a) => ({ a, found: advertisedArticleEntry(site, a.slug, a.publishedTo, targets) }))
      .filter((r) => includePublicArticle(r.a.status, r.found));
    const olderText = await loadOlderTextFields(
      this.prisma,
      resolved.filter((r) => needsOlderText(r.found, r.a.status)).map((r) => r.a.id),
    );

    let xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
        xmlns:ai="https://luvihost.com.tr/schemas/ai-sitemap"
        xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">
`;

    // Anasayfa. Ozet eskiden "<ad> — <nis> alanında hizmet veren Türkiye
    // merkezli platform." diye UYDURULUYORDU: her musterinin site haritasina
    // isi hakkinda dogrulanmamis bir iddia (Turkiye merkezli, platform)
    // yaziliyordu. Simdi sitenin kendi ana sayfasindaki meta aciklama okunur;
    // okunamazsa (engel, zaman asimi, aciklama yok) ozet alani hic yazilmaz.
    const baseUrl = rawUrl.replace(/\/+$/, '');
    const homeSummary = await this.readHomepageSummary(`${baseUrl}/`);
    const homeLoc = `${site.protocol}//${site.host}${site.pathname.endsWith('/') ? site.pathname : `${site.pathname}/`}`;
    const seen = new Set<string>([homeLoc]);
    xml += `  <url>
    <loc>${xmlText(homeLoc)}</loc>
    <changefreq>daily</changefreq>
    <priority>1.0</priority>
${homeSummary ? `    <ai:summary>${xmlText(homeSummary)}</ai:summary>\n` : ''}  </url>
`;

    for (const { a, found } of resolved) {
      if (!found || seen.has(found.url)) continue;
      const url = found.url;
      seen.add(url);
      const lastmod = articleLastmod(found.entry, a.publishedAt, a.createdAt).toISOString().slice(0, 10);
      // Ozet adresteki sayfanin metninden (K6): kopya eski metni gosteriyorsa ya da
      // yeniden yazim onay bekliyorsa yeniden yazimdan onceki goruntu, o da
      // bilinmiyorsa ozet yazilmaz
      const text = publicArticleText(
        { title: a.title, metaDescription: a.metaDescription, ...olderText.get(a.id) },
        found.entry,
        { pendingRevision: isPendingRevision(a.status) },
      );
      const summary = (text.metaDescription ?? '').slice(0, SUMMARY_MAX_CHARS).trim();
      const fm: any = a.frontmatter ?? {};
      // AEO sorulari kayit metninden uretildi: adresteki sayfa baska (eski)
      // metni gosteriyorsa o sorulari yanitladigi iddia edilmez
      const aeoQueries: unknown[] = text.source === 'row' && Array.isArray(fm.aeo_queries) ? fm.aeo_queries : [];
      const topics = aeoQueries.filter((q): q is string => typeof q === 'string' && q.trim().length > 0).slice(0, 5);
      const changefreq = (a.publishedAt && Date.now() - a.publishedAt.getTime() < 30 * 86400000) ? 'daily' : 'weekly';

      xml += `  <url>
    <loc>${xmlText(url)}</loc>
    <lastmod>${lastmod}</lastmod>
    <changefreq>${changefreq}</changefreq>
    <priority>${articlePriority(a.editorScore, a.createdAt)}</priority>
`;
      if (summary) xml += `    <ai:summary>${xmlText(summary)}</ai:summary>\n`;
      if (topics.length > 0) {
        xml += `    <ai:topics>\n`;
        for (const q of topics) xml += `      <ai:topic>${xmlText(q)}</ai:topic>\n`;
        xml += `    </ai:topics>\n`;
      }
      const image = sameSiteUrl(site, a.heroImageUrl);
      if (image) {
        // Onaydaki yeni baslik ilan edilmez: adresteki metin bilinmiyorsa gorsel basligi yazilmaz
        const imageTitle = text.title ?? (isPendingRevision(a.status) ? null : a.title);
        xml += `    <image:image><image:loc>${xmlText(image)}</image:loc>${imageTitle ? `<image:title>${xmlText(imageTitle)}</image:title>` : ''}</image:image>\n`;
      }
      xml += `  </url>\n`;
    }

    xml += `</urlset>\n`;

    return { xml, bytes: Buffer.byteLength(xml, 'utf8'), urls: seen.size };
  }

  /**
   * Ana sayfanin kendi meta aciklamasi. Adres musterinin kaydettigi site
   * adresidir: ic aga / metadata adresine baglanmamak icin safe-fetch.
   * Kisa zaman asimi: site haritasi istegi yavas bir sitede asili kalmasin.
   */
  private async readHomepageSummary(url: string): Promise<string | null> {
    const now = Date.now();
    const cached = this.homeSummaryCache.get(url);
    if (cached && cached.expiresAt > now) return cached.value;

    let value: string | null = null;
    try {
      const res = await this.fetchText(url, {
        timeoutMs: 6_000,
        maxBytes: 512 * 1024,
        errorBodyBytes: 0,
        accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.1',
      });
      value = res.ok && !res.binary ? homepageMetaDescription(res.text) : null;
    } catch (err: any) {
      this.log.warn(`Ana sayfa meta aciklamasi okunamadi (${url}): ${err?.message ?? err}`);
    }

    this.homeSummaryCache.delete(url);
    this.homeSummaryCache.set(url, { value, expiresAt: now + (value ? HOME_SUMMARY_TTL_MS : HOME_SUMMARY_MISS_TTL_MS) });
    // Map ekleme sirasini korur: en eski kayit ilk anahtar
    while (this.homeSummaryCache.size > HOME_SUMMARY_MAX_ENTRIES) {
      const oldest = this.homeSummaryCache.keys().next().value;
      if (oldest === undefined) break;
      this.homeSummaryCache.delete(oldest);
    }
    return value;
  }
}
