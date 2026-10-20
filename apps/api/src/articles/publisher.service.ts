import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import fs from 'node:fs/promises';
import path from 'node:path';
import { PrismaService } from '../prisma/prisma.service.js';
import { decryptCredentials, mdToHtml, parseFrontmatter } from '@luviai/shared';
import { getAdapter, type PublishPayload } from '@luviai/adapters';
import { ImageGeneratorService } from './image-generator.service.js';
import { AiIndexingPingerService } from '../audit/ai-indexing-pinger.service.js';
import { LlmsFullBuilderService } from '../audit/llms-full-builder.service.js';
import { LinkValidatorService } from './link-validator.service.js';
import { SiteUrlInventoryService } from '../sites/site-url-inventory.service.js';
// Tam sayfanin kanonik adresi: site haritasi, llms-full ve JSON-LD'nin ilan ettigi adresle ayni kural
import { advertisedArticleEntry, flagRetiredCanonicalCopies, fullPageCanonicalUrl, parseSiteUrl } from '../audit/ai-sitemap.service.js';
import { sectionPathOf } from './live-rewrite.js';
// Adresi bilinmeyen tam sayfada JSON-LD'nin yazi adresi alanlari uretim hattinin kuraliyla silinir
import { omitJsonLdArticleUrl } from './pipeline.service.js';
import { QaGateService } from './qa-gate.service.js';
import { stripHeroPlaceholder, applyHeroImageToJsonLd } from './hero-placeholder.js';
import { describeHeroImage } from './hero-alt.js';
import { LLMProviderService } from '../llm/llm-provider.service.js';
// Adaptor istegi oncesi adres denetimi (reddedilirse Turkce neden, gecerse
// null). Adaptorler duz fetch / FTP / SSH ile kullanicinin girdigi adrese
// baglanir; kayittan sonra DNS ic aga cevrilmis olabilir. Bozuk hedef yalniz
// KENDISINI atlar — toplu yayin digerleriyle surer, is cokmez.
import { publishTargetBlockReason } from '../publish-targets/publish-target-url.js';
// Silinmis gorunen kaydin herkese acik adres yoklamasi (S18): SSRF korumali, durust kimlik
import { safeFetchText } from '../common/safe-fetch.js';
// Yaniti canlilik denetimiyle AYNI kural okur: engel / bot dogrulama sayfasi 404 dese de belirsiz
import { classifyLivenessResponse, publicUrlFetchOptions, siteHomepage } from './public-url-probe.js';
// Yayindaki yazinin yeniden yayini: hedef basina guncelle / uzerine yaz / kopya acma
import {
  BLOCK_SKIP, agentOutputsWithLiveWriteBlocked, applyEntryObservations, articleContentHash, decideRepublish, liveCopyStale,
  publishSkipText, publishedEntryFor, refreshManualUpdateFlags, republishModeForType, selectPublishTargets, siteLiveEntries, statusAfterRetirement,
  type LiveWriteBlockedReason, type PublishSkip, type PublishTargetRow, type RepublishDecision,
} from './republish-policy.js';

/**
 * Yayini kim baslatti (paylasilan sozlesme D2)?
 *  - 'user': kullanicinin acik yayin istegi — panel / API anahtari ile POST
 *    .../publish → PUBLISH_ARTICLE isi (worker 'user' verir).
 *  - 'automation': kullanicinin o an istemedigi yayin — worker'in uretim sonrasi
 *    otomatik yayini (Tam otomatik, pivot yeniden yazimi) ve takili sayfa yeniden
 *    yayini. Verilmezse bu sayilir: belirsizlikte guvenli yon (silinen yazi geri
 *    getirilmez).
 */
export type PublishInitiator = 'user' | 'automation';

/**
 * Yeniden yazim hatti (pipeline) yayindaki yaziyi bu durumlara ceker; PUBLISHED
 * yazinin metni en son yayinlanan metindir. Icerik izi (contentHash) olmayan
 * eski yayin kayitlari icin "metin canliya ciktiktan sonra degisti mi" sorusunun
 * cevabi buradan verilir (republish-policy.ts refreshManualUpdateFlags).
 */
const REWRITTEN_SINCE_LIVE_STATUSES: ReadonlySet<string> = new Set(['READY_TO_PUBLISH', 'REVIZE_NEEDED']);

/**
 * Yayin sonunda yaziya yazim: kosullu deneme sayisi (K10). Her denemede kayit
 * yeniden okunur, bu yayinin sonucu GUNCEL publishedTo uzerine hedef bazinda
 * birlestirilir ve yalniz okunan updatedAt hala gecerliyse yazilir. Hepsi
 * yarisirsa son yazim en taze okumanin uzerine kosulsuz yapilir: yeni acilan
 * kopyanin kaydi (kimlik, adres) kaybolursa sonraki yayin ikinci kopya acardi.
 */
const COMMIT_CONDITIONAL_ATTEMPTS = 3;

/** Yayin sonunda yeniden okunan alanlar: kayit listesi, kilit ve metnin izi */
const FRESH_STATE_SELECT = {
  publishedTo: true, updatedAt: true, status: true, publishedAt: true,
  title: true, metaTitle: true, metaDescription: true, bodyMd: true,
} as const;

interface FreshArticleState {
  publishedTo: unknown;
  updatedAt: Date;
  status: unknown;
  publishedAt: Date | null;
  title: string | null;
  metaTitle: string | null;
  metaDescription: string | null;
  bodyMd: string | null;
  /** Yalniz istenince okunur (agir alan): otomatik yazim engeli kaydi icin */
  agentOutputs?: unknown;
}

/**
 * Bu yayinda hedeflerde GORULENLER (yazilmayan kayitlara islenir):
 *  - trashed: yazi WordPress'te cop kutusunda → kayda trashedAt
 *  - missing: yazi hedefte silinmis (kimlik VE adres 404/410) ve yeniden
 *    olusturulmadi → kayda missingAt (D3)
 *  - present: yazi duruyor, cop kutusunda degil (musterinin duzenlemesi korundu;
 *    ya da kimlik cozulmese de adres hala aciliyor: live_entry_unresolvable, S18).
 *    presentStatus: yalniz kimligiyle gorulenlerin (live_entry_edited) WordPress durumu;
 *    emekli kopya yalniz 'publish' ise geri gelir (taslaga alinan yazi yayinda degil)
 *  - unwritable: RanksUp bu kopyaya yazmadi — WordPress'te degismis, kimlik bu
 *    yaziya ait degil ya da cozulmuyor ama adres aciliyor, ya da kullanici acik
 *    listede o hedefi secmedi (D1) → metin farkliysa elle guncelleme isareti
 * live_entry_unverified (kimlik bulunamadi, adres dogrulanamadi) hicbirine
 * girmez: kopyanin durumu bilinmiyor, kayit oldugu gibi kalir.
 */
function entryObservations(results: PublishResult[]): {
  trashed: Set<string>; missing: Set<string>; present: Set<string>; presentStatus: Map<string, string | null>; unwritable: Set<string>;
} {
  const ids = (skips: readonly PublishSkip[]) => new Set(results.filter((r) => !!r.skipped && skips.includes(r.skipped)).map((r) => r.targetId));
  return {
    trashed: ids(['live_entry_trashed']),
    missing: ids(['live_entry_missing']),
    present: ids(['live_entry_edited', 'live_entry_unresolvable']),
    // Yalniz kimligiyle gorulen kopya (live_entry_edited) ve WordPress'in bildirdigi durumu:
    // emekli kopya yalniz 'publish' ise canli sayilir (republish-policy applyEntryObservations)
    presentStatus: new Map(results.filter((r) => r.skipped === 'live_entry_edited').map((r) => [r.targetId, r.remoteStatus ?? null])),
    unwritable: ids(['live_entry_edited', 'live_entry_mismatch', 'live_entry_unresolvable', 'live_target_not_selected']),
  };
}

/**
 * refreshManualUpdateFlags sonucuna emekli canonical isaretlerini (ai-sitemap.service
 * flagRetiredCanonicalCopies) ekler: liste isaretli haliyle, bekleyen hedefler birlesik.
 */
function withRetiredCanonicalFlags(
  refreshed: { publishedTo: unknown[]; changed: boolean; pendingTargetIds: string[] },
  canonical: { publishedTo: unknown[]; flagged: string[] },
): { publishedTo: unknown[]; changed: boolean; pendingTargetIds: string[] } {
  if (canonical.flagged.length === 0) return refreshed;
  return {
    publishedTo: canonical.publishedTo,
    changed: true,
    pendingTargetIds: [...new Set([...refreshed.pendingTargetIds, ...canonical.flagged])],
  };
}

/**
 * Kayitli yazinin herkese acik adresinin durumu (S18). Yonlendirmeler izlenir,
 * karari son yanit verir (public-url-probe.ts classifyLivenessResponse — canlilik
 * denetimiyle ayni kural):
 *  - 'gone': 404 / 410 ve yanit bir engel / bot dogrulama sayfasi degil: yazi o
 *    adreste artik yok
 *  - 'live': 2xx / 3xx: adres hala aciliyor (yazi orada duruyor ya da baska
 *    bir adrese yonlendiriliyor)
 *  - 'unknown': adres kayitli degil, baska durum (401/403/429/5xx), guvenlik
 *    duvari / bot dogrulama sayfasi (durum 404 olsa da), sitenin ana sayfasina
 *    yonlendirme ya da ag / adres hatasi (zaman asimi, ic adrese cozulme, cok
 *    fazla yonlendirme)
 */
export type EntryUrlState = 'gone' | 'live' | 'unknown';

/**
 * Kayitli adresi yoklayan islev (PublisherService; testte sahtesi verilir).
 * opts.homepage: sitenin ana sayfasi — silinen yaziyi ana sayfaya yonlendiren site
 * "adres aciliyor" sayilmasin diye (classifyLivenessResponse).
 */
export type EntryUrlCheck = (url: string | undefined, opts?: { homepage?: string | null }) => Promise<EntryUrlState>;

/**
 * Kayitli yazi adresini common/safe-fetch ile yoklar: yalniz http/https ve
 * 80/443, ic aga baglanmaz, yonlendirmenin her adimi yeniden denetlenir, durust
 * bot kimligi (RANKSUP_BOT_UA) gonderilir. Govdenin yalniz basi okunur
 * (publicUrlFetchOptions: 32 KB, sorgulu adreste 256 KB): engel / bot dogrulama
 * sayfasini ve sorgulu adreste sayfanin kanonik baglantisini tanimak icin. Hata
 * firlatmaz: her belirsizlik 'unknown'.
 *
 * NEDEN publicUrlFetchOptions: ortak siniflandirici sorgulu adreste (WordPress ?p=)
 * ana sayfayi kanonik bildiren sayfayi 'unknown' sayar. <link rel=canonical> <head>'de
 * satir ici CSS / betiklerden sonra 32 KB'i asabilir; sabit 32 KB tavanla bu yoklama
 * kanonigi goremiyor, canlilik denetimiyle ayni yaniti 'live' okuyordu.
 *
 * NEDEN: yerinde guncellemede WordPress'in 404'u (rest_post_invalid_id /
 * XML-RPC "Invalid post ID.") yazinin silindigini KANITLAMAZ. Kimlik artik bir
 * sayfaya aitse (yazi sayfaya donusturuldu) ya da WXR yeniden ice aktarimi
 * kimlikleri degistirdiyse WordPress yine 404 der, kalici adres ise yaziyi
 * sunmaya devam eder. Yalniz kimlige bakan yayinci canli yaziyi emekliye
 * ayiriyordu: durum READY_TO_PUBLISH, site haritasi adresi dusuyor, takili
 * sayfa dedektoru ve icerik pivotu yaziyi yok sayiyor, kullanicinin "WordPress
 * hedefini secip yeniden yayinlayin" adimi da ayni adreste ikinci bir kopya
 * aciyordu (inceleme S18'in yan etkisi).
 *
 * Siniflandirma eskiden yalniz durum koduna bakiyordu (govde okunmuyordu): 404
 * durumuyla donen bir guvenlik duvari / bot dogrulama sayfasi (Cloudflare
 * challenge, DataDome captcha) "yazi silinmis" sayiliyor, otomasyon musterinin
 * yayindaki kopyasini emekliye ayiriyordu. Artik canlilik denetiminin kurali
 * (common/block-detect.ts) uygulanir: boyle yanit 'unknown'dir.
 */
