/**
 * Yayin hedefi secimi — saf, test edilir (publish-targets.spec.mts). Icerik tablosu
 * ("Yayinla") ve makale sayfasi (hedef dugmeleri) kullanir.
 *
 * SOZLESME D1 (api articles/republish-policy.ts selectPublishTargets):
 *  - ACIK, bos olmayan hedef listesi AYNEN uygulanir. Yazinin yayinda oldugu ama listede
 *    olmayan hedefe yazilmaz: o kopya eski metinle kalir, kaydi "elle guncelleme bekliyor"
 *    (manualUpdatePending) isaretini alir ve sonuc listesinde 'live_target_not_selected'
 *    diye raporlanir.
 *  - BOS liste: yazi sitede yayindaysa yazinin yayinda oldugu AKTIF hedefler, degilse
 *    varsayilan + aktif hedef.
 * NEDEN: 11. turda API acik listeye yazinin yayinda oldugu aktif hedefleri kendiliginden
 * ekliyordu (addedLive). Musterinin makale sayfasinda bilerek kaldirdigi canli kopyaya
 * (or. onay bekleyen yeniden yazimi once Markdown ZIP ya da test sitesinde gormek icin)
 * yeni metin yine yaziliyor, panel hicbir uyari vermiyordu (inceleme S5/S11). Artik
 * secim panelin gosterdigi seydir; secilmeyen canli kopyanin sonucu yayindan ONCE soylenir.
 *
 * Bu yuzden:
 *  - makale sayfasi yazinin yayinda oldugu aktif hedefleri onsecer; musteri birini
 *    kaldirirsa o kopyanin eski metinle kalacagi ve RanksUp'in onu isaretleyecegi soylenir
 *    (leftOutLiveCopies, publishSelectionWarnings, leftOutLiveConfirm);
 *  - icerik tablosu bos listeyi YALNIZ yazi sitede yayindaysa gonderir: canli kopyalar
 *    yerinde guncellenir, varsayilan sonradan degistiyse ikinci kopya acilmaz (R10/R17).
 *    Sitede yayinda degilse varsayilan hedefi acikca gonderir (11. turdan onceki gibi).
 *    Yalniz Markdown ZIP disa aktarimi olan yazi sitede yayinda SAYILMAZ: bos liste onu
 *    yeniden disa aktarip varsayilan hedefe hic yazmiyordu (inceleme S25).
 */
import { OVERWRITE_TARGET_TYPES, UPDATE_TARGET_TYPES } from './manual-update';

/** Sitenin yayin hedefi satiri (GET /sites/:siteId/publish-targets) — kullanilan alanlar */
export interface PublishTargetLike {
  id: string;
  name?: string | null;
  type?: string | null;
  isDefault?: boolean | null;
  isActive?: boolean | null;
}

/** publishedTo'daki canli kayit — secim icin okunan alanlar */
export interface LivePublishedEntry {
  targetId: string;
  targetType?: unknown;
  [key: string]: unknown;
}

const doluMetin = (v: unknown): v is string => typeof v === 'string' && v.trim() !== '';
/** api republish-policy.ts entryTrashed ile ayni olcut: bos olmayan dize (bosluk da dolu sayilir) */
const damgali = (v: unknown): boolean => typeof v === 'string' && v !== '';

/**
 * Kayit yayinda mi — api republish-policy.ts liveEntries ile ayni kural: nesne, hedef
 * kimligi dolu, ok:false degil ve kopya emekli degil. Emekli kopya (sozlesme C3 / D3):
 *  - trashedAt: yazi WordPress cop kutusunda bulundu;
 *  - missingAt: yazi hedefte artik yok (404/410) ve yeniden olusturulmadi.
 * Ikisini de yayinci canli saymaz; panel de "yayinda" diye secmez, adresini baglanti yapmaz.
 */
export function isLivePublishedEntry(entry: unknown): entry is LivePublishedEntry {
  if (!entry || typeof entry !== 'object') return false;
  const e = entry as Record<string, unknown>;
  const emekli = damgali(e.trashedAt) || damgali(e.missingAt);
  return typeof e.targetId === 'string' && e.targetId !== '' && e.ok !== false && !emekli;
}

