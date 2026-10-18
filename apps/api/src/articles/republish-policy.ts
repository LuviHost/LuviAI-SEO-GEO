import { createHash } from 'node:crypto';
import { sanitizeErrorText, wordPressDateLabel, wordPressEntryAddressable } from '@luviai/adapters';

/**
 * YAYINDAKI YAZININ YENIDEN YAYINI — hedef tipine gore ne yapilir.
 *
 * NEDEN: PublisherService her yayinda her hedefte adapter.publish() cagiriyordu.
 * CMS adaptorleri her cagride YENI kayit acar (WordPress REST POST
 * /wp/v2/posts, XML-RPC metaWeblog.newPost, Ghost / Strapi / Webflow POST,
 * Sanity create, Contentful createEntry, WHMCS AddKBArticle). Yayindaki yaziyi
 * yeniden yayinlayan akislar (icerik pivotu, kapali dongu 'update', panelden
 * yeniden yayin, takili sayfa) WordPress'te /yazi-2/ adresinde ikinci bir kopya
 * aciyor, eski adres eski metinle kaliyor, yinelenen icerik musterinin SEO'suna
 * zarar veriyor ve panel yine "yayınlandı" diyordu.
 *
 * Kural tek yerde: PublisherService (her yayin) ve takili sayfa plani
 * (stuck-page-autopilot.ts planArticleRepublish) bu dosyayi kullanir.
 *
 *  - update: adaptor mevcut kaydi yerinde gunceller (WordPress REST / XML-RPC
 *    update(); adres, durum, yazar, tarih, kategori degismez)
 *  - overwrite: ayni yol/anahtar, yayin mevcut sayfanin UZERINE yazar —
 *    FTP / SFTP / cPanel `${remotePath}/${slug}.html` (basic-ftp uploadFrom,
 *    ssh2-sftp-client put, cPanel Fileman::upload_files overwrite=1), GitHub
 *    ayni dosya yoluna mevcut sha ile guncelleme commit'i, KobiPratik
 *    page-meta/upsert (yol anahtarli)
 *  - export: canli siteye dokunmaz, her seferinde yeni disa aktarim dosyasi
 *    uretir (Markdown ZIP) — yeniden uretmek kopya acmaz
 *  - create_only: her yayinda yeni kayit acar ya da ne yaptigi bilinmez
 *    (Ghost, Strapi, Webflow, Sanity, Contentful, WHMCS, ozel PHP uc noktasi,
 *    Shopify, Wix) — yayindaki yazi oraya yeniden YAYINLANMAZ
 */

export const UPDATE_TARGET_TYPES: ReadonlySet<string> = new Set(['WORDPRESS_REST', 'WORDPRESS_XMLRPC']);
export const OVERWRITE_TARGET_TYPES: ReadonlySet<string> = new Set(['FTP', 'SFTP', 'CPANEL_API', 'GITHUB', 'KOBIPRATIK']);
export const EXPORT_TARGET_TYPES: ReadonlySet<string> = new Set(['MARKDOWN_ZIP']);

export type RepublishMode = 'update' | 'overwrite' | 'export' | 'create_only';

export function republishModeForType(type: unknown): RepublishMode {
  const t = String(type ?? '');
  if (UPDATE_TARGET_TYPES.has(t)) return 'update';
  if (OVERWRITE_TARGET_TYPES.has(t)) return 'overwrite';
  if (EXPORT_TARGET_TYPES.has(t)) return 'export';
  return 'create_only';
}

const TARGET_LABELS: Record<string, string> = {
  WORDPRESS_REST: 'WordPress',
  WORDPRESS_XMLRPC: 'WordPress',
  GHOST: 'Ghost',
  STRAPI: 'Strapi',
  WEBFLOW: 'Webflow',
  SHOPIFY: 'Shopify',
  SANITY: 'Sanity',
  CONTENTFUL: 'Contentful',
  WHMCS_KB: 'WHMCS',
  CUSTOM_PHP: 'özel PHP uç noktası',
  MARKDOWN_ZIP: 'Markdown ZIP',
  WIX: 'Wix',
  FTP: 'FTP',
  SFTP: 'SFTP',
  CPANEL_API: 'cPanel',
  GITHUB: 'GitHub',
  KOBIPRATIK: 'KobiPratik',
};

/** Kullaniciya gosterilen hedef adi (Turkce metinlerde) */
export function targetLabel(type: unknown): string {
  return TARGET_LABELS[String(type ?? '')] ?? (String(type ?? '') || 'bilinmeyen hedef');
}

/** publishedTo'daki bir yayin kaydi (PublisherService yazar; eski kayitlarda url olabilir) */
export interface LiveEntry {
  targetId: string;
  targetType?: unknown;
  externalId?: unknown;
  externalUrl?: unknown;
  url?: unknown;
  publishedAt?: unknown;
  [key: string]: unknown;
}

/**
 * Kayit cop kutusunda bulundu mu? (publishedTo kaydinda trashedAt — ISO, paylasilan
 * sozlesme C3). Yerinde guncelleme yazinin WordPress'te cop kutusunda oldugunu
 * gordugunde yayinci yazar. Bu kopya artik CANLI DEGIL: musteri kaldirmis,
 * adresi 404 verir. Kayit (kimlik, adres) silinmez: musteri yaziyi geri
 * yuklerse sonraki yayin AYNI yaziyi bulur, yeni kopya acmaz; hedefe sonraki
 * basarili yazim kaydi yenisiyle degistirir (isaret kalkar).
 */
export function entryTrashed(e: unknown): boolean {
  return !!e && typeof e === 'object' && typeof (e as LiveEntry).trashedAt === 'string' && (e as LiveEntry).trashedAt !== '';
}

/**
 * Kayit hedefte SILINMIS bulundu mu? (publishedTo kaydinda missingAt — ISO,
 * paylasilan sozlesme D3). Yerinde guncelleme kayitli yaziyi hedefte bulamadiginda
 * (WordPress 404 rest_post_invalid_id / 410: kalici silme ya da WordPress'in cop
 * kutusunu 30 gun sonra kendiliginden bosaltmasi) ve yazi yeniden olusturulmadiginda
 * yayinci yazar. Anlami cop kutusuyla ayni: kopya CANLI DEGIL, adresi 404 verir.
 * NEDEN (S18): kayit eskiden "yayinda" kaliyordu; site haritasi, llms-full ve
 * canonical olu adresi ilan etmeye, pivot onu guncellenebilir saymaya devam ediyordu.
 * Kimlik ve adres silinmez: kullanicinin hedefi ACIKCA secerek yaptigi sonraki yayin
 * kaydi bulur (publishedEntryFor), yaziyi yeniden olusturur ve kayit yenisiyle
 * degisir (isaret kalkar).
 */
