'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, FileDown, RefreshCw, UserRound } from 'lucide-react';
import { useSiteContext } from '../../site-context';
import { api } from '@/lib/api';
import { siteHref } from '@/lib/site-routes';
import { trTarih, type MusteriRaporu } from '@/lib/musteri-raporu';
import { SectionHeader } from '@/components/ui/section-header';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { ErrorState } from '@/components/ui/async-state';
import { RaporBelgesi } from '@/components/musteri-raporu/rapor-belgesi';
import { RaporBaskiKopyasi, useRaporYazdir } from '@/components/musteri-raporu/rapor-baski';
import { RaporPaylasim } from '@/components/musteri-raporu/rapor-paylasim';

/**
 * Musteri raporu (Site Raporu) — sahibin / ajansin musteriye verdigi tek ekran.
 *
 * Veri kayitli son olcumlerden gelir (GET /client-report); bu sayfa tarama ya
 * da AI olcumu BASLATMAZ — tum planlarda ve suresi dolan denemede acik.
 * "PDF indir" tarayicinin yazdir penceresidir (A4, bolum basina yeni sayfa,
 * acik tema; globals.css "Musteri raporu"). "Bağlantı paylaş" raporun o anki
 * halini dondurur (rapor-paylasim.tsx).
 */
export default function MusteriRaporuPage() {
  const { site } = useSiteContext();
  const [rapor, setRapor] = useState<MusteriRaporu | null>(null);
  const [hata, setHata] = useState<unknown>(null);
  const [yukleniyor, setYukleniyor] = useState(true);
  const yazdir = useRaporYazdir(rapor);

  const yukle = useCallback(async () => {
    setYukleniyor(true);
    setHata(null);
    try {
      setRapor(await api.getClientReport(site.id));
    } catch (err) {
      setHata(err);
    } finally {
      setYukleniyor(false);
    }
  }, [site.id]);

  useEffect(() => { yukle(); }, [yukle]);

  return (
    <div className="space-y-5">
      <div className="space-y-4 print:hidden">
        <Link href={siteHref(site.id, 'report')} className="inline-flex items-center gap-1 text-label text-muted-foreground hover:text-brand">
          <ArrowLeft className="h-3 w-3" aria-hidden /> Raporlar
        </Link>
        <SectionHeader
          icon={UserRound}
          title="Müşteri raporu"
          description={
            rapor
              ? `SEO, GEO ve AI görünürlük sonuçları tek belgede · ${trTarih(rapor.generatedAt)} itibarıyla kayıtlı son ölçümlerden`
              : 'SEO, GEO ve AI görünürlük sonuçları tek belgede — kayıtlı son ölçümlerden, yeni ölçüm çalıştırmadan.'
          }
          actions={
            <>
              <Button size="sm" variant="outline" onClick={yukle} disabled={yukleniyor}>
                <RefreshCw className={`h-4 w-4 ${yukleniyor ? 'animate-spin' : ''}`} aria-hidden /> Yenile
              </Button>
              <Button size="sm" onClick={yazdir} disabled={!rapor}>
                <FileDown className="h-4 w-4" aria-hidden /> PDF indir
              </Button>
            </>
          }
        />
        <RaporPaylasim siteId={site.id} />
      </div>

      {yukleniyor && !rapor ? (
        <div className="mx-auto max-w-4xl space-y-4" aria-busy="true" aria-label="Rapor hazırlanıyor">
          <Skeleton className="h-64 w-full" />
          <Skeleton className="h-40 w-full" />
        </div>
      ) : hata ? (
        <ErrorState error={hata} onRetry={yukle} />
      ) : rapor ? (
        <>
          <div className="mx-auto max-w-4xl rounded-lg border border-border bg-muted/30 p-2 sm:p-4 print:hidden">
            <RaporBelgesi rapor={rapor} className="rounded-md border border-border p-5 sm:p-10" />
          </div>
          <RaporBaskiKopyasi rapor={rapor} />
        </>
      ) : null}
    </div>
  );
}
