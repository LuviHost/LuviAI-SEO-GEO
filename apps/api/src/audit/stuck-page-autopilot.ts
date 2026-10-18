import { Prisma, type StuckPageStatus } from '@prisma/client';
import { siteWhereForFeature } from '../billing/plan-site-filter.js';
import { FEATURE_MIN_PLAN, PLAN_FEATURE_LABELS, findPlan, planHasFeature, type PlanId } from '../billing/plans.js';
import { autoPublishEnabled } from '../articles/publish-approval.js';
// Yeniden yayin kurali tek yerde: yayinci da ayni karari verir
import {
  OVERWRITE_TARGET_TYPES, UPDATE_TARGET_TYPES, articleContentHash, decideRepublish, entryRetired, lastLiveWriteAt, liveEntries, liveEntryRef,
  republishModeForType, targetLabel,
} from '../articles/republish-policy.js';
// "Kayittaki metin canlida mi" kurali yeniden yazim hattiyla ortak (pipeline.service)
import { rowTextIsLive } from '../articles/live-rewrite.js';
import {
  STUCK_AI_DISABLED, STUCK_ARTICLE_EMPTY, STUCK_ARTICLE_LIVE_COPY_BEHIND, STUCK_ARTICLE_NOT_FOUND, STUCK_ARTICLE_NOT_LIVE,
  STUCK_ARTICLE_PENDING_VERSION, STUCK_ARTICLE_REWRITING, STUCK_ARTICLE_UNPUBLISHED_CHANGES, STUCK_EXTERNAL_AUTOPILOT_SKIP,
  STUCK_PAGE_NOT_FOUND,
} from './stuck-page-messages.js';

/**
 * Takili sayfa OTOPILOTU — haftalik tarama (STUCK_PAGE_DETECT_ALL), otomatik
 * kurtarma (STUCK_PAGE_RECOVER, triggeredBy 'autopilot') ve duzenlenen
 * makalenin YERINDE yeniden yayini (planArticleRepublish) kurallari.
 *
 * NEDEN AYRI DOSYA: kurallar worker'da satir ici duruyordu ve uc hata tasiyordu:
 *  1. Plan kapisi yoktu. Takili Sayfalar Profesyonel ozelligi (plans.ts
 *     FEATURE_MIN_PLAN.stuckPages; uclar @RequiresPlan('stuckPages')), ama
 *     haftalik tarama her aktif sitede GSC cekiyor, otopilot acik her sitede
 *     makaleyi yeniden yazip YAYINLIYORDU — alt plan musterisi ozelligi bedava
 *     kullaniyordu (plan-site-filter.ts'teki diger cron'larla ayni hata sinifi).
 *  2. Yari otomatik musterinin yazisi onaysiz yeniden yayinlaniyordu
 *     (publish-approval.ts).
 *  3. Yonlendirme getDetail(stuckPageId) ile tek argumanla yapiliyordu;
 *     getDetail(siteId, stuckPageId) her zaman null donuyor, her is RanksUp
 *     disi sayfa servisine gidip makale sayfasinda hata atiyordu — otopilot
 *     kurtarmasi hic calismiyordu.
 * Worker bu dosyayi api/dist'ten kullanir; kurallar burada test edilir.
 */

/** Sitede haftada en fazla bu kadar sayfa otomatik kurtarilir (en yuksek stuckScore once) */
export const STUCK_AUTO_RECOVER_PER_SITE = 5;

/**
 * Otomatik kurtarma adaylari bu buyuklukte sayfalarla okunur (en yuksek
 * stuckScore once): uygun olmayanlar elendikten sonra ilk
 * STUCK_AUTO_RECOVER_PER_SITE tanesi kuyruga girer.
 */
export const STUCK_AUTO_RECOVER_SCAN = 25;

/**
 * Sitede bir haftalik taramada en fazla bu kadar aday satiri okunur.
 * NEDEN: tarama yalniz ilk 25 satiri okuyup sonra eliyordu; kalici olarak
 * uygun olmayan yuksek puanli satirlar (ornegin taslak akisinda ?p= adresiyle
 * kayitli eski yazilar) her hafta ayni pencereyi doldurup altlarindaki uygun
 * sayfalari hic kuyruga birakmiyordu. Simdi STUCK_AUTO_RECOVER_SCAN'lik
 * sayfalarla, yeterince uygun sayfa bulunana ya da satirlar bitene kadar
 * okunur; bu tavan tek sitenin taramayi uzatmasini sinirlar.
 */
export const STUCK_AUTO_RECOVER_SCAN_BUDGET = 500;

/**
 * Takili sayfa kurtarma islerinin (haftalik otopilot ve paneldeki toplu onarim)
 * BullMQ onceligi. NEDEN DUSUK: her is GEO taramasi (~14 sirali istek) +
 * Sonnet cagrisi, sayfa basina ~30-60 sn; 50 sayfalik toplu istek oncelik
 * verilmeden kuyruga girince iki worker yuvasini ~12-25 dk tutuyor, butun
 * musterilerin yayin, uretim ve kurulum isleri arkasinda bekliyordu.
 * BullMQ'da oncelik verilmeyen is HER ZAMAN once islenir; oncelikli islerde
 * KUCUK sayi once gelir. Iki kaynak: docs.bullmq.io/guide/jobs/prioritized
 * ("Jobs without a priority assigned will get the highest priority", "a lower
 * number is always a higher priority than higher numbers") ve kurulu bullmq
 * 5.76.2 kaynagi (interfaces/base-job-options.d.ts "Ranges from 0 (highest
 * priority) to 2 097 152 (lowest priority)"; commands/includes/fetchNextJob.lua
 * once bekleme listesinden RPOPLPUSH yapar, oncelikli kumeye yalniz liste bosken
 * bakar). Kullanilan diger oncelikler 5 (site denetimi) ve 10 (kurulum, MCP,
 * gorsel alt metni); 50 hepsinin arkasinda kalir. Ikinci asama (kisa yerinde
 * yeniden yayin) bilerek onceliksizdir.
 */
export const STUCK_RECOVER_JOB_PRIORITY = 50;

/**
 * Yayindaki makaleyi YERINDE guncelleyebilen yayin hedefi tipleri: ayni yazi
 * yeniden yayinlaninca mevcut sayfa degisir, yeni sayfa acilmaz
 * (kural ve kaynaklar: articles/republish-policy.ts):
 *  - WORDPRESS_REST / WORDPRESS_XMLRPC: adaptor update() mevcut yaziyi kimligi
 *    (ya da adresindeki slug) ile bulup gunceller — POST /wp/v2/posts/<id>,
 *    wp.editPost; adres, durum, yazar, tarih degismez. Yalniz yazinin
 *    kaydi adreslenebiliyorsa (externalId, ?p= ya da adreste slug).
 *  - FTP / SFTP / CPANEL_API: her yayin `${remotePath}/${slug}.html` dosyasina
 *    yazar ve dosyanin uzerine yazar (basic-ftp uploadFrom, ssh2-sftp-client
 *    put, cPanel Fileman::upload_files overwrite=1).
 *  - GITHUB: ayni dosya yolu; mevcut dosyanin sha'siyla
 *    createOrUpdateFileContents guncelleme commit'i atar.
 *  - KOBIPRATIK: page-meta/upsert, yol (onek + slug) anahtarli.
 *  Yol tabanli hedeflerde yazinin slug'i yayindan sonra degistiyse yeni yol
 *  yeni sayfa demektir: o kayit da yerinde guncellenemez (slug_changed).
 * Digerleri her yayinda YENI kayit acar (Ghost / Strapi / Webflow / Shopify
 * POST, Sanity create, Contentful createEntry, WHMCS AddKBArticle), ne yaptigi
 * bilinmez (ozel PHP uc noktasi) ya da canli sayfaya hic dokunmaz (Markdown
 * ZIP, Wix).
 *
 * NEDEN: takili sayfa kurtarmasi yaziyi duzenleyip yeniden yayinliyordu; bu
 * hedeflerde sitede yazinin ikinci bir kopyasi aciliyor, takili adres hic
 * degismiyor, panel yine de "Düzeltildi" diyordu. Guncelleme yolu olmayan
 * hedeflerde duzenleme yalniz ONERI olarak kaydedilir.
 */
export const IN_PLACE_REPUBLISH_TARGET_TYPES: ReadonlySet<string> = new Set([...UPDATE_TARGET_TYPES, ...OVERWRITE_TARGET_TYPES]);

/** Neden makale yeniden yayinlanamiyor */
export type RepublishBlock = 'create_only' | 'unaddressable' | 'slug_changed' | 'target_missing' | 'unknown_location';

export type ArticleRepublishPlan =
  | { kind: 'republish'; targetIds: string[]; targetTypes: string[] }
  | { kind: 'proposal'; block: RepublishBlock; labels: string[] };

export interface RepublishTargetRow {
  id: string;
  type: unknown;
  isActive?: boolean | null;
}

/**
 * Duzenlenen makale nereye, yerinde yeniden yayinlanabilir?
 *
 * Kaynak, makalenin YAYINDA oldugu hedeflerdir (publishedTo), varsayilan hedef
 * degil: yazi WordPress'te yayindayken varsayilan hedef sonradan FTP yapildiysa
 * FTP'ye yayin yeni bir sayfa acar, takili WordPress adresi degismezdi.
 * Yazinin yayinda oldugu HER hedef yerinde guncelleyebilmeli; tek bir kopya
 * bile guncellenemiyorsa (yalniz yeni kayit acan hedef, kaydi adreslenemeyen
 * WordPress yazisi, slug'i degismis dosya, silinmis / pasif hedef, hedefi
 * kayitli olmayan eski yayin) duzenleme oneri olarak kalir. Hedef basina
 * karar yayincininkiyle ayni fonksiyondan gelir (republish-policy.ts
 * decideRepublish): plan "yerinde" deyip yayinci kopya diye reddetmesin.
 * slug verilmezse slug degisimi denetlenmez.
 */
export function planArticleRepublish(input: { publishedTo: unknown; targets: RepublishTargetRow[]; slug?: string | null }): ArticleRepublishPlan {
  const entries = (Array.isArray(input.publishedTo) ? input.publishedTo : [])
    .filter((e): e is Record<string, unknown> => !!e && typeof e === 'object' && (e as Record<string, unknown>).ok !== false);
  if (entries.length === 0) return { kind: 'proposal', block: 'unknown_location', labels: [] };
  const byId = new Map(input.targets.map((t) => [t.id, t]));
  const targetIds: string[] = [];
  const targetTypes: string[] = [];
  const createOnly = new Set<string>();
  const unaddressable = new Set<string>();
  const slugChanged = new Set<string>();
  const missing = new Set<string>();
  for (const e of entries) {
    const id = typeof e.targetId === 'string' && e.targetId ? e.targetId : null;
    if (!id) return { kind: 'proposal', block: 'unknown_location', labels: [] };
    const t = byId.get(id);
    if (!t || t.isActive === false) {
      missing.add(targetLabel(t?.type ?? e.targetType));
      continue;
    }
    const type = String(t.type);
    const decision = decideRepublish({ entry: { ...e, targetId: id }, targetType: type, articleSlug: input.slug });
    if (decision.kind === 'blocked') {
      const bucket = decision.reason === 'unaddressable' ? unaddressable : decision.reason === 'slug_changed' ? slugChanged : createOnly;
      bucket.add(targetLabel(type));
      continue;
    }
    // Markdown ZIP canli sayfaya dokunmaz: takili adres degismez. Cagiranlar
    // (planStuckRepublish, icerik pivotu) disa aktarim kayitlarini once ayirir.
    if (decision.kind !== 'update' && decision.kind !== 'overwrite') {
      createOnly.add(targetLabel(type));
      continue;
    }
    if (!targetIds.includes(id)) {
      targetIds.push(id);
      targetTypes.push(type);
    }
  }
  if (createOnly.size > 0) return { kind: 'proposal', block: 'create_only', labels: [...createOnly] };
  if (unaddressable.size > 0) return { kind: 'proposal', block: 'unaddressable', labels: [...unaddressable] };
  if (slugChanged.size > 0) return { kind: 'proposal', block: 'slug_changed', labels: [...slugChanged] };
  if (missing.size > 0) return { kind: 'proposal', block: 'target_missing', labels: [...missing] };
  return { kind: 'republish', targetIds, targetTypes };
}

