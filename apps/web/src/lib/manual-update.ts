/**
 * "Eski surum yayinda, elle guncelle" akisinin panel metinleri ve kurallari — saf,
 * test edilir (manual-update.spec.mts). Makale sayfasi (Yayin Gecmisi) ve icerik
 * tablosu kullanir.
 *
 * NEDEN: yayindaki yazi yeniden yazildiginda (icerik pivotu, takili sayfa onarimi,
 * panelden yeniden yayin) yazinin yayinda oldugu hedef yaziyi YERINDE
 * guncelleyemiyorsa (Ghost, Strapi, Webflow, Sanity, Contentful, WHMCS, ozel PHP —
 * api articles/republish-policy.ts 'create_only') yayinci kopya acmamak icin o hedefe
 * yazmaz. Hedefte eski metin kalir; publishedTo kaydi manualUpdatePending:true tasir.
 * Musteri guncel metni hedefin kendi paneline yapistirip "Elle güncelledim" der
 * (POST .../published-to/:targetId/mark-updated) ya da yaziyi orada sildiyse kaydi
 * unutur (.../forget) — o hedefe sonraki yayin yeni kayit acar.
 *
 * Isaretin tek nedeni "hedef yerinde guncelleyemiyor" DEGIL (api republish-policy.ts
 * liveCopyNeedsManualUpdate + paylasilan sozlesme C2): hedef pasif ya da silinmis,
 * WordPress kaydinin kimligi / adresi yok, dosya hedefinde adres degismis, ya da
 * WordPress yazisi RanksUp'in son yazimindan sonra wp-admin'de duzenlenmis (RanksUp
 * uzerine yazmadi). Neden kayda yazilmiyor; panel hedef satirindan ve kayittan cikarir
 * (manualUpdateReason). Eskiden her durumda "yerinde guncelleyemiyor" deniyordu:
 * WordPress icin yanlisti ve musteriyi elle kopyala-yapistira itiyordu.
 */

/** Yalniz yeni kayit acan hedefteki (Ghost, Strapi...) bekleyen kaydin notu (urun metni) */
export const MANUAL_UPDATE_NOTE =
  'Bu hedefte eski sürüm yayında; RanksUp bu hedefi yerinde güncelleyemiyor. Güncel metni kopyalayıp hedef panelinize yapıştırın.';

/** Kayit elle guncelleme bekliyor mu — yalniz acik true (eski kayitlarda alan yok) */
export function isManualUpdatePending(entry: unknown): boolean {
  return !!entry && typeof entry === 'object' && (entry as { manualUpdatePending?: unknown }).manualUpdatePending === true;
}

/**
 * Emekli kopya: WordPress cop kutusunda (trashedAt, sozlesme C3) ya da hedefte artik yok
 * (missingAt, D3). Guncellenecek bir kopya kalmadigi icin "elle guncelleme bekliyor"
 * sayilmaz (publish-result.ts publishedEntryView ile ayni kural).
 */
function emekliKopya(entry: unknown): boolean {
  if (!entry || typeof entry !== 'object') return false;
  const e = entry as { trashedAt?: unknown; missingAt?: unknown };
  return (typeof e.trashedAt === 'string' && e.trashedAt.trim() !== '') || (typeof e.missingAt === 'string' && e.missingAt.trim() !== '');
}

/** publishedTo'da elle guncelleme bekleyen (emekli olmayan) kayit sayisi (gecersiz girdi 0) */
export function pendingManualUpdateCount(publishedTo: unknown): number {
  return Array.isArray(publishedTo) ? publishedTo.filter((e) => isManualUpdatePending(e) && !emekliKopya(e)).length : 0;
}

/**
 * Icerik tablosu satir rozeti; bekleyen kayit yoksa null. Tablo hedef satirlarini
 * bilmez: nedeni (pasif hedef, WordPress'te elle duzenleme...) iddia etmez, ayrintiya
 * (Yayin Gecmisi) yonlendirir.
 */