/** Canli siteye dokunmayan disa aktarim (Markdown ZIP) — api republish-policy.ts EXPORT_TARGET_TYPES */
const EXPORT_TARGET_TYPES: ReadonlySet<string> = new Set(['MARKDOWN_ZIP']);
const disaAktarimTipi = (type: unknown) => typeof type === 'string' && EXPORT_TARGET_TYPES.has(type);
const disaAktarim = (t: PublishTargetLike) => disaAktarimTipi(t.type);
/** Hedef yaziyi yerinde gunceller / ayni yola yazar (yalniz yeni kayit acan degil) */
const yerindeYazar = (t: PublishTargetLike) => typeof t.type === 'string' && (UPDATE_TARGET_TYPES.has(t.type) || OVERWRITE_TARGET_TYPES.has(t.type));

/** Yazinin canli kayitlari (gecersiz girdi bos liste) */
export function livePublishedEntries(publishedTo: unknown): LivePublishedEntry[] {
  return Array.isArray(publishedTo) ? publishedTo.filter(isLivePublishedEntry) : [];
}

/**
 * Yazinin SITEDE yayinda oldugu kayitlar: canli ve disa aktarim degil. Tip hedef
 * satirindan; hedef silinmisse (ya da tipi yoksa) kaydin targetType'indan.
 */
export function liveSiteEntries(publishedTo: unknown, targets: readonly PublishTargetLike[]): LivePublishedEntry[] {
  const byId = new Map(targets.map((t) => [t.id, t]));
  return livePublishedEntries(publishedTo).filter((e) => !disaAktarimTipi(byId.get(e.targetId)?.type ?? e.targetType));
}

