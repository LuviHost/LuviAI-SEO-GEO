import { sanitizeErrorText } from './transport.js';

/**
 * Yayindaki WordPress yazisinin adreslenmesi — yerinde guncelleme (update) icin.
 *
 * NEDEN AYRI DOSYA: REST ve XML-RPC adaptorleri ayni kurali kullanir; API
 * tarafindaki karar da (takili sayfa plani, yayinci) "bu kayit guncellenebilir
 * mi" sorusunu ayni fonksiyonla yanitlar — adaptorun gercekten bulabildigi
 * kayit ile planin "guncellenebilir" dedigi kayit ayrismasin.
 */

/** Pozitif, guvenli tamsayi kimlik (WordPress yazi kimligi) ya da null */
function positiveId(raw: unknown): number | null {
  const text = typeof raw === 'number' ? String(raw) : typeof raw === 'string' ? raw.trim() : '';
  if (!/^\d{1,15}$/.test(text)) return null;
  const n = Number(text);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

/**
 * Yazi kimligi: once kayitli externalId (iki WordPress adaptoru de yayinda
 * yazi kimligini doner: REST `String(data.id)`, XML-RPC metaWeblog.newPost'un
 * dondurdugu kimlik), yoksa adresteki `?p=<kimlik>` (XML-RPC yayininin
 * kaydettigi adres ve taslak yazinin onizleme baglantisi bu bicimde).
 * Bulunamazsa null — cagiran adresteki slug'a duser ya da hic guncellemez.
 */
export function wordPressPostId(ref: { externalId?: unknown; externalUrl?: unknown } | null | undefined): number | null {
  if (!ref) return null;
  const fromId = positiveId(ref.externalId);
  if (fromId !== null) return fromId;
  if (typeof ref.externalUrl !== 'string' || !ref.externalUrl) return null;
  try {
    return positiveId(new URL(ref.externalUrl).searchParams.get('p'));
  } catch {
    return null;
  }
}

/**
 * Adresin son yol parcasi (WordPress kalici baglantisinda yazinin slug'i).
 * Kok adres, `?p=` bicimi ya da cozulemeyen adres → null. ON SAYFA'YA
 * DUSULMEZ: bos slug'i ana sayfa sayan cozum (applyOnPageMeta) guncellemede
 * musterinin ana sayfasinin icerigini ezerdi.
 */
export function wordPressUrlSlug(url: unknown): string | null {
  if (typeof url !== 'string' || !url) return null;
  let path: string;
  try {
    path = new URL(url).pathname;
  } catch {
    return null;
  }
  const seg = path.split('/').filter(Boolean).pop();
  if (!seg) return null;
  let slug = seg;
  try { slug = decodeURIComponent(seg); } catch { /* bozuk kacis — oldugu gibi */ }
  slug = slug.trim();
  return slug && slug !== 'index.php' ? slug : null;
}

/** Yayindaki kayit guncelleme icin bulunabilir mi (kimlik, ?p= ya da adreste slug) */
export function wordPressEntryAddressable(ref: { externalId?: unknown; externalUrl?: unknown } | null | undefined): boolean {
  return wordPressPostId(ref) !== null || wordPressUrlSlug(ref?.externalUrl) !== null;
}

// ─────────────────────────────────────────────────────────────────────────
//  YERINDE GUNCELLEMEDEN ONCE IKI DENETIM (REST ve XML-RPC ayni kural)
//
//  1. Kimlik: kayitli yazi kimligi HALA bu yaziya mi ait? Site tasima, yedekten
//     donus ya da hedefin baska bir WordPress'e baglanmasi kimlikleri kaydirir;
//     kimlige guvenip yazmak ilgisiz bir yazinin uzerine yazmakti.
//  2. Cakisma: yazi RanksUp'in son yaziminden sonra WordPress'te degisti mi?
//     Degistiyse musterinin duzenlemesi ezilmez (yalniz acik onayla yazilir).
// ─────────────────────────────────────────────────────────────────────────

/**
 * WordPress'in GMT tarih damgasi → ISO 8601 (UTC). Cozulemezse null.
 *
 * Iki bicim:
 *  - REST `modified_gmt`: "2026-09-14T10:00:00" — saat dilimi YAZILMAZ, deger
 *    GMT'dir. Kaynak 1: developer.wordpress.org/rest-api/reference/posts/
 *    ("modified_gmt: The date the post was last modified, as GMT."). Kaynak 2:
 *    wordpress-develop class-wp-rest-posts-controller.php prepare_item_for_response
 *    → prepare_date_response() → mysql_to_rfc3339() = mysql2date( 'Y-m-d\TH:i:s', ... )
 *    (developer.wordpress.org/reference/functions/mysql_to_rfc3339/: "Date
 *    formatted for ISO8601 without time zone."). JS Date.parse saat dilimsiz
 *    tarih-saati YEREL saat sayar; bu yuzden 'Z' eklenir.
 *  - XML-RPC `post_modified_gmt`: <dateTime.iso8601>20260914T10:00:00</dateTime.iso8601>
 *    — class-wp-xmlrpc-server.php _convert_date(): new IXR_Date( mysql2date(
 *    'Ymd\TH:i:s', ... ) ); IXR_Date::getIso() yil+ay+gun 'T' saat:dakika:saniye.
 *    Sifir tarih "00000000T00:00:00Z" → null.
 */
export function wordPressGmtToIso(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const s = raw.trim();
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(Z|[+-]\d{2}:?\d{2})?$/);
  if (!m) {
    const b = s.match(/^(\d{4})(\d{2})(\d{2})T(\d{2}):?(\d{2}):?(\d{2})(Z|[+-]\d{2}:?\d{2})?$/);
    if (!b) return null;
    m = b;
  }
  const [, y, mo, d, h, mi, sec, zone] = m;
  if (y === '0000') return null;
  const offset = !zone || zone === 'Z' ? 'Z' : zone.includes(':') ? zone : `${zone.slice(0, 3)}:${zone.slice(3)}`;
  const t = Date.parse(`${y}-${mo}-${d}T${h}:${mi}:${sec}${offset}`);
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
}