export function manualUpdateBadge(publishedTo: unknown): { label: string; title: string } | null {
  const n = pendingManualUpdateCount(publishedTo);
  if (n === 0) return null;
  const nerede = n === 1 ? 'bir yayın hedefinde' : `${n} yayın hedefinde`;
  return {
    label: 'Elle güncelleme bekliyor',
    title: `Bu yazının eski sürümü ${nerede} yayında; yeni metin oraya yazılmadı. Nedenini ve yapabileceklerini yazının sayfasındaki Yayın Geçmişi’nde görebilirsin.`,
  };
}

/**
 * Bekleyen kaydin nedeni (panelin cikarimi — kayit nedeni tasimaz):
 *  - create_only: hedef yaziyi yerinde guncelleyemez (Ghost, Strapi, Webflow...)
 *  - target_missing: yazinin yayinda oldugu hedef silinmis (hedef listesi okunabildiyse)
 *  - target_inactive: hedef pasif; etkinlestirilirse RanksUp yerinde gunceller
 *  - unaddressable: WordPress kaydinda yazi kimligi / adresi yok
 *  - slug_changed: dosya hedefinde yazinin adresi ilk yayindan sonra degismis
 *  - republishable: hedef aktif ve RanksUp bu kopyaya yazabilecek durumda. Isaret ya
 *    musterinin son yayinda bu hedefi secmemesi (D1 'live_target_not_selected'), ya
 *    WordPress'te elle duzenleme (C2 'live_entry_edited': RanksUp uzerine yazmadi), ya kayitli
 *    kimligin baska yaziyi gostermesi ('live_entry_mismatch') ya da hedefin o sirada pasif
 *    olmasi yuzunden duruyor; bu hedefe yeniden yayin kesin cevabi verir.
 *  - unknown: hedef listesi okunamadi ya da kaydin tipi bilinmiyor
 */
export type ManualUpdateReason =
  | 'create_only'
  | 'target_missing'
  | 'target_inactive'
  | 'unaddressable'
  | 'slug_changed'
  | 'republishable'
  | 'unknown';

/** Yerinde guncellenen (WordPress) tipler — api republish-policy.ts UPDATE_TARGET_TYPES */
export const UPDATE_TARGET_TYPES: ReadonlySet<string> = new Set(['WORDPRESS_REST', 'WORDPRESS_XMLRPC']);
/** Ayni yolun uzerine yazilan (dosya) tipler — api republish-policy.ts OVERWRITE_TARGET_TYPES */
export const OVERWRITE_TARGET_TYPES: ReadonlySet<string> = new Set(['FTP', 'SFTP', 'CPANEL_API', 'GITHUB', 'KOBIPRATIK']);

/** Kaydin adaptore giden adresi — api republish-policy.ts liveEntryRef ile ayni */
function entryRef(entry: Record<string, unknown>): { externalId?: string; externalUrl?: string } {
  const id = typeof entry.externalId === 'string' || typeof entry.externalId === 'number' ? String(entry.externalId) : undefined;
  const url = typeof entry.externalUrl === 'string' && entry.externalUrl
    ? entry.externalUrl
    : typeof entry.url === 'string' && entry.url ? entry.url : undefined;
  return { ...(id ? { externalId: id } : {}), ...(url ? { externalUrl: url } : {}) };
}

