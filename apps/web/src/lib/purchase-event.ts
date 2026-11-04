/**
 * GA4 `purchase` olayi: odeme ONAYLANDIGINDA (billing/success, paymentOutcome
 * active + paymentConfirmed) siparis basina bir kez. sign_up ile ayni kurallar
 * (lib/signup-event.ts):
 *  - cerez onayi 'granted' ve window.dataLayer var (GTM yalniz onayla yuklenir);
 *  - PayTR test modu sayilmaz (yonetici test odemesi raporu kirletmesin);
 *  - bu tarayicida bu siparis icin daha once gonderilmemis (localStorage isareti).
 *    Depo kullanilamiyorsa gonderilmez: eksik saymak cift saymaktan iyidir.
 *
 * Olay dataLayer'a gider; GTM-TSH8KWCC'de "purchase" ozel olay tetikleyicisi +
 * GA4 olay etiketi (e-ticaret verisi dataLayer'dan) kurulunca GA4'e iletilir.
 * Yuk GA4 e-ticaret bicimi: transaction_id = PayTR siparis numarasi, value/currency
 * faturadan. Kisisel veri yok (e-posta, ad, kullanici kimligi gonderilmez).
 */
import type { ConsentState } from './consent';
import { purchasedPlanId, type PaymentInvoice } from './payment-status';

/** localStorage anahtari: gonderilen son siparis numaralari (virgullu, en fazla PURCHASE_MARKER_MAX) */
export const PURCHASE_MARKER_KEY = 'ranksup-ga-purchase';
export const PURCHASE_MARKER_MAX = 10;

export interface PurchaseEventEnv {
  consent: ConsentState;
  dataLayer: unknown;
  testMode: boolean;
  /** Erisimin kendisi de hata atabilir (gizli pencere); yakalanir */
  storage: () => { getItem(key: string): string | null; setItem(key: string, value: string): void } | null | undefined;
}

export type PurchasePayload = {
  event: 'purchase';
  ecommerce: {
    transaction_id: string;
    value?: number;
    currency?: string;
    items: Array<{ item_id: string; item_name: string; price?: number; quantity: 1 }>;
  };
};

/** Onaylanmis faturadan GA4 purchase yuku; tutar okunamazsa value/currency eklenmez (GA4 geliri 0 saymasin) */
export function purchasePayload(invoice: PaymentInvoice, planName: string): PurchasePayload {
  const planId = purchasedPlanId(invoice.merchantOid) ?? 'bilinmiyor';
  const tutar = typeof invoice.amount === 'number' && Number.isFinite(invoice.amount) && invoice.amount > 0 ? invoice.amount : undefined;
  const para = tutar !== undefined && invoice.currency && /^[A-Z]{3}$/.test(invoice.currency) ? invoice.currency : undefined;
  const fiyat = tutar !== undefined && para ? { value: tutar, currency: para } : {};
  return {
    event: 'purchase',
    ecommerce: {
      transaction_id: invoice.merchantOid,
      ...fiyat,
      items: [{ item_id: planId, item_name: planName || planId, ...(fiyat.value !== undefined ? { price: fiyat.value } : {}), quantity: 1 }],
    },
  };
}

/** Kosullar tutarsa purchase'i dataLayer'a iter, isareti yazar; gonderildiyse true */
export function sendPurchaseEvent(env: PurchaseEventEnv, invoice: PaymentInvoice | null, planName: string): boolean {
  if (!invoice || invoice.status !== 'PAID') return false;
  if (env.consent !== 'granted' || env.testMode || !Array.isArray(env.dataLayer)) return false;
  let gonderilen: string[];
  try {
    const s = env.storage();
    if (!s) return false;
    gonderilen = (s.getItem(PURCHASE_MARKER_KEY) ?? '').split(',').filter(Boolean);
    if (gonderilen.includes(invoice.merchantOid)) return false;
    // Isaret once: yazilamazsa gonderilmez (her yenilemede yeniden sayilmasin)
    s.setItem(PURCHASE_MARKER_KEY, [...gonderilen, invoice.merchantOid].slice(-PURCHASE_MARKER_MAX).join(','));
  } catch {
    return false;
  }
  try {
    // GA4 e-ticaret: onceki ecommerce nesnesi yeni olaya karismasin
    (env.dataLayer as unknown[]).push({ ecommerce: null });
    (env.dataLayer as unknown[]).push(purchasePayload(invoice, planName));
  } catch {
    /* olcum hatasi odeme sayfasini etkilemesin */
  }
  return true;
}
