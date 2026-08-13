/**
 * LLM metin hijyeni + Turkce-guvenli eslesme normalizasyonu.
 *
 * IKI AYRI SEVIYE VAR, karistirilmamali:
 *
 *   normalizeText() — GORUNUM korunur (buyuk/kucuk harf, Turkce harfler aynen
 *     kalir). Yalnizca gorunmez/sifir-genislikli karakterler ve uyumluluk
 *     formlari temizlenir. Kullaniciya gosterilecek veya insan gozuyle
 *     okunacak metinlerde bunu kullan.
 *
 *   foldForMatch() — ESLESME icin agresif katlama: ustelik I/İ/ı ayrimini de
 *     kaldirir. SADECE "bu marka adi metinde geciyor mu?" tipi karsilastirmada
 *     kullan; kullaniciya gosterme.
 *
 * NEDEN VAR — canli hata: JavaScript'te `"İ".toLowerCase()` iki kod noktasi
 * uretir (`i` + U+0307 birlesik nokta). Marka adi kucultulup regex'e konunca
 * olusan desen, orijinal metindeki `İ` ile `i` bayragina ragmen ESLESMEZ.
 * Sonuc: İ ile baslayan her Turkce marka (İSG Etkinlikleri, İddaa.com, İs
 * Bankasi...) AI cevabinda acikca anilsa bile "anilmadi" olarak olculuyordu.
 */

/**
 * Gorunmez / sifir-genislikli / yon kontrol karakterleri.
 * LLM ciktilarinda ve kopyala-yapistir metinlerde sessizce tasinir; karakter
 * limiti sayimini bozar ve kelime eslesmesini kirar.
 *
 * U+200D (ZWJ) BILEREK DISARIDA: emoji dizilerini birlestiren karakter odur
 * (aile emojisi, meslek emojileri). Silinirse sosyal post ve ASO metnindeki
 * emoji tek tek insanlara dagilir. Sorunu yaratanlar U+200B/U+FEFF/U+00AD ve
 * yon kontrol karakterleri; ZWJ'ye dokunmaya gerek yok.
 */
const INVISIBLE_RE =
  /[\u00AD\u200B\u200C\u200E\u200F\u202A-\u202E\u2060-\u2064\u206A-\u206F\uFEFF]|[\u{E0000}-\u{E007F}]/gu;

/** Kirilmaz bosluk (U+00A0) ve dar/ince bosluk varyantlari. */
const ODD_SPACE_RE = /[\u00A0\u2007\u202F\u2009\u200A]/g;

/** Gorunmez karakterleri sil (buyuk/kucuk harf ve dil karakterlerine dokunmaz). */
export function stripInvisible(s: string): string {
  return String(s ?? '').replace(INVISIBLE_RE, '');
}

/**
 * Gorunum koruyan normalizasyon: NFKC + gorunmez karakter temizligi +
 * sira disi bosluklar → normal bosluk.
 */
export function normalizeText(s: string): string {
  return stripInvisible(String(s ?? '').normalize('NFKC')).replace(ODD_SPACE_RE, ' ');
}

/**
 * Eslesme icin katlama. normalizeText uzerine:
 *   I / İ / ı → i   (Turkce noktali-noktasiz ayrimi tamamen kaldirilir)
 *   toLowerCase()
 *   artakalan U+0307 birlesik noktasi silinir
 *
 * ONEMLI: İ→i donusumu toLowerCase()'DEN ONCE yapilir; boylece JS'in
 * `İ → i + U+0307` genislemesi hic olusmaz ve sonuc `normalizeText(s)` ile
 * AYNI UZUNLUKTA kalir. Bu, katlanmis metinde bulunan indeksin normalize
 * metinde de gecerli olmasini saglar (bkz. sameLength).
 */
export function foldForMatch(s: string): string {
  return normalizeText(s)
    .replace(/[İıI]/g, 'i')
    .toLowerCase()
    .replace(/\u0307/g, '');
}

/**
 * foldForMatch cikti uzunlugunu koruyor mu? Neredeyse her zaman evet; teoride
 * bir dil ozel-durumu uzunlugu degistirebilir. Indeks tabanli slice yapmadan
 * once bunu kontrol et.
 */
export function sameLength(a: string, b: string): boolean {
  return a.length === b.length;
}

/** Regex icinde literal kullanim icin kacis. */
export function escapeRegex(s: string): string {
  return String(s ?? '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