export function entryMissing(e: unknown): boolean {
  return !!e && typeof e === 'object' && typeof (e as LiveEntry).missingAt === 'string' && (e as LiveEntry).missingAt !== '';
}

/**
 * Kopya artik canli degil: cop kutusunda (trashedAt) ya da hedefte silinmis
 * (missingAt). "Yazi nerede yayinda" sorusunu yanitlayan HER okuyucu bu tek kurali
 * kullanir (liveEntries ve onu kullanan secim, durum karari, pivot, son yazim ani).
 */
export function entryRetired(e: unknown): boolean {
  return entryTrashed(e) || entryMissing(e);
}

/**
 * Yayin kayitlari (canli ya da cop kutusunda / silinmis): nesne, hedef kimligi var,
 * ok:false degil. Yalniz YAYINCININ hedef kaydini bulmasi icindir; "yazi
 * nerede yayinda" sorusunun cevabi liveEntries'tir.
 */
export function publishedEntries(publishedTo: unknown): LiveEntry[] {
  return (Array.isArray(publishedTo) ? publishedTo : []).filter(
    (e): e is LiveEntry => !!e && typeof e === 'object'
      && typeof (e as LiveEntry).targetId === 'string' && (e as LiveEntry).targetId !== ''
      && (e as LiveEntry).ok !== false,
  );
}

/**
 * Bu hedefteki yayin kaydi — cop kutusundaki ve silinmis bulunan dahil (yoksa null).
 * Yayinci hedefe yazarken bunu kullanir: cop kutusundaki yazinin kaydi "yok"
 * sayilsaydi karar publish_new olur ve musterinin kaldirdigi yazinin yanina yeni bir
 * kopya acilirdi; silinmis bulunan kayit da yerinde guncelleme yolundan gider
 * (yeniden olusturma yalniz kullanicinin acik seciminde, publisher.service).
 */
export function publishedEntryFor(publishedTo: unknown, targetId: string): LiveEntry | null {
  return publishedEntries(publishedTo).find((e) => e.targetId === targetId) ?? null;
}

/**
 * Yayinda sayilan kayitlar: nesne, hedef kimligi var, ok:false degil ve artik canli
 * olmayan kopya degil (entryRetired: cop kutusu ya da silinmis). Okuyanlar (secim,
 * durum karari, pivot, site haritasi lastmod, uretim hatti) bu kopyalari canli saymaz.
 */
export function liveEntries(publishedTo: unknown): LiveEntry[] {
  return publishedEntries(publishedTo).filter((e) => !entryRetired(e));
}

/** Bu hedefteki canli kayit (yoksa null) */
export function liveEntryFor(publishedTo: unknown, targetId: string): LiveEntry | null {
  return liveEntries(publishedTo).find((e) => e.targetId === targetId) ?? null;
}

/** ISO tarih dizesi ise aynen, degilse undefined */
function isoOrUndefined(v: unknown): string | undefined {
  return typeof v === 'string' && Number.isFinite(Date.parse(v)) ? v : undefined;
}

/**
 * Adaptor update() icin kayit adresi (eski kayitlarda adres `url` alaninda) ve
 * cakisma denetiminin dayanaklari: remoteModifiedAt (RanksUp'in son yaziminin
 * yanitindaki hedef damgasi) ve lastWriteAt (RanksUp'in bu kayda son yazimi:
 * updatedAt, yoksa publishedAt). Ikisi de olmayan eski kayitta yayinci
 * makalenin publishedAt'ini verir (publisher.service).
 */
export function liveEntryRef(entry: LiveEntry): { externalId?: string; externalUrl?: string; remoteModifiedAt?: string; lastWriteAt?: string } {
  const id = typeof entry.externalId === 'string' || typeof entry.externalId === 'number' ? String(entry.externalId) : undefined;
  const url = typeof entry.externalUrl === 'string' && entry.externalUrl
    ? entry.externalUrl
    : typeof entry.url === 'string' && entry.url ? entry.url : undefined;
  const remoteModifiedAt = isoOrUndefined(entry.remoteModifiedAt);
  const lastWriteAt = isoOrUndefined(entry.updatedAt) ?? isoOrUndefined(entry.publishedAt);
  return {
    ...(id ? { externalId: id } : {}),
    ...(url ? { externalUrl: url } : {}),
    ...(remoteModifiedAt ? { remoteModifiedAt } : {}),
    ...(lastWriteAt ? { lastWriteAt } : {}),
  };
}

/**
 * Yol tabanli hedefte canli kaydin slug'i: adresin son parcasi, uzantisiz
 * (FTP `ftp://host/yol/<slug>.html`, SFTP `yol/<slug>.html`, cPanel
 * `https://site/yol/<slug>`, GitHub `.../blob/<dal>/yol/<slug>.md`,
 * KobiPratik `https://site/onek/<slug>`). Adres yoksa null.
 */