/** Turkce harfler: WordPress remove_accents() bunlari ASCII'ye cevirir (formatting.php: 'ı' => 'i', 'ş' => 's', ...) */
const TR_ASCII: Record<string, string> = { ı: 'i', İ: 'i', I: 'i', ş: 's', Ş: 's', ğ: 'g', Ğ: 'g', ç: 'c', Ç: 'c', ö: 'o', Ö: 'o', ü: 'u', Ü: 'u' };

/**
 * Slug karsilastirma bicimi: URL kodlamasi cozulur, Turkce harfler ve diger
 * aksanlar ASCII'ye indirilir, kucuk harf. NEDEN: WordPress kayitta slug'i
 * sanitize_title() ile yazar; o da 'save' baglaminda remove_accents() calistirir
 * (developer.wordpress.org/reference/functions/sanitize_title/: "When set to
 * 'save', the string runs through remove_accents()"; kaynak formatting.php).
 * RanksUp'in "kdv-beyanı" slug'i WordPress'te "kdv-beyani" olur — ayni yazidir.
 */
export function normalizeWordPressSlug(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  let s = raw.trim();
  try { s = decodeURIComponent(s); } catch { /* bozuk kacis — oldugu gibi */ }
  s = s.replace(/[ıİIşŞğĞçÇöÖüÜ]/g, (c) => TR_ASCII[c] ?? c);
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

/**
 * Hedefteki slug beklenenlerden biriyle ayni yazi mi?
 *  - "__trashed" eki: cop kutusuna atilan yazinin slug'ina eklenir (post.php
 *    wp_add_trashed_suffix_to_post_name_for_post: "_truncate_post_slug(
 *    $post->post_name, 191 ) . '__trashed'"; developer.wordpress.org/reference/
 *    functions/wp_add_trashed_suffix_to_post_name_for_post/).
 *  - "-2", "-3"...: ayni slug baska yazidaysa yayinlanirken eklenir
 *    (wp_unique_post_slug: "... . "-$suffix""; developer.wordpress.org/
 *    reference/functions/wp_unique_post_slug/ "with a -1, -2, etc. suffix").
 *    Taslak slug'i ek almaz (ayni fonksiyon draft/pending/auto-draft'ta erken doner);
 *    musteri taslagi yayina aldiginda ek alabilir. Ek 1-999 araliginda kabul
 *    edilir: "kdv-rehberi-2026" gibi yil tasiyan BASKA bir yazi ek sayilmasin.
 * Bos slug hicbir seyle eslesmez (kimlik dogrulanamaz).
 */
export function wordPressSlugMatches(remote: unknown, expected: ReadonlyArray<unknown>): boolean {
  let r = normalizeWordPressSlug(remote);
  if (r.endsWith('__trashed')) r = r.slice(0, -'__trashed'.length);
  if (!r) return false;
  return expected.some((e) => {
    const x = normalizeWordPressSlug(e);
    if (!x) return false;
    if (r === x) return true;
    return r.startsWith(`${x}-`) && /^[1-9]\d{0,2}$/.test(r.slice(x.length + 1));
  });
}

/**
 * Kayitli yazinin beklenen slug'lari: kayitli adresin okunur slug'i (kalici
 * baglanti; "?p=123" ya da sayisal "/arsiv/123" bicimi slug degildir) ve
 * yazinin RanksUp'taki slug'i. Ikisinden biri tutarsa ayni yazi sayilir:
 * yeniden yazimda slug degismis eski kayitlar (update slug gondermez) adresle,
 * taslak olarak acilip adresi "?p=" kalan kayitlar yazinin slug'iyla eslesir.
 */
export function expectedWordPressSlugs(ref: { externalUrl?: unknown } | null | undefined, articleSlug: unknown): string[] {
  const out: string[] = [];
  const fromUrl = wordPressUrlSlug(ref?.externalUrl);
  if (fromUrl && !/^\d+$/.test(fromUrl)) out.push(fromUrl);
  if (typeof articleSlug === 'string' && articleSlug.trim() && !out.includes(articleSlug.trim())) out.push(articleSlug.trim());
  return out;
}

/**
 * Saat payi: kayitta WordPress'in kendi damgasi (remoteModifiedAt) yoksa yazinin
 * son degisikligi RanksUp'in KENDI saatindeki son yazim aniyla kiyaslanir. Iki
 * sunucunun saati ayni degildir; WordPress'in saati birkac dakika ilerideyse
 * RanksUp'in kendi yazimi "sonradan duzenlenmis" gorunurdu. Pay kucuk tutuldu:
 * yanlis "duzenlenmis" demek zararsizdir (yazilmaz, musteri onaylayabilir),
 * duzenlemeyi kacirmak musterinin metnini ezer.
 */
export const WP_CLOCK_SKEW_TOLERANCE_MS = 2 * 60_000;

/**
 * Yazi RanksUp'in son yaziminden sonra WordPress'te degisti mi?
 *  - Kayitta remoteModifiedAt varsa (RanksUp'in son basarili yaziminin yanitindaki
 *    modified_gmt — ayni saat): saniyesi farkliysa degismis. Daha ESKI bir damga
 *    (yedekten donus) da degisiklik sayilir: icerik RanksUp'in yazdigi degil.
 *  - Yoksa RanksUp'in son yazim ani (lastWriteAt) + saat payi.
 *  - Ikisi de yoksa ya da WordPress damgasi okunamadiysa: degismis sayilir
 *    (emin olmadan musterinin metninin ustune yazilmaz).
 * Not (bilincli, temkinli): WordPress HER kayitta modified_gmt'yi ilerletir
 * (post.php wp_insert_post: "if ( $update || ... ) { $post_modified_gmt =
 * current_time( 'mysql', true ); }"; developer.wordpress.org/reference/functions/
 * wp_insert_post/). Musterinin RanksUp taslagini hic degistirmeden yayina
 * almasi, RanksUp'in kendi meta / gorsel alt metni yazimi ya da cop kutusundan
 * geri yukleme de "degismis" sayilir; yazi kendiliginden ezilmez, musteri
 * panelden acikca onaylayarak ustune yazdirabilir.
 */
export function wordPressEditedSince(
  remoteModifiedIso: string | null | undefined,
  ref: { remoteModifiedAt?: unknown; lastWriteAt?: unknown } | null | undefined,
): boolean {
  const remote = typeof remoteModifiedIso === 'string' ? Date.parse(remoteModifiedIso) : Number.NaN;
  if (!Number.isFinite(remote)) return true;
  const stored = wordPressGmtToIso(ref?.remoteModifiedAt);
  if (stored) return Math.floor(remote / 1000) !== Math.floor(Date.parse(stored) / 1000);
  const last = typeof ref?.lastWriteAt === 'string' ? Date.parse(ref.lastWriteAt) : Number.NaN;
  if (!Number.isFinite(last)) return true;
  return remote > last + WP_CLOCK_SKEW_TOLERANCE_MS;
}

/** Kullaniciya gosterilen tarih (Turkiye saati): "14.09.2026 13:00"; cozulemezse null */
export function wordPressDateLabel(iso: unknown): string | null {
  const t = typeof iso === 'string' ? Date.parse(iso) : Number.NaN;
  if (!Number.isFinite(t)) return null;
  try {
    return new Intl.DateTimeFormat('tr-TR', {
      timeZone: 'Europe/Istanbul', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
    }).format(new Date(t));
  } catch {
    return new Date(t).toISOString().slice(0, 16).replace('T', ' ');
  }
}

/** Kimlik denetimi sonucu: null = ayni yazi; aksi halde neden (Turkce) ve hedefteki slug */
export interface WordPressIdentityProblem {
  error: string;
  remoteSlug: string;
}

/**
 * Kayitli kimlikteki kayit BU yazi mi? Tur 'post' olmali (yayin yolu yalniz
 * yazi acar: REST POST /wp/v2/posts, XML-RPC metaWeblog.newPost — post_type
 * verilmezse 'post') ve slug beklenenlerden biriyle eslesmeli
 * (wordPressSlugMatches). Beklenen slug yoksa da dogrulanamaz sayilir.
 * Eslesmezse HICBIR SEY yazilmaz ve kopya acilmaz: notFound DEGIL — kayit
 * baska bir yere tasinmis ya da adresi degistirilmis olabilir; yeni yazi
 * acmak ikinci kopya, kimlige yazmak ilgisiz yazinin ezilmesi demekti.
 */
export function wordPressIdentityProblem(input: {
  id: number;
  type?: unknown;
  slug?: unknown;
  ref: { externalUrl?: unknown } | null | undefined;
  articleSlug: unknown;
}): WordPressIdentityProblem | null {
  const remoteSlug = typeof input.slug === 'string' ? input.slug : '';
  const shown = sanitizeErrorText(remoteSlug, 80) || 'boş';
  if (typeof input.type === 'string' && input.type !== '' && input.type !== 'post') {
    return {
      remoteSlug,
      error: `WordPress'teki #${input.id} numaralı kayıt bir yazı değil (tür: ${sanitizeErrorText(input.type, 40)}, adres: ${shown}); bu yazının kaydı olamaz. Başka bir içeriğin üzerine yazmamak için güncellenmedi, kopya da açılmadı.`,
    };
  }
  const expected = expectedWordPressSlugs(input.ref, input.articleSlug);
  if (expected.length === 0) {
    return {
      remoteSlug,
      error: `Bu yazının WordPress'teki adresi bilinmediği için #${input.id} numaralı yazının bu yazı olduğu doğrulanamadı; güncellenmedi, kopya da açılmadı.`,
    };
  }
  if (wordPressSlugMatches(remoteSlug, expected)) return null;
  return {
    remoteSlug,
    error: `WordPress'teki #${input.id} numaralı yazı bu yazıyla eşleşmiyor (o yazının adresi: ${shown}, beklenen: ${expected.map((e) => sanitizeErrorText(e, 80)).join(' ya da ')}). Başka bir yazının üzerine yazmamak için güncellenmedi, kopya da açılmadı.`,
  };
}

/** Cakisma nedeni (Turkce, adaptor duzeyi) */
export function wordPressEditedText(remoteModifiedIso: string | null | undefined): string {
  const when = wordPressDateLabel(remoteModifiedIso);
  return `WordPress yazısı RanksUp'ın son yazımından sonra değiştirilmiş${when ? ` (son değişiklik: ${when})` : ''}; değişikliklerin üzerine yazılmadı.`;
}
