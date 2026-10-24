import { fetchPlansResponse } from '@/components/landing/landing-data';
import { PricingView, type PricingData } from './pricing-view';

/**
 * Fiyat sayfasi — SUNUCU bileseni. Eskiden tum sayfa 'use client' idi ve planlar
 * useEffect'te cekiliyordu: ilk HTML'de fiyat grid'i yoktu, JS calistirmayan AI
 * tarayicilari fiyati yalniz meta/JSON-LD'den gorebiliyordu. Simdi landing ile ayni
 * yol (components/landing/landing-data.ts, ISR): iki dilin plan verisi sunucuda
 * cekilir, etkilesim (aylik/yillik, satin alma, dil) PricingView adaciginda kalir.
 */

/** Plan/kur 10 dakikada bir yeniden uretilir (landing-data LANDING_REVALIDATE ile ayni) */
export const revalidate = 600;

export default async function PricingPage() {
  const [tr, en] = await Promise.all([
    fetchPlansResponse<PricingData>('tr'),
    fetchPlansResponse<PricingData>('en'),
  ]);
  return <PricingView initial={{ tr, en }} />;
}