export async function checkEntryPublicUrl(
  url: string | undefined,
  fetchText: typeof safeFetchText = safeFetchText,
  opts: { homepage?: string | null } = {},
): Promise<EntryUrlState> {
  if (typeof url !== 'string' || !url.trim()) return 'unknown';
  const requested = url.trim();
  try {
    const r = await fetchText(requested, publicUrlFetchOptions(requested));
    return classifyLivenessResponse(r, { requested, homepage: opts.homepage ?? null });
  } catch {
    return 'unknown';
  }
}

/**
 * Markdown body'yi CMS gövdesine girecek HTML PARÇASI haline getirir.
 *
 * WordPress / Ghost / Shopify gibi hedefler içeriği kendi temasının içine
 * gömer. Onlara tam sayfa (<!DOCTYPE html> + <head> + <style>) göndermek
 * post gövdesine <style> bloğu, ikinci bir site navigasyonu ve ikinci bir
 * footer sızdırır; ayrıca <style> içindeki `body{...}` kuralı temanın kendi
 * tipografisini ezer. Bu yüzden CMS hedefleri sadece bu parçayı alır.
 *
 * Schema JSON-LD burada da yer alır: WordPress <script type="application/ld+json">
 * bloğunu post gövdesinde korur, böylece GEO/AEO sinyali kaybolmaz.
 */