/** Hedef tipinin kullaniciya gosterilen adi — api republish-policy.ts TARGET_LABELS ile ayni */
const TARGET_TYPE_LABELS: Record<string, string> = {
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

export function targetTypeLabel(type: unknown): string {
  const t = typeof type === 'string' ? type : '';
  return TARGET_TYPE_LABELS[t] ?? (t || 'Yayın hedefi');
}

/**
 * Sonuc / kayit satirinin hedef adi: hedef listesindeki ad, yoksa tipin Turkce adi.
 * Eskiden tablo yalniz varsayilan hedefin adini biliyor, digerlerinde ham tip
 * (WORDPRESS_REST) ya da kimlik gosteriyordu.
 */
export function targetDisplayName(
  targets: readonly PublishTargetLike[],
  targetId: string | null | undefined,
  fallbackType?: unknown,
): string {
  const t = targetId ? targets.find((x) => x.id === targetId) : undefined;
  if (t && doluMetin(t.name)) return t.name.trim();
  return targetTypeLabel(t?.type ?? fallbackType);
}

/** Yazinin canli kaydi olan AKTIF hedefler (hedef listesi sirasiyla) */
function canliAktifHedefler(publishedTo: unknown, targets: readonly PublishTargetLike[]): PublishTargetLike[] {
  const liveIds = new Set(livePublishedEntries(publishedTo).map((e) => e.targetId));
  return targets.filter((t) => liveIds.has(t.id) && t.isActive === true);
}

/** Etkin varsayilan hedefler (normalde tek) */
function etkinVarsayilanlar(targets: readonly PublishTargetLike[]): PublishTargetLike[] {
  return targets.filter((t) => t.isDefault === true && t.isActive === true);
}

/**
 * Makale sayfasinda onceden secili hedefler — API'nin BOS listedeki kuraliyla ayni (tablo
 * yayindaki yazida bos liste gonderir; iki yol ayni hedeflere yazsin):
 *  - yazi sitede yayindaysa: yazinin yayinda oldugu AKTIF hedefler (varsayilan degil).
 *    Hepsi pasif ya da silinmisse bos: kullanici bilerek secer (ipuclari
 *    publishSelectionWarnings'te).
 *  - sitede yayinda degilse (hic yayinlanmamis ya da yalniz Markdown ZIP disa aktarimi
 *    var): varsayilan + aktif hedef. Pasif varsayilan SECILMEZ: dugmesi devre disi oldugu
 *    icin kullanici kaldiramaz, istek yine de onu gonderirdi.
 */
export function initialPublishSelection(publishedTo: unknown, targets: readonly PublishTargetLike[]): string[] {
  if (liveSiteEntries(publishedTo, targets).length > 0) return canliAktifHedefler(publishedTo, targets).map((t) => t.id);
  return etkinVarsayilanlar(targets).map((t) => t.id);
}

export type TablePublishPlan =
  /**
   * targetIds: yazi sitede yayindaysa BOS (API yazinin yayinda oldugu aktif hedefleri
   * secer; tablonun elindeki liste eski olsa da kopya acilmaz), degilse etkin varsayilan
   * hedef(ler) — acik liste API'de aynen uygulanir (D1).
   */
  | { kind: 'publish'; targetIds: string[]; live: boolean; targetNames: string[] }
  /** Yazi sitede yayinda degil ve etkin varsayilan hedef yok: istek atmanin anlami yok */
  | { kind: 'no_target'; message: string };

export function tablePublishPlan(publishedTo: unknown, targets: readonly PublishTargetLike[]): TablePublishPlan {
  if (liveSiteEntries(publishedTo, targets).length > 0) {
    const names = canliAktifHedefler(publishedTo, targets).map((t) => targetDisplayName(targets, t.id));
    return { kind: 'publish', targetIds: [], live: true, targetNames: names };
  }
  const defaults = etkinVarsayilanlar(targets);
  if (defaults.length === 0) {
    return { kind: 'no_target', message: 'Etkin bir varsayılan yayın hedefi yok. Yayın Hedefleri’nden bir hedef ekle ya da varsayılan yap.' };
  }
  return { kind: 'publish', targetIds: defaults.map((t) => t.id), live: false, targetNames: defaults.map((t) => targetDisplayName(targets, t.id)) };
}

/** Tablonun "kuyruga alindi" bildiriminin aciklamasi */
export function tablePublishDescription(plan: Extract<TablePublishPlan, { kind: 'publish' }>): string {
  const adlar = plan.targetNames.join(', ');
  if (plan.live) {
    return adlar
      ? `Yazı yayında olduğu hedefte güncelleniyor: ${adlar}. Sonucu burada göstereceğiz.`
      : 'Yazının yayında olduğu hedef pasif ya da silinmiş görünüyor; başka bir hedefte kopya açılmaz. Sonucu burada göstereceğiz.';
  }
  return `${adlar} hedefine gönderiliyor; sonucu burada göstereceğiz.`;
}

/** "X hedefinde" / "X, Y hedeflerinde" */
function hedefte(names: string[]): string {
  return names.length === 1 ? `${names[0]} hedefinde` : `${names.join(', ')} hedeflerinde`;
}

// ─────────────────────────────────────────────────────────────────────────
//  SECILMEYEN CANLI KOPYA (D1)
// ─────────────────────────────────────────────────────────────────────────

/**
 * Metni canliya ciktiktan sonra degismis sayilan durumlar — api publisher.service.ts
 * REWRITTEN_SINCE_LIVE_STATUSES (spec kaynak metinle karsilastirir). Izsiz eski kayitta
 * (contentHash yok) API "kopyanin metni eski mi" sorusunu bununla cevaplar.
 */
export const REWRITTEN_SINCE_LIVE_STATUSES: ReadonlySet<string> = new Set(['READY_TO_PUBLISH', 'REVIZE_NEEDED']);

/**
 * Yazinin icerik izi — api articles/republish-policy.ts articleContentHash ile AYNI kural:
 * SHA-256(JSON.stringify([baslik, meta baslik, meta aciklama, govde])), metin olmayan alan
 * bos dize, sonuc kucuk harfli onaltilik (spec iki fonksiyonu ayni girdilerle karsilastirir).
 * Panel bunu kaydin contentHash'iyle (hedefe en son giden metnin izi) karsilastirip
 * "secilmeyen kopya eski metinle mi kalir" sorusunu KESIN cevaplar; ayni metni gosteren
 * kopya icin bos yere "eski metin kalir" denmez.
 * Web Crypto: crypto.subtle yalniz guvenli baglamda (HTTPS, localhost) tanimli ve
 * TextEncoder her zaman UTF-8 uretir; Node'un createHash().update(metin) varsayilani da
 * UTF-8 (kaynaklar, 2026-10-18'de okundu: W3C Web Cryptography API IDL "[SecureContext]
 * readonly attribute SubtleCrypto subtle", MDN SubtleCrypto/digest "available only in
 * secure contexts (HTTPS)"; WHATWG Encoding "A TextEncoder object ... only supports
 * UTF-8", Node crypto hash.update "If encoding is not provided, and the data is a string,
 * an encoding of 'utf8' is enforced"). Iz hesaplanamazsa null: cevap "bilinmiyor".
 */
export async function articleContentHash(a: {
  title?: unknown;
  metaTitle?: unknown;
  metaDescription?: unknown;
  bodyMd?: unknown;
}): Promise<string | null> {
  const text = (v: unknown) => (typeof v === 'string' ? v : '');
  const subtle = (globalThis as { crypto?: { subtle?: SubtleCrypto } }).crypto?.subtle;
  if (!subtle) return null;
  try {
    const data = new TextEncoder().encode(JSON.stringify([text(a.title), text(a.metaTitle), text(a.metaDescription), text(a.bodyMd)]));
    const digest = await subtle.digest('SHA-256', data);
    return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
  } catch {
    return null;
  }
}

/** Secilmeyen canli kopyanin metni guncel metinden eski mi */
export type LiveCopyStaleness = 'yes' | 'no' | 'unknown';

/**
 * api republish-policy.ts liveCopyStale ile ayni kural (spec ayni girdilerle karsilastirir;
 * yayinci secilmeyen kopyayi bununla isaretler ve 'live_target_not_selected' metnini
 * secer): kayitta contentHash varsa yazinin guncel izi ile; yoksa (eski kayit) yazinin
 * durumu READY_TO_PUBLISH / REVIZE_NEEDED ise ya da kayit zaten "elle guncelleme
 * bekliyor" ise metin eski sayilir. Guncel iz henuz hesaplanmadiysa ya da eski kayitta bu
 * isaretlerden hicbiri yoksa 'unknown': API o kopyayi isaretlemez, panel de "eski metin
 * kalir" ya da "ayni metin" demez (izsiz kayitta hangisinin dogru oldugu bilinmiyor).
 */
export function liveCopyStaleness(
  entry: unknown,
  opts: { contentHash?: string | null; articleStatus?: string | null },
): LiveCopyStaleness {
  const e = entry && typeof entry === 'object' ? (entry as Record<string, unknown>) : {};
  if (typeof e.contentHash === 'string' && e.contentHash !== '') {
    if (!opts.contentHash) return 'unknown';
    return e.contentHash === opts.contentHash ? 'no' : 'yes';
  }
  return REWRITTEN_SINCE_LIVE_STATUSES.has(String(opts.articleStatus ?? '')) || e.manualUpdatePending === true ? 'yes' : 'unknown';
}

export interface LeftOutLiveCopy {
  targetId: string;
  name: string;
  stale: LiveCopyStaleness;
}

/**
 * Secimin disarida biraktigi canli kopyalar: yazi o AKTIF hedefte sitede yayinda (disa
 * aktarim degil) ama hedef secili degil. D1: API oraya yazmaz. Pasif hedef burada yok:
 * secilemez, ipucu ayrica ("hedef pasif").
 */
export function leftOutLiveCopies(
  selected: Iterable<string>,
  publishedTo: unknown,
  targets: readonly PublishTargetLike[],
  opts: { contentHash?: string | null; articleStatus?: string | null } = {},
): LeftOutLiveCopy[] {
  const sel = new Set(selected);
  const entries = liveSiteEntries(publishedTo, targets);
  const out: LeftOutLiveCopy[] = [];
  for (const t of targets) {
    if (sel.has(t.id) || t.isActive !== true || disaAktarim(t)) continue;
    const entry = entries.find((e) => e.targetId === t.id);
    if (!entry) continue;
    out.push({ targetId: t.id, name: targetDisplayName(targets, t.id), stale: liveCopyStaleness(entry, opts) });
  }
  return out;
}

/**
 * Secilmeyen ve metni eski kalacak canli kopyalar icin yayindan once onay penceresi.
 * Ayni metni gosteren kopya ('no') ve metni bilinmeyen kopya ('unknown') icin sorulmaz:
 * ilkinde degisen bir sey yok, ikincisinde API isaretlemez — uyari satiri yeterli.
 */
export function leftOutLiveConfirm(copies: readonly LeftOutLiveCopy[]): { title: string; description: string; confirmLabel: string } | null {
  const eski = copies.filter((c) => c.stale === 'yes').map((c) => c.name);
  if (eski.length === 0) return null;
  const tek = eski.length === 1;
  return {
    title: tek ? 'Yayındaki bir kopya güncellenmeyecek' : 'Yayındaki kopyalar güncellenmeyecek',
    description:
      `Yazı ${hedefte(eski)} yayında ama ${tek ? 'bu hedef' : 'bu hedefler'} seçili değil. `
      + `Bu yayın oraya yazmaz: ${tek ? 'oradaki kopya' : 'oradaki kopyalar'} eski metinle kalır ve RanksUp ${tek ? 'onu' : 'onları'} Yayın Geçmişi’nde “Eski sürüm yayında” diye işaretler. `
      + 'Yeni metnin orada da yayınlanmasını istiyorsan vazgeç ve hedefi seçili bırak.',
    confirmLabel: 'Yalnız seçili hedeflere yayınla',
  };
}

/**
 * Hedefteki emekli kayit (sozlesme C3 / D3): 'trashed' (WordPress cop kutusunda),
 * 'missing' (hedefte artik yok, yeniden olusturulmadi) ya da null. Yayinci bu kayitlari
 * hedefe yazarken yine bulur; panel secimin sonucunu bununla soyler.
 */
function emekliKayit(publishedTo: unknown, targetId: string): 'trashed' | 'missing' | null {
  if (!Array.isArray(publishedTo)) return null;
  let sonuc: 'trashed' | 'missing' | null = null;
  for (const raw of publishedTo) {
    if (!raw || typeof raw !== 'object') continue;
    const e = raw as Record<string, unknown>;
    if (e.targetId !== targetId || e.ok === false) continue;
    if (damgali(e.trashedAt)) return 'trashed';
    if (damgali(e.missingAt)) sonuc = 'missing';
  }
  return sonuc;
}

/**
 * Makale sayfasinda secimin sonucu — yayindan ONCE gosterilen uyarilar:
 *  - secili hedefteki kopya cop kutusunda GORULMUSTU (trashedAt, ilk goruldugu an):
 *    yayinci kaydi yine yerinde guncelleme yolundan dener (publishedEntryFor +
 *    decideRepublish 'update'). Yazi hala cop kutusundaysa yazmaz ('live_entry_trashed');
 *    WordPress cop kutusunu bosalttiysa ya da yazi kalici silindiyse 404 gorur ve
 *    kullanicinin ACIKCA sectigi hedefte yaziyi yeniden olusturur (D2, 'recreated').
 *    NEDEN iki ihtimal birden: eski metin "bu yayin oraya yazmaz" diyordu; WordPress cop
 *    kutusunu varsayilan olarak 30 gunde bosaltir (EMPTY_TRASH_DAYS — kaynaklar,
 *    2026-10-18: developer.wordpress.org "Editing wp-config.php" > Empty Trash "The
 *    default is 30 days"; wp-includes/default-constants.php define('EMPTY_TRASH_DAYS',
 *    30)). Sonra yapilan yayin yaziyi yeniden aciyordu, uyari tersini soyluyordu (S11
 *    yan etkisi). Panel cop kutusunun simdiki halini bilemez: ikisini de soyler.
 *  - secili hedefteki kopya artik bulunamiyor (missingAt): kullanicinin acikca sectigi
 *    hedefte yayin yaziyi yeniden olusturur (D2)
 * Yalniz yazi SITEDE yayindaysa (yalniz Markdown ZIP disa aktarimi olan yazi icin
 * "kopya" uyarisi yok):
 *  - secili hedefte hic kayit yok: yeni bir yazi acilir (ayni siteye bagliysa kopya);
 *    Markdown ZIP disa aktarimdir, sayilmaz
 *  - aktif canli hedef secili degil (D1): bu yayin oraya yazmaz. Metni eskiyse kopya eski
 *    metinle kalir ve RanksUp onu isaretler; metni bilinmiyorsa yalniz "guncellenmez"
 *    denir; ayni metni gosteriyorsa uyari yok (degisen bir sey yok)
 *  - canli kopyanin hedefi pasif: RanksUp pasif hedefe yazmaz; yerinde yazan tipte
 *    etkinlestirilirse orada guncellenir
 *  - canli kopyanin hedefi silinmis (hedef listesi okunabildiyse): oraya artik yazilamaz
 * targetsKnown false (hedef listesi okunamadi): "silinmis" denmez.
 */
export function publishSelectionWarnings(
  selected: Iterable<string>,
  publishedTo: unknown,
  targets: readonly PublishTargetLike[],
  opts: { targetsKnown: boolean; contentHash?: string | null; articleStatus?: string | null },
): string[] {
  const sel = new Set(selected);
  const byId = new Map(targets.map((t) => [t.id, t]));
  const liveIds = new Set(livePublishedEntries(publishedTo).map((e) => e.targetId));
  const ad = (t: PublishTargetLike) => targetDisplayName(targets, t.id);
  const out: string[] = [];

  const seciliKayitsiz = targets.filter((t) => sel.has(t.id) && !liveIds.has(t.id) && !disaAktarim(t));
  const copte = seciliKayitsiz.filter((t) => emekliKayit(publishedTo, t.id) === 'trashed');
  if (copte.length > 0) {
    out.push(
      `Yazı ${hedefte(copte.map(ad))} çöp kutusunda görülmüştü. Hâlâ oradaysa bu yayın oraya yazmaz (RanksUp kaldırılan yazıyı geri getirmez); yazıyı orada yeniden görmek istiyorsan önce çöp kutusundan geri yükle. `
      + 'Çöp kutusu boşaltıldıysa (WordPress bunu varsayılan olarak 30 gün sonra yapar) ya da yazı kalıcı olarak silindiyse bu yayın yazıyı orada yeniden oluşturur.',
    );
  }
  const kayip = seciliKayitsiz.filter((t) => emekliKayit(publishedTo, t.id) === 'missing');
  if (kayip.length > 0) {
    out.push(`Yazı ${hedefte(kayip.map(ad))} artık bulunamıyor (silinmiş olabilir); bu yayın yazıyı orada yeniden oluşturur.`);
  }

  const live = liveSiteEntries(publishedTo, targets);
  if (live.length === 0) return out;
  const siteLiveIds = new Set(live.map((e) => e.targetId));

  const yeni = seciliKayitsiz.filter((t) => emekliKayit(publishedTo, t.id) === null);
  if (yeni.length > 0) {
    out.push(`Yazı ${hedefte(yeni.map(ad))} henüz yok; bu yayın orada yeni bir yazı açar. Hedef aynı siteye bağlıysa sitende aynı içerik iki kez yayında olur.`);
  }
  const disarida = leftOutLiveCopies(sel, publishedTo, targets, opts);
  const eski = disarida.filter((c) => c.stale === 'yes').map((c) => c.name);
  if (eski.length > 0) {
    const tek = eski.length === 1;
    out.push(`Yazı ${hedefte(eski)} yayında ama ${tek ? 'bu hedef' : 'bu hedefler'} seçili değil: bu yayın oraya yazmaz. ${tek ? 'Oradaki kopya' : 'Oradaki kopyalar'} eski metinle kalır; RanksUp ${tek ? 'onu' : 'onları'} Yayın Geçmişi’nde “Eski sürüm yayında” diye işaretler.`);
  }
  const bilinmeyen = disarida.filter((c) => c.stale === 'unknown').map((c) => c.name);
  if (bilinmeyen.length > 0) {
    const tek = bilinmeyen.length === 1;
    out.push(`Yazı ${hedefte(bilinmeyen)} yayında ama ${tek ? 'bu hedef' : 'bu hedefler'} seçili değil: bu yayın oraya yazmaz, ${tek ? 'oradaki kopya' : 'oradaki kopyalar'} güncellenmez.`);
  }
  const pasif = targets.filter((t) => siteLiveIds.has(t.id) && t.isActive !== true && !disaAktarim(t));
  if (pasif.length > 0) {
    const etkinlestir = pasif.every(yerindeYazar)
      ? ' Hedefi Yayın Hedefleri’nden etkinleştirip yeniden yayınlarsan yazı orada güncellenir.'
      : '';
    out.push(`Yazı ${hedefte(pasif.map(ad))} yayında ama hedef pasif; RanksUp pasif hedefe yazmaz.${etkinlestir}`);
  }
  if (opts.targetsKnown) {
    const silinmis = new Set(live.filter((e) => !byId.has(e.targetId)).map((e) => e.targetId));
    if (silinmis.size > 0) {
      out.push(silinmis.size === 1
        ? 'Yazının yayında olduğu bir yayın hedefi silinmiş; RanksUp oradaki kopyaya artık yazamaz.'
        : `Yazının yayında olduğu ${silinmis.size} yayın hedefi silinmiş; RanksUp oradaki kopyalara artık yazamaz.`);
    }
  }
  return out;
}