/** Pozitif, guvenli tamsayi kimlik ya da null — adapters wordpress-post-ref.ts positiveId */
function positiveId(raw: unknown): number | null {
  const text = typeof raw === 'number' ? String(raw) : typeof raw === 'string' ? raw.trim() : '';
  if (!/^\d{1,15}$/.test(text)) return null;
  const n = Number(text);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

/**
 * WordPress kaydi guncelleme icin bulunabilir mi (kimlik, adreste ?p= ya da adresin son
 * parcasinda slug) — packages/adapters/src/wordpress-post-ref.ts wordPressEntryAddressable
 * ile ayni kural (manual-update.spec.mts iki fonksiyonu ayni girdilerle karsilastirir).
 * Web paketi adaptorleri yukleyemez (FTP/SSH bagimliliklari); bu yuzden kopya.
 */
export function wordPressEntryAddressable(entry: unknown): boolean {
  if (!entry || typeof entry !== 'object') return false;
  const ref = entryRef(entry as Record<string, unknown>);
  if (positiveId(ref.externalId) !== null) return true;
  if (!ref.externalUrl) return false;
  let parsed: URL;
  try {
    parsed = new URL(ref.externalUrl);
  } catch {
    return false;
  }
  if (positiveId(parsed.searchParams.get('p')) !== null) return true;
  const seg = parsed.pathname.split('/').filter(Boolean).pop();
  if (!seg) return false;
  let slug = seg;
  try { slug = decodeURIComponent(seg); } catch { /* bozuk kacis — oldugu gibi */ }
  slug = slug.trim();
  return !!slug && slug !== 'index.php';
}

/**
 * Dosya hedefinde canli kaydin slug'i yazinin simdiki slug'indan farkli mi — api
 * republish-policy.ts liveEntrySlug + decideRepublish 'slug_changed' kurali: adresin son
 * parcasi, uzantisiz, harf buyuklugu yok sayilarak. Biri bilinmiyorsa false (API de engellemez).
 */
export function fileEntrySlugChanged(entry: unknown, articleSlug: string | null | undefined): boolean {
  if (!entry || typeof entry !== 'object') return false;
  const raw = entryRef(entry as Record<string, unknown>).externalUrl;
  const slug = typeof articleSlug === 'string' ? articleSlug.trim() : '';
  if (!raw || !slug) return false;
  let path: string;
  try {
    path = new URL(raw).pathname;
  } catch {
    path = raw.split(/[?#]/)[0];
  }
  const seg = path.split('/').filter(Boolean).pop();
  if (!seg) return false;
  let live = seg;
  try { live = decodeURIComponent(seg); } catch { /* bozuk kacis — oldugu gibi */ }
  live = live.replace(/\.(?:html?|mdx?|markdown)$/i, '').trim();
  return !!live && live.toLowerCase() !== slug.toLowerCase();
}

/**
 * Bekleyen kaydin nedeni. target: kaydin hedef satiri (yoksa undefined). targetsKnown:
 * hedef listesi okunabildi mi — okunamadiysa "silinmis" denmez.
 * Sira onemli: pasif hedef + adreslenemeyen kayit 'unaddressable'dir (etkinlestirmek
 * cozmez); yalniz yeni kayit acan tip etkinlik durumundan bagimsiz 'create_only'.
 */
export function manualUpdateReason(
  entry: unknown,
  target: { type?: string | null; isActive?: boolean | null } | null | undefined,
  opts: { targetsKnown: boolean; articleSlug?: string | null },
): ManualUpdateReason {
  if (!entry || typeof entry !== 'object') return 'unknown';
  const entryType = (entry as { targetType?: unknown }).targetType;
  const type = typeof target?.type === 'string' && target.type
    ? target.type
    : typeof entryType === 'string' ? entryType : '';
  if (type && !SELF_HEALING_TARGET_TYPES.has(type)) return 'create_only';
  // Markdown ZIP canli siteye dokunmaz; API onu hic isaretlemez (eski kayit) — iddia yok
  if (type && !UPDATE_TARGET_TYPES.has(type) && !OVERWRITE_TARGET_TYPES.has(type)) return 'unknown';
  if (!opts.targetsKnown) return 'unknown';
  if (!target) return 'target_missing';
  if (UPDATE_TARGET_TYPES.has(type) && !wordPressEntryAddressable(entry)) return 'unaddressable';
  if (OVERWRITE_TARGET_TYPES.has(type) && fileEntrySlugChanged(entry, opts.articleSlug)) return 'slug_changed';
  if (target.isActive !== true) return 'target_inactive';
  // Tipi bilinmeyen kayit: yazilabilir mi bilinmiyor
  if (!type) return 'unknown';
  return 'republishable';
}

/** Bekleyen kaydin notu — nedene gore; "yerinde guncelleyemiyor" yalniz gercekten oyleyse */
export function manualUpdateNote(reason: ManualUpdateReason, targetType?: string | null): string {
  switch (reason) {
    case 'create_only':
      return MANUAL_UPDATE_NOTE;
    case 'target_missing':
      // Hedefi yeniden ekleyip yayinlamak onerilmez: yeni hedefe yayin YENI bir yazi acar (kopya)
      return 'Bu hedefte eski sürüm yayında; yazının yayında olduğu yayın hedefi silinmiş, RanksUp bu kopyaya artık yazamıyor. Güncel metni kopyalayıp yazının yayında olduğu panele yapıştırın; yazıyı orada sildiyseniz kaydı unutun.';
    case 'target_inactive':
      return 'Bu hedefte eski sürüm yayında; yayın hedefi pasif olduğu için RanksUp yeni metni oraya yazmadı. Hedefi Yayın Hedefleri’nden etkinleştirip bu hedefe yeniden yayınlarsanız yazı yerinde güncellenir; isterseniz güncel metni kopyalayıp hedef panelinize de yapıştırabilirsiniz.';
    case 'unaddressable':
      return 'Bu hedefte eski sürüm yayında; yazının WordPress kimliği ya da adresi kayıtlı olmadığı için RanksUp hangi yazıyı güncelleyeceğini bilemiyor. Güncel metni kopyalayıp WordPress panelinize yapıştırın.';
    case 'slug_changed':
      return 'Bu hedefte eski sürüm yayında; yazının adresi ilk yayından sonra değişti. Yeni adrese yazmak ikinci bir sayfa açacağı için RanksUp mevcut sayfaya dokunmadı. Güncel metni mevcut sayfaya elle uygulayın.';
    case 'republishable':
      // Isaretin nedeni birkac olasiliktan biri (api republish-policy.ts
      // refreshManualUpdateFlags unwritableTargetIds, D1'de secilmeyen canli hedef, pasif
      // hedef); hangisi oldugu kayitta yok. Yeniden yayin kesin cevabi verir ve onaysiz
      // hicbir sey ezilmez (C1/C2).
      return typeof targetType === 'string' && UPDATE_TARGET_TYPES.has(targetType)
        ? 'Bu hedefte eski sürüm yayında. Yeni metin bu WordPress yazısına yazılmadı: son yayında bu hedef seçilmedi, yazı WordPress’te RanksUp’ın son yazımından sonra değişti, kayıtlı yazı kimliği başka bir yazıyı gösteriyor ya da hedef o sırada pasifti. Bu hedefe yeniden yayınlayın; RanksUp nedeni kesin olarak söyler ve WordPress’teki değişiklikleri onayınız olmadan ezmez.'
        : 'Bu hedefte eski sürüm yayında. Yeni metin bu hedefe yazılmadı (son yayında bu hedef seçilmedi ya da hedef o sırada pasifti); RanksUp sayfayı aynı adreste yeniden yazabilir: bu hedefe yeniden yayınlayın.';
    default:
      return 'Bu hedefte eski sürüm yayında; yeni metin bu hedefe yazılmadı. Güncel metni kopyalayıp hedef panelinize yapıştırın.';
  }
}

/**
 * Yazinin yerinde guncellendigi (WordPress), ayni yolun uzerine yazildigi (dosya
 * hedefleri) ya da canli siteye dokunmayan disa aktarim (Markdown ZIP) hedef tipleri —
 * api articles/republish-policy.ts UPDATE / OVERWRITE / EXPORT_TARGET_TYPES birlesimi
 * (manual-update.spec.mts API kaynagiyla karsilastirir). Disindaki her tip her yayinda
 * YENI kayit acar ('create_only').
 */
export const SELF_HEALING_TARGET_TYPES: ReadonlySet<string> = new Set([
  'WORDPRESS_REST', 'WORDPRESS_XMLRPC', 'FTP', 'SFTP', 'CPANEL_API', 'GITHUB', 'KOBIPRATIK', 'MARKDOWN_ZIP',
]);

/**
 * "Bu hedefteki kaydi unut" sunulsun mu?
 *
 * NEDEN yalniz bekleyen kayitta degil: isaret (manualUpdatePending) yalniz metin
 * degistiyse konur. Yaziyi yalniz yeni kayit acan bir hedefte (Ghost, Strapi...)
 * elle silen musteri metni degistirmediyse isaret yoktur; kayit "yayinda" der ve
 * yayinci o hedefe yeniden yayini kopya korumasiyla atlar — kacis yolu kalmazdi.
 *  - elle guncelleme bekleyen kayit: evet
 *  - yalniz yeni kayit acan hedef: evet (silinen yaziyi RanksUp goremez)
 *  - WordPress (silinen yazi 404 ile yeniden acilir), dosya hedefleri (ayni yola
 *    yeniden yazilir), Markdown ZIP: hayir — unutmak gereksiz, yalniz kopya riski.
 * Hedef satiri bulunamazsa (silinmis hedef ya da hedef listesi okunamadi) kaydin
 * targetType'i kullanilir: "bulunamadi = silinmis" sayilmaz; silinmis hedefe zaten
 * yayin yapilamaz, unutmanin anlami yok.
 */
export function canForgetEntry(
  entry: unknown,
  target: { type?: string | null } | null | undefined,
): boolean {
  if (!entry || typeof entry !== 'object') return false;
  if (isManualUpdatePending(entry)) return true;
  const type = typeof target?.type === 'string' && target.type
    ? target.type
    : String((entry as { targetType?: unknown }).targetType ?? '');
  // Tipi bilinmeyen kayit (cok eski kayit): iddia yok, eylem sunulmaz
  if (!type) return false;
  return !SELF_HEALING_TARGET_TYPES.has(type);
}

/** "Bu hedefteki kaydi unut" onay penceresi — yalniz eski yazi silindiyse kullanilmali */
export function forgetEntryConfirm(targetName: string): { title: string; description: string; confirmLabel: string } {
  return {
    title: 'Bu hedefteki kayıt unutulsun mu?',
    description:
      `RanksUp bu yazının ${targetName} hedefinde yayında olduğunu unutur ve bu hedefe bir sonraki yayın yeni bir yazı açar. `
      + 'Eski yazı hâlâ duruyorsa sitende aynı içerik iki kez yayında olur. '
      + `Bunu yalnız eski yazıyı ${targetName} panelinden sildiysen kullan.`,
    confirmLabel: 'Kaydı unut',
  };
}

/**
 * Kopyalanacak GUNCEL metin (Markdown): baslik blogu (frontmatter) ve kapak gorseli
 * yer tutucusu cikarilir (api articles/hero-placeholder.ts stripHeroPlaceholder ile
 * ayni kural: once yalniz yer tutucudan olusan satir, sonra satir ici kalanlar).
 *
 * NEDEN bodyMd: bodyHtml yalniz basarili yayinda yazilir (publisher.service, son
 * yayinin govde parcasi); metni degistiren her akis onu yenilemez (takili sayfa
 * onarimi ve geri almasi bodyHtml'e dokunmaz: stuck-page-recovery.service). Elle
 * guncelleme bekleyen yazida bodyHtml hedefteki ESKI metin olabilir; kopyalanirsa
 * musteri eski metni yeniden yapistirirdi. Guncel metnin tek kaynagi bodyMd.
 */
export function currentArticleMarkdown(bodyMd: unknown): string {
  if (typeof bodyMd !== 'string') return '';
  return bodyMd
    .replace(/^---\r?\n[\s\S]+?\r?\n---\r?\n+/, '')
    .replace(/^[ \t]*!\[[^\]]*\]\(\s*placeholder-hero\.webp\s*\)[ \t]*(?:\r?\n|$)/gim, '')
    .replace(/!\[[^\]]*\]\(\s*placeholder-hero\.webp\s*\)/gi, '')
    .trim();
}
