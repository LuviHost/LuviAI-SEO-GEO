/**
 * Sayfa yukleme hatalari — bir COKME degil, tarayicinin elindeki sayfanin eksik ya da bayat
 * oldugu iki durum. Ikisinde de React'in "yeniden dene"si (reset) ise yaramaz; sayfa
 * sunucudan yeniden indirilmelidir. Hata ekranlari (app/error.tsx, app/global-error.tsx)
 * bunu tanir, bir kez sessizce yeniden yukler; olmazsa ne oldugunu soyleyen ekrani gosterir.
 *
 *  - bayat-surum: acik sekme eski HTML'i tutar, o HTML eski JS parcalarini ister; yeni
 *    derleme onlari sildigi icin "ChunkLoadError / Loading chunk N failed" gelir
 *    (01.09.2026: yayin sirasinda gercek kullanicida goruldu).
 *  - yarim-yukleme: sayfanin indirilmesi yarida kesilir (mobil baglantida kopma, yukleme
 *    surerken uygulama degistirme). React eksik veriyi "Connection closed." diye bildirir.
 *    13.11.2026: sahibin telefonunda (LTE) kok hata ekrani cikti, "Yeniden Dene" hicbir
 *    seyi duzeltmedi; govdesi %60'ta kesilen ana sayfayla WebKit'te birebir uretildi.
 */

export type YuklemeHatasi = 'bayat-surum' | 'yarim-yukleme';

// Parca kimligi sayi da olabilir, yol da ("app/page-8ac2"); o yuzden bosluksuz her sey
const BAYAT_SURUM =
  /ChunkLoadError|Loading (?:CSS )?chunk \S+ failed|Importing a module script failed|Failed to fetch dynamically imported module|error loading dynamically imported module/i;

/** React'in mesaji TAM olarak budur; icinde gecen baska hatalar (or. veritabani) sayilmaz */
const YARIM_YUKLEME = /^Connection closed\.?$/i;

export function yuklemeHatasiTuru(
  error: { name?: unknown; message?: unknown } | null | undefined,
): YuklemeHatasi | null {
  const name = typeof error?.name === 'string' ? error.name : '';
  const message = typeof error?.message === 'string' ? error.message : '';
  if (BAYAT_SURUM.test(`${name} ${message}`)) return 'bayat-surum';
  if (YARIM_YUKLEME.test(message.trim())) return 'yarim-yukleme';
  return null;
}

/** Ekranda gosterilecek metin; taninmayan hatada null (ekran kendi genel metnini kullanir) */
export function yuklemeHatasiMetni(
  tur: YuklemeHatasi | null,
): { baslik: string; aciklama: string; dugme: string } | null {
  if (tur === 'bayat-surum') {
    return {
      baslik: 'Yeni sürüm yayınlandı',
      aciklama: 'Bu sekme eski sürümü açık tutuyordu. "Güncel sürüme geç" ile devam edebilirsin; verilerin etkilenmedi.',
      dugme: 'Güncel sürüme geç',
    };
  }
  if (tur === 'yarim-yukleme') {
    return {
      baslik: 'Sayfa tam yüklenemedi',
      aciklama: 'Bağlantı, sayfa yüklenirken kesildi. Sayfayı yeniden yükle; verilerin etkilenmedi.',
      dugme: 'Sayfayı yeniden yükle',
    };
  }
  return null;
}

/** Eski ad korunur: acik sekmelerdeki kayit (zaman damgasi) yeni kuralla da okunur */
export const YENILEME_ANAHTARI = 'luvi_chunk_reloaded';

/**
 * Sessiz yenileme en fazla bu aralikta bir kez yapilir. Yenilenen sayfa da ayni hatayi
 * verirse (baglanti hala kotu) ikinci yenileme YAPILMAZ, ekran gosterilir: sonsuz dongu olmaz.
 */
export const YENILEME_ARALIGI_MS = 60_000;

type Depo = Pick<Storage, 'getItem' | 'setItem'>;

/** Yalniz okur: su an sessiz yenileme yapilabilir mi? */
export function sessizYenilemeHakki(depo: Depo | null | undefined, now: number, online = true): boolean {
  if (!online || !depo) return false;
  try {
    const son = Number(depo.getItem(YENILEME_ANAHTARI));
    return !(Number.isFinite(son) && son > 0 && son <= now && now - son < YENILEME_ARALIGI_MS);
  } catch {
    return false;
  }
}

/** Hak varsa zamani yazar ve true doner; yazamazsa (depo kapali) yenileme yapilmaz */
export function sessizYenilemeyiAl(depo: Depo | null | undefined, now: number, online = true): boolean {
  if (!sessizYenilemeHakki(depo, now, online)) return false;
  try {
    depo!.setItem(YENILEME_ANAHTARI, String(now));
    return true;
  } catch {
    return false;
  }
}

function tarayiciDeposu(): Depo | null {
  try {
    return typeof window === 'undefined' ? null : window.sessionStorage;
  } catch {
    return null; // Safari "tum cerezleri engelle": erisim bile hata firlatir
  }
}

function cevrimici(): boolean {
  return typeof navigator === 'undefined' ? true : navigator.onLine !== false;
}

/** Cizim sirasinda (yan etkisiz): bu hata icin sessiz yenileme yapilacak mi? */
export function sessizYenilemeBekleniyor(error: { name?: unknown; message?: unknown } | null | undefined): boolean {
  if (typeof window === 'undefined' || !yuklemeHatasiTuru(error)) return false;
  return sessizYenilemeHakki(tarayiciDeposu(), Date.now(), cevrimici());
}

/** Efekt icinde: hak varsa isaretler ve sayfayi yeniden yukler. Yuklediyse true. */
export function sessizYenile(error: { name?: unknown; message?: unknown } | null | undefined): boolean {
  if (typeof window === 'undefined' || !yuklemeHatasiTuru(error)) return false;
  if (!sessizYenilemeyiAl(tarayiciDeposu(), Date.now(), cevrimici())) return false;
  window.location.reload();
  return true;
}