// ─────────────────────────────────────────────────────────────────────────
//  TAKILI ADRES — duzeltilecek kopya gercekten takili sayfa mi?
// ─────────────────────────────────────────────────────────────────────────

/**
 * Takili sayfa planinin ek engelleri. RepublishBlock'a eklenmez: o tipi icerik
 * pivotu da kullanir ve her degerini tek tek karsilar (content-pivot.service
 * pivotBlockText); takiliya ozgu engeller burada ayri tutulur.
 *  - export_only: yazinin yalniz disa aktarim kaydi var (Markdown ZIP) —
 *    sitedeki sayfaya dokunan bir kopya yok.
 *  - url_mismatch: guncellenebilen canli kopyalarin hicbiri takili adres degil
 *    (ornek: eski yayinci her yeniden yayinda /yazi-2/ kopyasi acip kaydi
 *    yalniz o kopyayla ezdi; takili sayfa asil /yazi/ adresi).
 *  - draft_link: url_mismatch'in ozel hali — guncellenebilen WordPress
 *    kopyalarinin kayitli adresi yalniz taslak baglantisi (?p=<kimlik>);
 *    yazinin yayindaki kalici adresi henuz kayitli degil.
 *  - live_copy_trashed: kopya WordPress cop kutusunda (yayinci kayda trashedAt
 *    yazar); musteri kaldirmis, RanksUp ona yazmaz.
 *  - live_copy_missing: kopya hedefte artik yok (yayinci yerinde guncellemede
 *    404/410 gorup kayda missingAt yazar; paylasilan sozlesme D3).
 *  - live_copy_edited: kopya RanksUp'in son yaziminden sonra sitede
 *    degismis (takili sayfa yayini 'live_entry_edited' gorup kayda
 *    remoteEditSkip yazdi); duzenleme musterinin metnini ezerdi.
 *  - live_copy_mismatch: kayitli WordPress kimligi artik baska bir yaziyi
 *    gosteriyor (takili sayfa yayini 'live_entry_mismatch' gordu).
 *  - live_copy_stale: kopya "elle guncelleme bekliyor" (manualUpdatePending):
 *    son metin oraya yazilmadi (yazilamadi ya da o hedef secilmedi); RanksUp
 *    bu kopyaya kendiliginden yazmaz.
 */
export type StuckRepublishBlock =
  | RepublishBlock | 'export_only' | 'url_mismatch' | 'draft_link'
  | 'live_copy_trashed' | 'live_copy_missing' | 'live_copy_edited' | 'live_copy_mismatch' | 'live_copy_stale';

export type StuckRepublishPlan =
  | { kind: 'republish'; targetIds: string[]; targetTypes: string[] }
  | { kind: 'proposal'; block: StuckRepublishBlock; labels: string[] };

/** Yol parcalari: bos parca yok, kacislar cozulmus, kucuk harf (dedektorun eslemesi gibi) */
function pathParts(path: string): string[] {
  return path
    .split('/')
    .map((seg) => {
      let s = seg;
      try { s = decodeURIComponent(seg); } catch { /* bozuk kacis — oldugu gibi */ }
      return s.trim().toLowerCase();
    })
    .filter(Boolean);
}

/**
 * Herkese acik adresin karsilastirma anahtari: sema, www, sondaki bolu ve son
 * parcadaki .html yok; kucuk harf; sorgu korunur — duz kalici baglantili
 * WordPress'te yazinin adresi `/?p=12`, sorgu atilsaydi ana sayfayla eslesirdi.
 * Iki kaynak: wordpress.org/documentation/article/customize-permalinks ("The
 * default Plain Permalink ... http://example.com/?p=N") ve wordpress-develop
 * wp-includes/link-template.php get_permalink ("$permalink = home_url( '?p=' .
 * $post->ID );"). Dedektorun eslemesiyle (stuck-page-detector.service
 * matchArticle norm) ayni kurallar; http(s) degilse null.
 */
function publicUrlKey(raw: unknown): string | null {
  if (typeof raw !== 'string' || !raw.trim()) return null;
  let u: URL;
  try { u = new URL(raw.trim()); } catch { return null; }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
  const parts = pathParts(u.pathname);
  if (parts.length > 0) parts[parts.length - 1] = parts[parts.length - 1].replace(/\.html?$/, '');
  const host = u.hostname.toLowerCase().replace(/\.$/, '').replace(/^www\./, '');
  return `${host}/${parts.join('/')}${u.search}`;
}

/**
 * Sunucu kok dizini isaretleri — adreste yer almaz (klasik hosting
 * public_html / www, Plesk httpdocs, XAMPP htdocs, IIS wwwroot, Debian
 * /var/www/html). articles/article-url.util.ts ayni kokleri adresten atar.
 */
const WEB_ROOT_PARTS: ReadonlySet<string> = new Set(['public_html', 'htdocs', 'httpdocs', 'wwwroot', 'www']);

