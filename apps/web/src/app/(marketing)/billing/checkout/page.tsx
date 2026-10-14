'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { CHECKOUT_STORAGE_KEY, DirectCheckoutForm, type DirectCheckout } from '@/components/direct-checkout-form';

/**
 * Otomatik yenilemeli abonelik ödemesi — fiyat sayfası / plan yükseltme penceresi
 * API'den gelen imzalı formu sessionStorage'a bırakır, bu sayfa kart formunu çizer.
 */
export default function CheckoutPage() {
  const [checkout, setCheckout] = useState<DirectCheckout | null | undefined>(undefined);

  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(CHECKOUT_STORAGE_KEY);
      setCheckout(raw ? (JSON.parse(raw) as DirectCheckout) : null);
    } catch {
      setCheckout(null);
    }
  }, []);

  return (
    <main className="mx-auto max-w-5xl px-4 py-12 sm:py-16">
      <h1 className="mb-2 text-center font-brand text-h4 font-semibold tracking-tight">Ödeme</h1>
      <p className="mb-8 text-center text-sm text-muted-foreground">Güvenli ödeme · PayTR</p>
      {checkout === undefined ? null : checkout ? (
        <DirectCheckoutForm checkout={checkout} />
      ) : (
        <p className="text-center text-sm text-muted-foreground">
          Ödeme oturumu bulunamadı. <Link href="/pricing" className="underline underline-offset-2">Planlar sayfasından</Link> yeniden başla.
        </p>
      )}
    </main>
  );
}