function renderArticleFragment(opts: {
  bodyMd: string;
  heroImageUrl?: string | null;
  /** Hero alt metni (gorulerek uretilir; yoksa "" — susleme sayilir) */
  heroImageAlt?: string | null;
  schemaJsonLd?: any[] | null;
  audioUrl?: string | null;
  trackerSiteId?: string | null;
}): string {
  const parsed = parseFrontmatter(opts.bodyMd ?? '');
  const md = (parsed.content || opts.bodyMd || '').trim();

  // Bastaki "# H1" satirini at: CMS zaten post basligini <h1> olarak basiyor.
  // Ikisi birden kalirsa sayfada iki H1 olur (SEO hatasi). Sadece EN BASTAKI
  // H1 dusurulur; govde icinde H1 kullanilmadigi icin gerisi korunur.
  const withoutH1 = md.replace(/^#\s+[^\n]*\n+/, '');

  const inner = mdToHtml(withoutH1);
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

  const schemaTags = Array.isArray(opts.schemaJsonLd) && opts.schemaJsonLd.length > 0
    ? opts.schemaJsonLd.map((s) => `<script type="application/ld+json">${JSON.stringify(s)}</script>`).join('\n')
    : '';

  const audioBlock = opts.audioUrl ? `
<audio controls preload="metadata" style="width:100%;margin:1rem 0">
  <source src="${esc(opts.audioUrl)}" type="audio/mpeg">
</audio>` : '';

  // AI crawler tracker — tam sayfa render'indaki davranisla ayni kalsin
  const trackerScript = opts.trackerSiteId
    ? `<script async src="${process.env.NEXT_PUBLIC_API_URL ?? 'https://ranksup.ai'}/api/tracker.js?site=${esc(opts.trackerSiteId)}"></script>`
    : '';

  // Hero <img>: WordPress adapter featured image yüklerse bunu kendisi siler.
  const hero = opts.heroImageUrl ? `<img src="${esc(opts.heroImageUrl)}" alt="${esc(opts.heroImageAlt ?? '')}" class="hero">` : '';

  return [hero, audioBlock, inner, schemaTags, trackerScript].filter(Boolean).join('\n');
}

/**
 * Markdown body'yi tam bir HTML sayfasi haline getir.
 * - frontmatter strip (mdToHtml'e gelmesin)
 * - <html lang="tr"> + UTF-8 + viewport
 * - SEO meta (title, description, canonical, og)
 * - Inline minimal CSS — okunabilir, mobile-first
 *
 * SADECE dosya-tabanli hedefler icin (FTP/SFTP/cPanel/ZIP/GitHub Pages) —
 * bunlar diske gercek bir .html dosyasi yazar. CMS hedefleri
 * renderArticleFragment() kullanir.
 */
function renderArticleHtml(opts: {
  bodyMd: string;
  title: string;
  metaTitle?: string | null;
  metaDescription?: string | null;
  canonical?: string | null;
  heroImageUrl?: string | null;
  heroImageAlt?: string | null;
  siteName?: string | null;
  /** Makalenin bölüm yolu (ör. "/pratik-kobi-rehberi"). Yoksa nav linki basılmaz. */
  sectionPath?: string | null;
  schemaJsonLd?: any[] | null;
  audioUrl?: string | null;
  trackerSiteId?: string | null;
}): string {
  const parsed = parseFrontmatter(opts.bodyMd ?? '');
  const inner = mdToHtml((parsed.content || opts.bodyMd || '').trim());
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
  const title = esc(opts.metaTitle || opts.title || '');
  const desc = esc(opts.metaDescription || '');
  const canonical = esc(opts.canonical || '');
  const heroAlt = esc(opts.heroImageAlt ?? '');
  const hero = opts.heroImageUrl ? `<img src="${esc(opts.heroImageUrl)}" alt="${heroAlt}" class="hero">` : '';
  const brand = esc(opts.siteName || 'Blog');
  const year = new Date().getFullYear();

  // Sabit `/blog` nav linki kaldırıldı: pek çok sitede (kobipratik dahil) /blog
  // yolu YOK, yani yayınlanan HER sayfa 404'e giden bir iç link taşıyordu.
  // Bölüm yolu gerçekten biliniyorsa link basılır, bilinmiyorsa hiç basılmaz.
  const section = (opts.sectionPath || '').trim();
  const sectionLink = section
    ? `<a href="${esc(section)}">${esc(section.replace(/^\//, '').replace(/-/g, ' '))}</a>`
    : '';

  // GEO: Schema.org JSON-LD <script> tag'leri
  const schemaTags = Array.isArray(opts.schemaJsonLd) && opts.schemaJsonLd.length > 0
    ? opts.schemaJsonLd.map((s) => `<script type="application/ld+json">${JSON.stringify(s)}</script>`).join('\n')
    : '';

  // GEO: Audio player + AudioObject schema
  const audioBlock = opts.audioUrl ? `
<audio controls preload="metadata" style="width:100%;margin:1rem 0">
  <source src="${esc(opts.audioUrl)}" type="audio/mpeg">
  Tarayıcınız HTML5 audio desteklemiyor.
</audio>` : '';

  // AI Crawler tracker
  const trackerScript = opts.trackerSiteId
    ? `<script async src="${process.env.NEXT_PUBLIC_API_URL ?? 'https://ranksup.ai'}/api/tracker.js?site=${esc(opts.trackerSiteId)}"></script>`
    : '';
  return `<!DOCTYPE html>
<html lang="tr">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
${desc ? `<meta name="description" content="${desc}">` : ''}
${canonical ? `<link rel="canonical" href="${canonical}">` : ''}
<meta property="og:title" content="${title}">
${desc ? `<meta property="og:description" content="${desc}">` : ''}
<meta property="og:type" content="article">
${canonical ? `<meta property="og:url" content="${canonical}">` : ''}
${opts.heroImageUrl ? `<meta property="og:image" content="${esc(opts.heroImageUrl)}">` : ''}
${opts.heroImageUrl && heroAlt ? `<meta property="og:image:alt" content="${heroAlt}">\n<meta name="twitter:image:alt" content="${heroAlt}">` : ''}
${schemaTags}
${trackerScript}
<style>
:root{--ink:#0f172a;--muted:#475569;--brand:#6366f1;--brand-d:#4f46e5;--line:#e2e8f0;--bg:#fff;--soft:#f8fafc}
*{box-sizing:border-box}
body{margin:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;background:var(--bg);color:var(--ink);line-height:1.7}
.wrap{max-width:740px;margin:0 auto;padding:0 1.25rem}
header.brand{display:flex;align-items:center;justify-content:space-between;padding:1.25rem 0;border-bottom:1px solid var(--line)}
header.brand a.logo{font-weight:700;color:var(--ink);text-decoration:none;font-size:1.1rem;letter-spacing:-.01em}
header.brand a{color:var(--muted);text-decoration:none}
main{padding:2rem 0 3rem}
main h1{font-size:2.1rem;line-height:1.2;margin:.5rem 0 1.5rem;letter-spacing:-.02em}
main h2{font-size:1.45rem;margin:2.5rem 0 .75rem;padding-bottom:.4rem;border-bottom:1px solid var(--line);letter-spacing:-.01em}
main h3{font-size:1.15rem;margin:1.75rem 0 .5rem}
main p{margin:.75rem 0}
main a{color:var(--brand);text-decoration:none}
main a:hover{text-decoration:underline}
main blockquote{border-left:4px solid var(--brand);background:var(--soft);padding:.75rem 1.1rem;margin:1.25rem 0;border-radius:0 10px 10px 0;color:var(--muted)}
main blockquote p:first-child{margin-top:0}
main blockquote p:last-child{margin-bottom:0}
main ul,main ol{padding-left:1.5rem}
main li{margin:.35rem 0}
main table{width:100%;border-collapse:collapse;margin:1.5rem 0;font-size:.95rem}
main th,main td{padding:.65rem .8rem;border:1px solid var(--line);text-align:left;vertical-align:top}
main th{background:var(--soft);font-weight:600}
main code{background:var(--soft);padding:.15rem .4rem;border-radius:4px;font-size:.92em;font-family:ui-monospace,Menlo,monospace}
main pre{background:#0f172a;color:#e2e8f0;padding:1rem;border-radius:10px;overflow-x:auto;font-size:.92em}
main pre code{background:none;padding:0;color:inherit}
main img{max-width:100%;height:auto;border-radius:12px;margin:1.5rem 0;display:block}
main img.hero{margin-top:0}
main hr{border:none;border-top:1px solid var(--line);margin:2rem 0}
.cta,a.cta{display:inline-block;background:var(--brand);color:#fff!important;padding:.85rem 1.5rem;border-radius:10px;font-weight:600;text-decoration:none;margin:1.25rem 0;transition:background .15s}
.cta:hover{background:var(--brand-d);text-decoration:none!important}
footer.site{margin-top:3rem;padding:1.5rem 0;border-top:1px solid var(--line);color:var(--muted);font-size:.9rem;text-align:center}
@media(max-width:560px){main h1{font-size:1.7rem}main h2{font-size:1.25rem}}
</style>
</head>
<body>
<div class="wrap">
<header class="brand"><a class="logo" href="/">${brand}</a>${sectionLink}</header>
<main>
${hero}
${audioBlock}
${inner}
</main>
<footer class="site">© ${brand} — ${year}</footer>
</div>
</body>
</html>`;
}

/** Markdown body'deki "Sıkça Sorulan Sorular" bölümünden FAQPage JSON-LD üretir (yoksa null). */
function buildFaqPageLd(bodyMd: string): any | null {
  const md = bodyMd ?? '';
  const i = md.search(/##\s*S[ıi]k[çc]a\s+Sorulan\s+Sorular/i);
  if (i < 0) return null;
  const after = md.slice(i);
  const nextH2 = after.slice(3).search(/\n##\s/);
  const sec = nextH2 >= 0 ? after.slice(0, nextH2 + 3) : after;
  const parts = sec.split(/\n###\s+/).slice(1);
  const clean = (s: string) => s.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').replace(/[#>*`_]/g, '').replace(/\s+/g, ' ').trim();
  const mainEntity = parts.map((p) => {
    const nl = p.indexOf('\n');
    const q = clean(nl >= 0 ? p.slice(0, nl) : p);
    const a = clean(nl >= 0 ? p.slice(nl + 1) : '');
    return { '@type': 'Question', name: q, acceptedAnswer: { '@type': 'Answer', text: a } };
  }).filter((q) => q.name && q.acceptedAnswer.text.length > 10);
  if (mainEntity.length < 2) return null;
  return { '@context': 'https://schema.org', '@type': 'FAQPage', mainEntity };
}

/** JSON-LD dugumunun @type'i bu tiplerden biri mi (dizi tipi de olabilir) */
function jsonLdTypeIs(node: Record<string, unknown>, types: ReadonlySet<string>): boolean {
  const t = node['@type'];
  return Array.isArray(t) ? t.some((x) => types.has(String(x))) : types.has(String(t));
}

const JSON_LD_ARTICLE_TYPES: ReadonlySet<string> = new Set(['Article', 'BlogPosting', 'NewsArticle', 'TechArticle']);
const JSON_LD_PAGE_TYPES: ReadonlySet<string> = new Set(['WebPage']);
const JSON_LD_BREADCRUMB_TYPES: ReadonlySet<string> = new Set(['BreadcrumbList']);

/**
 * Kayitli JSON-LD'nin yazi adresi olarak tasidigi degerler (saf): Article / BlogPosting url'i ve
 * mainEntityOfPage @id'si, WebPage (Speakable) url'i, kirinti listesinin SON ogesinin item'i.
 * Uretim hattinda (pipeline.service, schema-classifier buildJsonLd) bunlarin hepsi ayni adrestir;
 * eski / elle duzenlenmis kayitta farkli olabilirler, hepsi toplanir. Sitenin kok adresi yazi
 * adresi sayilmaz: yayinci / kurulus url'i ezilmesin.
 */
function jsonLdArticleUrls(jsonLd: readonly unknown[], siteRoot: string | null): Set<string> {
  const urls = new Set<string>();
  const add = (v: unknown) => { if (typeof v === 'string' && v.trim()) urls.add(v); };
  for (const raw of jsonLd) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue;
    const node = raw as Record<string, unknown>;
    if (jsonLdTypeIs(node, JSON_LD_ARTICLE_TYPES)) {
      add(node.url);
      const page = node.mainEntityOfPage;
      if (typeof page === 'string') add(page);
      else if (page && typeof page === 'object' && !Array.isArray(page)) add((page as Record<string, unknown>)['@id']);
    }
    if (jsonLdTypeIs(node, JSON_LD_PAGE_TYPES)) add(node.url);
    if (jsonLdTypeIs(node, JSON_LD_BREADCRUMB_TYPES) && Array.isArray(node.itemListElement) && node.itemListElement.length > 0) {
      const last = node.itemListElement[node.itemListElement.length - 1] as Record<string, unknown> | null;
      const item = last && typeof last === 'object' ? last.item : undefined;
      if (typeof item === 'string') add(item);
      else if (item && typeof item === 'object' && !Array.isArray(item)) add((item as Record<string, unknown>)['@id']);
    }
  }
  const root = siteRoot ? siteRoot.replace(/\/+$/, '') : null;
  if (root) for (const u of [...urls]) if (u.replace(/\/+$/, '') === root) urls.delete(u);
  return urls;
}

/** Degeri `from` kumesinde olan her dizeyi `to` ile degistirir (saf; girdi degismez) */
function replaceJsonLdStrings<T>(node: T, from: ReadonlySet<string>, to: string): T {
  if (typeof node === 'string') return (from.has(node) ? to : node) as T;
  if (Array.isArray(node)) return node.map((n) => replaceJsonLdStrings(n, from, to)) as T;
  if (!node || typeof node !== 'object') return node;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(node as Record<string, unknown>)) out[key] = replaceJsonLdStrings(value, from, to);
  return out as T;
}

/**
 * Tam sayfanin JSON-LD'sindeki yazi adresi alanlarini sayfanin canonical'iyla hizalar (saf; girdi
 * degismez): Article url'i, mainEntityOfPage @id'si, son kirintinin item'i, Speakable url'i ve
 * ayni adresi tasiyan diger alanlar (HowTo adimi, Course / Product / Service / DefinedTerm url'i,
 * VideoObject contentUrl) canonical olur. Canonical yoksa (GitHub, Markdown ZIP: adres bilinmiyor)
 * bu alanlar silinir (pipeline.service omitJsonLdArticleUrl — uretim hattinin adressiz JSON-LD
 * kurali); mainEntityOfPage nesnesi butunuyle duser, baska dugum @id ile ona baglanmadigi icin
 * kopuk referans kalmaz. Kayitli JSON-LD'de yazi adresi yoksa (uretim hatti adressiz yazdi)
 * dokunulmaz.
 *
 * NEDEN: JSON-LD uretim aninda (pipeline) kurulur; o anki adres yayinci bu sayfaya canonical
 * olarak yazdigi adresten (ai-sitemap.service fullPageCanonicalUrl) farkli olabilir: yeni bir
 * hedefe ilk yayin, klasoru sonradan degisen dosya hedefi, varsayilan hedefin yol kuralindan
 * tahmin edilen adresle uretilip baska hedefe yayinlanan yazi. Ayni sayfada canonical bir adresi,
 * JSON-LD baska (cogu zaman 404 veren) bir adresi bildiriyordu; arama motoru ve AI tarayicisi
 * hangisinin dogru oldugunu bilemez.
 */
export function alignJsonLdArticleUrl(jsonLd: readonly unknown[], canonical: string | null, siteRoot: string | null): unknown[] {
  const urls = jsonLdArticleUrls(jsonLd, siteRoot);
  if (urls.size === 0) return [...jsonLd];
  if (canonical) return replaceJsonLdStrings([...jsonLd], urls, canonical);
  let out: unknown[] = [...jsonLd];
  for (const u of urls) out = omitJsonLdArticleUrl(out, u);
  return out;
}

/**
 * Basarili yazimda hedefte ne yapildi:
 *  - created: ilk yayin (bu hedefte canli kayit yoktu)
 *  - updated: mevcut kayit yerinde guncellendi (WordPress)
 *  - overwritten: ayni yol/anahtar uzerine yazildi (FTP, SFTP, cPanel, GitHub, KobiPratik)
 *  - exported: disa aktarim yeniden uretildi (Markdown ZIP)
 *  - recreated: kayit hedefte silinmisti (404/410), yeniden olusturuldu
 */
export type PublishAction = 'created' | 'updated' | 'overwritten' | 'exported' | 'recreated';

export interface PublishResult {
  targetId: string;
  targetType: string;
  ok: boolean;
  externalUrl?: string;
  externalId?: string;
  /** Turkce neden (basarisiz ya da bilerek yapilmayan yayin) — panel aynen gosterir */
  error?: string;
  /** Ek alan: basarili yazimda ne yapildi */
  action?: PublishAction;
  /** Ek alan: kopya acmamak icin bilerek YAPILMAYAN yayin (makine okunur neden; metin error'da) */
  skipped?: PublishSkip;
  /** publishedTo kaydi: bu hedefte ilk yayin zamani (ISO; panel "Yayın Geçmişi" bunu okur) */
  publishedAt?: string;
  /** publishedTo kaydi: bu hedefe son yazim zamani (ISO) */
  updatedAt?: string;
  /**
   * publishedTo kaydi: bu hedefe yazilan metnin izi (republish-policy.ts
   * articleContentHash). "Bu hedefte daha eski metin yayinda" karari buna bakar.
   */
  contentHash?: string;
  /**
   * publishedTo kaydi (paylasilan sozlesme C3): hedefin KENDI son degisiklik
   * damgasi, RanksUp'in bu yaziminin hemen ardindan (WordPress modified_gmt,
   * ISO). Sonraki yerinde guncelleme "yazi o zamandan beri WordPress'te
   * degisti mi" sorusunu ayni saatle yanitlar.
   */
  remoteModifiedAt?: string;
  /**
   * publishedTo kaydi: WordPress'in BU yazimin yanitinda bildirdigi yazi durumu (publish,
   * draft, pending, private...; adaptorun publish() / update() sonucundaki status). Yalniz
   * WordPress hedeflerinde yazilir. Canlilik denetimi ve site haritasi "bu ?p= adresi herkese
   * acik mi" kararini bundan verir (republish-policy recordedWordPressStatus). NEDEN: karar
   * eskiden hedefin BUGUNKU "Yayın durumu" ayarina bakiyordu; ayar "Taslak"tan "Yayında"ya
   * alininca WordPress'te taslak kalan eski yazilar emekliye ayriliyordu.
   * Yazilmayan 'live_entry_edited' sonucunda da tasinir (kayda yazilmaz): yazinin o an
   * WordPress'teki durumu; emekli kopya yalniz 'publish' ise yeniden canli sayilir.
   */
  remoteStatus?: string;
  /**
   * publishedTo kaydi: TAM SAYFA yazan hedefte (FTP / SFTP / cPanel / GitHub / Markdown ZIP)
   * sayfaya yazilan <link rel="canonical"> adresi; null: canonical yazilmadi. NEDEN: canonical
   * yazinin ilan edilen BASKA bir kopyasini (or. WordPress) gosterebilir; o kopya emekliye
   * ayrilinca bu sayfa 404 veren adresi kanonik bildirir. Kayit, hangi kopyanin yeniden yazilmasi
   * gerektigini bilmek icin tutulur (ai-sitemap.service flagRetiredCanonicalCopies).
   */
  canonicalUrl?: string | null;
  /**
   * publishedTo kaydi (C3): kopya WordPress cop kutusunda bulundu (ISO). Kopya
   * canli sayilmaz (liveEntries, lastLiveWriteAt, adres secimi); kimlik ve
   * adres korunur, hedefe sonraki basarili yazim isareti kaldirir.
   */
  trashedAt?: string;
  /**
   * publishedTo kaydi (D3): kayitli yazi hedefte silinmis bulundu ve yeniden
   * olusturulmadi (ISO). Cop kutusu gibi canli sayilmaz; kimlik ve adres korunur,
   * hedefe sonraki basarili yazim isareti kaldirir.
   */
  missingAt?: string;
}

/**
 * Article.publishedTo birlestirmesi: bu yayinin basarili sonuclari ayni
 * hedefin onceki kaydinin YERINE gecer; baska hedeflerdeki kayitlar korunur.
 *
 * NEDEN: kayit her yayinda tumden eziliyordu. Yazi tek hedefe yeniden
 * yayinlaninca (takili sayfa kurtarmasi, hedef secerek yayin) diger
 * hedeflerdeki canli kopyalarin izi (WordPress yazi kimligi, adres) kayboluyor;
 * site haritasi / llms.txt adresi ve "yazi nerede yayinda" karari
 * (stuck-page-autopilot.ts planArticleRepublish) eksik veriyle calisiyordu.
 * Yeni sonuclar basta: kaydi sirayla okuyup ilk sitedeki adresi alanlar
 * (ai-sitemap.service advertisedArticleEntry — site haritasi, llms-full,
 * canonical, JSON-LD) en son yayini gorur.
 */
export function mergePublishedTo(previous: unknown, successful: PublishResult[]): unknown[] {
  const ids = new Set(successful.map((r) => r.targetId));
  const kept = (Array.isArray(previous) ? previous : []).filter((e) => {
    if (!e || typeof e !== 'object') return false;
    const id = (e as { targetId?: unknown }).targetId;
    return !(typeof id === 'string' && ids.has(id));
  });
  return [...successful, ...kept];
}

/**
 * Article publish — bir veya daha fazla publish target'a aynı makaleyi yayınla.
 * Adapter framework üzerinden çalışır (WordPress, FTP, SFTP, Markdown ZIP, ...)
 *
 * Yazi bir hedefte ZATEN yayindaysa (publishedTo'da o hedefin canli kaydi)
 * ikinci kopya acilmaz (republish-policy.ts): WordPress yazisi yerinde
 * guncellenir, dosya hedeflerinde ayni yolun uzerine yazilir, yalniz yeni
 * kayit acan hedeflerde (Ghost, Strapi, Webflow, Sanity, Contentful, WHMCS,
 * ozel PHP) yayin yapilmaz ve sonuc Turkce nedenle `skipped` doner.
 *
 * Worker'dan PUBLISH_ARTICLE job'unda çağrılır.
 */
@Injectable()
export class PublisherService implements OnModuleInit {
  private readonly log = new Logger(PublisherService.name);

  /**
   * Silinmis gorunen kaydin herkese acik adres yoklamasi (S18, checkEntryPublicUrl).
   * Nest yasam dongusu (onModuleInit) gercek yoklayiciyi kurar; API ve worker
   * servisi Nest uzerinden alir (worker: createApplicationContext init'i
   * cagirir). Dogrudan kurulan ornekte (birim testleri) test kendi sahtesini
   * verir; verilmezse adaptorun 404/410'u tek basina yeterli sayilir. NEDEN:
   * testlerin sahte WordPress'i herkese acik adresi sunmaz, gercek aga
   * cikmalari yavas ve kararsiz olurdu.
   */
  private entryUrlCheck: EntryUrlCheck | null = null;

  onModuleInit(): void {
    this.entryUrlCheck ??= (url, opts) => checkEntryPublicUrl(url, safeFetchText, opts);
  }

  constructor(
    private readonly prisma: PrismaService,
    private readonly imageGen: ImageGeneratorService,
    private readonly indexingPinger: AiIndexingPingerService,
    private readonly llmsFullBuilder: LlmsFullBuilderService,
    private readonly linkValidator: LinkValidatorService,
    private readonly urlInventory: SiteUrlInventoryService,
    private readonly qaGate: QaGateService,
    private readonly llm: LLMProviderService,
  ) {}

  /**
   * opts.overwriteRemoteEdits (paylasilan sozlesme C1): YALNIZ kullanicinin
   * panelden verdigi acik onay (POST .../publish govdesi → PUBLISH_ARTICLE is
   * verisi). WordPress yazisi RanksUp'in son yaziminden sonra WordPress'te
   * degismisse bile ustune yazilir (adapter.update force). Otomasyon (takili
   * sayfa otopilotu, icerik pivotu, Tam otomatik yayin) bu secenegi HIC vermez:
   * musterinin duzenlemesi kendiliginden ezilmez, yazi live_entry_edited ile
   * atlanir ve kopya "elle guncelleme bekliyor" diye isaretlenir.
   * Onayin KAPSAMI: yalniz targetIds ile ADI verilen hedefler zorlanir. Hedef
   * listesi bos gelirse hicbir hedef zorlanmaz (panel uzerine yazmayi her zaman
   * hedefleri acikca gondererek ister).
   *
   * HEDEF SECIMI (paylasilan sozlesme D1, selectPublishTargets): acik liste AYNEN
   * uygulanir. Yazinin yayinda oldugu ama listede olmayan canli kopyaya yazilmaz;
   * sonucta 'live_target_not_selected' (Turkce neden) doner ve metni farkliysa
   * kayit "elle guncelleme bekliyor" diye isaretlenir. Bos liste: yazi sitede
   * yayindaysa canli aktif hedefler, degilse varsayilan + aktif hedefler.
   *
   * opts.initiator (D2; varsayilan 'automation', PublishInitiator): yalniz
   * kullanicinin acik yayin istegi (PUBLISH_ARTICLE) 'user' verir.
   * opts.recreateMissing (varsayilan: initiator 'user' ise true): yerinde
   * guncellenecek kayit hedefte artik yoksa (404/410, adaptor notFound) yeni kayit
   * acilsin mi. Acilsa bile YALNIZ targetIds ile adi verilen hedefte acilir. NEDEN
   * (S3): varsayilan herkes icin true'ydu; Tam otomatik yayin ve pivot, musterinin
   * wp-admin'de kalici sildigi (ya da WordPress'in 30 gun sonra cop kutusundan
   * bosalttigi) yaziyi sessizce yeniden aciyor, kimlik baska bir yaziya gecmisse
   * (WXR aktarimi) ikinci bir kopya olusturuyordu. Acilmazsa hicbir sey yazilmaz,
   * sonuc 'live_entry_missing' ve kayda missingAt yazilir (D3). Takili sayfa
   * yeniden yayini ayrica false verir. Kimligin 404'u tek basina yetmez (S18):
   * yazinin adresi hala aciliyorsa ne yeniden acilir ne emekliye ayrilir
   * ('live_entry_unresolvable'); adres dogrulanamazsa otomasyon kaydi emekliye
   * ayirmaz ('live_entry_unverified'), kullanicinin acik secimi yeniden acar.
   */
  async publishArticle(
    articleId: string,
    targetIds: string[],
    opts: { overrideQa?: boolean; overwriteRemoteEdits?: boolean; recreateMissing?: boolean; initiator?: PublishInitiator } = {},
  ): Promise<PublishResult[]> {
    // Sitenin TUM hedefleri okunur (birkac satir); secim sorgudan sonra
    // (selectPublishTargets): hedef verilmeyen otomasyon yayininda yazinin
    // YAYINDA oldugu hedefler gerekir, bu da yazinin publishedTo'suna bagli.
    const article = await this.prisma.article.findUniqueOrThrow({
      where: { id: articleId },
      include: { site: { include: { publishTargets: true } } },
    });
    const initiator: PublishInitiator = opts.initiator === 'user' ? 'user' : 'automation';
    const previousPublishedTo: unknown = (article as any).publishedTo;
    const { targets: selectedTargets, unavailableLive, notSelectedLive } = selectPublishTargets(article.site.publishTargets, targetIds, previousPublishedTo);
    // Yazinin yayinda oldugu ama silinmis / pasif hedefler: otomasyon baska
    // hedefe kopya acmadi — is sonucunda nedeniyle gorunsun
    const unavailableResults: PublishResult[] = unavailableLive.map((e) => ({
      targetId: e.targetId,
      targetType: String(e.targetType ?? ''),
      ok: false,
      skipped: 'live_target_inactive',
      error: publishSkipText('live_target_inactive', e.targetType),
    }));
    // Hedefe giden metnin izi (basarili kayitlara yazilir) ve izsiz eski kayitlar
    // icin "metin canliya ciktiktan sonra degisti mi" (refreshManualUpdateFlags)
    const liveState = {
      contentHash: articleContentHash(article),
      legacyContentChanged: REWRITTEN_SINCE_LIVE_STATUSES.has(String((article as any).status ?? '')),
    };
    // Kullanicinin acik listesinde olmayan canli kopyalar (D1): yazilmaz, raporlanir.
    // Metin, kopyanin eski metni gosterip gostermedigini ve RanksUp'in onu yerinde
    // guncelleyip guncelleyemeyecegini dogru soyler.
    const targetById = new Map(article.site.publishTargets.map((t) => [t.id, t]));
    const notSelectedResults: PublishResult[] = notSelectedLive.map((e) => {
      const target = targetById.get(e.targetId);
      const type = String(target?.type ?? e.targetType ?? '');
      const kind = decideRepublish({ entry: e, targetType: type, articleSlug: article.slug }).kind;
      return {
        targetId: e.targetId,
        targetType: type,
        ok: false,
        skipped: 'live_target_not_selected',
        error: publishSkipText('live_target_not_selected', type, {
          stale: liveCopyStale(e, liveState),
          inPlace: kind === 'update' || kind === 'overwrite',
          verified: typeof e.contentHash === 'string' && e.contentHash !== '',
        }),
      };
    });
    if (notSelectedResults.length > 0) {
      this.log.log(`[${articleId}] Yazının yayında olduğu ama bu yayında seçilmeyen hedef(ler)e yazılmıyor: ${notSelectedResults.map((r) => r.targetId).join(', ')}`);
    }

    // Yazilacak hedef yoksa ya da hepsi kopya acacaksa QA'dan ONCE donulur:
    // hicbir sey yayinlanmayacakken QA (LLM) kosmak bosuna maliyet, QA_BLOCKED
    // da kullaniciya asil nedeni ("kopya açılmadı") gizlerdi.
    if (selectedTargets.length === 0) {
      this.log.warn(`[${articleId}] Hiç publish target yok${unavailableResults.length > 0 ? ' (yazının yayında olduğu hedef silinmiş ya da pasif)' : ''}`);
      const nothing = [...unavailableResults, ...notSelectedResults];
      await this.recordUnwrittenLiveState(article, nothing, liveState, initiator);
      return nothing;
    }

    // Hedef basina yeniden yayin karari (ag istegi yok): kayit yoksa yayin,
    // varsa guncelle / uzerine yaz / kopya acma (republish-policy.ts). Kayit
    // cop kutusundaysa da bulunur (publishedEntryFor): o yazi geri getirilmez,
    // yanina yeni kopya da acilmaz; geri yuklenmisse yerinde guncellenir. Silinmis
    // bulunan kayit (missingAt) da bulunur: yalniz kullanicinin bu hedefi acikca
    // sectigi yayinda yeniden olusturulur, aksi halde yine yazilmaz.
    // Cakisma denetiminin dayanagi: kayittaki remoteModifiedAt / updatedAt /
    // publishedAt; hicbiri olmayan eski kayitta (bu dalgadan once yazilmis:
    // { targetId, targetType, ok, externalUrl, externalId }) makalenin
    // publishedAt'i. O surumde yayinci her yayinda publishedTo'yu tumden yazip
    // publishedAt'i ileri aliyordu; yani publishedAt o kayitlara son yazimin
    // anidir (yaziminin bitisinden hemen sonra).
    const fallbackLastWriteAt = article.publishedAt instanceof Date ? article.publishedAt.toISOString() : undefined;
    // Acik onay (C1) yalniz adi verilen hedeflere; bos listede hicbir hedef zorlanmaz
    const forcedTargetIds: ReadonlySet<string> = new Set(opts.overwriteRemoteEdits === true ? targetIds : []);
    if (opts.overwriteRemoteEdits === true) {
      const unforced = selectedTargets.filter((t) => !forcedTargetIds.has(t.id)).map((t) => t.id);
      if (unforced.length > 0) this.log.log(`[${articleId}] Üzerine yazma onayı yalnız seçilen hedef(ler) için; diğerleri değişiklik denetimiyle yazılıyor: ${unforced.join(', ')}`);
    }
    // Silinen kaydin yeniden olusturulmasi (D2): istek (acik secenek ya da
    // kullanicinin yayini) VE hedefin adi listede verilmis olmali. Bos listede
    // kullanici hedef secmedi: otomasyon gibi geri getirilmez.
    const recreateRequested = opts.recreateMissing ?? initiator === 'user';
    const namedTargetIds: ReadonlySet<string> = new Set(targetIds);
    // Sitenin ana sayfasi: silinmis gorunen kaydin adres yoklamasinda (checkEntryPublicUrl)
    // silinen yaziyi ana sayfaya yonlendiren site "adres hala aciliyor" sayilmasin
    const probeSite = parseSiteUrl((article.site as any).url);
    const homepage = probeSite ? siteHomepage(probeSite) : null;
    const plans = selectedTargets.map((target) => {
      const live = publishedEntryFor(previousPublishedTo, target.id);
      let decision = decideRepublish({ entry: live, targetType: target.type, articleSlug: article.slug });
      if (decision.kind === 'update' && !decision.ref.lastWriteAt && fallbackLastWriteAt) {
        decision = { ...decision, ref: { ...decision.ref, lastWriteAt: fallbackLastWriteAt } };
      }
      return { target, live, decision };
    });
    const blockedResult = (target: { id: string; type: string }, decision: Extract<RepublishDecision, { kind: 'blocked' }>): PublishResult => ({
      targetId: target.id,
      targetType: target.type,
      ok: false,
      skipped: BLOCK_SKIP[decision.reason],
      error: publishSkipText(BLOCK_SKIP[decision.reason], target.type, { liveSlug: decision.liveSlug, slug: article.slug }),
    });
    if (plans.every((p) => p.decision.kind === 'blocked')) {
      // Hicbir hedefe yazilmayacak: gorsel uretimi, govde / ilk yayin tarihi
      // yazimi, llms yeniden uretimi YOK — canli kopya oldugu gibi kalir; yalniz
      // durum gercegi ve elle guncelleme isareti kaydedilir (recordUnwrittenLiveState)
      const skippedOnly = [
        ...plans.map((p) => blockedResult(p.target, p.decision as Extract<RepublishDecision, { kind: 'blocked' }>)),
        ...unavailableResults,
        ...notSelectedResults,
      ];
      for (const r of skippedOnly) this.log.warn(`[${articleId}] ${r.targetType} yayinlanmadi (${r.skipped}): ${r.error}`);
      await this.recordUnwrittenLiveState(article, skippedOnly, liveState, initiator);
      return skippedOnly;
    }

    // ── QA Gate — BLOCKED makale yayinlanmaz (kullanici bilerek override
    // edebilir; override da audit izine yazilir). qaStatus hic kosulmadiysa
    // yayin aninda kos: pipeline hook'u kacirmis eski makaleler de kapsansin.
    if (!opts.overrideQa) {
      let qaStatus = (article as any).qaStatus as string | null;
      if (!qaStatus) {
        try {
          const res = await this.qaGate.check(articleId);
          qaStatus = res.status;
        } catch (err: any) {
          this.log.warn(`[${articleId}] Yayin oncesi QA kosulamadi (yayina devam): ${err.message}`);
        }
      }
      if (qaStatus === 'BLOCKED') {
        const report: any = (article as any).qaReport
          ?? (await this.prisma.article.findUnique({ where: { id: articleId }, select: { qaReport: true } as any }) as any)?.qaReport;
        const blockers: any[] = Array.isArray(report?.blockers) ? report.blockers : [];
        const summary = blockers.slice(0, 3).map((b) => b.detail).join(' | ') || 'QA blocker mevcut';
        throw new Error(`QA_BLOCKED: Yayin engellendi — ${summary}. Sorunlari duzelt veya "yine de yayinla" ile override et.`);
      }
    } else {
      this.log.warn(`[${articleId}] QA gate OVERRIDE ile atlandi (kullanici karari)`);
    }

    // GEO v7: schema JSON-LD + audio + tracker injection
    // KOPYA: asagida yayina ozel FAQPage eklenir ve hero image duzeltilir;
    // kayittaki schemaMarkup nesnesi bunlardan etkilenmemeli.
    const schemaJsonLd: any[] = (() => {
      const sm: any = (article as any).schemaMarkup;
      return Array.isArray(sm?.jsonLd) ? structuredClone(sm.jsonLd) : [];
    })();
    const audioUrl: string | null = (() => {
      const fm: any = (article as any).frontmatter ?? {};
      return fm?.audio_url ?? null;
    })();

    // GEO: body'de görünür SSS varsa eşleşen FAQPage schema ekle (zaten yoksa).
    // Google FAQ rich-result politikası: schema görünür içerikle eşleşmeli — bu yüzden
    // makaledeki gerçek SSS sorularından üretiyoruz, uydurmuyoruz.
    if (!schemaJsonLd.some((s) => s?.['@type'] === 'FAQPage')) {
      const faqLd = buildFaqPageLd(article.bodyMd ?? '');
      if (faqLd) schemaJsonLd.push(faqLd);
    }

    // ── Hero görsel: yoksa veya placeholder ise gerçek görsel üret ──
    // Yazar şablonu eskiden makaleye "placeholder-hero.webp" yazıyordu (artık
    // yazmıyor; eski makalelerde duruyor). Gerçeğini burada üretip hem og:image
    // hem WordPress featured image (media upload) için kullanıyoruz.
    let heroImageUrl: string | null = article.heroImageUrl ?? null;
    let heroImageBase64: string | undefined;
    let heroImageFilename: string | undefined;
    let heroImageMime: string | undefined;
    if (!heroImageUrl || /placeholder/i.test(heroImageUrl)) {
      try {
        const outPath = path.join(process.cwd(), 'public', 'blog', article.slug, 'hero.webp');
        const prompt = `Professional, modern editorial blog header illustration for an article titled "${article.title}". Clean, high-quality, conceptual, relevant to the subject. No text, no words, no letters, no logos.`;
        const gen = await this.imageGen.generate(
          { prompt, outputPath: outPath, width: 1536, height: 1024, type: 'hero' },
          { provider: process.env.IMAGE_PROVIDER },
        );
        if (gen.ok) {
          const base = (process.env.NEXT_PUBLIC_API_URL ?? 'https://ranksup.ai').replace(/\/+$/, '');
          heroImageUrl = `${base}/blog/${article.slug}/hero.webp`;
          // WordPress media için en uyumlu format JPG byte'larını oku (yoksa webp)
          try {
            const buf = await fs.readFile(outPath.replace(/\.webp$/, '.jpg'));
            heroImageBase64 = buf.toString('base64');
            heroImageFilename = `${article.slug}-hero.jpg`;
            heroImageMime = 'image/jpeg';
          } catch {
            const buf = await fs.readFile(outPath);
            heroImageBase64 = buf.toString('base64');
            heroImageFilename = `${article.slug}-hero.webp`;
            heroImageMime = 'image/webp';
          }
          await this.prisma.article.update({ where: { id: article.id }, data: { heroImageUrl } }).catch(() => {});
          this.log.log(`[${articleId}] hero görsel üretildi → ${heroImageUrl}`);
        } else {
          this.log.warn(`[${articleId}] hero görsel üretilemedi: ${gen.error}`);
          heroImageUrl = null; // placeholder'ı body'ye koyma
        }
      } catch (err: any) {
        this.log.warn(`[${articleId}] hero görsel hata: ${err.message}`);
        heroImageUrl = null;
      }
    }

    // JSON-LD image: eski makalelerde göreli "placeholder-hero.webp" duruyordu
    // (39 makale, 5'i yayında — 09.10.2026). Yayında gerçek mutlak hero URL'i
    // basılır; kayıt da düzeltilir ki sonraki okuyucular (llms, rapor) temiz görsün.
    if (applyHeroImageToJsonLd(schemaJsonLd, heroImageUrl) > 0) {
      const sm: any = (article as any).schemaMarkup;
      const storedLd = Array.isArray(sm?.jsonLd) ? structuredClone(sm.jsonLd) : null;
      if (storedLd && applyHeroImageToJsonLd(storedLd, heroImageUrl) > 0) {
        await this.prisma.article.update({
          where: { id: article.id },
          data: { schemaMarkup: { ...sm, jsonLd: storedLd } },
        }).catch((err: any) => this.log.warn(`[${articleId}] JSON-LD image kaydi duzeltilemedi: ${err.message}`));
      }
    }

    // ── Hero alt metni ──
    // Kayitli (onceki yayindan) alt varsa o; yoksa YENI uretilen gorselin yerel
    // baytlari uzerinden gorerek uretilir. Hata/red → "" (eski davranis), yayin durmaz.
    let heroImageAlt = '';
    if (heroImageUrl) {
      const stored: any[] = Array.isArray((article as any).inlineImages) ? (article as any).inlineImages : [];
      const known = stored.find((i) => i?.position === 'hero' && i?.url === heroImageUrl && typeof i?.alt === 'string');
      if (known) {
        heroImageAlt = known.alt;
      } else if (heroImageBase64) {
        const d = await describeHeroImage(this.llm, {
          bytes: Buffer.from(heroImageBase64, 'base64'),
          title: article.title,
          language: (article as any).language ?? null,
          siteId: article.siteId,
          userId: (article.site as any).userId,
          articleId: article.id,
        });
        if (d) {
          heroImageAlt = d.alt;
          const others = stored.filter((i) => i?.position !== 'hero');
          await this.prisma.article.update({
            where: { id: article.id },
            data: { inlineImages: [...others, { url: heroImageUrl, alt: d.alt, position: 'hero', model: d.model }] as any },
          }).catch(() => {});
        }
      }
    }

    // Body markdown'daki placeholder hero referansını temizle (kırık img olmasın)
    let cleanBodyMd = stripHeroPlaceholder(article.bodyMd ?? '');

    // ── Yayın öncesi son link kontrolü ────────────────────────
    // Pipeline'daki doğrulamadan sonra makale günlerce beklemiş, elle
    // düzenlenmiş veya hedef sayfa silinmiş olabilir. Kırık link canlıya
    // çıkmasın diye yayından hemen önce bir kez daha süzülür.
    try {
      const validated = await this.linkValidator.validateArticleMarkdown(article.siteId, cleanBodyMd, {
        checkExternal: false, // yayını yavaşlatmamak için sadece iç linkler
      });
      cleanBodyMd = validated.bodyMd;
      if (validated.report.remapped || validated.report.unlinked) {
        this.log.warn(
          `[${articleId}] yayın öncesi link temizliği: ${validated.report.remapped} remap, ${validated.report.unlinked} kaldırıldı`,
        );
      }
    } catch (err: any) {
      this.log.warn(`[${articleId}] yayın öncesi link doğrulama atlandı: ${err.message}`);
    }

    // Markdown → tam HTML sayfa (frontmatter strip + UTF-8 + meta + sade tema): dosya-tabanli
    // hedefler (FTP/SFTP/cPanel/GitHub/ZIP) icin, hedef basina kanonik adresiyle.
    //
    // Tarihce: eski hali sabit `${base}/blog/${slug}` uretiyordu; sayfa kendi kendisiyle
    // celisiyordu (sema bir adres, canonical var olmayan /blog). Yol kurali artik tek yerde
    // (article-url.util.ts resolveArticleUrl; dosya kopyasinin adresi ai-sitemap.service
    // fileCopyPublicUrl).
    //
    // canonical (ai-sitemap.service fullPageCanonicalUrl): yazinin ILAN edilen adresi
    // (advertisedArticleEntry — site haritasi, llms-full ve uretim hattinin JSON-LD url'i ile
    // ayni kural; yazilan kopyanin kaydi, bugunku klasore yazilacagi icin yazimdan sonraki
    // konumuyla); ilan edilecek adres yoksa yazilan kopyanin KENDI adresi (self-canonical);
    // o da bilinmiyorsa (GitHub, Markdown ZIP) canonical yazilmaz.
    // NEDEN: canonical eskiden articlePublicUrl'den ya da sitenin varsayilan hedefinin yol
    // kuralindan geliyordu. Hic canli gorulmemis WordPress taslaginin ?p= baglantisi (anonim
    // ziyaretciye 404) ya da bu yayinda yazilmayan varsayilan hedefin yolu sayfanin kanonik
    // adresi oluyordu: 404'e isaret eden canonical sayfanin dizine alinmasina zarar verir.
    // Self-canonical yalniz yazilan sayfanin kendisini gosterir, var olmayan bir adresi degil.
    const canonicalTargets = new Map(article.site.publishTargets.map((t) => [t.id, { type: String(t.type), config: t.config }]));
    const fullPages = new Map<string, string>();
    const canonicalFor = (target: { id: string; type: string; config?: unknown }): string | null => (probeSite
      ? fullPageCanonicalUrl(probeSite, article.slug, previousPublishedTo, canonicalTargets, { id: target.id, type: String(target.type), config: target.config })
      : null);
    const fullPageHtmlFor = (target: { id: string; type: string; config?: unknown }): string => {
      const canonical = canonicalFor(target);
      const cached = fullPages.get(canonical ?? '');
      if (cached !== undefined) return cached;
      const html = renderArticleHtml({
        bodyMd: cleanBodyMd,
        title: article.title,
        metaTitle: article.metaTitle,
        metaDescription: article.metaDescription,
        canonical,
        heroImageUrl,
        heroImageAlt,
        siteName: article.site.name,
        // Bolum baglantisi kanonik adresin yolundan; adres bilinmiyorsa basilmaz
        sectionPath: canonical ? sectionPathOf(canonical) : null,
        // JSON-LD'nin yazi adresi sayfanin canonical'i; canonical yoksa adres alanlari yok
        schemaJsonLd: alignJsonLdArticleUrl(schemaJsonLd, canonical, probeSite ? siteHomepage(probeSite) : null),
        audioUrl,
        trackerSiteId: article.siteId,
      });
      fullPages.set(canonical ?? '', html);
      return html;
    };

    // CMS hedefleri (WordPress/Ghost/Shopify/...) icin sadece govde parcasi.
    // JSON-LD'nin yazi adresi alanlari (url, mainEntityOfPage, son kirinti, Speakable) yazinin
    // ILAN edilen adresiyle hizalanir (advertisedArticleEntry: site haritasi, llms-full ve tam
    // sayfa canonical'i ile ayni kural); adres henuz bilinmiyorsa (ilk yayin) bu alanlar yazilmaz.
    // NEDEN: parca eskiden uretim anindaki JSON-LD'yi aynen tasiyordu. Hic yayinlanmamis yazinin
    // adresi varsayilan hedefin yol kuralindan TAHMIN ediliyordu; WordPress yazisinin gercek
    // adresiyle uyusmuyor, her yerinde guncellemede o yanlis adres yeniden yaziliyordu.
    const fragmentUrl = probeSite ? advertisedArticleEntry(probeSite, article.slug, previousPublishedTo, canonicalTargets)?.url ?? null : null;
    const fragmentHtml = renderArticleFragment({
      bodyMd: cleanBodyMd,
      heroImageUrl,
      heroImageAlt,
      schemaJsonLd: alignJsonLdArticleUrl(schemaJsonLd, fragmentUrl, probeSite ? siteHomepage(probeSite) : null),
      audioUrl,
      trackerSiteId: article.siteId,
    });

    const results: PublishResult[] = [];

    for (const { target, live, decision } of plans) {
      // Kopya acilacagi icin bilerek yapilmayan yayin: hedefe hic baglanilmaz
      if (decision.kind === 'blocked') {
        const skipped = blockedResult(target, decision);
        results.push(skipped);
        this.log.warn(`[${articleId}] ${target.type} yayinlanmadi (${skipped.skipped}): ${skipped.error}`);
        continue;
      }

      const Adapter = getAdapter(target.type) as any;
      if (!Adapter) {
        results.push({
          targetId: target.id,
          targetType: target.type,
          ok: false,
          error: `Adapter yok: ${target.type}`,
        });
        continue;
      }

      const credentials = decryptCredentials(target.credentials as Record<string, any>);
      const unsafe = await publishTargetBlockReason(target.type, credentials, target.config);
      if (unsafe) {
        results.push({ targetId: target.id, targetType: target.type, ok: false, error: unsafe });
        this.log.warn(`[${articleId}] ${target.type} atlandi: ${unsafe}`);
        continue;
      }

      try {
        // Kurucu hata atarsa da yalniz bu hedef basarisiz sayilsin (eskiden try disindaydi)
        const adapter = new Adapter(credentials, target.config ?? {});
        const payload: PublishPayload = {
          slug: article.slug,
          title: article.title,
          bodyHtml: adapter.needsFullPage ? fullPageHtmlFor(target) : fragmentHtml,
          bodyMd: article.bodyMd ?? '',
          metaTitle: article.metaTitle ?? undefined,
          metaDescription: article.metaDescription ?? undefined,
          category: article.category ?? undefined,
          heroImageUrl: heroImageUrl ?? undefined,
          heroImageAlt: heroImageAlt || undefined,
          heroImageBase64,
          heroImageFilename,
          heroImageMime,
        };
        const outcome = await this.writeToTarget(adapter, target.type, decision, payload, {
          force: forcedTargetIds.has(target.id),
          recreateMissing: recreateRequested && namedTargetIds.has(target.id),
          homepage,
        });

        // Last used timestamp güncelle — best-effort: yazilamazsa yayinlanmis
        // makale "basarisiz" sayilmasin (catch blogu sonucu ok:false yapardi)
        await this.prisma.publishTarget.update({
          where: { id: target.id },
          data: { lastUsedAt: new Date() },
        }).catch((err: any) => this.log.warn(`[${articleId}] ${target.type} lastUsedAt yazilamadi: ${err.message}`));

        const result: PublishResult = { targetId: target.id, targetType: target.type, ...outcome };
        // Sayfaya yazilan canonical kayda gecer (PublishResult.canonicalUrl)
        if (result.ok && adapter.needsFullPage) result.canonicalUrl = canonicalFor(target);
        if (result.ok) {
          // publishedTo kaydinin zamanlari: ilk yayin (yeni kayitta simdi, aksi halde
          // onceki kayittan tasinir — panel "Yayın Geçmişi" bunu gosterir) ve son yazim
          const now = new Date().toISOString();
          const fresh = result.action === 'created' || result.action === 'recreated';
          const firstAt = fresh ? now : typeof live?.publishedAt === 'string' ? live.publishedAt : undefined;
          if (firstAt) result.publishedAt = firstAt;
          result.updatedAt = now;
          // Bu hedefe giden metnin izi: sonraki yayinlarda "hedefteki metin eski mi" buna bakilir
          result.contentHash = liveState.contentHash;
        }
        results.push(result);

        this.log.log(`[${articleId}] ${target.type} → ${result.ok ? '✓' : '✗'}${result.action ? ` ${result.action}` : ''} ${result.externalUrl ?? result.error ?? ''}`);
      } catch (err: any) {
        results.push({
          targetId: target.id,
          targetType: target.type,
          ok: false,
          error: err.message,
        });
        this.log.error(`[${articleId}] ${target.type} hata: ${err.message}`);
      }
    }
    results.push(...unavailableResults, ...notSelectedResults);

    // Article status + publishedTo güncelle
    const successful = results.filter(r => r.ok);
    if (successful.length > 0) {
      // publishedAt = yazinin ILK yayin tarihi. Yalniz bu yayindan ONCE yazinin
      // canli (disa aktarim olmayan) bir kopyasi yoksa ve bu yayin canli bir
      // kopya actiysa yazilir: ilk gercek yayin, ya da tum canli kopyalar
      // unutulduktan / cop kutusuna atildiktan sonraki yeniden yayin. Yayindaki
      // yaziyi baska bir hedefe ilk kez yazmak (Markdown ZIP disa aktarimi, yeni
      // eklenen FTP hedefi) ya da silinmis kopyayi yeniden olusturmak (recreated)
      // yazinin ilk yayin tarihini DEGISTIRMEZ: icerik yeni degil. Silinmis kopya
      // once bir yayinda missingAt alip (D3) sonraki yayinda yeniden olusturulsa da
      // (o an "canli kopyasi yok" gorunur) ayni kural: yalniz 'created' sayilir.
      // Okuyanlar (18.10.2026 tarandi):
      //  - "donemde yayinlanan yazi" sayilari: reports.service overview,
      //    site-report isDokumu, agency (son 30 gun), email.cron haftalik ozet,
      //    geo-score-card tazelik (30/7 gun). Guncelleme / disa aktarim yeni yayin
      //    sayilsaydi eski yazi bu donemin uretimi gibi raporlanirdi (yanlis musteri verisi).
      //  - llms-full "Yayin:" tarihi, siralamalar (orderBy publishedAt) ve uretim
      //    hattinin JSON-LD datePublished'i (pipeline: existing.publishedAt): ilk yayin dogru.
      //  - ai-sitemap lastmod ve content-pivot "30 gunden eski" suzgeci SON yazimi
      //    bekler: eskiden publishedAt her yeniden yayinda ileri aliniyordu ve
      //    pivotun tek bekleme suresi buydu. Son yazim artik publishedTo
      //    kayitlarinin updatedAt'inda; pivot lastLiveWriteAt'i
      //    (republish-policy.ts), site haritasi adresi veren kaydin updatedAt'ini okur.
      const typeById = new Map(article.site.publishTargets.map((t) => [t.id, String(t.type)]));
      const typeOf = (targetId: string) => typeById.get(targetId);
      const hadLiveCopy = siteLiveEntries(previousPublishedTo, typeOf).length > 0;
      const wroteLiveCopy = successful.some((r) => r.action === 'created' && republishModeForType(r.targetType) !== 'export');
      const writtenTargetIds = new Set(successful.map((r) => r.targetId));
      const freshEntries = successful.map((r) => ({ ...r }));
      const observed = entryObservations(results);
      // Bu yayinda bir kopya cop kutusunda ya da silinmis bulundu (kayda trashedAt / missingAt)
      const retiredNow = observed.trashed.size + observed.missing.size > 0;
      const now = new Date().toISOString();
      let pendingTargetIds: string[] = [];
      let siteCopyGone = false;
      // Hedef bazinda birlestir: diger hedeflerdeki canli kopyalarin kaydi
      // kaybolmasin. Yeni metni alamayan canli kopyalar (yalniz yeni kayit acan
      // hedef, pasif hedef, WordPress'te elle degismis yazi, acik listede
      // secilmeyen hedef...) "elle guncelleme bekliyor" diye isaretlenir; bu
      // yayinda yazilan hedeflerin kaydi taze, isaretsiz; cop kutusunda bulunan
      // kopyaya trashedAt, silinmis bulunana missingAt yazilir.
      // Birlestirme yayinin BASINDA okunan listeye degil, yazmadan hemen once
      // yeniden okunan GUNCEL listeye yapilir (commitArticleState, K10): uzun
      // bir yayin sirasinda musterinin "guncelledim" / "unut" demesi ezilmez.
      await this.commitArticleState(articleId, (fresh) => {
        const unobserved = mergePublishedTo(fresh.publishedTo, freshEntries);
        const merged = applyEntryObservations(unobserved, { trashed: observed.trashed, missing: observed.missing, present: observed.present, presentStatus: observed.presentStatus, now });
        const refreshed = refreshManualUpdateFlags({
          publishedTo: merged,
          targets: article.site.publishTargets as PublishTargetRow[],
          articleSlug: article.slug,
          ...liveState,
          writtenTargetIds,
          trashedTargetIds: observed.trashed,
          unwritableTargetIds: observed.unwritable,
          now,
        });
        // Emekliye ayrilan kopyanin adresini canonical bildiren tam sayfa kopyalari (bu yayinda
        // yazilan dahil: sayfasi yayindan onceki listeyle kuruldu) elle guncelleme bekler
        const flags = retiredNow && probeSite
          ? withRetiredCanonicalFlags(refreshed, flagRetiredCanonicalCopies({ site: probeSite, slug: article.slug, before: unobserved, after: refreshed.publishedTo, targets: canonicalTargets, now }))
          : refreshed;
        pendingTargetIds = flags.pendingTargetIds;
        // Metin yayin sirasinda degistiyse (or. bir yeniden yazim bitti) kayit
        // artik yayinlanan metni tasimiyor: durum ve onizleme ona dokunulmadan
        // kalir (PUBLISHED, kayittaki metnin yayinda oldugu anlamina gelir)
        const textUnchanged = articleContentHash(fresh) === liveState.contentHash;
        const keepPublishedAt = fresh.publishedAt != null && (hadLiveCopy || !wroteLiveCopy);
        // "Son canli kopya" kurali (statusAfterRetirement, recordUnwrittenLiveState ile ayni):
        // bu yayinda kopya cop kutusunda / silinmis bulunduysa ve yazilan hedefler yalniz
        // disa aktarimsa (Markdown ZIP) yazinin sitede canli kopyasi kalmamistir; PUBLISHED
        // denmez, READY_TO_PUBLISH olur. NEDEN: ZIP yeniden uretildi diye yazi sitede yayinda
        // sayiliyordu (panel, KPI'lar ve raporlar sitede olmayan yaziyi sayiyordu). Kopya
        // emekliye ayrilmayan yayinda (ilk disa aktarim dahil) davranis aynen kalir.
        const baseStatus = textUnchanged ? 'PUBLISHED' : String(fresh.status ?? '');
        const status = retiredNow ? statusAfterRetirement(baseStatus, flags.publishedTo, typeOf) : baseStatus;
        siteCopyGone = status !== baseStatus;
        return {
          ...(textUnchanged
            ? {
              status,
              // Panel onizlemesi bunu dogrudan DOM'a basiyor → tam sayfa degil parca sakla
              bodyHtml: fragmentHtml,
            }
            : status !== String(fresh.status ?? '') ? { status } : {}),
          ...(keepPublishedAt ? {} : { publishedAt: new Date() }),
          publishedTo: flags.publishedTo,
        };
      });
      if (pendingTargetIds.length > 0) {
        this.log.warn(`[${articleId}] Güncel metni alamayan canlı kopyalar elle güncelleme bekliyor: ${pendingTargetIds.join(', ')}`);
      }
      if (siteCopyGone) {
        this.log.warn(`[${articleId}] Sitedeki son canlı kopya çöp kutusunda ya da silinmiş; yalnız dışa aktarım (Markdown ZIP) yazıldı, durum READY_TO_PUBLISH`);
      }

      // Sosyal kanallara otomatik DRAFT post artık üretilmiyor — kullanıcı article
      // listesindeki "Sosyalde paylaş" butonundan modal ile kanal seçip elle ekler.
      // (Geri açmak istersen: socialAutoDraft.createDraftsForArticle(articleId) çağır.)

      // Yeni sayfa eklendi → iç link envanteri bayatladı. Cache düşürülmezse
      // sonraki makaleler bu makaleye link veremez (envanterde görünmez).
      this.urlInventory.invalidate(article.siteId);

      // GEO: yayinlanan URL'i tum AI/search engine kanallarina ping at (best-effort)
      const firstPublicUrl = successful.find((r) => r.externalUrl)?.externalUrl;
      if (firstPublicUrl) {
        this.indexingPinger.pingUrl(article.siteId, firstPublicUrl).catch((err) => {
          this.log.warn(`[${articleId}] index ping basarisiz: ${err.message}`);
        });
      }

      // GEO: yeni makale llms-full.txt'ye HEMEN girsin diye site'in llms dosyasini
      // yeniden uret (haftalik cron'u bekleme). Best-effort — publish'i bloklamaz.
      // AI-sitemap zaten anlik (on-demand) uretildigi icin ayrica rebuild gerekmez.
      try {
        const r = await this.llmsFullBuilder.build(article.siteId);
        this.log.log(`[${articleId}] llms-full.txt güncellendi: ${r.articles} makale, ${(r.bytes / 1024).toFixed(1)} KB`);

        // GEO: kendi llms.txt'sini üretmeyen hedeflere (kobipratik gibi) llms.txt +
        // llms-full.txt push et. Best-effort — desteklemeyen adapter no-op döner.
        await this.pushLlmsToTargets(article.siteId, selectedTargets).catch((err) => {
          this.log.warn(`[${articleId}] llms push başarısız: ${err.message}`);
        });
      } catch (err: any) {
        this.log.warn(`[${articleId}] llms-full.txt rebuild başarısız: ${err.message}`);
      }
    } else {
      await this.recordUnwrittenLiveState(article, results, liveState, initiator);
    }

    return results;
  }

  /**
   * Hicbir hedefe yazilmayan yayinin ardindan yazinin DURUM GERCEGI.
   *
   * Yazi yayindaysa (canli kopyasi duruyorsa) ve bu yayin yalniz BILEREK
   * atlandiysa (kopya acilmadi, kayit adreslenemedi, slug degisti, hedef pasif)
   * durum PUBLISHED'a doner: yazi gercekten yayinda, yalniz eski metinle.
   * NEDEN: yeniden yazilan yazi READY_TO_PUBLISH'te kaliyordu; panel yayindaki
   * yaziyi "yayına hazır" gosteriyor, PUBLISHED okuyan her yer (llms-full,
   * site haritasi, KPI'lar, takili sayfa eslesmesi, raporlar) onu yok sayiyordu.
   * publishedAt (ilk yayin) degismez. Yeni metni alamayan kopyalar "elle
   * guncelleme bekliyor" diye isaretlenir (refreshManualUpdateFlags).
   *
   * Bir hedef HATA verdiyse (yetki, ag) durum DEGISMEZ: yazi onayda kalir,
   * kullanici yeniden dener (worker "onayini bekliyor" e-postasini atar). DB
   * hatasi yayin sonucunu degistirmez (hicbir hedefe zaten yazilmadi); uyari loglanir.
   *
   * Cop kutusu (R19): yerinde guncelleme kopyanin WordPress cop kutusunda
   * oldugunu gorduyse kayda trashedAt yazilir (kopya artik canli sayilmaz:
   * site haritasi, llms-full, pivot ve takili sayfa plani onu ilan etmez).
   * Yazinin SITEDE baska canli kopyasi kalmadiysa PUBLISHED yazi
   * READY_TO_PUBLISH olur ve llms-full yeniden uretilir. Kural tek yerde
   * (republish-policy statusAfterRetirement): musterinin "bu kaydi unut" demesi
   * (articles.service forgetPublishedEntry) ve canlilik denetimi de onu kullanir.
   * Markdown ZIP disa aktarimi sitede kopya SAYILMAZ (siteLiveEntries): eskiden
   * yalniz ZIP kaydi kalan yazi PUBLISHED kaliyordu. Gerekce: yazi sitede hicbir
   * yerde yayinda degil; PUBLISHED okuyan her yer (site haritasi, llms-full,
   * KPI'lar, raporlar) olmayan bir sayfayi sayardi. READY_TO_PUBLISH metni bitmis,
   * yayini musterinin kararina birakir; hicbir otomasyon onu kendiliginden
   * yayinlamaz. publishedAt gecmis kaydi olarak kalir.
   * Silinmis kopya (D3, live_entry_missing) ayni kural: kayda missingAt yazilir,
   * kopya canli sayilmaz, sitedeki son canli kopyaysa yazi READY_TO_PUBLISH olur.
   *
   * Otomatik yazim engeli (S4): yayini otomasyon baslattiysa (initiator
   * 'automation') ve en az bir hedef bilerek atlandiysa agentOutputs.liveWriteBlocked
   * { at, reasons } ayni kosullu yazimla kaydedilir. Icerik pivotu bu kayittan sonraki
   * 30 gun yaziyi yeniden yazmaz: hicbir sey yazilmayinca son canli yazim ani
   * ilerlemiyor, yazi her hafta LLM yeniden yazimina giriyordu. Kullanicinin
   * yayini kaydetmez (pivotu, kopyanin "elle guncelleme bekliyor" isareti durdurur).
   */
  private async recordUnwrittenLiveState(
    article: { id: string; siteId?: string; slug: string; status?: unknown; publishedTo?: unknown; site: { url?: unknown; publishTargets: unknown[] } },
    results: PublishResult[],
    liveState: { contentHash: string; legacyContentChanged: boolean },
    initiator: PublishInitiator,
  ): Promise<void> {
    const hasError = results.some((r) => !r.ok && !r.skipped);
    // Hedefte artik durmayan kopya (cop kutusunda ya da silinmis: 'live_entry_missing')
    // "eski metniyle yayinda" sayilmaz; durum ona bakarak PUBLISHED'a cekilmez
    const stillLive = results.some((r) => !r.ok && !!r.skipped && r.skipped !== 'live_entry_trashed' && r.skipped !== 'live_entry_missing');
    const observed = entryObservations(results);
    const typeById = new Map((article.site.publishTargets as PublishTargetRow[]).map((t) => [t.id, t.type]));
    const typeOf = (targetId: string) => typeById.get(targetId);
    const now = new Date().toISOString();
    const site = parseSiteUrl(typeof article.site.url === 'string' ? article.site.url : '');
    const targetRefs = new Map((article.site.publishTargets as Array<{ id: string; type: unknown; config?: unknown }>)
      .map((t) => [t.id, { type: String(t.type), config: t.config }]));
    const blockedReasons: LiveWriteBlockedReason[] = initiator === 'automation'
      ? results.filter((r) => !r.ok && !!r.skipped).map((r) => ({ targetId: r.targetId, targetType: r.targetType, skipped: String(r.skipped) }))
      : [];
    let outcome = { backToPublished: false, retired: false, pending: [] as string[] };
    try {
      const done = await this.commitArticleState(article.id, (fresh) => {
        const refreshed = refreshManualUpdateFlags({
          publishedTo: applyEntryObservations(fresh.publishedTo, { trashed: observed.trashed, missing: observed.missing, present: observed.present, presentStatus: observed.presentStatus, now }),
          targets: article.site.publishTargets as PublishTargetRow[],
          articleSlug: article.slug,
          ...liveState,
          trashedTargetIds: observed.trashed,
          unwritableTargetIds: observed.unwritable,
          now,
        });
        // Emekliye ayrilan kopyanin adresini canonical bildiren tam sayfa kopyalari (flagRetiredCanonicalCopies)
        const flags = observed.trashed.size + observed.missing.size > 0 && site
          ? withRetiredCanonicalFlags(refreshed, flagRetiredCanonicalCopies({ site, slug: article.slug, before: fresh.publishedTo, after: refreshed.publishedTo, targets: targetRefs, now }))
          : refreshed;
        const status = String(fresh.status ?? '');
        // Yalniz gozlemlerden SONRA sitede gercekten canli bir kopya kaldiysa. NEDEN: emekli kopyaya
        // yazilmayan yayin (slug'i degismis dosya kopyasi 'slug_changed', adresi dogrulanamayan
        // kayit 'live_entry_unverified', taslaga alinmis WordPress yazisi 'live_entry_edited')
        // "eski metniyle yayinda" sayiliyordu: yazi sitede hic canli kopyasi yokken PUBLISHED oluyordu.
        const backToPublished = !hasError && stillLive && status !== 'PUBLISHED'
          && siteLiveEntries(flags.publishedTo, typeOf).length > 0;
        // Sitedeki son canli kopya emekliye ayrildi mi: "son canli kopya" kurali durumu
        // degistiriyorsa (yalniz PUBLISHED yazi, sitede canli kopya kalmadi; Markdown ZIP sayilmaz)
        const effective = backToPublished ? 'PUBLISHED' : status;
        const retired = observed.trashed.size + observed.missing.size > 0
          && statusAfterRetirement(effective, flags.publishedTo, typeOf) !== effective;
        const before = Array.isArray(fresh.publishedTo) ? fresh.publishedTo : [];
        const entriesChanged = JSON.stringify(flags.publishedTo) !== JSON.stringify(before);
        outcome = { backToPublished: backToPublished && !retired, retired, pending: flags.pendingTargetIds };
        const blocked = blockedReasons.length > 0;
        if (!entriesChanged && !outcome.backToPublished && !retired && !blocked) return null;
        return {
          ...(retired ? { status: 'READY_TO_PUBLISH' } : outcome.backToPublished ? { status: 'PUBLISHED' } : {}),
          ...(entriesChanged ? { publishedTo: flags.publishedTo } : {}),
          ...(blocked ? { agentOutputs: agentOutputsWithLiveWriteBlocked(fresh.agentOutputs, { at: now, reasons: blockedReasons }) } : {}),
        };
      }, blockedReasons.length > 0 ? { agentOutputs: true } : undefined);
      if (!done) return;
      this.log.warn(
        `[${article.id}] Hiçbir hedefe yazılmadı${outcome.backToPublished ? '; yazı eski metniyle yayında, durum PUBLISHED' : ''}`
        + `${outcome.retired ? '; sitedeki son canlı kopya çöp kutusunda ya da silinmiş (Markdown ZIP sitede kopya sayılmaz), durum READY_TO_PUBLISH' : ''}`
        + `${outcome.pending.length > 0 ? `; elle güncelleme bekleyen: ${outcome.pending.join(', ')}` : ''}`
        + `${blockedReasons.length > 0 ? '; otomatik yazım engellendi (içerik pivotu 30 gün yeniden yazmaz)' : ''}`,
      );
    } catch (err: any) {
      this.log.warn(`[${article.id}] Yayın sonrası yazı durumu kaydedilemedi: ${err.message}`);
      return;
    }
    if (outcome.retired && article.siteId) {
      // Olu adres AI tarayicilarina haftalik yenilemeye kadar gosterilmesin (en iyi caba)
      await this.llmsFullBuilder.build(article.siteId)
        .catch((err: any) => this.log.warn(`[${article.id}] llms-full.txt yeniden üretilemedi: ${err?.message ?? err}`));
    }
  }

  /**
   * Yayin sonucunu yaziya yazar — GUNCEL kayit uzerine (K10).
   *
   * NEDEN: yayinci publishedTo'yu yayinin basinda okuyup sonunda kosulsuz
   * yaziyordu. Uzun bir yayin (gorsel uretimi, QA, birkac hedef) sirasinda
   * musterinin "guncelledim" (mark-updated) ya da "bu kaydi unut" (forget)
   * istegi ya da baska bir yayin kaydi yazarsa, yayinin sonu eski listeyle
   * onlari geri aliyordu. Simdi: kayit yeniden okunur, compute bu yayinin
   * sonucunu o listeye hedef bazinda birlestirir ve yazim yalniz okunan
   * updatedAt hala gecerliyse yapilir (tek SQL UPDATE; mark-updated / forget
   * uclari ayni iyimser kilidi kullanir — articles.service writeEntries).
   * Yarisirsa yeniden okunup yeniden birlestirilir; COMMIT_CONDITIONAL_ATTEMPTS
   * denemeden sonra en taze okumanin uzerine kosulsuz yazilir (yeni acilan
   * kopyanin kimligi kaybolursa sonraki yayin ikinci kopya acardi). updatedAt
   * acikca yazilir: kilit Prisma'nin updateMany davranisina dayanmaz.
   * compute null donerse yazilacak bir sey yok demektir. extraSelect: agir alanlar
   * (agentOutputs) yalniz yazilacaklarsa okunur — birlestirme ayni taze okumadan yapilir.
   */
  private async commitArticleState(
    articleId: string,
    compute: (fresh: FreshArticleState) => Record<string, unknown> | null,
    extraSelect?: { agentOutputs: true },
  ): Promise<Record<string, unknown> | null> {
    const select = extraSelect ? { ...FRESH_STATE_SELECT, ...extraSelect } : FRESH_STATE_SELECT;
    for (let attempt = 1; ; attempt += 1) {
      const fresh = (await this.prisma.article.findUnique({ where: { id: articleId }, select })) as FreshArticleState | null;
      if (!fresh) {
        this.log.warn(`[${articleId}] Yayın sonucu kaydedilemedi: yazı artık yok`);
        return null;
      }
      const data = compute(fresh);
      if (!data) return null;
      if (attempt > COMMIT_CONDITIONAL_ATTEMPTS) {
        await this.prisma.article.update({ where: { id: articleId }, data: data as any });
        this.log.warn(`[${articleId}] Yayın kaydı ${COMMIT_CONDITIONAL_ATTEMPTS} kez yarıştı; en güncel kayıt üzerine yazıldı`);
        return data;
      }
      const r = await this.prisma.article.updateMany({
        where: { id: articleId, updatedAt: fresh.updatedAt },
        data: { ...data, updatedAt: new Date() } as any,
      });
      if (r.count === 1) return data;
      this.log.warn(`[${articleId}] Yayın kaydı yazılırken yazı değişti; güncel kayıt üzerine yeniden birleştiriliyor (${attempt}/${COMMIT_CONDITIONAL_ATTEMPTS})`);
    }
  }

  /**
   * Tek hedefe yazim — karar (decideRepublish) ve adaptor yetenegine gore.
   *  - update: adaptor yerinde gunceller. Kayit hedefte bulunamazsa (notFound:
   *    404/410) once yazinin herkese acik adresi yoklanir (S18): adres hala
   *    aciliyorsa hicbir sey yazilmaz ve yeni kayit acilmaz
   *    ('live_entry_unresolvable', kopya canli kalir). Aksi halde yalniz
   *    opts.recreateMissing ACIKCA true ise yeni kayit acilir (kullanicinin bu
   *    hedefi secerek yaptigi yayin, D2); acilmazsa hicbir sey yazilmaz: adres
   *    404/410 verdiyse 'live_entry_missing' (emekli), dogrulanamadiysa
   *    'live_entry_unverified' (kopya canli kalir). Cop kutusundaysa
   *    yapilmaz: musteri bilerek kaldirmis, geri getirilmez. Kayitli kimlik bu
   *    yaziya ait degilse (mismatch) hicbir sey yazilmaz, kopya acilmaz. Yazi
   *    RanksUp'in son yaziminden sonra hedefte degismisse (edited) musterinin
   *    duzenlemesi ezilmez; yalniz opts.force (kullanicinin acik onayi) ile
   *    yazilir. Diger hata (yetki, ag, beklenmeyen yanit) yeni kayit ACMAZ —
   *    yazi hala yayinda olabilir, yeni yayin ikinci kopya olurdu.
   *  - overwrite / export / publish_new: bugunku gibi publish().
   * Basarili yazimda adaptorun dondurdugu hedef damgasi (remoteModifiedAt) ve WordPress
   * hedefinde yazinin durumu (remoteStatus) kayda gecer.
   */
  private async writeToTarget(
    adapter: any,
    targetType: string,
    decision: Exclude<RepublishDecision, { kind: 'blocked' }>,
    payload: PublishPayload,
    opts: { force?: boolean; recreateMissing?: boolean; homepage?: string | null } = {},
  ): Promise<Omit<PublishResult, 'targetId' | 'targetType'>> {
    const stamp = (r: any) => (typeof r?.remoteModifiedAt === 'string' && r.remoteModifiedAt ? { remoteModifiedAt: r.remoteModifiedAt as string } : {});
    // WordPress'in bu yazimda bildirdigi yazi durumu (istenen degil, WordPress'in kaydettigi):
    // "?p= adresi herkese acik mi" karari yazim anindaki bu bilgiden verilir (PublishResult.remoteStatus)
    const wpStatus = (r: any) => (republishModeForType(targetType) === 'update' && typeof r?.status === 'string' && r.status.trim()
      ? { remoteStatus: r.status.trim() as string }
      : {});
    if (decision.kind === 'update') {
      if (typeof adapter.update !== 'function') {
        // Karar tablosu (UPDATE_TARGET_TYPES) ile adaptor ayrismis: kopya acma
        return { ok: false, skipped: 'already_live_create_only', error: publishSkipText('already_live_create_only', targetType) };
      }
      const r = await adapter.update(decision.ref, payload, { force: opts.force === true });
      if (r?.ok) {
        return {
          ok: true,
          action: 'updated',
          externalUrl: r.externalUrl ?? decision.ref.externalUrl,
          externalId: r.externalId ?? decision.ref.externalId,
          ...stamp(r),
          ...wpStatus(r),
        };
      }
      if (r?.mismatch) {
        return {
          ok: false,
          skipped: 'live_entry_mismatch',
          error: publishSkipText('live_entry_mismatch', targetType, { postId: r.externalId ?? decision.ref.externalId ?? null, remoteSlug: r.remoteSlug ?? null, slug: payload.slug }),
        };
      }
      if (r?.trashed) {
        return { ok: false, skipped: 'live_entry_trashed', error: publishSkipText('live_entry_trashed', targetType) };
      }
      if (r?.edited) {
        // Durum (remoteStatus): emekli kopya yalniz WordPress 'publish' diyorsa geri gelir (entryObservations)
        return { ok: false, skipped: 'live_entry_edited', error: publishSkipText('live_entry_edited', targetType, { remoteModifiedAt: r.remoteModifiedAt ?? null }), ...wpStatus(r) };
      }
      if (r?.notFound) {
        // Kimligin 404'u yazinin silindigini kanitlamaz (S18, checkEntryPublicUrl):
        // once yazinin herkese acik adresi yoklanir. Yoklayici yoksa (dogrudan
        // kurulan ornek) adaptorun cevabi yeterli sayilir.
        const postId = r.externalId ?? decision.ref.externalId ?? null;
        const urlState: EntryUrlState = this.entryUrlCheck
          ? await this.entryUrlCheck(decision.ref.externalUrl, { homepage: opts.homepage ?? null })
          : 'gone';
        if (urlState === 'live') {
          // Adres hala aciliyor: emekliye ayirma da, yeniden olusturma da yanlis olurdu
          // (kullanici hedefi acikca secse bile ayni adreste ikinci kopya acilirdi)
          return { ok: false, skipped: 'live_entry_unresolvable', error: publishSkipText('live_entry_unresolvable', targetType, { postId }) };
        }
        // Silinen kaydi yeniden acmak istenmedi (otomasyon, bos liste, takili sayfa):
        // hedefe hicbir sey yazilmaz, neden atlama metninde musteriye gider. Adres de
        // 404/410 vermediyse (dogrulanamadi) kopya emekliye ayrilmaz.
        if (opts.recreateMissing !== true) {
          if (urlState === 'unknown') {
            return { ok: false, skipped: 'live_entry_unverified', error: publishSkipText('live_entry_unverified', targetType, { postId }) };
          }
          return { ok: false, skipped: 'live_entry_missing', error: publishSkipText('live_entry_missing', targetType) };
        }
        // Kullanicinin acik secimi (D2): adres 404/410 ya da dogrulanamadi (WAF / site
        // kapali): canli bir kopya gorulmedigi icin yazi eskisi gibi yeniden olusturulur
        const p = await adapter.publish(payload);
        return { ok: !!p?.ok, externalUrl: p?.externalUrl, externalId: p?.externalId, error: p?.error, ...(p?.ok ? { action: 'recreated' as const, ...stamp(p), ...wpStatus(p) } : {}) };
      }
      return { ok: false, error: `Mevcut yazı güncellenemedi; kopya açılmadı. ${r?.error ?? 'Hedef yanıt vermedi.'}` };
    }
    const p = await adapter.publish(payload);
    const action: PublishAction = decision.kind === 'publish_new' ? 'created' : decision.kind === 'overwrite' ? 'overwritten' : 'exported';
    return { ok: !!p?.ok, externalUrl: p?.externalUrl, externalId: p?.externalId, error: p?.error, ...(p?.ok ? { action, ...stamp(p), ...wpStatus(p) } : {}) };
  }

  /**
   * Site'in llms.txt (kısa index) + llms-full.txt içeriğini, llms push destekleyen
   * publish hedeflerine gönderir (kobipratik vb). Desteklemeyen adapter `skipped`
   * döner → atlanır. Tamamen best-effort: publish sonucunu etkilemez.
   */
  private async pushLlmsToTargets(
    siteId: string,
    targets: Array<{ type: string; credentials: any; config: any }>,
  ): Promise<void> {
    if (!targets || targets.length === 0) return;

    const full =
      ((await this.prisma.site.findUnique({
        where: { id: siteId },
        select: { llmsFullTxt: true } as any,
      })) as any)?.llmsFullTxt ?? '';
    const shortIndex = await this.llmsFullBuilder.buildShortIndex(siteId);

    for (const target of targets) {
      const Adapter = getAdapter(target.type) as any;
      if (!Adapter) continue;
      const credentials = decryptCredentials(target.credentials as Record<string, any>);
      const unsafe = await publishTargetBlockReason(target.type, credentials, target.config);
      if (unsafe) {
        this.log.warn(`[${siteId}] llms push → ${target.type} atlandi: ${unsafe}`);
        continue;
      }

      try {
        const adapter = new Adapter(credentials, target.config ?? {});
        if (typeof adapter.pushLlms !== 'function') continue;
        const r = await adapter.pushLlms({ llmsTxt: shortIndex, llmsFullTxt: full });
        if (r?.ok) {
          this.log.log(`[${siteId}] llms push → ${target.type}: ✓ ${r.externalUrl ?? ''}`);
        } else if (r && !r.skipped) {
          this.log.warn(`[${siteId}] llms push → ${target.type}: ${r.error ?? 'bilinmeyen hata'}`);
        }
      } catch (err: any) {
        this.log.warn(`[${siteId}] llms push → ${target.type} hata: ${err.message}`);
      }
    }
  }

}
