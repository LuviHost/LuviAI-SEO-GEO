import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { gecerliRaporTokeni } from '@/lib/musteri-raporu';
import { PaylasilanRaporGorunumu } from './paylasilan-rapor';

/**
 * Paylasilan musteri raporu — herkese acik, oturumsuz (/rapor/<token>).
 *
 * Koruma baglantinin kendisidir (24 rastgele bayt); sayfa arama motorlarina
 * kapali (noindex) ve baglanti adresi disari giden isteklere Referer olarak
 * sizmaz (no-referrer: rapordaki site adreslerine tiklanirsa token gitmez).
 *
 * NEDEN veri TARAYICIDAN cekiliyor (karne sayfasi gibi sunucudan degil):
 * API'nin herkese acik ucu IP basina hiz sinirli. Next sunucusundan cekilseydi
 * tum ziyaretciler sunucunun tek IP'sinde toplanir, sinir herkesi birden keserdi.
 */
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Site raporu',
  robots: { index: false, follow: false, nocache: true },
  referrer: 'no-referrer',
};

export default async function PaylasilanRaporPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!gecerliRaporTokeni(token)) notFound();
  return <PaylasilanRaporGorunumu token={token} />;
}
