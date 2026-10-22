'use client';

import { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { RaporBelgesi } from './rapor-belgesi';
import { trTarih, type MusteriRaporu } from '@/lib/musteri-raporu';

/**
 * Raporun YAZDIRMA kopyasi — dogrudan <body>'nin altina tasinir.
 *
 * NEDEN: panel sayfasinda rapor; kenar cubugu, mobil ust cubuk, deneme bandi,
 * site basligi gibi kabuklarin icinde. Global yazdirma kurallari bunlarin bir
 * kismini gizliyor ama A4 genisliginde (768px alti) mobil ust cubuk ve
 * site basligi kagida giriyordu. Kopya body'nin dogrudan cocugu oldugunda tek
 * kural (globals.css `body:has(> .rapor-baski) > *:not(.rapor-baski)`) geri
 * kalan her seyi kagittan cikarir; ekranda kopya gorunmez.
 */
export function RaporBaskiKopyasi({ rapor, paylasimSonu }: { rapor: MusteriRaporu; paylasimSonu?: string | null }) {
  const [hedef, setHedef] = useState<HTMLElement | null>(null);
  useEffect(() => { setHedef(document.body); }, []);
  if (!hedef) return null;
  return createPortal(
    <div className="rapor-baski" aria-hidden>
      <RaporBelgesi rapor={rapor} paylasimSonu={paylasimSonu} kimlikOneki="rapor-baski" />
    </div>,
    hedef,
  );
}

/**
 * "PDF indir": tarayicinin yazdir penceresi (Hedef: PDF olarak kaydet).
 * Belge basligi gecici olarak rapor adina cevrilir — tarayici PDF dosya adini
 * basliktan onerir ("Mükellef - Site Raporu - 22 Ekim 2026.pdf").
 */
export function useRaporYazdir(rapor: MusteriRaporu | null) {
  return useCallback(() => {
    if (!rapor) return;
    const eski = document.title;
    document.title = `${rapor.site.ad} - Site Raporu - ${trTarih(rapor.generatedAt)}`;
    const geriAl = () => {
      document.title = eski;
      window.removeEventListener('afterprint', geriAl);
    };
    window.addEventListener('afterprint', geriAl);
    window.print();
  }, [rapor]);
}
