'use client';

import { useEffect, useState } from 'react';
import { FileDown, Loader2, SearchX } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import type { PaylasilanRapor } from '@/lib/musteri-raporu';
import { Button } from '@/components/ui/button';
import { BrandWordmark } from '@/components/brand-logo';
import { RaporBelgesi } from '@/components/musteri-raporu/rapor-belgesi';
import { RaporBaskiKopyasi, useRaporYazdir } from '@/components/musteri-raporu/rapor-baski';

type Durum = { tur: 'yukleniyor' } | { tur: 'yok' } | { tur: 'hata'; mesaj: string } | { tur: 'hazir'; veri: PaylasilanRapor };

/**
 * Paylasilan raporun istemci gorunumu: dondurulmus govdeyi API'den okur ve
 * paneldeki AYNI belge bilesenini cizer. Sayfa her zaman acik tema
 * (`.rapor-kagit`): musteri raporu bir kagit belge gibi gorunmeli.
 */
export function PaylasilanRaporGorunumu({ token }: { token: string }) {
  const [durum, setDurum] = useState<Durum>({ tur: 'yukleniyor' });
  const yazdir = useRaporYazdir(durum.tur === 'hazir' ? durum.veri.rapor : null);

  useEffect(() => {
    let iptal = false;
    api.getSharedClientReport(token)
      .then((veri) => { if (!iptal) setDurum({ tur: 'hazir', veri }); })
      .catch((err) => {
        if (iptal) return;
        if (err instanceof ApiError && err.status === 404) setDurum({ tur: 'yok' });
        else setDurum({ tur: 'hata', mesaj: err instanceof ApiError ? err.userMessage : 'Rapor yüklenemedi. Biraz sonra tekrar dene.' });
      });
    return () => { iptal = true; };
  }, [token]);

  return (
    <div className="rapor-kagit min-h-screen bg-muted/40">
      <div className="sticky top-0 z-10 border-b border-border bg-background/90 backdrop-blur print:hidden">
        <div className="mx-auto flex max-w-4xl items-center justify-between gap-3 px-4 py-3">
          <BrandWordmark size={18} />
          {durum.tur === 'hazir' && (
            <Button size="sm" onClick={yazdir}>
              <FileDown className="h-4 w-4" aria-hidden /> PDF indir
            </Button>
          )}
        </div>
      </div>

      <main className="mx-auto max-w-4xl px-2 py-6 sm:px-4 sm:py-10">
        {durum.tur === 'yukleniyor' && (
          <p className="flex items-center justify-center gap-2 py-24 text-sm text-muted-foreground" aria-busy="true">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Rapor yükleniyor…
          </p>
        )}
        {durum.tur === 'yok' && (
          <div className="mx-auto max-w-md py-24 text-center">
            <SearchX className="mx-auto h-8 w-8 text-muted-foreground" aria-hidden />
            <h1 className="mt-3 text-base font-semibold">Rapor bulunamadı</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Bağlantı kaldırılmış ya da paylaşım süresi dolmuş olabilir. Raporu sana gönderen kişiden yeni bir bağlantı isteyebilirsin.
            </p>
          </div>
        )}
        {durum.tur === 'hata' && (
          <p role="alert" className="mx-auto max-w-md py-24 text-center text-sm text-danger">{durum.mesaj}</p>
        )}
        {durum.tur === 'hazir' && (
          <>
            <RaporBelgesi
              rapor={durum.veri.rapor}
              paylasimSonu={durum.veri.paylasim.sonGecerlilik}
              className="rounded-md border border-border p-5 shadow-sm sm:p-10"
            />
            <RaporBaskiKopyasi rapor={durum.veri.rapor} paylasimSonu={durum.veri.paylasim.sonGecerlilik} />
          </>
        )}
      </main>
    </div>
  );
}
