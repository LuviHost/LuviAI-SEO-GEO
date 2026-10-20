import type { CheckoutAvailability } from './api';

/**
 * Satin alma butonlarinin durumu (fiyat sayfasi + panel abonelik sayfasi) —
 * saf, test edilir (checkout-availability.spec.mts).
 *
 * NEDEN: uretim PayTR test modunda calisiyordu. Test modunda PayTR odeme
 * sayfasi test kartini kendisi doldurur ve basarili bildirim gonderir; her
 * deneme kullanicisi odemeden ucretli plan alabiliyordu. ASIL KAPI SUNUCUDA
 * (api billing/paytr.service.ts assertCheckoutOpen: test modunda yalniz
 * yonetici, digerleri 403). Buradaki kilit yalniz kullanicinin butona basip
 * hata almadan once durumu gormesi icin.
 *
 * Kaynaklar:
 *  - page: GET /billing/plans `checkout` — herkese acik, anonim ziyaretci
 *    karari; metin sayfanin diline gore (EN fiyat sayfasinda Ingilizce).
 *  - account: GET /billing/users/:id/current `checkout` — oturumdaki hesaba
 *    gore (test modunda yonetici acik gorur, canliya gecis testini o yapar).
 * Hesap karari varsa o gecerlidir. Alan hic yoksa (eski API, istek basarisiz)
 * satin alma ACIK sayilir: eski davranis, sunucu yine korur.
 */
export interface PurchaseState {
  open: boolean;
  /** Kapaliyken gosterilecek metin; acikken null */
  message: string | null;
}

/** API metin gondermezse (beklenmez) — api CHECKOUT_TEST_MODE_MESSAGE ile ayni metin */
export const PURCHASE_CLOSED_FALLBACK =
  'Ödeme altyapısı şu an test modunda; satın alma henüz açık değil. Bilgi için bizimle iletişime geç.';

/** "Bizimle iletişime geç" adresi — sitenin geri kalaniyla ayni destek kutusu (site-footer) */
export const PURCHASE_CONTACT_EMAIL = 'destek@luvihost.com';

/** Sunucunun checkout alani; yoksa ya da bicim disiysa null */
export function readCheckout(raw: unknown): CheckoutAvailability | null {
  if (!raw || typeof raw !== 'object') return null;
  const c = raw as Record<string, unknown>;
  if (typeof c.open !== 'boolean') return null;
  return {
    open: c.open,
    testMode: c.testMode === true,
    message: typeof c.message === 'string' && c.message.trim() ? c.message : null,
  };
}

export function purchaseState(src: { page?: unknown; account?: unknown }): PurchaseState {
  const page = readCheckout(src.page);
  const account = readCheckout(src.account);
  const decision = account ?? page;
  if (!decision || decision.open) return { open: true, message: null };
  // Metin once sayfa kaynagindan (dile gore uretildi); /current metni Turkce
  const message = (page && !page.open ? page.message : null) ?? decision.message ?? PURCHASE_CLOSED_FALLBACK;
  return { open: false, message };
}
