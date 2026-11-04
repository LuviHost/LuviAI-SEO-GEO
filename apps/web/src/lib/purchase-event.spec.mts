/**
 * GA4 purchase: onay sarti, test modu, siparis basina tek gonderim, e-ticaret yuku.
 * Calistirma: cd apps/web && ../api/node_modules/.bin/vitest run --root . src/lib
 */
import { describe, expect, it } from 'vitest';
import { findPaymentInvoice, type PaymentInvoice } from './payment-status';
import { PURCHASE_MARKER_KEY, PURCHASE_MARKER_MAX, purchasePayload, sendPurchaseEvent, type PurchaseEventEnv } from './purchase-event';

const OID = 'LUVIabcd1234PRO1730000000';
const FATURA: PaymentInvoice = { merchantOid: OID, status: 'PAID', createdAt: 1, amount: 1490, currency: 'TRY' };

function memory() {
  const data = new Map<string, string>();
  return { data, getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v) };
}

function env(over: Partial<PurchaseEventEnv> = {}) {
  const store = memory();
  const dataLayer: unknown[] = [];
  const e: PurchaseEventEnv = { consent: 'granted', dataLayer, testMode: false, storage: () => store, ...over };
  return { e, store, dataLayer };
}

describe('purchasePayload', () => {
  it('GA4 e-ticaret bicimi: siparis numarasi, tutar, para birimi, plan', () => {
    expect(purchasePayload(FATURA, 'Pro')).toEqual({
      event: 'purchase',
      ecommerce: { transaction_id: OID, value: 1490, currency: 'TRY', items: [{ item_id: 'pro', item_name: 'Pro', price: 1490, quantity: 1 }] },
    });
  });

  it('tutar okunamazsa value/currency yok (GA4 geliri 0 saymasin)', () => {
    const p = purchasePayload({ merchantOid: 'XYZ1', status: 'PAID', createdAt: 1 }, '');
    expect(p.ecommerce).toEqual({ transaction_id: 'XYZ1', items: [{ item_id: 'bilinmiyor', item_name: 'bilinmiyor', quantity: 1 }] });
  });
});

describe('sendPurchaseEvent', () => {
  it('onayli, PAID, test disi: once ecommerce temizlenir sonra purchase itilir; ikinci kez gonderilmez', () => {
    const { e, store, dataLayer } = env();
    expect(sendPurchaseEvent(e, FATURA, 'Pro')).toBe(true);
    expect(dataLayer).toEqual([{ ecommerce: null }, purchasePayload(FATURA, 'Pro')]);
    expect(store.data.get(PURCHASE_MARKER_KEY)).toBe(OID);
    expect(sendPurchaseEvent(e, FATURA, 'Pro')).toBe(false);
    expect(dataLayer).toHaveLength(2);
  });

  it('onay yoksa, test modunda, GTM yuklenmemisse ya da fatura PAID degilse gonderilmez', () => {
    for (const over of [{ consent: 'denied' as const }, { consent: 'unset' as const }, { testMode: true }, { dataLayer: undefined }]) {
      const { e, store } = env(over);
      expect(sendPurchaseEvent(e, FATURA, 'Pro')).toBe(false);
      expect(store.data.size).toBe(0);
    }
    const { e } = env();
    expect(sendPurchaseEvent(e, { ...FATURA, status: 'PENDING' }, 'Pro')).toBe(false);
    expect(sendPurchaseEvent(e, null, 'Pro')).toBe(false);
  });

  it('depo kullanilamiyorsa gonderilmez; isaret listesi sinirli', () => {
    const { e, dataLayer } = env({ storage: () => { throw new Error('gizli pencere'); } });
    expect(sendPurchaseEvent(e, FATURA, 'Pro')).toBe(false);
    expect(dataLayer).toHaveLength(0);
    const k = env();
    for (let i = 0; i < PURCHASE_MARKER_MAX + 3; i++) sendPurchaseEvent(k.e, { ...FATURA, merchantOid: `OID${i}` }, 'Pro');
    expect(k.store.data.get(PURCHASE_MARKER_KEY)!.split(',')).toHaveLength(PURCHASE_MARKER_MAX);
  });
});

describe('findPaymentInvoice tutar alanlari', () => {
  it('Prisma Decimal metni sayiya cevrilir; bozuk tutar ve para birimi eklenmez', () => {
    const satir = { paytrTransactionId: OID, status: 'PAID', createdAt: '2026-11-04T10:00:00Z' };
    expect(findPaymentInvoice([{ ...satir, amount: '1490.00', currency: 'TRY' }], [OID])).toMatchObject({ amount: 1490, currency: 'TRY' });
    const bozuk = findPaymentInvoice([{ ...satir, amount: 'x', currency: 'try' }], [OID])!;
    expect(bozuk).not.toHaveProperty('amount');
    expect(bozuk).not.toHaveProperty('currency');
  });
});
