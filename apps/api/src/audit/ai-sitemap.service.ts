import { Injectable, Logger } from '@nestjs/common';
import { load } from 'cheerio';
import { PrismaService } from '../prisma/prisma.service.js';
import { safeFetchText } from '../common/safe-fetch.js';
import { isCanonicalSiteId } from '../common/site-id.js';
import { resolveArticleUrl } from '../articles/article-url.util.js';
import { articleContentHash, entryRetired } from '../articles/republish-policy.js';

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
 * Yalniz bu hedefler gercek .html dosyasi yazar ve kamusal adresi hedef
 * ayarindan bellidir (articles/article-url.util.ts FILE_BASED_TARGETS ile
 * ayni liste). Adaptorleri adres dondurmez ya da ftp:// / sunucu yolu dondurur.
 */
const FILE_TARGET_TYPES = new Set(['FTP', 'SFTP', 'CPANEL_API']);

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
 *  2. Dosya yazan hedeflerde (FTP/SFTP/cPanel) yayinin kanonik adresi —
 *     yayinci sayfaya ayni kuralla <link rel="canonical"> yazar
 *     (article-url.util.ts resolveArticleUrl).
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
 */
export function articlePublicEntry(
  site: URL,
  slug: string,
  publishedTo: unknown,
  targets: Map<string, TargetRef>,
): { url: string; entry: PublishedEntry } | null {
  const entries = (Array.isArray(publishedTo) ? publishedTo : []).filter(
    (e): e is PublishedEntry => !!e && typeof e === 'object' && (e as PublishedEntry).ok !== false && !entryNotLive(e as PublishedEntry),
  );
  for (const e of entries) {
    const onSite = sameSiteUrl(site, e.externalUrl) ?? sameSiteUrl(site, e.url);
    if (onSite) return { url: onSite, entry: e };
  }
  for (const e of entries) {
    const target = typeof e.targetId === 'string' ? targets.get(e.targetId) : undefined;
    if (!target || !FILE_TARGET_TYPES.has(target.type)) continue;
    const base = `${site.protocol}//${site.host}${site.pathname}`;
    const onSite = sameSiteUrl(site, resolveArticleUrl(base, slug, target).url);
    if (onSite) return { url: onSite, entry: e };
  }
  return null;
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

/**
 * Adresteki sayfanin metni. NEDEN: site haritasi ozeti ve llms-full her zaman
 * kayit metnini kullaniyordu; adresi veren kopya elle guncelleme bekliyorsa
 * o adresteki sayfa hala ESKI metni gosterir — AI'lara adresle birlikte
 * sayfada olmayan bir baslik/ozet/metin ilan ediliyordu.
 *
 * Isaretli kopyada sira:
 *  1. Kopyanin icerik izi (contentHash) kayit metninin iziyle ayniysa isaret
 *     bayattir: kayit metni.
 *  2. agentOutputs.liveSnapshot varsa ve kopyanin izi yoksa (eski kayit) ya da
 *     goruntunun iziyle ayniysa: goruntu (baslik, meta aciklama, govde, SSS).
 *  3. Aksi halde (goruntu yok ya da kopya ondan da eski bir metni gosteriyor —
 *     ust uste iki yeniden yazim): unknown. Yanlis metin ilan etmektense hic
 *     metin ilan edilmez.
 */
export function publicArticleText(row: ArticleTextFields, entry: PublishedEntry): PublicArticleText {
  const rowText: PublicArticleText = {
    source: 'row',
    title: row.title ?? null,
    metaDescription: row.metaDescription ?? null,
    bodyMd: row.bodyMd ?? null,
    faqs: row.faqs ?? null,
  };
  if (!entryShowsOlderText(entry)) return rowText;
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
 * Dosya yazan hedeflerin kanonik adresi icin gereken yayin hedefi ayarlarini
 * yukler — yalniz bir yayin kaydinin sitedeki adresi yoksa (kimlik bilgisi
 * okunmaz). Site haritasi ve llms-full AYNI adres kuralini kullansin diye ortak.
 */
export async function loadArticleTargets(
  prisma: { publishTarget: { findMany: (args: any) => Promise<Array<{ id: string; type: unknown; config: unknown }>> } },
  siteId: string,
  site: URL,
  articles: Array<{ publishedTo: unknown }>,
): Promise<Map<string, TargetRef>> {
  const needsTargets = articles.some((a) => Array.isArray(a.publishedTo) && (a.publishedTo as PublishedEntry[])
    .some((e) => !!e && typeof e === 'object' && typeof e.targetId === 'string'
      && !sameSiteUrl(site, e.externalUrl) && !sameSiteUrl(site, e.url)));
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
 *     (articlePublicUrl; cop kutusundaki kopya adres vermez); <ai:summary>
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
      where: { siteId, status: 'PUBLISHED' as any },
      orderBy: { publishedAt: 'desc' },
      take: 1000,
      // Govde (bodyMd/bodyHtml) ve ajan ciktilari okunmaz: 1000 makalede onlarca MB
      // (adresi veren kopyasi eski metni gosteren makaleler icin ayrica — loadOlderTextFields)
      select: {
        id: true, slug: true, title: true, metaDescription: true, frontmatter: true, editorScore: true,
        publishedAt: true, createdAt: true, publishedTo: true, heroImageUrl: true,
      },
    });

    // Hedef ayari yalniz bir yayin kaydinin sitedeki adresi yoksa okunur (dosya
    // yazan hedefin kanonik adresi icin); kimlik bilgisi (credentials) okunmaz
    const targets = await loadArticleTargets(this.prisma, siteId, site, articles);
    const resolved = articles.map((a) => ({ a, found: articlePublicEntry(site, a.slug, a.publishedTo, targets) }));
    const olderText = await loadOlderTextFields(
      this.prisma,
      resolved.filter((r) => r.found && entryShowsOlderText(r.found.entry)).map((r) => r.a.id),
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
      // Ozet adresteki sayfanin metninden (K6): kopya eski metni gosteriyorsa
      // yeniden yazimdan onceki goruntu, o da bilinmiyorsa ozet yazilmaz
      const text = publicArticleText({ title: a.title, metaDescription: a.metaDescription, ...olderText.get(a.id) }, found.entry);
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
        xml += `    <image:image><image:loc>${xmlText(image)}</image:loc><image:title>${xmlText(text.title ?? a.title)}</image:title></image:image>\n`;
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
