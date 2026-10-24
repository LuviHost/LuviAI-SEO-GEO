import { fetchPlans } from '@/components/landing/landing-data';
import { CompareView } from './compare-view';
import { pickComparePrices } from './compare-prices';

/**
 * Karsilastirma sayfasi — SUNUCU bileseni. Eskiden tum sayfa 'use client' idi ve
 * RanksUp fiyatlari useEffect'te cekiliyordu: ilk HTML'de fiyat yoktu. Simdi landing
 * ile ayni yol (landing-data.ts, ISR); tablo ve dil secimi CompareView adaciginda.
 */

/** Fiyatlar 10 dakikada bir yeniden uretilir (landing-data LANDING_REVALIDATE ile ayni) */
export const revalidate = 600;

export default async function ComparePage() {
  const [tr, en] = await Promise.all([fetchPlans('tr'), fetchPlans('en')]);
  return <CompareView initialPrices={{ tr: pickComparePrices(tr), en: pickComparePrices(en) }} />;
}
