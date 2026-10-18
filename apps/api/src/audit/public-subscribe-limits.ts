/**
 * Anonim 90 gunluk takip aboneligi (POST /public/citation-check/subscribe) —
 * kotuye kullanim sinirlari.
 *
 * NEDEN: uc kimlik dogrulamasiz; eskiden Turnstile, IP limiti ve adres basina
 * sinir yoktu — herkes herhangi bir adrese bizim gondericimizden hos geldin
 * e-postasi tetikleyebiliyordu (gonderici itibari / spam riski).
 *
 * Iki kademe:
 *  - NORMAL: Turnstile dogrulandi (ya da Turnstile hic yapilandirilmamis).
 *  - SIKI: Turnstile yapilandirilmis ama istek token'siz geldi ve kendini
 *    mobil uygulama olarak tanitti. Uygulama Turnstile'i ancak bir WebView ile
 *    calistirabilir (https://developers.cloudflare.com/turnstile/get-started/mobile-implementation/);
 *    o yapilana kadar token'siz kabul edilir AMA daha dar sinirla. User-Agent
 *    taklit edilebildigi icin istisna Turnstile'i atlatmanin odulu degildir.
 *
 * Sayilar urun parametresidir (olculmus bir esik degil): mesru ziyaretci tek
 * alan adi icin bir kez abone olur; yanlis yazilan e-posta icin birkac deneme
 * payi birakilir.
 */

/** Ayni IP'den 24 saatte en fazla kac abonelik denemesi (Turnstile dogrulanmis). */
export const SUBSCRIBE_IP_LIMIT = 5;
/** Token'siz mobil istekte IP basina 24 saatlik deneme siniri. */
export const SUBSCRIBE_IP_LIMIT_STRICT = 2;
/** Ayni adrese 24 saatte en fazla kac onay (hos geldin) e-postasi — tum alan adlari toplami. */
export const SUBSCRIBE_WELCOME_PER_EMAIL = 3;
/** Token'siz mobil istekte adres basina 24 saatlik onay e-postasi siniri. */
export const SUBSCRIBE_WELCOME_PER_EMAIL_STRICT = 1;
/** Abone olunabilmesi icin alan adinin en son kontrol kaydinin en fazla yasi. */
export const SUBSCRIBE_CHECK_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export const SUBSCRIBE_IP_LIMIT_MESSAGE = 'Çok fazla abonelik denemesi yapıldı. Lütfen 24 saat sonra tekrar deneyin.';
export const SUBSCRIBE_EMAIL_LIMIT_MESSAGE =
  'Bu e-posta adresine son 24 saatte çok sayıda onay e-postası gönderildi. Lütfen gelen kutunuzu kontrol edin ya da yarın tekrar deneyin.';

/**
 * Mobil uygulama istemcisi mi — mobile/src/api.ts User-Agent'ina
 * `RanksUp-iOS/<surum>` ekler (Android surumu icin `RanksUp-Android/`).
 */
export function isMobileAppClient(userAgent: string | undefined | null): boolean {
  return /\bRanksUp-(?:iOS|Android)\/\d/.test(userAgent ?? '');
}

/**
 * Kayan pencere deneme sayaci (surec belleginde).
 *
 * Kalici degil: surec yeniden baslayinca sifirlanir ve her surec kendi
 * sayacini tutar (@nestjs/throttler'in varsayilan bellek deposuyla ayni
 * sinir). Kalici ust sinir adres basina onay e-postasi sayisidir — o
 * PublicCitationEmailLog'dan sayilir (public-citation-subscriber.service.ts).
 */
export class AttemptWindow {
  private readonly hits = new Map<string, number[]>();

  constructor(
    private readonly windowMs: number,
    /** Bellek tavani: asilinca suresi dolan anahtarlar silinir, yetmezse en eskiler. */
    private readonly maxKeys = 50_000,
  ) {}

  /** Denemeyi kaydeder; anahtar pencerede `limit` denemeye ulastiysa kaydetmez ve false doner. */
  take(key: string, limit: number, now = Date.now()): boolean {
    const since = now - this.windowMs;
    const recent = (this.hits.get(key) ?? []).filter((t) => t > since);
    if (recent.length >= limit) {
      this.hits.set(key, recent);
      return false;
    }
    recent.push(now);
    // Sona tasi: Map ekleme sirasini korur, tavan asiminda en eski anahtar ilk gider
    this.hits.delete(key);
    this.hits.set(key, recent);
    if (this.hits.size > this.maxKeys) this.sweep(now);
    return true;
  }

  private sweep(now: number): void {
    const since = now - this.windowMs;
    for (const [k, ts] of this.hits) {
      if (!ts.some((t) => t > since)) this.hits.delete(k);
    }
    for (const k of this.hits.keys()) {
      if (this.hits.size <= this.maxKeys) break;
      this.hits.delete(k);
    }
  }
}