/** Dosya hedefi kaydinin yol parcalari (sunucudaki ya da depodaki yol) */
function fileEntryParts(raw: string, targetType: string): string[] {
  let path: string;
  try { path = new URL(raw).pathname; } catch { path = raw.split(/[?#]/)[0]; }
  const parts = pathParts(path);
  // GitHub html_url: /<sahip>/<depo>/blob/<dal>/<depodaki yol>. Iki kaynak:
  // @octokit/openapi-types (GitHub'in resmi OpenAPI tanimindan uretilir) dosya
  // html_url ornegi "https://github.com/github/docs/blob/main/CODE_OF_CONDUCT.md";
  // github.ts yanitta html_url yoksa ayni bicimi kurar.
  return targetType === 'GITHUB' && parts[2] === 'blob' ? parts.slice(4) : parts;
}

const sameParts = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((p, i) => p === b[i]);

/**
 * Dosya hedefi: klasor + slug. Adaptorler `${klasor}/${slug}.html` (FTP, SFTP,
 * cPanel) ya da `${klasor}/${slug}.md|html` (GitHub) yazar. Slug ayni olmali;
 * klasor, sunucu kok dizini atildiktan sonra takili adresin klasoruyle ayni
 * olmali. Yolda kok isareti yoksa (FTP kullanicisinin dizini site kokunun
 * ustunde olabilir; GitHub icerik klasoru 'content/blog' → '/blog/'), takili
 * adresin klasoru BOS DEGILSE ve yolun sonuyla ayniysa ayni dosya sayilir.
 * Ana sayfa hicbir yazi dosyasi degildir.
 */
function fileEntryAddressesUrl(raw: string, targetType: string, pageUrl: string): boolean {
  let u: URL;
  try { u = new URL(pageUrl); } catch { return false; }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
  const page = pathParts(u.pathname);
  if (page.length === 0) return false;
  const pageSlug = page[page.length - 1].replace(/\.(?:html?|php)$/, '');
  const pageDir = page.slice(0, -1);
  const entry = fileEntryParts(raw, targetType);
  if (entry.length === 0) return false;
  const entrySlug = entry[entry.length - 1].replace(/\.(?:html?|mdx?|markdown)$/, '');
  if (!entrySlug || entrySlug !== pageSlug) return false;
  let dir = entry.slice(0, -1);
  let rooted = false;
  for (let i = dir.length - 1; i >= 0; i--) {
    if (WEB_ROOT_PARTS.has(dir[i]) || (dir[i] === 'html' && dir[i - 1] === 'www')) {
      dir = dir.slice(i + 1);
      rooted = true;
      break;
    }
  }
  if (sameParts(dir, pageDir)) return true;
  return !rooted && pageDir.length > 0 && dir.length > pageDir.length && sameParts(dir.slice(dir.length - pageDir.length), pageDir);
}

/**
 * Bu yayin kaydi (ya da yayin sonucu) takili sayfanin adresi mi?
 *  - WordPress (REST / XML-RPC) ve KobiPratik: kayittaki herkese acik adres
 *    takili adresle ayni (publicUrlKey). Yalniz `?p=` adresi olan WordPress
 *    kaydi (taslak olarak acilan yazi) kalici baglantili takili adresle
 *    KARSILASTIRILAMAZ: eslesmez — eski yayincinin actigi /yazi-2/ taslak
 *    kopyasi da boyle kayitlidir; RanksUp emin olmadan yaziya dokunmaz.
 *  - FTP / SFTP / GitHub: klasor + slug (fileEntryAddressesUrl).
 *  - cPanel: yayin sonucu herkese acik adres tasir ama alan adi, ayarda
 *    publicBaseUrl yoksa cPanel sunucu adindan tahmin edilir (cpanel-api.ts);
 *    yol ise yazilan dosyanin yoludur → klasor + slug.
 *  - Diger hedefler (yeni kayit acan, disa aktarim): hicbir zaman.
 */
export function liveEntryAddressesUrl(
  entry: { externalUrl?: unknown; url?: unknown; externalId?: unknown } | null | undefined,
  targetType: unknown,
  pageUrl: unknown,
): boolean {
  if (!entry || typeof pageUrl !== 'string' || !pageUrl.trim()) return false;
  const raw = liveEntryRef({ targetId: '', ...entry }).externalUrl;
  if (!raw) return false;
  const type = String(targetType ?? '');
  if (type === 'WORDPRESS_REST' || type === 'WORDPRESS_XMLRPC' || type === 'KOBIPRATIK') {
    const key = publicUrlKey(raw);
    return key !== null && key === publicUrlKey(pageUrl);
  }
  if (type === 'FTP' || type === 'SFTP' || type === 'GITHUB' || type === 'CPANEL_API') {
    return fileEntryAddressesUrl(raw, type, pageUrl.trim());
  }
  return false;
}

const isTrashedEntry = (e: Record<string, unknown>) => typeof e.trashedAt === 'string' && e.trashedAt !== '';

/**
 * Kayit artik canli degil mi: WordPress cop kutusunda (trashedAt) ya da hedefte
 * hic yok (missingAt — yerinde guncellemede 404/410 goruldu ve yazi yeniden
 * olusturulmadi; paylasilan sozlesme D3, ayni anlam). Kural tek yerde:
 * yayincinin ve liveEntries'in kullandigi republish-policy entryRetired.
 */
export function isRetiredStuckEntry(e: unknown): boolean {
  return entryRetired(e);
}

/**
 * Takili sayfa ikinci asamasinda kopyanin sitede degistigini gosteren atlamalar.
 * Duzenleme geri alininca kayda remoteEditSkip + remoteEditSeenAt yazilir
 * (rollbackStuckEntryFlags); plan bu isaretle ayni kopyaya bir daha otomatik
 * duzeltme denemez. Isaret, o hedefe sonraki BASARILI yazimda kendiliginden
 * kalkar: yayinci yazilan hedefin kaydini taze kayitla degistirir.
 */
export type RemoteEditSkip = 'live_entry_edited' | 'live_entry_mismatch';

export function remoteEditSkipOf(e: unknown): RemoteEditSkip | null {
  const v = e && typeof e === 'object' ? (e as Record<string, unknown>).remoteEditSkip : undefined;
  return v === 'live_entry_edited' || v === 'live_entry_mismatch' ? v : null;
}

/**
 * Adres WordPress'in kisa `?p=<kimlik>` baglantisi mi? Taslak olarak gonderilen
 * yazinin kaydina WordPress bu baglantiyi verir; yazinin yayindaki kalici adresi
 * henuz bilinmez. Iki kaynak: developer.wordpress.org
 * wp_force_plain_post_permalink ("Publicly viewable links never have plain
 * permalinks"; goruntulenebilir olmayan durum, ornek baglanti istenmedikce
 * duz baglanti alir — get_permalink o zaman home_url( '?p=' . $post->ID ) doner)
 * ve create_initial_post_types (taslak durumu 'protected' => true kayitli,
 * herkese acik degil). Adaptor de yazi kimligini bu parametreden okur
 * (adapters wordpress-post-ref.ts wordPressPostId).
 */
function isWordPressShortLink(raw: unknown): boolean {
  if (typeof raw !== 'string' || !raw.trim()) return false;
  try {
    return /^\d{1,15}$/.test(new URL(raw.trim()).searchParams.get('p') ?? '');
  } catch {
    return false;
  }
}

/**
 * Takili sayfa icin yerinde yeniden yayin plani — planArticleRepublish'in
 * kurallari + takili adrese ozgu kosullar. Recover, haftalik tarama, geri alma
 * ve ikinci asama (yayindan hemen once) AYNI plani kullanir.
 *
 * Sira (ilk tutan engel doner):
 *  1. Takili adresteki ya da tek kopya artik canli degilse (cop kutusu:
 *     live_copy_trashed; hedefte yok: live_copy_missing).
 *  2. Markdown ZIP canli sayfaya dokunmaz (republish-policy 'export'): kayit
 *     yok sayilir; yazinin YALNIZ disa aktarim kaydi varsa export_only. NEDEN:
 *     ZIP kaydi 'create_only' sayiliyordu — WordPress + ZIP yazisi hic otomatik
 *     duzeltilmiyor, oneri metni de "ikinci kopya acardi" diye yanlis bir iddia
 *     tasiyordu (icerik pivotu ayni kaydi zaten yok sayiyor).
 *  3. planArticleRepublish: yazinin yayinda oldugu HER hedef yerinde
 *     guncelleyebilmeli (create_only / unaddressable / slug_changed / ...).
 *  4. Yeni metni alacak kopyalardan biri onceki takili sayfa yayininda sitede
 *     degismis bulundu (live_copy_edited) ya da kimligi baska yaziyi gosterdi
 *     (live_copy_mismatch); ya da "elle guncelleme bekliyor" (live_copy_stale).
 *     NEDEN AYRI: eskiden hepsi manualUpdatePending'den okunup "elle
 *     degistirilmis" deniyordu; isaret ayni zamanda "son metin bu kopyaya
 *     yazilmadi" demek ve secilmeyen ya da pasif kalmis kopyada da konuyor.
 *  5. Yeni metni alacak kopyalardan biri takili adres olmali: url_mismatch
 *     (kopyalarin kayitli adresi yalniz WordPress `?p=` baglantisiysa
 *     draft_link — kalici adres henuz kayitli degil).
 *     NEDEN: plan takili adresi hic gormuyordu. Dedektor /yazi/ adresini slug
 *     ile makaleye bagliyor, kayit ise eski /yazi-2/ kopyasini gosteriyordu:
 *     kopya guncelleniyor, /yazi/ hic degismeden sayfa "Düzeltildi" oluyor,
 *     30 gunluk olcum degismemis sayfayi olcuyordu.
 * url bos ya da adres degilse eslesme kurulamaz: url_mismatch (emin olmadan yazilmaz).
 */
export function planStuckRepublish(input: {
  publishedTo: unknown;
  targets: RepublishTargetRow[];
  slug?: string | null;
  url: unknown;
}): StuckRepublishPlan {
  const byId = new Map(input.targets.map((t) => [t.id, t]));
  const typeOf = (e: Record<string, unknown>) => byId.get(typeof e.targetId === 'string' ? e.targetId : '')?.type ?? e.targetType;
  const labelsOf = (list: Array<Record<string, unknown>>) => [...new Set(list.map((e) => targetLabel(typeOf(e))))];
  const entries = (Array.isArray(input.publishedTo) ? input.publishedTo : [])
    .filter((e): e is Record<string, unknown> => !!e && typeof e === 'object' && (e as Record<string, unknown>).ok !== false);
  // Cop kutusu ve hedefte olmayan kopya ayni kurala tabi; metin nedeni ayri soyler
  const retiredPlan = (list: Array<Record<string, unknown>>): StuckRepublishPlan => {
    const trashed = list.filter(isTrashedEntry);
    return trashed.length > 0
      ? { kind: 'proposal', block: 'live_copy_trashed', labels: labelsOf(trashed) }
      : { kind: 'proposal', block: 'live_copy_missing', labels: labelsOf(list) };
  };

  const retired = entries.filter(isRetiredStuckEntry);
  const retiredHere = retired.filter((e) => liveEntryAddressesUrl(e, typeOf(e), input.url));
  if (retiredHere.length > 0) return retiredPlan(retiredHere);
  const live = entries.filter((e) => !isRetiredStuckEntry(e));
  if (entries.length > 0 && live.length === 0) return retiredPlan(retired);

  const sitewide = live.filter((e) => republishModeForType(typeOf(e)) !== 'export');
  if (live.length > 0 && sitewide.length === 0) return { kind: 'proposal', block: 'export_only', labels: labelsOf(live) };

  const base = planArticleRepublish({ publishedTo: sitewide, targets: input.targets, slug: input.slug });
  if (base.kind !== 'republish') return base;

  const planned = sitewide.filter((e) => typeof e.targetId === 'string' && base.targetIds.includes(e.targetId));
  const edited = planned.filter((e) => remoteEditSkipOf(e) === 'live_entry_edited');
  if (edited.length > 0) return { kind: 'proposal', block: 'live_copy_edited', labels: labelsOf(edited) };
  const mismatched = planned.filter((e) => remoteEditSkipOf(e) === 'live_entry_mismatch');
  if (mismatched.length > 0) return { kind: 'proposal', block: 'live_copy_mismatch', labels: labelsOf(mismatched) };
  const stale = planned.filter((e) => e.manualUpdatePending === true);
  if (stale.length > 0) return { kind: 'proposal', block: 'live_copy_stale', labels: labelsOf(stale) };
  if (!planned.some((e) => liveEntryAddressesUrl(e, typeOf(e), input.url))) {
    const addresses = planned.map((e) => liveEntryRef({ targetId: '', ...e }).externalUrl ?? targetLabel(typeOf(e)));
    const shortLinkOnly = planned.length > 0 && planned.every((e) => {
      const type = String(typeOf(e) ?? '');
      return (type === 'WORDPRESS_REST' || type === 'WORDPRESS_XMLRPC') && isWordPressShortLink(liveEntryRef({ targetId: '', ...e }).externalUrl);
    });
    return { kind: 'proposal', block: shortLinkOnly ? 'draft_link' : 'url_mismatch', labels: [...new Set(addresses)].slice(0, 3) };
  }
  return base;
}

/** Ikinci asama geri alinirken yazilmayan kopyalarda yayindan onceki haline donen alanlar */
const ROLLBACK_ENTRY_FIELDS = ['manualUpdatePending', 'manualUpdatePendingSince', 'remoteModifiedAt'] as const;

/**
 * Takili sayfa ikinci asamasi GERI ALINDIGINDA (metin duzenlemeden onceki
 * haline donduruldu) yayincinin bu yayinda yazilmayan kopyalara koydugu
 * isaretleri yayindan onceki haline dondurur (saf; girdi degismez).
 *
 * NEDEN: yayinci isaretleri o anki kayit metnine (yapay zekanin duzenledigi,
 * sonra atilan metin) gore hesaplar: WordPress'te degismis kopya "elle
 * guncelleme bekliyor" (manualUpdatePending) isaretini aliyordu. Metin geri
 * alininca kopyanin izi kayittaki metinle yine aynidir, yani "kopyada eski
 * surum yayinda" iddiasi yanlis: panel "Eski sürüm yayında" gosteriyor,
 * "Güncel metni kopyala" musterinin WordPress duzenlemelerini silecek metni
 * veriyor, "Elle güncelledim" de duzenleme korumasini (remoteModifiedAt)
 * kaldiriyordu.
 *  - Bu yayinda BASARIYLA yazilan hedef: dokunulmaz (kaydi taze ve gercek).
 *  - Yayindan once kaydi olmayan hedef: dokunulmaz.
 *  - Bu yayinda cop kutusunda / hedefte yok bulunan kopya: dokunulmaz (yayinci
 *    gozleme dayanarak isareti bilerek kaldirdi; gozlem gercek).
 *  - Digerleri: manualUpdatePending, manualUpdatePendingSince ve
 *    remoteModifiedAt yayindan onceki degerine doner (onceden yoksa silinir);
 *    diger alanlar (yayincinin gozlemleri) kalir.
 *  - Kopya bu yayinda sitede degismis ya da kimligi baska yaziyi gosterir
 *    bulunduysa (remoteEdits) kayda remoteEditSkip + remoteEditSeenAt yazilir:
 *    panel bunu "eski surum" diye gostermez, takili sayfa plani ise ayni kopyaya
 *    bir daha otomatik duzeltme denemez (yoksa otopilot her hafta yapay zeka
 *    cagirip ayni oneriyi uretirdi).
 */
export function rollbackStuckEntryFlags(input: {
  current: unknown;
  snapshot: unknown;
  writtenTargetIds: ReadonlySet<string>;
  remoteEdits: ReadonlyMap<string, RemoteEditSkip>;
  now: string;
}): { publishedTo: unknown[]; changed: boolean } {
  const before = new Map<string, Record<string, unknown>>();
  for (const e of Array.isArray(input.snapshot) ? input.snapshot : []) {
    const id = e && typeof e === 'object' ? (e as Record<string, unknown>).targetId : undefined;
    if (typeof id === 'string' && id !== '' && !before.has(id)) before.set(id, e as Record<string, unknown>);
  }
  let changed = false;
  const out = (Array.isArray(input.current) ? input.current : []).map((raw) => {
    if (!raw || typeof raw !== 'object') return raw;
    const e = raw as Record<string, unknown>;
    const id = typeof e.targetId === 'string' ? e.targetId : '';
    const prev = before.get(id);
    if (!id || !prev || input.writtenTargetIds.has(id) || isRetiredStuckEntry(e)) return raw;
    const copy: Record<string, unknown> = { ...e };
    let differs = false;
    for (const f of ROLLBACK_ENTRY_FIELDS) {
      const had = Object.prototype.hasOwnProperty.call(prev, f);
      if (had && copy[f] !== prev[f]) { copy[f] = prev[f]; differs = true; }
      if (!had && Object.prototype.hasOwnProperty.call(copy, f)) { delete copy[f]; differs = true; }
    }
    const skip = input.remoteEdits.get(id);
    if (skip) {
      const seenAt = remoteEditSkipOf(prev) === skip && typeof prev.remoteEditSeenAt === 'string' ? prev.remoteEditSeenAt : input.now;
      if (copy.remoteEditSkip !== skip || copy.remoteEditSeenAt !== seenAt) {
        copy.remoteEditSkip = skip;
        copy.remoteEditSeenAt = seenAt;
        differs = true;
      }
    }
    if (!differs) return raw;
    changed = true;
    return copy;
  });
  return { publishedTo: out, changed };
}

/**
 * Kullaniciya gosterilen neden (Turkce).
 *  - autopilot: otopilot hicbir sey degistirmedi
 *  - proposal: "AI Duzelt" onerileri kaydetti, yazi degismedi
 *  - skip: hicbir sey yapilmadi (yapay zeka da cagrilmadi)
 *  - revert: geri alma yapilmadi
 *  - republish: duzenleme kuyruktayken hedef degisti; yayinlanmadi, metin geri alindi
 */
export function republishBlockText(
  plan: { block: StuckRepublishBlock; labels: string[] },
  context: 'autopilot' | 'proposal' | 'skip' | 'revert' | 'republish',
): string {
  const where = plan.labels.join(', ') || 'yayın hedefi';
  let cause: string;
  switch (plan.block) {
    case 'create_only':
      cause = `Yazının yayınlandığı hedef (${where}) mevcut yazıyı yerinde güncelleyemiyor; yeniden yayınlamak sitende yazının ikinci bir kopyasını açardı.`;
      break;
    case 'unaddressable':
      cause = `Yazının yayınlandığı hedefte (${where}) mevcut yazının kimliği ya da adresi kayıtlı değil; yazı bulunamadığı için yerinde güncellenemez, yeniden yayın ikinci bir kopya açardı.`;
      break;
    case 'slug_changed':
      cause = `Yazının adresi ilk yayından sonra değişti; ${where} hedefine yeniden yayın yeni bir sayfa açardı, takılı adres eski metinle kalırdı.`;
      break;
    case 'target_missing':
      cause = `Yazının yayınlandığı yayın hedeflerinden biri (${where}) silinmiş ya da pasif; oradaki kopya güncellenemez.`;
      break;
    case 'export_only':
      cause = `Yazı yalnız ${where} olarak dışa aktarıldı; dışa aktarım sitendeki sayfaya dokunmaz, bu yüzden RanksUp takılı sayfayı güncelleyemez.`;
      break;
    case 'url_mismatch':
      cause = `Takılı adres, RanksUp'ın kayıtlı yayın adresiyle eşleşmiyor (kayıtlı: ${where}). Yazı sitende başka bir adreste de yayında olabilir (örneğin eski bir kopya); yanlış sayfayı değiştirmemek için takılı adrese dokunulmadı.`;
      break;
    case 'draft_link':
      // Kopya iddiasi YOK: kayitli kisa baglanti ayni yaziya ait olabilir; yalniz
      // kalici adres kayitli degil. Musterinin yayinladigi kesin bilinmedigi icin kosullu
      cause = `RanksUp'ta bu yazı için yalnız WordPress'in kısa ?p= bağlantısı var (${where}); taslak olarak gönderilen yazılar böyle kaydedilir, yazının yayındaki kalıcı adresi henüz kayıtlı değil. Takılı adresin bu yazı olduğu doğrulanamadığı için yazıya dokunulmadı; yazıyı taslaktan sen yayınladıysan RanksUp onu kendiliğinden düzenlemez.`;
      break;
    case 'live_copy_trashed':
      cause = `Yazının sitendeki kopyası (${where}) çöp kutusunda; RanksUp kaldırılan yazıyı düzenleyip yeniden yayınlamaz.`;
      break;
    case 'live_copy_missing':
      cause = `Yazının sitendeki kopyası (${where}) artık bulunamıyor (silinmiş ya da taşınmış olabilir); RanksUp silinen yazıyı kendiliğinden yeniden oluşturmaz.`;
      break;
    case 'live_copy_edited':
      // "elle" denmez: RanksUp'in kendi gorsel alt metni / meta yazimi da yazinin
      // degisiklik zamanini ilerletir; kesin olan, kopyanin sitede degistigi
      cause = `Yazının sitendeki kopyası (${where}) RanksUp'ın son yayınından sonra sitende değiştirilmiş; RanksUp sitedeki değişikliklerin üzerine kendiliğinden yazmaz.`;
      break;
    case 'live_copy_mismatch':
      cause = `Yazının kayıtlı kimliği sitende (${where}) artık başka bir yazıyı gösteriyor; RanksUp yanlış yazıyı değiştirmemek için takılı sayfaya dokunmaz.`;
      break;
    case 'live_copy_stale':
      cause = `Yazının sitendeki kopyasına (${where}) son metin yazılmadı (son yayında yazılamadı ya da o hedef seçilmedi); RanksUp bu kopyanın üzerine kendiliğinden yazmaz. Kopyayı yazının sayfasındaki Yayın Geçmişi'nden güncelleyebilirsin.`;
      break;
    default:
      cause = 'Yazının hangi yayın hedefinde yayında olduğu kayıtlı değil; yeniden yayın yanlış yerde yeni bir sayfa açabilirdi.';
  }
  switch (context) {
    case 'autopilot':
      return `${cause} Otopilot bu sayfayı otomatik düzeltmez; Takılı Sayfalar ekranındaki "AI Düzelt" ile önerileri alıp elle uygulayabilirsin.`;
    case 'proposal':
      return `${cause} Öneriler kaydedildi, yazı değiştirilmedi; Takılı Sayfalar ekranında Detay'dan görüp yazına elle uygula.`;
    case 'skip':
      return `${cause} Hiçbir şey değiştirilmedi.`;
    case 'revert':
      return `${cause} Bu yüzden düzeltme otomatik geri alınmadı; önceki metni düzeltme kaydında görüp yazına elle geri yükleyebilirsin.`;
    case 'republish':
      return `${cause} Düzeltme yayınlanmadı, yazı önceki haline döndürüldü.`;
  }
}

// ─────────────────────────────────────────────────────────────────────────
//  YAZININ DURUMU — duzeltme yalniz canlidaki metin uzerinden
// ─────────────────────────────────────────────────────────────────────────

/** Kurtarma ve taramanin okudugu yazi alanlari (Prisma select) */
export const STUCK_ARTICLE_SELECT = {
  status: true,
  slug: true,
  title: true,
  metaTitle: true,
  metaDescription: true,
  bodyMd: true,
  publishedTo: true,
  publishedAt: true,
} as const;

export interface StuckArticleRow {
  status?: unknown;
  slug: string;
  title?: string | null;
  metaTitle?: string | null;
  metaDescription?: string | null;
  bodyMd?: string | null;
  publishedTo?: unknown;
  publishedAt?: Date | null;
}

/**
 * Duzeltme bu yazinin metni uzerinden yapilabilir mi? Engel yoksa null, varsa
 * kullaniciya gosterilecek neden.
 *
 * NEDEN: icerik pivotu ve kapali dongu yayindaki yazinin kaydini yeniden
 * yazimla ezer (READY_TO_PUBLISH / REVIZE_NEEDED; canli metin yalniz
 * agentOutputs.liveSnapshot'ta). Kurtarma kayittaki metni "once" diye okuyup
 * duzenliyor ve yeniden yayinliyordu: onaylanmamis (ya da editorun reddettigi)
 * yeniden yazim, yeni basligi ve yapisiyla onaysiz canliya cikiyor, "Geri Al"
 * de canlidaki eski metne degil taslaga donuyordu. Yayinci yazinin durumuna
 * bakmadan kayitta ne varsa yayinlar; kural burada. "Kayittaki metin canlida"
 * karari yeniden yazim hattiyla ortak (live-rewrite.ts rowTextIsLive: canli bir
 * kopyanin icerik izi kayit metninin iziyle ayni, ya da izsiz eski kayitta
 * PUBLISHED + isaretsiz).
 *
 * Neden metni NEDENE gore (eskiden hepsine "onay bekleyen yeni bir surum var;
 * onaylayin ya da reddedin" deniyordu — onaylanacak bir sey ve reddetme eylemi
 * olmadan da):
 *  - READY_TO_PUBLISH / REVIZE_NEEDED: gercekten yayinlanmamis yeni surum.
 *  - PUBLISHED + "elle guncelleme bekliyor" kopya: son metin bir kopyaya
 *    yazilamadi (musteri kopyayi gunceller ya da "Elle güncelledim" der).
 *  - PUBLISHED, isaret yok: kayitta yayinlanmamis bir degisiklik (capraz
 *    baglanti / snippet uygulamasi kaydi degistirir, yayinlamaz) ya da nedeni
 *    bilinmeyen fark.
 */
export function stuckArticleLiveBlock(article: StuckArticleRow): string | null {
  const status = String(article.status ?? '');
  if (status === 'PUBLISHED' && rowTextIsLive(article)) return null;
  if (status === 'GENERATING' || status === 'EDITING') return STUCK_ARTICLE_REWRITING;
  if (status === 'READY_TO_PUBLISH' || status === 'REVIZE_NEEDED') return STUCK_ARTICLE_PENDING_VERSION;
  if (status === 'PUBLISHED') {
    const behind = liveEntries(article.publishedTo).some((e) => e.manualUpdatePending === true && !isRetiredStuckEntry(e));
    return behind ? STUCK_ARTICLE_LIVE_COPY_BEHIND : STUCK_ARTICLE_UNPUBLISHED_CHANGES;
  }
  return STUCK_ARTICLE_NOT_LIVE;
}

/**
 * recover()'un yapay zekadan ve her degisiklikten ONCEKI ucuz denetimleri
 * (RanksUp makalesi olan sayfa). Engel yoksa null, varsa kullaniciya giden neden.
 * Toplu onarim kuyruga almadan once AYNI kurali uygular (stuck-batch-result.ts,
 * paylasilan sozlesme D4): is kosunca atlanacagi bastan bilinen sayfa kuyruga
 * girmez, nedeni satirda hemen doner.
 *  1. Yazi yok.
 *  2. Takili adresteki (ya da tek) kopya cop kutusunda / hedefte yok: oneri de
 *     uretilmez — musteri yaziyi kaldirdi (metin her baglamda "hicbir sey
 *     degistirilmedi" der; "AI Düzelt" de oneri uretmez).
 *  3. Kayittaki metin canlida degil (stuckArticleLiveBlock).
 *  4. Govde bos.
 */
export function stuckArticleSkipReason(article: StuckArticleRow | null | undefined, plan: StuckRepublishPlan | null): string | null {
  if (!article) return STUCK_ARTICLE_NOT_FOUND;
  if (plan && plan.kind === 'proposal' && (plan.block === 'live_copy_trashed' || plan.block === 'live_copy_missing')) {
    return republishBlockText(plan, 'skip');
  }
  const liveBlock = stuckArticleLiveBlock(article);
  if (liveBlock) return liveBlock;
  if (!(article.bodyMd ?? '').trim()) return STUCK_ARTICLE_EMPTY;
  return null;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Otopilotun olcum penceresi: dedektor GSC'nin son 30 gununu olcer
 * (stuck-page-detector.service fetchPagePerformance(siteId, 30)). Yazi bu
 * pencerede yeniden yayinlandiysa (icerik pivotu, kapali dongu, onceki
 * duzeltme) veri buyuk olcude ESKI metnin performansidir; ayni sabah pivotla
 * yeniden yazilmis yaziya bayat veriyle ikinci bir otomatik duzenleme yapilmaz.
 */
export const STUCK_MEASUREMENT_WINDOW_DAYS = 30;

/**
 * Basarisiz denemeden sonra otopilotun ayni adresi yeniden denemedigi sure.
 * NEDEN: kalici bir engel (canli metindeki kalite engeli, cop kutusu) varsa
 * otopilot her pazartesi yapay zeka + kalite kontrolu harcayip bir FAILED
 * satiri daha ekliyordu. Dedektor artik adresin son FAILED satirini yeniden
 * kullanir (sure icinde FAILED kalir; sure dolunca kurtarma kaydi yoksa
 * DETECTED'a doner), ama eski dedektorun biriktirdigi yinelenen DETECTED
 * satirlari icin bu bekleme hala gerekli. Kullanici "AI Düzelt" ile her zaman
 * elle deneyebilir.
 */
export const STUCK_FAILED_COOLDOWN_DAYS = 30;

function asDate(v: unknown): Date | null {
  if (v instanceof Date) return Number.isFinite(v.getTime()) ? v : null;
  if (typeof v === 'string') {
    const t = Date.parse(v);
    return Number.isFinite(t) ? new Date(t) : null;
  }
  return null;
}

/**
 * Yazi olcum penceresi icinde yayinlandi ya da guncellendi mi? Evet ise o an,
 * degilse null. Son yazim kayitlarin updatedAt'i (lastLiveWriteAt); izi
 * olmayan eski yayinda ilk yayin tarihi — icerik pivotunun bekleme suresiyle
 * ayni kural (content-pivot.service).
 */
export function recentStuckLiveWrite(article: { publishedTo?: unknown; publishedAt?: unknown }, now: Date): Date | null {
  const last = lastLiveWriteAt(article.publishedTo) ?? asDate(article.publishedAt);
  if (!last) return null;
  return now.getTime() - last.getTime() < STUCK_MEASUREMENT_WINDOW_DAYS * DAY_MS ? last : null;
}

/** Olcum penceresi nedeniyle otopilotun atladigi sayfanin nedeni (is sonucu) */
export function recentLiveWriteText(at: Date): string {
  return `Yazı ${at.toISOString().slice(0, 10)} tarihinde yayınlandı ya da güncellendi; Search Console'un son ${STUCK_MEASUREMENT_WINDOW_DAYS} günlük verisi yeni metni henüz yansıtmıyor. Otopilot ölçüm penceresi dolmadan sayfayı yeniden düzenlemez; istersen "AI Düzelt" ile elle düzeltebilirsin.`;
}

/**
 * Sayfa hangi durumdan kurtarilabilir: otopilot yalniz "Tespit edildi"den;
 * kullanici "Basarisiz"dan da (panel canRecover). Kurtarma bu durumlardan
 * birinden RECOVERING'e ATOMIK gecisle baslar (stuck-page-recovery.service).
 */
export function recoverableStuckStatuses(triggeredBy: string): StuckPageStatus[] {
  return triggeredBy === 'autopilot' ? ['DETECTED'] : ['DETECTED', 'FAILED'];
}

// ─────────────────────────────────────────────────────────────────────────
//  SAHIPLENME KIRASI — RECOVERING satiri sahipsiz kalmasin
// ─────────────────────────────────────────────────────────────────────────

/**
 * Sahiplenmenin (RECOVERING) kirasi: bu sureden eski bir sahiplenme, sayfa icin
 * bekleyen ya da islenen bir kurtarma isi yoksa SAHIPSIZ sayilir ve geri alinir.
 *
 * NEDEN: kurtarma sayfayi yapay zekadan once ATOMIK sahipleniyor (cift isi
 * onlemek icin). Is sahiplenmeden sonra olurse (dagitimda pm2 restart:
 * SIGINT, varsayilan 1.6 sn sonra SIGKILL; bellek siniri) BullMQ isi kilit
 * suresi dolunca yeniden verir, ama yeni teslim sayfayi RECOVERING gorup
 * "zaten suruyor" diye atliyor ve satir sonsuza kadar "Çalışıyor" kaliyordu:
 * otopilot, toplu onarim ve panel hicbiri RECOVERING satira dokunmuyordu.
 * Kurallar (releaseAbandonedStuckClaim):
 *  - Ayni BullMQ isi yeniden teslim edildiyse (kiradaki jobId) hemen devralir:
 *    BullMQ isi ancak kilit suresi (worker lockDuration 5 dk) dolunca yeniden
 *    verir, yani onceki teslim artik calismiyor.
 *  - Kiradan eski sahiplenmeyi baska bir cagiran (tekil "AI Düzelt", toplu
 *    onarim, haftalik tarama, liste) devralir.
 *  - Her iki durumda sayfa icin canli bir STUCK_PAGE_RECOVER isi (ornegin
 *    kuyrukta bekleyen ikinci asama) olmamali; dogrulanamazsa dokunulmaz.
 * Sure, ilk asamanin en kotu suresinin rahatca ustunde: GEO taramasi + tek
 * Sonnet cagrisi; Anthropic istemcisi bir istegi varsayilan 10 dk bekler ve 2
 * kez yeniden dener (en kotu ~30 dk). Iki kaynak: kurulu @anthropic-ai/sdk
 * 0.71.2 client.js (DEFAULT_TIMEOUT "10 minutes", maxRetries ?? 2) ve ayni
 * paketin README'si ("By default requests time out after 10 minutes",
 * "automatically retried 2 times by default"). Kuyruk isinde kira yerine
 * BullMQ durumu belirleyicidir (canli is varken devralinmaz); sure asil
 * olarak isi olmayan senkron "AI Düzelt" sahiplenmeleri icindir.
 */
export const STUCK_CLAIM_LEASE_MS = 60 * 60_000;
/** Kira kaydinin kv_store'da kalma suresi (yalniz temizlik; gecerlilik STUCK_CLAIM_LEASE_MS) */
const STUCK_CLAIM_KV_TTL_MS = 30 * DAY_MS;
/**
 * BullMQ kimligi henuz DB'ye yazilmamis yeni is (kuyruga eklenirken) canli
 * sayilir. JobQueueService.enqueue DB satirini yazip hemen queue.add yapar;
 * kimlik milisaniyeler icinde yazilir. queue.add hata verirse satir FAILED olur
 * (kimliksiz). Eskiden 5 dk'lik pencere, hic kuyruga girmemis isi haftalik
 * taramada ve sahipsiz kira birakmada 5 dk "suruyor" saydiriyordu (inceleme
 * S24'un yan etkisi); toplu onarimdaki 30 sn'lik payla ayni deger kullanilir.
 */
const STUCK_JOB_INFLIGHT_MS = 30_000;
/** Daha eski is kayitlarina bakilmaz: JobQueueService biten isleri BullMQ'dan en gec 1 gunde siler */
const STUCK_JOB_LOOKBACK_MS = 7 * DAY_MS;
/** Tek sorguda en fazla bu kadar JSON yolu kosulu (generating-sweeper ile ayni) */
const STUCK_JOB_QUERY_CHUNK = 50;
/** Redis bu surede yanit vermezse durum "dogrulanamadi" sayilir (sahiplenmeye dokunulmaz) */
const STUCK_REDIS_TIMEOUT_MS = 5_000;
/**
 * BullMQ'da isin bitmedigini gosteren durumlar (kurulu bullmq 5.76.2
 * types/job-type.d.ts JobState + queue-getters getJobState: 'completed',
 * 'failed', 'delayed', 'active', 'waiting', 'waiting-children', 'prioritized',
 * yoksa 'unknown'). Yeniden deneme beklemesi 'delayed'dir: canli.
 */
const LIVE_BULL_STATES: ReadonlySet<string> = new Set(['active', 'waiting', 'delayed', 'prioritized', 'paused', 'waiting-children']);

/** Sahiplenme kirasinin kv_store anahtari */
export const stuckClaimKey = (stuckPageId: string) => `stuck-claim:${stuckPageId}`;

/** kv_store'daki kira: sahiplenme ani (StuckPage.updatedAt ile ayni), onceki durum ve BullMQ is kimligi */
export interface StuckClaimLease {
  at: string;
  prev: 'DETECTED' | 'FAILED';
  /** Onceki durumun updatedAt'i: FAILED'in otopilot bekleme suresi bu andan sayilir */
  prevUpdatedAt?: string;
  /** Sahiplenen BullMQ isi (senkron tekil "AI Düzelt"te yok) */
  jobId?: string;
}

/** Canli is denetiminin okudugu yuzey (PrismaService.job + JobQueueService.getJobState) */
export interface StuckJobLivenessDeps {
  prisma: { job?: { findMany(args: any): Promise<any[]> } };
  jobs?: { getJobState?(bullJobId: string): Promise<string> };
  now?: () => Date;
}

/** Sahiplenme / devralma / canli is denetiminin okudugu-yazdigi yuzey (PrismaService + JobQueueService uyar) */
export interface StuckClaimDeps {
  prisma: {
    stuckPage: { updateMany(args: any): Promise<{ count: number }> };
    kvStore?: { upsert(args: any): Promise<unknown>; findUnique(args: any): Promise<any> };
    job?: { findMany(args: any): Promise<any[]> };
    stuckPageRecovery?: { findFirst(args: any): Promise<any>; delete(args: any): Promise<unknown> };
    article?: { findUnique(args: any): Promise<any>; updateMany(args: any): Promise<{ count: number }> };
  };
  jobs?: { getJobState?(bullJobId: string): Promise<string> };
  now?: () => Date;
  log?: { warn(msg: string): void };
}

function parseStuckClaimLease(raw: unknown): StuckClaimLease | null {
  if (typeof raw !== 'string' || !raw) return null;
  let v: Record<string, unknown>;
  try {
    v = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return null;
  }
  if (!v || typeof v !== 'object' || typeof v.at !== 'string' || !Number.isFinite(Date.parse(v.at))) return null;
  if (v.prev !== 'DETECTED' && v.prev !== 'FAILED') return null;
  return {
    at: v.at,
    prev: v.prev,
    ...(typeof v.prevUpdatedAt === 'string' && Number.isFinite(Date.parse(v.prevUpdatedAt)) ? { prevUpdatedAt: v.prevUpdatedAt } : {}),
    ...(typeof v.jobId === 'string' && v.jobId ? { jobId: v.jobId } : {}),
  };
}

/** Sayfanin kirasi (yoksa ya da okunamazsa null) */
export async function readStuckClaimLease(deps: StuckClaimDeps, stuckPageId: string): Promise<StuckClaimLease | null> {
  if (!deps.prisma.kvStore) return null;
  const row = await deps.prisma.kvStore.findUnique({ where: { key: stuckClaimKey(stuckPageId) }, select: { value: true } }).catch(() => null);
  return parseStuckClaimLease(row?.value);
}

/**
 * Sayfayi ATOMIK sahiplenir: okunan durumdan (DETECTED / FAILED) RECOVERING'e,
 * yalniz satir hala o durumdaysa. updatedAt ACIKCA sahiplenme anidir (kiranin
 * yasi bundan olculur; Prisma @updatedAt'i elle verilebilir — prisma.io/docs
 * prisma-schema-reference "@updatedAt": "If you do not supply a time yourself,
 * Prisma Client will automatically set the value" ve kurulu motor write_args.rs
 * add_datetimes degeri yalniz verilmemisse ekler). Sonra kira kv_store'a
 * yazilir; yazilamazsa sahiplenme yine gecerli, devralma updatedAt'e gore olur.
 * Satir bu arada baska bir isle degistiyse null (hicbir sey yapilmaz).
 */
export async function claimStuckPage(
  deps: StuckClaimDeps,
  input: { stuckPageId: string; from: { status: unknown; updatedAt?: unknown }; jobId?: string },
): Promise<Date | null> {
  const now = deps.now?.() ?? new Date();
  const r = await deps.prisma.stuckPage.updateMany({
    where: { id: input.stuckPageId, status: input.from.status },
    data: { status: 'RECOVERING', updatedAt: now },
  });
  if (r.count !== 1) return null;
  if (deps.prisma.kvStore) {
    const key = stuckClaimKey(input.stuckPageId);
    const lease: StuckClaimLease = {
      at: now.toISOString(),
      prev: String(input.from.status) === 'FAILED' ? 'FAILED' : 'DETECTED',
      ...(input.from.updatedAt instanceof Date && Number.isFinite(input.from.updatedAt.getTime()) ? { prevUpdatedAt: input.from.updatedAt.toISOString() } : {}),
      ...(input.jobId ? { jobId: input.jobId } : {}),
    };
    const value = JSON.stringify(lease);
    const expiresAt = new Date(now.getTime() + STUCK_CLAIM_KV_TTL_MS);
    await deps.prisma.kvStore.upsert({ where: { key }, create: { key, value, expiresAt }, update: { value, expiresAt } })
      .catch((err: any) => deps.log?.warn(`[${input.stuckPageId}] Sahiplenme kirasi yazilamadi: ${err?.message ?? err}`));
  }
  return now;
}

/** Redis cagrisini sinirli sure bekler (maxRetriesPerRequest null iken baglanti yokken suresiz beklerdi) */
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`Redis ${ms} ms içinde yanıt vermedi`)), ms);
    (timer as { unref?: () => void }).unref?.();
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/**
 * Sayfalar icin BEKLEYEN ya da ISLENEN STUCK_PAGE_RECOVER isleri (ilk asama
 * ve ikinci asama — ikisinin verisinde de stuckPageId var): sayfa kimligi →
 * DB is kimligi (GET /jobs/:id). Dogrulanamazsa (Redis yanit vermedi, is
 * kuyrugu okunamiyor) null.
 *
 * Is kayitlari DB'den okunur (MySQL JSON yolu `$.stuckPageId`; iki kaynak:
 * prisma.io/docs working-with-json-fields "Filter on object property" —
 * MySQL'de path '$.petName' bicimi — ve kurulu @prisma/client 6.19.3 uretilmis
 * JsonFilterBase.path?: string; ayni kalip articles/generating-sweeper.ts).
 * DB durumu tek basina yetmez (FAILED yeniden deneme beklemesi olabilir,
 * PROCESSING kayit olen surecten kalmis olabilir): karari BullMQ durumu verir.
 */
export async function liveStuckRecoverJobs(
  deps: StuckJobLivenessDeps,
  stuckPageIds: readonly string[],
  opts: { excludeBullJobId?: string } = {},
): Promise<Map<string, string> | null> {
  const out = new Map<string, string>();
  const ids = [...new Set(stuckPageIds.filter((id) => typeof id === 'string' && id !== ''))];
  if (ids.length === 0) return out;
  if (!deps.prisma.job) return null;
  const now = deps.now?.() ?? new Date();
  const since = new Date(now.getTime() - STUCK_JOB_LOOKBACK_MS);
  for (let i = 0; i < ids.length; i += STUCK_JOB_QUERY_CHUNK) {
    const chunk = ids.slice(i, i + STUCK_JOB_QUERY_CHUNK);
    let rows: any[];
    try {
      rows = await deps.prisma.job.findMany({
        where: {
          type: 'STUCK_PAGE_RECOVER',
          status: { in: ['QUEUED', 'PROCESSING', 'FAILED'] },
          queuedAt: { gte: since },
          OR: chunk.map((id) => ({ payload: { path: '$.stuckPageId', equals: id } })),
        },
        select: { id: true, bullJobId: true, queuedAt: true, payload: true, status: true },
        orderBy: { queuedAt: 'desc' },
      });
    } catch {
      return null;
    }
    for (const row of Array.isArray(rows) ? rows : []) {
      const pageId = (row?.payload as { stuckPageId?: unknown } | null | undefined)?.stuckPageId;
      if (typeof pageId !== 'string' || !chunk.includes(pageId) || out.has(pageId)) continue;
      const bullJobId = typeof row.bullJobId === 'string' && row.bullJobId ? row.bullJobId : null;
      if (bullJobId && opts.excludeBullJobId && bullJobId === opts.excludeBullJobId) continue;
      let live: boolean;
      if (!bullJobId) {
        // Kimliksiz FAILED satir: queue.add hata verdi, is hic kuyruga girmedi.
        // (Kimlikli FAILED satir BullMQ'da yeniden deneme bekliyor olabilir; asagida.)
        const queuedAt = row.queuedAt instanceof Date ? row.queuedAt.getTime() : Number.NaN;
        live = row.status !== 'FAILED' && Number.isFinite(queuedAt) && now.getTime() - queuedAt < STUCK_JOB_INFLIGHT_MS;
      } else {
        if (!deps.jobs?.getJobState) return null;
        let state: string;
        try {
          state = await withTimeout(Promise.resolve(deps.jobs.getJobState(bullJobId)), STUCK_REDIS_TIMEOUT_MS);
        } catch {
          return null;
        }
        live = LIVE_BULL_STATES.has(String(state));
      }
      if (live) out.set(pageId, String(row.id));
    }
  }
  return out;
}

/**
 * Sahipsiz kalmis sahiplenmeyi (RECOVERING) birakir: sayfa sahiplenmeden
 * onceki durumuna (kiradaki prev; kira yoksa DETECTED) doner. Donen: yeni durum;
 * birakilmadiysa null (kira gecerli, canli is var ya da dogrulanamadi, satir
 * bu arada degisti).
 *
 * Yarim kalmis ilk asama: sahiplenmeden sonra acilmis bir kurtarma kaydi varsa
 * (govde yazildi, ikinci asama yayinlamadan is oldu) duzenleme metinden geri
 * alinir ve kayit silinir — canliya gitmeyen yapay zeka metni yazida kalmasin.
 * Duzenleme bir kopyaya ulastiysa (kaydin izi duzenlenmis metnin izi) metin ve
 * kayit kalir, sayfa FAILED olur (ikinci asamanin "kismen yayinlandi" kurali).
 *
 * Satir yazimi KOSULLU: okunan updatedAt ile (iki birakici yarisirsa biri gecer).
 * opts.jobId: cagiran BullMQ isi; kiradaki jobId ile ayniysa (yeniden teslim)
 * kira suresi beklenmez, isin kendi kaydi canli is sayilmaz.
 */
export async function releaseAbandonedStuckClaim(
  deps: StuckClaimDeps,
  row: { id: string; status: unknown; updatedAt?: unknown; articleId?: string | null },
  opts: { jobId?: string } = {},
): Promise<StuckPageStatus | null> {
  if (String(row.status) !== 'RECOVERING') return null;
  const updatedAt = row.updatedAt instanceof Date && Number.isFinite(row.updatedAt.getTime()) ? row.updatedAt : null;
  if (!updatedAt) return null;
  const now = deps.now?.() ?? new Date();
  const stored = await readStuckClaimLease(deps, row.id);
  // Kira bu sahiplenmenin mi? Sahiplenme updatedAt'i kiradaki anla AYNI yazar;
  // farkliysa kira onceki bir sahiplenmeden kalmistir (yok sayilir)
  const lease = stored && Date.parse(stored.at) === updatedAt.getTime() ? stored : null;
  const resume = !!opts.jobId && lease?.jobId === opts.jobId;
  if (!resume && now.getTime() - updatedAt.getTime() < STUCK_CLAIM_LEASE_MS) return null;
  const live = await liveStuckRecoverJobs(deps, [row.id], { excludeBullJobId: opts.jobId });
  if (!live || live.size > 0) return null;

  let status: 'DETECTED' | 'FAILED' = lease?.prev ?? 'DETECTED';
  let statusAt = lease?.prevUpdatedAt ? new Date(lease.prevUpdatedAt) : now;
  if (row.articleId && deps.prisma.stuckPageRecovery && deps.prisma.article) {
    const half = await deps.prisma.stuckPageRecovery.findFirst({
      where: { stuckPageId: row.id, appliedAt: { gte: updatedAt } },
      orderBy: { appliedAt: 'desc' },
      select: { id: true, bodyMdBefore: true, bodyMdAfter: true },
    });
    if (half) {
      const article = await deps.prisma.article.findUnique({ where: { id: row.articleId }, select: STUCK_ARTICLE_SELECT });
      const afterHash = articleContentHash({ ...(article ?? {}), bodyMd: half.bodyMdAfter ?? '' });
      const editLive = !!article && liveEntries(article.publishedTo).some((e) => e.contentHash === afterHash);
      if (editLive) {
        status = 'FAILED';
        statusAt = now;
      } else {
        // restoreBody ile ayni kosul: yazi hala bizim duzenledigimiz metinse
        await deps.prisma.article.updateMany({
          where: { id: row.articleId, bodyMd: half.bodyMdAfter ?? '' },
          data: { bodyMd: half.bodyMdBefore ?? '', qaStatus: null, qaReport: Prisma.DbNull },
        });
        await deps.prisma.stuckPageRecovery.delete({ where: { id: half.id } }).catch(() => undefined);
      }
    }
  }
  const r = await deps.prisma.stuckPage.updateMany({
    where: { id: row.id, status: 'RECOVERING', updatedAt },
    data: { status, updatedAt: statusAt },
  });
  if (r.count !== 1) return null;
  deps.log?.warn(`[${row.id}] Sahipsiz kalan duzeltme birakildi (${resume ? 'ayni is yeniden teslim edildi' : 'kira suresi doldu'}): RECOVERING → ${status}`);
  return status;
}

/**
 * STUCK_PAGE_RECOVER isinin ikinci asamasi: duzenlenen (ya da geri alinan)
 * makalenin YERINDE yeniden yayini. LLM cagrisi yok; is worker'da
 * stuck-page-recovery.service republish()'e gider. Sayfa ancak yayin
 * basarilinca RECOVERED olur (eskiden yayin kuyruga atilir atilmaz).
 */
export const STUCK_REPUBLISH_PHASE = 'republish' as const;

export interface StuckRepublishPayload {
  phase: typeof STUCK_REPUBLISH_PHASE;
  stuckPageId: string;
  recoveryId: string;
  articleId: string;
  /** recover: duzenleme yayini; revert: geri alinan eski metnin yayini */
  mode: 'recover' | 'revert';
  /**
   * recover: duzenleme yazildiktan sonraki kaydin icerik izi (republish-policy
   * articleContentHash). Ikinci asama yayindan once kaydi bununla karsilastirir:
   * arada baslik / meta / govde degistiyse (onay bekleyen yeniden yazim) o
   * metin duzeltme diye yayinlanmaz. Eski islerde yok (yalniz govde denetlenir).
   */
  expectedContentHash?: string;
}

/** Worker yonlendirmesi: ikinci asama isi mi? (alanlari servis dogrular) */
export function isStuckRepublishJob(data: unknown): boolean {
  return !!data && typeof data === 'object' && (data as Record<string, unknown>).phase === STUCK_REPUBLISH_PHASE;
}

export function isStuckRepublishPayload(data: unknown): data is StuckRepublishPayload {
  if (!isStuckRepublishJob(data)) return false;
  const d = data as Record<string, unknown>;
  const id = (v: unknown) => typeof v === 'string' && v.length > 0;
  return id(d.stuckPageId) && id(d.recoveryId) && id(d.articleId) && (d.mode === 'recover' || d.mode === 'revert');
}

/** Haftalik taramanin site suzgeci: aktif + plani Takili Sayfalar'i kapsayan */
export function stuckPageSweepSiteWhere() {
  return {
    status: { in: ['ACTIVE', 'AUDIT_COMPLETE'] as Array<'ACTIVE' | 'AUDIT_COMPLETE'> },
    ...siteWhereForFeature('stuckPages'),
  };
}

export type AutoRecoveryBlock = 'plan' | 'paused' | 'manual_approve';

export interface AutoRecoverySite {
  autopilot?: boolean | null;
  publishApprovalMode?: string | null;
  user?: { plan?: string | null } | null;
}

/**
 * Otopilot bu sitede sayfayi yeniden yazip YAYINLAYABILIR mi? Engel yoksa null.
 * Plan kontrolu @RequiresPlan'in kullandigi planHasFeature ile ayni kural;
 * plani bilinmeyen kullanici kapali sayilir.
 */
export function autoRecoveryBlock(site: AutoRecoverySite): AutoRecoveryBlock | null {
  const plan = String(site.user?.plan ?? '').toLowerCase() as PlanId;
  if (!planHasFeature(plan, 'stuckPages')) return 'plan';
  if (site.autopilot !== true) return 'paused';
  if (!autoPublishEnabled(site)) return 'manual_approve';
  return null;
}

/**
 * Kullanicinin plani Takili Sayfalar'i kapsiyor mu? Plani bilinmiyorsa (kayit
 * okunmadi) null: karar uctaki @RequiresPlan kapisina kalir. Kural
 * autoRecoveryBlock ile ayni (planHasFeature).
 */
export function stuckPlanAllows(plan: unknown): boolean | null {
  if (typeof plan !== 'string' || !plan) return null;
  return planHasFeature(plan.toLowerCase() as PlanId, 'stuckPages');
}

/** Toplu onarim: plan ozelligi kapsamiyor (kuyruga alinmadi) */
export function stuckPlanRequiredText(): string {
  const planName = findPlan(FEATURE_MIN_PLAN.stuckPages)?.name_tr ?? FEATURE_MIN_PLAN.stuckPages;
  return `${PLAN_FEATURE_LABELS.stuckPages} ${planName} planına dahildir; düzeltme kuyruğa alınmadı.`;
}

/** Is sonucunda gorunen neden (Turkce, kullaniciya da gosterilebilir) */
export function autoRecoveryBlockText(block: AutoRecoveryBlock): string {
  switch (block) {
    case 'plan': {
      const planName = findPlan(FEATURE_MIN_PLAN.stuckPages)?.name_tr ?? FEATURE_MIN_PLAN.stuckPages;
      return `${PLAN_FEATURE_LABELS.stuckPages} ${planName} planına dahildir; sayfa otomatik düzeltilmedi.`;
    }
    case 'paused':
      return 'Otomatik akış durdurulmuş; sayfa otomatik düzeltilmedi.';
    case 'manual_approve':
      return 'Site Yarı otomatik modda: yazılar onaysız yeniden yayınlanmaz. Sayfayı Takılı Sayfalar ekranındaki "AI Düzelt" ile düzeltebilirsin.';
  }
}

type Log = { log(msg: string): void; warn(msg: string): void };

/**
 * Kapali takili sayfa durumlari: tamamlanmis duzeltme (RECOVERED), musterinin
 * geri almasi (REVERTED) ya da yok saymasi (IGNORED). Dedektor
 * (stuck-page-detector.service detect, closedExisting) ayni adreste bu
 * durumlardan biri varsa yeni satir acmaz, acik satiri da guncellemez;
 * haftalik tarama ayni listeyi kullanir (esitligi stuck-page-autopilot.spec
 * gercek dedektorun sorgusuyla denetler).
 */
export const CLOSED_STUCK_STATUSES = ['RECOVERED', 'REVERTED', 'IGNORED'] as const;

export interface StuckSweepDeps {
  prisma: {
    site: { findMany(args: any): Promise<any[]> };
    /** updateMany varsa (PrismaService) tarama sahipsiz sahiplenmeleri de birakir */
    stuckPage: { findMany(args: any): Promise<any[]>; findFirst(args: any): Promise<any | null>; updateMany?(args: any): Promise<{ count: number }> };
    publishTarget: { findMany(args: any): Promise<any[]> };
    kvStore?: StuckClaimDeps['prisma']['kvStore'];
    job?: StuckClaimDeps['prisma']['job'];
    stuckPageRecovery?: StuckClaimDeps['prisma']['stuckPageRecovery'];
    article?: StuckClaimDeps['prisma']['article'];
  };
  detector: { detect(siteId: string): Promise<{ found: number }> };
  /** getJobState (JobQueueService): sayfanin bekleyen isi var mi — ikinci is kuyruga alinmaz */
  jobs: { enqueue(opts: any): Promise<unknown>; getJobState?(bullJobId: string): Promise<string> };
  log?: Log;
  /** Saat (testler icin); verilmezse simdi */
  now?: () => Date;
}

/** Tek turda site basina en fazla bu kadar sahipsiz sahiplenme birakilir (en eskiler once) */
export const STUCK_STALE_CLAIM_BATCH = 50;

/**
 * Sitenin kira suresi dolmus RECOVERING satirlarini birakir
 * (releaseAbandonedStuckClaim — canli isi olan ya da dogrulanamayan satira
 * dokunulmaz). Donen: birakilan satir sayisi. Haftalik tarama ve takili sayfa
 * listesi (audit.controller) cagirir.
 */
export async function releaseStaleStuckClaims(
  deps: StuckClaimDeps & { prisma: { stuckPage: { findMany(args: any): Promise<any[]> } } },
  siteId: string,
): Promise<number> {
  const now = deps.now?.() ?? new Date();
  const rows = await deps.prisma.stuckPage.findMany({
    where: { siteId, status: 'RECOVERING', updatedAt: { lt: new Date(now.getTime() - STUCK_CLAIM_LEASE_MS) } },
    select: { id: true, status: true, updatedAt: true, articleId: true },
    orderBy: { updatedAt: 'asc' },
    take: STUCK_STALE_CLAIM_BATCH,
  });
  let released = 0;
  for (const row of Array.isArray(rows) ? rows : []) {
    if (await releaseAbandonedStuckClaim(deps, row)) released++;
  }
  return released;
}

/** Taramanin bagimliliklarindan sahiplenme yuzeyi (stuckPage.updateMany yoksa birakma yapilmaz) */
function sweepClaimDeps(deps: StuckSweepDeps): (StuckClaimDeps & { prisma: { stuckPage: { findMany(args: any): Promise<any[]> } } }) | null {
  if (typeof deps.prisma.stuckPage.updateMany !== 'function') return null;
  return { prisma: deps.prisma as StuckClaimDeps['prisma'] & { stuckPage: { findMany(args: any): Promise<any[]> } }, jobs: deps.jobs, now: deps.now, log: deps.log };
}

export interface StuckSweepSummary {
  totalSites: number;
  totalDetected: number;
  autoRecoveryQueued: number;
  /** Bulgu var ama Yari otomatik — sayfalar "Tespit edildi"de kullanicinin onayini bekler */
  awaitingApprovalSites: number;
  /**
   * Otomatik kurtarilmayan sayfalar: yazinin yayin hedefi yaziyi yerinde
   * guncelleyemiyor (planArticleRepublish). "Tespit edildi"de kalir;
   * kullanici "AI Duzelt" ile oneri alabilir.
   */
  notUpdatablePages: number;
  /**
   * Otomatik kurtarilmayan "Tespit edildi" satirlari: ayni adreste kapali
   * kayit var (CLOSED_STUCK_STATUSES). Dedektor duzeltmesinden once, musterinin
   * geri aldigi adrese acilmis eski cift satirlardir; otopilot onlari yazmaz.
   */
  closedDuplicatePages: number;
  /**
   * Ek alan: yazinin kayittaki metni canlida degil (onay bekleyen yeniden
   * yazim, editorun reddettigi taslak, yeniden uretim) — stuckArticleLiveBlock.
   */
  pendingRewritePages: number;
  /** Ek alan: yazi olcum penceresinde (STUCK_MEASUREMENT_WINDOW_DAYS) yayinlandi / guncellendi */
  recentlyPublishedPages: number;
  /** Ek alan: ayni adresin son STUCK_FAILED_COOLDOWN_DAYS icinde basarisiz bir denemesi var */
  recentFailurePages: number;
  /** Ek alan: sayfa icin bekleyen / islenen bir kurtarma isi zaten var (ikinci is kuyruga alinmadi) */
  alreadyQueuedPages: number;
  /** Ek alan: kira suresi dolmus, isi olmayan RECOVERING satiri onceki durumuna birakildi */
  staleClaimsReleased: number;
}

/**
 * Ayni adreste kapali takili sayfa kaydi var mi? "Ayni sayfa" dedektordeki
 * tanimla ayni: siteId + url esitligi, karsilastirmayi DB yapar (kolon
 * harmanlamasi). Dedektor kod tarafinda adresi normallestirmez (matchArticle
 * icindeki norm yalniz makale eslemesi icin); burada da yapilmaz, yoksa
 * tarama dedektorun ayri saydigi iki adresi tek sayfa sanabilirdi.
 * url yoksa (Prisma'da `url: undefined` suzgeci kaldirir ve sitenin HERHANGI
 * bir kapali kaydi eslesirdi) sorgu atilmaz. Kaynak: prisma.io/docs "Null and
 * undefined" ("undefined means do nothing"; sorgu o kolona hic kosul
 * verilmemis gibi calisir) ve zenn.dev/chot prisma-dangerous-find-first
 * (findFirst'te undefined alanla uretilen SQL'de WHERE kosulu yok).
 */
async function hasClosedStuckRecord(deps: StuckSweepDeps, siteId: string, url: unknown): Promise<boolean> {
  if (typeof url !== 'string' || url.length === 0) return false;
  const closed = await deps.prisma.stuckPage.findFirst({
    where: { siteId, url, status: { in: [...CLOSED_STUCK_STATUSES] } },
    select: { id: true },
  });
  return !!closed;
}

/**
 * Ayni adreste son STUCK_FAILED_COOLDOWN_DAYS icinde basarisiz bir deneme var
 * mi? "Ayni sayfa" hasClosedStuckRecord'daki tanimla ayni (siteId + url).
 * Basarisizlik ani satirin updatedAt'i: kurtarma servisi FAILED'a gecerken
 * updatedAt'i ACIKCA yazar (stuck-page-recovery.service markFailed) — Prisma
 * belgesi @updatedAt'in updateMany'de de kendiliginden yazildigini soylemiyor.
 */
async function hasRecentFailure(deps: StuckSweepDeps, siteId: string, url: unknown, since: Date): Promise<boolean> {
  if (typeof url !== 'string' || url.length === 0) return false;
  const failed = await deps.prisma.stuckPage.findFirst({
    where: { siteId, url, status: 'FAILED', updatedAt: { gte: since } },
    select: { id: true },
  });
  return !!failed;
}

/**
 * Haftalik tarama: plani Takili Sayfalar'i kapsayan aktif sitelerde tespit;
 * yalniz otopilot acik + Tam otomatik sitelerde, yalniz yayin hedefi yaziyi
 * YERINDE guncelleyebilen RanksUp makalelerinin otomatik kurtarmasi kuyruga
 * girer. RanksUp disi sayfalar (articleId yok) otopilotta hic yazilmaz —
 * onlari yalniz kullanici baslatir. Su "Tespit edildi" satirlari da otomatik
 * kurtarilmaz (her biri ozette ayri sayilir):
 *  - ayni adreste kapali kaydi olan (geri alinmis / yok sayilmis / duzeltilmis);
 *  - yazinin kayittaki metni canlida olmayan (onay bekleyen yeniden yazim);
 *  - yazisi olcum penceresinde yayinlanmis / guncellenmis;
 *  - yeni metni takili adrese yerinde yazilamayan (planStuckRepublish);
 *  - ayni adresi yakin zamanda basarisiz olmus;
 *  - icin bekleyen / islenen bir kurtarma isi zaten olan.
 * Adaylar STUCK_AUTO_RECOVER_SCAN'lik sayfalarla (stuckScore azalan, esitlikte
 * id) okunur; STUCK_AUTO_RECOVER_PER_SITE uygun sayfa bulununca, satirlar
 * bitince ya da STUCK_AUTO_RECOVER_SCAN_BUDGET satir okununca durur.
 * Tespitten once kira suresi dolmus RECOVERING satirlari birakilir
 * (releaseStaleStuckClaims).
 * Is kosarken servis ayni kurallari yeniden denetler (stuck-page-recovery.service recover).
 */
export async function runStuckPageSweep(deps: StuckSweepDeps): Promise<StuckSweepSummary> {
  const now = deps.now?.() ?? new Date();
  const failedSince = new Date(now.getTime() - STUCK_FAILED_COOLDOWN_DAYS * DAY_MS);
  const claimDeps = sweepClaimDeps(deps);
  const sites = await deps.prisma.site.findMany({
    where: stuckPageSweepSiteWhere(),
    select: { id: true, userId: true, autopilot: true, publishApprovalMode: true, user: { select: { plan: true } } },
  });
  const summary: StuckSweepSummary = {
    totalSites: sites.length, totalDetected: 0, autoRecoveryQueued: 0, awaitingApprovalSites: 0, notUpdatablePages: 0,
    closedDuplicatePages: 0, pendingRewritePages: 0, recentlyPublishedPages: 0, recentFailurePages: 0,
    alreadyQueuedPages: 0, staleClaimsReleased: 0,
  };
  for (const site of sites) {
    if (claimDeps) {
      // Tespitten ONCE: birakilan satiri dedektor tazeler, otopilot ayni turda aday gorebilir
      summary.staleClaimsReleased += await releaseStaleStuckClaims(claimDeps, site.id).catch((err: any) => {
        deps.log?.warn(`[${site.id}] sahipsiz sahiplenmeler birakilamadi: ${err?.message ?? err}`);
        return 0;
      });
    }
    try {
      const result = await deps.detector.detect(site.id);
      summary.totalDetected += result.found;
      if (result.found <= 0) continue;
      const block = autoRecoveryBlock(site);
      if (block) {
        if (block === 'manual_approve') summary.awaitingApprovalSites++;
        continue;
      }
      // Yazisi yalniz yeni kayit acan hedefte (Ghost vb.) yayinda olan sayfa
      // otomatik kurtarilmaz: yeniden yayin ikinci bir kopya acardi. Is kosarken
      // servis ayni kurali yeniden denetler (stuck-page-recovery.service recover).
      const targets = await deps.prisma.publishTarget.findMany({
        where: { siteId: site.id },
        select: { id: true, type: true, isActive: true },
      });
      const isEligible = async (sp: { id: string; url?: unknown; article?: unknown }): Promise<boolean> => {
        // Aday DETECTED satirlarindan secilir; dedektor REVERTED'i kapali
        // saymadan once musterinin geri aldigi adrese yeni DETECTED satiri
        // aciliyordu. O eski cift satirlar hala duruyor: kapali kaydi olan
        // adres musterinin karari (ya da zaten duzeltilmis) — otopilot ayni
        // AI duzenlemesini yeniden uygulamasin.
        if (await hasClosedStuckRecord(deps, site.id, sp.url)) {
          summary.closedDuplicatePages++;
          return false;
        }
        const article = sp.article as StuckArticleRow | null | undefined;
        if (!article) {
          summary.notUpdatablePages++;
          return false;
        }
        // Onay bekleyen yeniden yazim kaydi ezdiyse duzenleme onu onaysiz yayinlardi
        if (stuckArticleLiveBlock(article)) {
          summary.pendingRewritePages++;
          return false;
        }
        if (recentStuckLiveWrite(article, now)) {
          summary.recentlyPublishedPages++;
          return false;
        }
        if (planStuckRepublish({ publishedTo: article.publishedTo, targets, slug: article.slug, url: sp.url }).kind !== 'republish') {
          summary.notUpdatablePages++;
          return false;
        }
        if (await hasRecentFailure(deps, site.id, sp.url, failedSince)) {
          summary.recentFailurePages++;
          return false;
        }
        // Sayfa basina tek bekleyen is (toplu onarimin kuyruga aldigi is bekliyorsa
        // ikinci GEO + Sonnet turu acilmaz). Dogrulanamazsa engel sayilmaz: is
        // kosarken sahiplenme ve istek zamani denetimi ikinci turu yine durdurur.
        const live = await liveStuckRecoverJobs(deps, [sp.id]);
        if (live && live.size > 0) {
          summary.alreadyQueuedPages++;
          return false;
        }
        return true;
      };
      // Uygun olmayan yuksek puanli satirlar pencereyi doldurmasin: sayfa sayfa oku
      const eligible: Array<{ id: string }> = [];
      const seen = new Set<string>();
      let cursor: { score: number; id: string } | null = null;
      let scanned = 0;
      scan: while (eligible.length < STUCK_AUTO_RECOVER_PER_SITE && scanned < STUCK_AUTO_RECOVER_SCAN_BUDGET) {
        const page: any[] = await deps.prisma.stuckPage.findMany({
          where: {
            siteId: site.id,
            status: 'DETECTED',
            articleId: { not: null },
            ...(cursor ? { OR: [{ stuckScore: { lt: cursor.score } }, { stuckScore: cursor.score, id: { gt: cursor.id } }] } : {}),
          },
          orderBy: [{ stuckScore: 'desc' }, { id: 'asc' }],
          take: STUCK_AUTO_RECOVER_SCAN,
          // Yazinin durumu ve metni: kayittaki metin canlida mi (stuckArticleLiveBlock),
          // son yazim (olcum penceresi), yayin kayitlari + slug (planStuckRepublish);
          // stuckScore sonraki sayfanin imleci
          select: { id: true, url: true, stuckScore: true, article: { select: STUCK_ARTICLE_SELECT } },
        });
        const rows = Array.isArray(page) ? page : [];
        let fresh = 0;
        for (const sp of rows) {
          if (!sp || typeof sp.id !== 'string' || seen.has(sp.id)) continue;
          seen.add(sp.id);
          fresh++;
          scanned++;
          if (await isEligible(sp)) {
            eligible.push(sp);
            if (eligible.length >= STUCK_AUTO_RECOVER_PER_SITE) break scan;
          }
          if (scanned >= STUCK_AUTO_RECOVER_SCAN_BUDGET) break scan;
        }
        // Son sayfa ya da yeni satir gelmedi (imlec ilerlemiyor): dur
        const last = rows[rows.length - 1];
        if (rows.length < STUCK_AUTO_RECOVER_SCAN || fresh === 0 || typeof last?.stuckScore !== 'number') break;
        cursor = { score: last.stuckScore, id: last.id };
      }
      for (const sp of eligible) {
        const queued = await deps.jobs.enqueue({
          type: 'STUCK_PAGE_RECOVER',
          userId: site.userId,
          siteId: site.id,
          // requestedAt: is kosmadan once sayfa baska bir yoldan islendiyse
          // (kullanici "AI Düzelt"e basti) ikinci tur yapay zeka cagirmadan atlar
          payload: { stuckPageId: sp.id, triggeredBy: 'autopilot', requestedAt: now.toISOString() },
          priority: STUCK_RECOVER_JOB_PRIORITY,
        }).then(() => true, (err: any) => {
          deps.log?.warn(`[${site.id}] stuck recovery kuyruga alinamadi (${sp.id}): ${err?.message ?? err}`);
          return false;
        });
        if (queued) summary.autoRecoveryQueued++;
      }
    } catch (err: any) {
      deps.log?.warn(`[${site.id}] stuck detect hata: ${err?.message ?? err}`);
    }
  }
  return summary;
}

export type StuckRecoveryRoute = 'article' | 'external' | 'missing';

/**
 * STUCK_PAGE_RECOVER yonlendirmesi: sayfanin RanksUp makalesi var mi?
 * Dogrudan kimlikle okunur — getDetail(siteId, id) imzasi siteId ister ve
 * worker'da tek argumanla cagrildigi icin her zaman null donuyordu.
 */
export async function stuckRecoveryRoute(
  prisma: { stuckPage: { findUnique(args: any): Promise<{ articleId: string | null } | null> } },
  stuckPageId: unknown,
): Promise<StuckRecoveryRoute> {
  if (typeof stuckPageId !== 'string' || !stuckPageId) return 'missing';
  const sp = await prisma.stuckPage.findUnique({ where: { id: stuckPageId }, select: { articleId: true } });
  if (!sp) return 'missing';
  return sp.articleId ? 'article' : 'external';
}

/**
 * Kuyruktaki is calismadan once sayfa baska bir yoldan islendi mi? (istek
 * zamanindan sonra: sayfa FAILED oldu — markFailed updatedAt'i acikca yazar —
 * ya da bir kurtarma kaydi acildi: oneri, duzeltme). Evet ise is ayni GEO
 * taramasini ve Sonnet cagrisini ikinci kez yapmadan atlar.
 * NEDEN: atomik sahiplenme yalniz AYNI ANDA kosan isleri durdurur. Panel
 * yenilenince sirada bekleyen sayfa yeniden secilebiliyor (ya da tekil "AI
 * Düzelt"e basiliyor); ilk tur oneriyle DETECTED'a ya da FAILED'a donunce
 * bekleyen ikinci is ayni yapay zeka turunu yeniden kosuyor, ikinci bir oneri
 * kaydi aciyordu.
 */
export async function stuckProcessedSince(
  prisma: { stuckPageRecovery?: { findFirst(args: any): Promise<any> } },
  stuckPage: { id: string; status: unknown; updatedAt?: unknown },
  since: Date,
): Promise<boolean> {
  if (String(stuckPage.status) === 'FAILED' && stuckPage.updatedAt instanceof Date && stuckPage.updatedAt.getTime() >= since.getTime()) return true;
  if (!prisma.stuckPageRecovery) return false;
  const rec = await prisma.stuckPageRecovery.findFirst({ where: { stuckPageId: stuckPage.id, appliedAt: { gte: since } }, select: { id: true } });
  return !!rec;
}

/** Is verisindeki istek zamani (ISO); gecersizse null */
export function stuckRequestedAt(value: unknown): Date | null {
  return asDate(value);
}

/** Worker STUCK_PAGE_RECOVER'in servise varmadan atladigi durumlarin kodu */
export type StuckRecoverSkipCode = 'AI_GLOBAL_DISABLED' | 'STUCK_PAGE_NOT_FOUND' | 'EXTERNAL_PAGE_MANUAL_ONLY';

/**
 * Worker'in atlama sonucu (is kaydina Job.result olarak yazilir): makine kodu +
 * Turkce neden. NEDEN: panel kuyruga alinan sayfanin sonucunu GET /jobs/:id
 * ile okur ve nedeni AYNEN gosterir (paylasilan sozlesme D4); eskiden neden
 * alaninda yalniz 'AI_GLOBAL_DISABLED' gibi bir kod vardi.
 */
export function stuckRecoverSkip(code: StuckRecoverSkipCode): { skipped: true; code: StuckRecoverSkipCode; reason: string } {
  const reason = code === 'AI_GLOBAL_DISABLED' ? STUCK_AI_DISABLED : code === 'STUCK_PAGE_NOT_FOUND' ? STUCK_PAGE_NOT_FOUND : STUCK_EXTERNAL_AUTOPILOT_SKIP;
  return { skipped: true, code, reason };
}