export function liveEntrySlug(entry: LiveEntry): string | null {
  const raw = liveEntryRef(entry).externalUrl;
  if (!raw) return null;
  let path: string;
  try {
    path = new URL(raw).pathname;
  } catch {
    path = raw.split(/[?#]/)[0];
  }
  const seg = path.split('/').filter(Boolean).pop();
  if (!seg) return null;
  let slug = seg;
  try { slug = decodeURIComponent(seg); } catch { /* bozuk kacis — oldugu gibi */ }
  slug = slug.replace(/\.(?:html?|mdx?|markdown)$/i, '').trim();
  return slug || null;
}

/** Yeniden yayinin yapilmama nedeni */
export type RepublishBlockReason = 'create_only' | 'unaddressable' | 'slug_changed';

export type RepublishDecision =
  /** Bu hedefte canli kayit yok: bugunku gibi yayin (ilk yayin ya da kullanicinin ekledigi yeni hedef) */
  | { kind: 'publish_new' }
  | { kind: 'update'; ref: ReturnType<typeof liveEntryRef> }
  | { kind: 'overwrite' }
  | { kind: 'export' }
  | { kind: 'blocked'; reason: RepublishBlockReason; liveSlug?: string };

/**
 * Yazi bu hedefe nasil yeniden yayinlanir?
 *
 * slug_changed: yol tabanli hedefte (FTP vb.) dosya yolu slug'dan gelir.
 * Yayindaki yazi yeniden yazilirken slug degistiyse (uretim hatti yeniden
 * yazimda frontmatter'dan yeni slug uretebiliyor), "uzerine yazma" yeni
 * yolda YENI bir sayfa acar, eski adres eski metinle kalir — tam olarak
 * onlenmek istenen kopya. WordPress'te sorun yok: update slug gondermez,
 * adres degismez.
 */
export function decideRepublish(input: { entry: LiveEntry | null; targetType: unknown; articleSlug?: string | null }): RepublishDecision {
  const { entry } = input;
  if (!entry) return { kind: 'publish_new' };
  switch (republishModeForType(input.targetType)) {
    case 'update':
      return wordPressEntryAddressable(liveEntryRef(entry))
        ? { kind: 'update', ref: liveEntryRef(entry) }
        : { kind: 'blocked', reason: 'unaddressable' };
    case 'overwrite': {
      const liveSlug = liveEntrySlug(entry);
      const slug = typeof input.articleSlug === 'string' ? input.articleSlug.trim() : '';
      if (liveSlug && slug && liveSlug.toLowerCase() !== slug.toLowerCase()) {
        return { kind: 'blocked', reason: 'slug_changed', liveSlug };
      }
      return { kind: 'overwrite' };
    }
    case 'export':
      return { kind: 'export' };
    default:
      return { kind: 'blocked', reason: 'create_only' };
  }
}

/**
 * Kopya acilmadigi ya da musterinin icerigi ezilmesin diye yayinlanmayan
 * hedefin makine okunur nedeni (yayin sonucunda `skipped`; Turkce metin error'da):
 *  - live_entry_edited: WordPress yazisi RanksUp'in son yaziminden sonra
 *    WordPress'te degismis; ustune yazilmadi (paylasilan sozlesme C2). Kayit
 *    elle guncelleme bekliyor diye isaretlenir (metin farkliysa). Yalniz
 *    kullanicinin acik onayiyla (overwriteRemoteEdits) yazilir.
 *  - live_entry_mismatch: kayitli WordPress yazi kimligi artik bu yaziya ait
 *    degil (adres / tur tutmuyor); hicbir sey yazilmadi, kopya acilmadi (C2).
 *  - live_entry_missing: kayitli WordPress yazisi hedefte artik yok (404/410)
 *    ve yazi yeniden olusturulmadi. Yeniden olusturma yalniz KULLANICININ bu
 *    hedefi acikca secerek yaptigi yayinda olur (publisher.service initiator
 *    'user' + targetIds; paylasilan sozlesme D2): otomasyon (Tam otomatik yayin,
 *    pivot, takili sayfa) ve bos listeli yayin musterinin sildigi yaziyi geri
 *    getirmez. Hicbir sey yazilmadi; kayda missingAt yazilir (D3), kopya artik
 *    canli sayilmaz. Yalniz yazinin herkese acik adresi de 404/410 verirse
 *    (publisher.service checkEntryPublicUrl, S18).
 *  - live_entry_unresolvable: kayitli kimlik hedefte bulunamadi (404/410) ama
 *    yazinin adresi hala aciliyor (2xx/3xx): yazi sayfaya donusturulmus, site
 *    yeniden ice aktarilirken kimlikler degismis ya da adres onbellekten
 *    sunuluyor olabilir. Kopya CANLI sayilmaya devam eder (missingAt yok),
 *    kullanicinin acik seciminde de yeniden OLUSTURULMAZ (ayni adreste ikinci
 *    kopya olurdu); metin farkliysa elle guncelleme isareti alir.
 *  - live_entry_unverified: kayitli kimlik bulunamadi ve adresin durumu
 *    dogrulanamadi (adres kayitli degil, site yanit vermedi ya da erisimi
 *    engelledi). Kaldirildigindan emin olunmadan kopya emekliye ayrilmaz;
 *    otomasyon hicbir sey yazmaz. Kullanicinin acik seciminde eskisi gibi
 *    yeniden olusturulur (D2).
 *  - live_target_not_selected: yazi bu hedefte yayinda ama kullanicinin ACIK
 *    hedef listesinde yok (D1). Oraya yazilmadi; metin farkliysa kayit "elle
 *    guncelleme bekliyor" diye isaretlenir. Takili sayfa plani gibi acik liste
 *    gonderen sistem akislari zaten yazinin tum canli kopyalarini gonderir.
 */
export type PublishSkip =
  | 'already_live_create_only'
  | 'live_entry_unaddressable'
  | 'slug_changed'
  | 'live_entry_trashed'
  | 'live_target_inactive'
  | 'live_entry_edited'
  | 'live_entry_mismatch'
  | 'live_entry_missing'
  | 'live_entry_unresolvable'
  | 'live_entry_unverified'
  | 'live_target_not_selected';

export const BLOCK_SKIP: Record<RepublishBlockReason, PublishSkip> = {
  create_only: 'already_live_create_only',
  unaddressable: 'live_entry_unaddressable',
  slug_changed: 'slug_changed',
};

/** Elle guncellemenin yapilacagi yer (Turkce cumle ici) */
function manualPlace(type: unknown): string {
  return String(type ?? '') === 'CUSTOM_PHP' ? 'kendi sisteminizden' : `${targetLabel(type)} panelinden`;
}

/**
 * Yayin sonucunda (error) ve panelde gosterilen Turkce neden. Kullaniciya ne
 * oldugunu ve ne yapabilecegini soyler; "yayınlandı" demez.
 */
export function publishSkipText(
  skip: PublishSkip,
  type: unknown,
  extra: {
    liveSlug?: string | null; slug?: string | null; remoteModifiedAt?: string | null; remoteSlug?: string | null; postId?: string | null;
    /** live_target_not_selected: kopyadaki metin guncel metinden farkli (ya da zaten isaretli) */
    stale?: boolean;
    /** live_target_not_selected: RanksUp bu kopyayi yerinde guncelleyebilir (decideRepublish update / overwrite) */
    inPlace?: boolean;
    /**
     * live_target_not_selected: kopyanin guncel olup olmadigi dogrulanabiliyor mu
     * (kayit contentHash izi tasiyor). Izsiz eski kayitta "metin ayni" denemez.
     * Verilmezse true sayilir (eski cagiranlarin davranisi).
     */
    verified?: boolean;
  } = {},
): string {
  const label = targetLabel(type);
  switch (skip) {
    case 'live_entry_edited': {
      const when = wordPressDateLabel(extra.remoteModifiedAt);
      // WordPress HER kayitta son degisiklik damgasini ilerletir: RanksUp'in
      // kendi SEO duzeltmesi (meta, gorsel alt metni) de burada gorunur — metin
      // bunu da soyler ki musteri "ben dokunmadim" diye yaniltilmasin
      return `Bu yazı ${label} üzerinde, RanksUp'ın son yazımından sonra değiştirilmiş${when ? ` (son değişiklik: ${when})` : ''}: orada düzenlenmiş, taslaktan yayına alınmış, çöp kutusundan geri yüklenmiş ya da yazıya bir SEO düzeltmesi (meta, görsel alt metni) uygulanmış olabilir. Yapılan değişikliklerin üzerine yazılmadı ve kopya açılmadı. Güncel metni ${manualPlace(type)} elle uygulayabilir ya da ${label}'teki değişikliklerin üzerine yazılmasını açıkça onaylayarak yeniden yayınlayabilirsiniz.`;
    }
    case 'live_entry_mismatch': {
      // Hedeften gelen slug temizlenip kisaltilir (panel metni; HTML / ic adres tasimaz)
      const remoteSlug = extra.remoteSlug ? sanitizeErrorText(extra.remoteSlug, 80) : '';
      const ownSlug = extra.slug ? sanitizeErrorText(extra.slug, 80) : '';
      const id = extra.postId && /^\d{1,15}$/.test(extra.postId) ? ` (#${extra.postId})` : '';
      const found = remoteSlug ? ` O kimlikteki yazının adresi: ${remoteSlug}${ownSlug ? `; bu yazınınki: ${ownSlug}` : ''}.` : '';
      return `${label} üzerinde kayıtlı yazı kimliği${id} artık bu yazıya ait görünmüyor.${found} Site taşındıysa, yedekten geri dönüldüyse ya da yayın hedefi başka bir siteye bağlandıysa kimlikler değişmiş olabilir; yazının adresi ${label}'te değiştirilmiş de olabilir. Başka bir yazının üzerine yazmamak için güncellenmedi ve kopya açılmadı. Yazının ${label}'teki yerini kontrol edip güncel metni doğru yazıya elle uygulayabilirsiniz.`;
    }
    case 'already_live_create_only':
      return `Bu yazı ${label} üzerinde zaten yayında. Bu yayın hedefi mevcut yazıyı yerinde güncelleyemediği için kopya açılmadı; güncel metni ${manualPlace(type)} elle güncelleyin.`;
    case 'live_entry_unaddressable':
      return `Bu yazı ${label} üzerinde zaten yayında, ancak mevcut yazının kimliği ya da adresi kayıtlı değil. Yazı bulunamadığı için güncellenmedi ve kopya açılmadı; güncel metni ${manualPlace(type)} elle güncelleyin.`;
    case 'slug_changed':
      return `Yazının adresi ilk yayından sonra değişti (yayındaki: ${extra.liveSlug ?? '?'}, şimdiki: ${extra.slug ?? '?'}). ${label} hedefine yeniden yayın yeni bir sayfa açar, eski adres eski metinle kalırdı; kopya açılmadı. Güncel metni ${label} üzerindeki mevcut sayfaya elle uygulayın.`;
    case 'live_entry_trashed':
      return `Bu yazı ${label} üzerinde çöp kutusunda olduğu için yeniden yayınlanmadı (kaldırılan yazı geri getirilmez). Yazıyı yeniden yayında görmek istiyorsanız önce ${manualPlace(type)} çöp kutusundan geri yükleyin, sonra yeniden yayınlayın.`;
    case 'live_entry_missing':
      // Yeniden olusturma yalniz hedefi ACIKCA secen kullanici yayininda (D2): metin
      // musteriye tam olarak o yolu soyler. Kayit missingAt alir, canli sayilmaz (D3).
      return `Bu yazı ${label} üzerinde artık bulunamadı (silinmiş ya da site taşınmış olabilir). Silinen yazı bu yayında yeniden oluşturulmadı; hiçbir şey yazılmadı ve kopya açılmadı. RanksUp bu kopyayı artık yayında saymıyor. Yazıyı yeniden yayında görmek istiyorsanız yazının sayfasında ${label} hedefini seçerek yeniden yayınlayın; RanksUp yazıyı ${label} üzerinde yeniden oluşturur.`;
    case 'live_entry_unresolvable': {
      // Adres hala aciliyor (S18): yeniden olusturma onerilmez, ayni adreste ikinci kopya acardi
      const id = extra.postId && /^\d{1,15}$/.test(extra.postId) ? ` (#${extra.postId})` : '';
      return `Bu yazı ${label} üzerinde kayıtlı kimliğiyle${id} bulunamadı, ancak yazının adresi hâlâ açılıyor: yazı sayfaya dönüştürülmüş, site yeniden içe aktarılırken kimlikler değişmiş ya da adres önbellekten sunuluyor olabilir. Yazının ikinci bir kopyasını açmamak için yeniden oluşturulmadı ve hiçbir şey yazılmadı; RanksUp bu kopyayı yayında saymaya devam ediyor. Güncel metni ${manualPlace(type)} bu adresteki yazıya elle uygulayabilirsiniz.`;
    }
    case 'live_entry_unverified': {
      // Kaldirildigi dogrulanamadi: kopya emekliye ayrilmaz. Yeniden olusturma yolu
      // dogru: kullanicinin hedefi secerek yaptigi yayin bu durumda yaziyi yeniden olusturur (D2)
      const id = extra.postId && /^\d{1,15}$/.test(extra.postId) ? ` (#${extra.postId})` : '';
      return `Bu yazı ${label} üzerinde kayıtlı kimliğiyle${id} bulunamadı. Yazının kaldırıldığı, adresi kontrol edilerek de doğrulanamadı (adres kayıtlı değil ya da site yanıt vermedi, hata döndürdü veya erişimi engelledi). RanksUp bu kopyayı yayında saymaya devam ediyor; hiçbir şey yazılmadı ve kopya açılmadı. Yazıyı ${label} üzerinden sildiyseniz yazının sayfasında ${label} hedefini seçerek yeniden yayınlayabilirsiniz; RanksUp yazıyı ${label} üzerinde yeniden oluşturur.`;
    }
    case 'live_target_inactive':
      return `Yazının yayında olduğu hedef (${label}) silinmiş ya da pasif. Otomatik yayın başka bir hedefte yeni bir kopya açmaz; yazıyı hangi hedefe yayınlayacağınızı yazının sayfasından seçebilirsiniz.`;
    case 'live_target_not_selected': {
      // Secim neyse yazilan odur (D1). Metin iki seyi dogru soylemeli: kopyanin eski
      // metni gosterip gostermedigi ve RanksUp'in o kopyayi guncelleyip guncelleyemeyecegi
      // (yalniz yeni kayit acan hedefte "secip yeniden yayinlayin" yanlis bir vaat olurdu).
      const head = `Bu yazı ${label} üzerinde de yayında, ancak bu yayında ${label} seçilmediği için oraya yazılmadı ve oradaki kopyaya dokunulmadı.`;
      if (!extra.stale && extra.verified !== false) return `${head} RanksUp'ın oraya son yazdığı metin güncel metinle aynı; yapılacak bir şey yok.`;
      if (!extra.stale) {
        // Izsiz eski kayit: kopyanin hangi metni tasidigi bilinmiyor; "ayni" demek
        // dogrulanmamis bir iddia olurdu, "eski" demek de. Ne yapilabilecegini soyle.
        const what = extra.inPlace
          ? `Güncel metnin orada da olduğundan emin olmak için yazının sayfasında ${label} hedefini de seçerek yeniden yayınlayabilirsiniz.`
          : `Gerekirse güncel metni ${manualPlace(type)} elle kontrol edip uygulayın.`;
        return `${head} Bu eski yayın kaydı metin izi taşımadığı için oradaki kopyanın güncel metni gösterip göstermediği bilinmiyor. ${what}`;
      }
      const next = extra.inPlace
        ? `Güncel metni oraya da yazmak için yazının sayfasında ${label} hedefini de seçerek yeniden yayınlayabilirsiniz.`
        : `RanksUp bu kopyayı yerinde güncelleyemiyor; güncel metni ${manualPlace(type)} elle uygulayın.`;
      return `${head} Oradaki kopya eski metni gösteriyor ve elle güncelleme bekliyor diye işaretlendi. ${next}`;
    }
  }
}

/**
 * Bu yayinda hangi hedefler kullanilir? (saf — test edilir; paylasilan sozlesme D1)
 *  - targetIds verildi (kullanici secti ya da takili sayfa plani): YALNIZ onlar.
 *    Yazinin yayinda oldugu ama listede olmayan AKTIF canli kopyalar (disa aktarim
 *    degil) yazilmaz; notSelectedLive'da doner, yayinci onlari sonucunda
 *    'live_target_not_selected' ile raporlar ve metni farkliysa kaydi "elle
 *    guncelleme bekliyor" diye isaretler. NEDEN (S5/S11): 11. tur bu kopyalari
 *    secime kendiliginden ekliyordu (addedLive). Musteri canli WordPress'i bilerek
 *    kapatip yalniz Markdown ZIP'i ya da bir test sitesini secse de onay bekleyen
 *    (hatta QA engelli) yeniden yazim canli yaziya gidiyor, panel bunu soylemiyordu.
 *    Secim neyse yazilan odur; secilmeyen canli kopya sessiz kalmaz. Takili sayfa
 *    plani zaten yazinin TUM yerinde guncellenebilir canli kopyalarini gonderir.
 *  - verilmedi ve yazinin SITEDE canli kopyasi var (disa aktarim olmayan canli
 *    kayit): yazinin YAYINDA oldugu aktif hedefler (otomasyon, panel tablosu).
 *    Varsayilan hedef DEGIL: yayindan sonra varsayilan degistiyse yeni varsayilan
 *    hedefe ikinci bir kopya acilir, eski adres eski metinle kalirdi.
 *  - verilmedi ve sitede canli kopya yok (hic yayinlanmamis; kopyalar cop
 *    kutusunda / silinmis; ya da YALNIZ Markdown ZIP disa aktarimi var):
 *    varsayilan + aktif hedefler. NEDEN (S25): ZIP kaydi canli sayildiginda bos
 *    liste yalniz ZIP'i yeniden uretiyor, varsayilan site hedefine hic yazmiyordu.
 * unavailableLive (yalniz bos listede): yazinin sitede yayinda oldugu ama silinmis /
 * pasif hedefler. Otomasyon onlarin yerine baska hedefe yazmaz (ayni siteye baska bir
 * hedef tipiyle kopya acabilirdi); yayin sonucunda nedeniyle raporlanir. Disa
 * aktarim kaydi bu listeye girmez: canli kopya degildir, hedefi silinse de sitede
 * eski metin kalmaz. (Acik secimde pasif / silinmis hedefteki kopya raporlanmaz ama
 * yayin sonrasi "elle guncelleme bekliyor" diye isaretlenir — refreshManualUpdateFlags.)
 */
export function selectPublishTargets<T extends { id: string; type?: unknown; isDefault?: boolean | null; isActive?: boolean | null }>(
  all: T[],
  targetIds: string[],
  publishedTo: unknown,
): { targets: T[]; unavailableLive: LiveEntry[]; notSelectedLive: LiveEntry[] } {
  const byId = new Map(all.map((t) => [t.id, t]));
  const live = liveEntries(publishedTo);
  // Sitedeki canli kopyalar: disa aktarim (Markdown ZIP) canli siteye dokunmaz
  const siteLive = live.filter((e) => republishModeForType(byId.get(e.targetId)?.type ?? e.targetType) !== 'export');
  // Ayni hedefe ait birden fazla kayit (eski yayincidan kalma) tek sonuc uretir
  const oncePerTarget = (list: LiveEntry[]) => {
    const seen = new Set<string>();
    const out: LiveEntry[] = [];
    for (const e of list) {
      if (seen.has(e.targetId)) continue;
      seen.add(e.targetId);
      out.push(e);
    }
    return out;
  };
  if (targetIds.length > 0) {
    const wanted = new Set(targetIds);
    const notSelectedLive = oncePerTarget(siteLive.filter((e) => !wanted.has(e.targetId) && byId.get(e.targetId)?.isActive === true));
    return { targets: all.filter((t) => wanted.has(t.id)), unavailableLive: [], notSelectedLive };
  }
  if (siteLive.length === 0) {
    return { targets: all.filter((t) => t.isDefault === true && t.isActive === true), unavailableLive: [], notSelectedLive: [] };
  }
  const liveIds = new Set(live.map((e) => e.targetId));
  const targets = all.filter((t) => liveIds.has(t.id) && t.isActive === true);
  const usable = new Set(targets.map((t) => t.id));
  const unavailableLive = oncePerTarget(siteLive.filter((e) => !usable.has(e.targetId)));
  return { targets, unavailableLive, notSelectedLive: [] };
}

/**
 * Yazinin hedeflerine EN SON ne zaman yazildi (publishedTo kayitlarindaki
 * updatedAt'in en yenisi). Article.publishedAt artik ilk yayin tarihidir ve
 * yerinde guncellemede degismez; "son yazim" isteyen okuyucular (or. icerik
 * pivotunun bekleme suresi, site haritasi lastmod) bunu kullanmali.
 */
export function lastLiveWriteAt(publishedTo: unknown): Date | null {
  let latest: number | null = null;
  for (const e of liveEntries(publishedTo)) {
    const t = typeof e.updatedAt === 'string' ? Date.parse(e.updatedAt) : Number.NaN;
    if (Number.isFinite(t) && (latest === null || t > latest)) latest = t;
  }
  return latest === null ? null : new Date(latest);
}

// ─────────────────────────────────────────────────────────────────────────
//  ELLE GUNCELLEME BEKLEYEN CANLI KOPYA (paylasilan sozlesme)
//
//  publishedTo kaydinda ek alanlar: manualUpdatePending?: boolean,
//  manualUpdatePendingSince?: string (ISO). Anlami: yazi bu hedefte DAHA ESKI
//  bir metinle yayinda, RanksUp bu hedefi yerinde guncelleyemiyor, musteri
//  guncel metni kendi panelinden yapistirmali. Panel bunu gosterir; musteri
//  "guncelledim" (mark-updated) ya da "bu kaydi unut" (forget) diyebilir.
//  Hedefe sonraki basarili yazim isareti kaldirir (yeni kayit eskisinin yerine
//  gecer, isaret tasinmaz).
// ─────────────────────────────────────────────────────────────────────────

/**
 * Yazinin icerik izi: hedefe giden metnin (baslik, meta baslik, meta aciklama,
 * govde) SHA-256 ozeti. Basarili her yazimda kayda `contentHash` olarak yazilir.
 *
 * NEDEN: "bu hedefte daha ESKI metin yayinda" ancak hedefe en son giden metin
 * biliniyorsa dogru soylenebilir. Degismemis yaziyi yeniden yayinlamak (panelde
 * "Yayınla"ya tekrar basmak) sahte bir "elle güncelleyin" isareti uretmesin;
 * capraz link / snippet uygulamasi gibi durumu degistirmeden metni degistiren
 * akislar da yakalansin.
 */
export function articleContentHash(a: { title?: unknown; metaTitle?: unknown; metaDescription?: unknown; bodyMd?: unknown }): string {
  const text = (v: unknown) => (typeof v === 'string' ? v : '');
  return createHash('sha256')
    .update(JSON.stringify([text(a.title), text(a.metaTitle), text(a.metaDescription), text(a.bodyMd)]))
    .digest('hex');
}

/** Sitenin yayin hedefi satiri (karar icin gereken alanlar) */
export interface PublishTargetRow {
  id: string;
  type: unknown;
  isActive?: boolean | null;
}

/**
 * Bu canli kopyaya yeni metni RanksUp yazamaz mi? Evet ise yeni metni ancak
 * musteri elle uygular: hedef silinmis ya da pasif (yayinci ona yazmaz,
 * selectPublishTargets), yalniz yeni kayit acan hedef, kaydi adreslenemeyen
 * WordPress yazisi, slug'i degismis dosya (decideRepublish 'blocked').
 * Markdown ZIP canli siteye dokunmayan bir disa aktarim; canli kopya sayilmaz.
 */
export function liveCopyNeedsManualUpdate(entry: LiveEntry, target: PublishTargetRow | undefined, articleSlug?: string | null): boolean {
  if (republishModeForType(target?.type ?? entry.targetType) === 'export') return false;
  if (!target || target.isActive !== true) return true;
  return decideRepublish({ entry, targetType: target.type, articleSlug }).kind === 'blocked';
}

/**
 * publishedTo'daki elle guncelleme isaretlerini yeniden hesaplar (saf).
 *
 * Yalniz RanksUp'in yazamadigi canli kopyalar isaretlenir
 * (liveCopyNeedsManualUpdate). Kopyanin metni guncel metinden farkli mi:
 *  - kayitta contentHash varsa: o hedefe en son giden metnin izi ile simdiki
 *    metnin izi karsilastirilir (esitse isaret de kalkar);
 *  - yoksa (bu degisiklikten once yazilmis eski kayit): legacyContentChanged —
 *    yayinci bunu "yazi canliya ciktiktan sonra yeniden yazildi" diye verir
 *    (durum READY_TO_PUBLISH / REVIZE_NEEDED). Eski kayitta isaret yalniz
 *    kalkmaz: neyin yayinda oldugu bilinmiyor; musteri "güncelledim" diyerek
 *    kaldirir (o an kayda iz yazilir).
 * Bu yayinda basariyla yazilan hedeflerin kaydi zaten taze (isaretsiz, izli);
 * cop kutusunda bulunan kopya canli degil — ikisine dokunulmaz.
 * unwritableTargetIds: RanksUp bu yayinda o kopyaya YAZMADI — yazmayi denedi ama
 * yazi WordPress'te RanksUp disinda degismis (live_entry_edited) ya da kayitli
 * kimlik artik bu yaziya ait degil (live_entry_mismatch) ya da hic cozulmuyor
 * ama adres hala aciliyor (live_entry_unresolvable, S18), ya da kullanici acik
 * hedef listesinde o hedefi secmedi (live_target_not_selected, sozlesme D1).
 * Hedef normalde guncellenebilir olsa da bu kopya yeni metni bu yayinda almadi;
 * metin farkliysa isaretlenir (ayni metni yeniden yayinlamak isaret uretmez:
 * yapistirilacak yeni bir sey yok).
 * Isaret ilk konuldugu an (manualUpdatePendingSince) korunur.
 */
export function refreshManualUpdateFlags(input: {
  publishedTo: unknown;
  targets: readonly PublishTargetRow[];
  articleSlug?: string | null;
  contentHash: string;
  legacyContentChanged: boolean;
  writtenTargetIds?: ReadonlySet<string>;
  trashedTargetIds?: ReadonlySet<string>;
  unwritableTargetIds?: ReadonlySet<string>;
  now: string;
}): { publishedTo: unknown[]; changed: boolean; pendingTargetIds: string[] } {
  const list = Array.isArray(input.publishedTo) ? input.publishedTo : [];
  const byId = new Map(input.targets.map((t) => [t.id, t]));
  const live = new Set(liveEntries(list));
  let changed = false;
  const out = list.map((raw) => {
    if (!live.has(raw as LiveEntry)) return raw;
    const e = raw as LiveEntry;
    if (input.writtenTargetIds?.has(e.targetId) || input.trashedTargetIds?.has(e.targetId)) return e;
    if (!input.unwritableTargetIds?.has(e.targetId) && !liveCopyNeedsManualUpdate(e, byId.get(e.targetId), input.articleSlug)) return e;
    const hasHash = typeof e.contentHash === 'string' && e.contentHash !== '';
    const differs = hasHash ? e.contentHash !== input.contentHash : input.legacyContentChanged;
    if (differs) {
      if (e.manualUpdatePending === true && typeof e.manualUpdatePendingSince === 'string') return e;
      changed = true;
      return {
        ...e,
        manualUpdatePending: true,
        manualUpdatePendingSince: typeof e.manualUpdatePendingSince === 'string' ? e.manualUpdatePendingSince : input.now,
      };
    }
    if (hasHash && (e.manualUpdatePending !== undefined || e.manualUpdatePendingSince !== undefined)) {
      changed = true;
      return withoutManualUpdateFlag(e);
    }
    return e;
  });
  const pendingTargetIds = liveEntries(out).filter((e) => e.manualUpdatePending === true).map((e) => e.targetId);
  return { publishedTo: out, changed, pendingTargetIds };
}

/**
 * RanksUp'in bu yayinda YAZMADIGI canli kopya, yayindan sonra "elle guncelleme
 * bekliyor" isaretli mi olacak? refreshManualUpdateFlags'in unwritable kopya icin
 * verdigi kararla birebir ayni: izli kayitta iz guncel metnin izinden farkliysa;
 * izsiz eski kayitta metin canliya ciktiktan sonra yeniden yazildiysa ya da kayit
 * zaten isaretliyse (eski kayitta isaret kendiliginden kalkmaz). Yayinci
 * 'live_target_not_selected' metnini buna gore kurar: kopya guncel metni tasiyorsa
 * "eski metin" denmez.
 */
export function liveCopyStale(entry: LiveEntry, current: { contentHash: string; legacyContentChanged: boolean }): boolean {
  const hasHash = typeof entry.contentHash === 'string' && entry.contentHash !== '';
  return hasHash ? entry.contentHash !== current.contentHash : current.legacyContentChanged || entry.manualUpdatePending === true;
}

/** Kaydin elle guncelleme isareti kaldirilmis kopyasi (girdi degismez) */
export function withoutManualUpdateFlag(entry: LiveEntry): LiveEntry {
  const copy: LiveEntry = { ...entry };
  delete copy.manualUpdatePending;
  delete copy.manualUpdatePendingSince;
  return copy;
}

/**
 * Yayin sirasinda hedefte GORULENLERI yazilmayan kayitlara isler (saf; girdi
 * degismez):
 *  - trashed: yazi WordPress'te cop kutusunda → kayda trashedAt (ilk gorulen an
 *    korunur). Elle guncelleme isareti kalkar: cop kutusundaki kopyaya
 *    yapistirilacak bir sey yok; geri yuklenirse sonraki yayin yeniden karar verir.
 *    Yazi cop kutusunda DURUYOR: varsa missingAt kalkar.
 *  - missing (sozlesme D3): yazi hedefte silinmis (404/410) ve yeniden
 *    olusturulmadi → kayda missingAt (ilk gorulen an korunur), elle guncelleme
 *    isareti kalkar (silinmis kopyaya yapistirilacak bir sey yok). trashedAt
 *    varsa gecmis bilgisi olarak kalir.
 *  - present: yazi hedefte duruyor ve cop kutusunda degil (yazilmadi, or.
 *    musterinin duzenlemesi korundu ya da kimlik cozulmese de adres hala
 *    aciliyor) → trashedAt / missingAt varsa kalkar (musteri geri yuklemis, yazi
 *    yedekten donmus ya da kayit yalniz kimlik 404'uyle emekliye ayrilmisti).
 * Kimlik ve adres hic silinmez: kopya geri gelirse ayni yazi bulunur.
 */
export function applyEntryObservations(
  publishedTo: unknown,
  obs: { trashed?: ReadonlySet<string>; missing?: ReadonlySet<string>; present?: ReadonlySet<string>; now: string },
): unknown[] {
  const list = Array.isArray(publishedTo) ? publishedTo : [];
  const known = new Set(publishedEntries(list));
  const flagged = (e: LiveEntry) => e.manualUpdatePending !== undefined || e.manualUpdatePendingSince !== undefined;
  return list.map((raw) => {
    if (!known.has(raw as LiveEntry)) return raw;
    const e = raw as LiveEntry;
    if (obs.trashed?.has(e.targetId)) {
      if (entryTrashed(e) && !entryMissing(e) && !flagged(e)) return e;
      const copy = withoutManualUpdateFlag(e);
      copy.trashedAt = entryTrashed(e) ? e.trashedAt : obs.now;
      delete copy.missingAt;
      return copy;
    }
    if (obs.missing?.has(e.targetId)) {
      if (entryMissing(e) && !flagged(e)) return e;
      const copy = withoutManualUpdateFlag(e);
      copy.missingAt = entryMissing(e) ? e.missingAt : obs.now;
      return copy;
    }
    if (obs.present?.has(e.targetId) && entryRetired(e)) {
      const copy: LiveEntry = { ...e };
      delete copy.trashedAt;
      delete copy.missingAt;
      return copy;
    }
    return e;
  });
}

/** Atlanan hedefin is sonucundaki ozeti (worker loga / is sonucuna yazar) */
export interface SkippedTargetSummary {
  targetId: string;
  targetType: string;
  skipped: string;
  error?: string;
}

/**
 * Otomatik yayindan (worker GENERATE_ARTICLE) sonra ne yapilir?
 *  - en az bir hedefe yazildi: yazi yayinda; e-posta yok.
 *  - hicbir hedefe yazilmadi ve TUM hedefler bilerek atlandi (skipped: kopya
 *    acilmadi, kayit adreslenemedi, slug degisti, cop kutusu, hedef pasif):
 *    "onayini bekliyor / henuz yayinda degil" e-postasi YANLIS olur — yazinin
 *    eski hali yayinda (ya da musteri kaldirmis) ve onay vermek bir sey
 *    degistirmez. Nedenler is sonucuna ve loga yazilir.
 *  - hicbir hedefe yazilmadi, en az bir hedef HATA verdi ya da hic hedef yok:
 *    yazi gercekten onay / yeniden deneme bekliyor; e-posta gider (eski davranis).
 */
export function autoPublishFollowUp(results: unknown): {
  written: boolean;
  notifyAwaitingApproval: boolean;
  skipped: SkippedTargetSummary[];
} {
  const list = (Array.isArray(results) ? results : []).filter((r): r is Record<string, unknown> => !!r && typeof r === 'object');
  if (list.some((r) => r.ok === true)) return { written: true, notifyAwaitingApproval: false, skipped: [] };
  const allSkipped = list.length > 0 && list.every((r) => typeof r.skipped === 'string' && r.skipped !== '');
  if (!allSkipped) return { written: false, notifyAwaitingApproval: true, skipped: [] };
  return {
    written: false,
    notifyAwaitingApproval: false,
    skipped: list.map((r) => ({
      targetId: String(r.targetId ?? ''),
      targetType: String(r.targetType ?? ''),
      skipped: String(r.skipped),
      ...(typeof r.error === 'string' ? { error: r.error } : {}),
    })),
  };
}

// ─────────────────────────────────────────────────────────────────────────
//  OTOMATIK YAZIM ENGELLENDI (agentOutputs.liveWriteBlocked)
//
//  NEDEN (S4): otomasyonun yayini hicbir canli kopyaya yazamayinca (WordPress'te
//  degismis, kimlik tutmuyor, silinmis...) son canli yazim ani (lastLiveWriteAt)
//  ilerlemiyor; icerik pivotunun 30 gunluk bekleme suresi hep gecmis gorunuyor,
//  yazi her Pazartesi 5 ajanli LLM yeniden yazimina giriyor ve yayin yine
//  atlaniyordu. Yayinci bu sonucu yaziya kaydeder, pivot 30 gun yeniden yazmaz.
// ─────────────────────────────────────────────────────────────────────────

/** Otomatik yazimda bilerek atlanan hedefin kayittaki ozeti */
export interface LiveWriteBlockedReason {
  targetId: string;
  targetType: string;
  skipped: string;
}

/**
 * agentOutputs.liveWriteBlocked: otomasyonun (yayinci initiator 'automation': Tam
 * otomatik yayin, pivot yeniden yazimi, takili sayfa) yayininda HICBIR hedefe
 * yazilmadi ve en az bir hedef bilerek atlandi. at: o yayinin sonu (ISO).
 */
export interface LiveWriteBlocked {
  at: string;
  reasons: LiveWriteBlockedReason[];
}

function objectOrEmpty(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

/** Ajan ciktilarina engel kaydi eklenir (onceki kaydin yerine); geri kalan aynen kalir, girdi degismez */
export function agentOutputsWithLiveWriteBlocked(agentOutputs: unknown, blocked: LiveWriteBlocked): Record<string, unknown> {
  return { ...objectOrEmpty(agentOutputs), liveWriteBlocked: blocked };
}

/** Engel kaydi kaldirilmis ajan ciktilari; kayit yoksa null (yazilacak bir sey yok). Girdi degismez. */
export function agentOutputsWithoutLiveWriteBlocked(agentOutputs: unknown): Record<string, unknown> | null {
  const o = objectOrEmpty(agentOutputs);
  if (!Object.prototype.hasOwnProperty.call(o, 'liveWriteBlocked')) return null;
  const copy = { ...o };
  delete copy.liveWriteBlocked;
  return copy;
}

/**
 * Hala gecerli otomatik yazim engeli (yoksa null). Kayit, o andan SONRA bir canli
 * kopyaya yazildiysa anlamini yitirir: basarili yayin ya da musterinin "Elle
 * güncelledim" bildirimi kaydin updatedAt'ini ilerletir (lastLiveWriteAt). "Bu kaydi
 * unut" kaydi ayrica siler (articles.service). Bekleme suresini cagiran uygular
 * (content-pivot PIVOT_COOLDOWN_DAYS).
 */
export function activeLiveWriteBlock(agentOutputs: unknown, publishedTo: unknown): { at: Date; reasons: LiveWriteBlockedReason[] } | null {
  const raw = objectOrEmpty(objectOrEmpty(agentOutputs).liveWriteBlocked);
  const t = typeof raw.at === 'string' ? Date.parse(raw.at) : Number.NaN;
  if (!Number.isFinite(t)) return null;
  const last = lastLiveWriteAt(publishedTo);
  if (last && last.getTime() > t) return null;
  const reasons = (Array.isArray(raw.reasons) ? raw.reasons : [])
    .filter((r): r is Record<string, unknown> => !!r && typeof r === 'object')
    .map((r) => ({ targetId: String(r.targetId ?? ''), targetType: String(r.targetType ?? ''), skipped: String(r.skipped ?? '') }));
  return { at: new Date(t), reasons };
}
