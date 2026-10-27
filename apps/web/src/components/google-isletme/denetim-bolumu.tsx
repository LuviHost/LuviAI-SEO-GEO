'use client';

import { useState } from 'react';
import { Loader2, ScanSearch } from 'lucide-react';
import { api, type GbpPanelDenetim } from '@/lib/api';
import { gbpHataMetni } from '@/lib/google-isletme';
import { Button } from '@/components/ui/button';
import { StatusBanner } from '@/components/ui/status-banner';
import { DenetimKarti } from './denetim-karti';

/**
 * Panel denetimi — Places'ten canli; sonuc SAKLANMAZ (Google Maps Platform kosulu), sayfadan
 * cikinca kaybolur. Site basina gunluk 20 denetim (sunucu: GbpService.SITE_GUNLUK_DENETIM).
 */
export function DenetimBolumu({ siteId, sonuc, onSonuc }: {
  siteId: string;
  sonuc: GbpPanelDenetim | null;
  onSonuc: (s: GbpPanelDenetim) => void;
}) {
  const [yukleniyor, setYukleniyor] = useState(false);
  const [hata, setHata] = useState<string | null>(null);

  async function denetle() {
    setYukleniyor(true);
    setHata(null);
    try {
      onSonuc(await api.denetleGbp(siteId));
    } catch (err) {
      setHata(gbpHataMetni(err, 'panel'));
    } finally {
      setYukleniyor(false);
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <Button onClick={denetle} disabled={yukleniyor}>
          {yukleniyor ? <Loader2 className="h-4 w-4 animate-spin" /> : <ScanSearch className="h-4 w-4" />}
          {sonuc ? 'Yeniden denetle' : 'Profili denetle'}
        </Button>
        <p className="text-label text-muted-foreground">
          Sonuçlar saklanmaz; her denetim Google’dan canlı alınır (site başına günde en fazla 20 denetim).
        </p>
      </div>
      {hata && <StatusBanner tone="warning" title="Denetim yapılamadı">{hata}</StatusBanner>}
      {sonuc && <DenetimKarti sonuc={sonuc} />}
    </div>
  );
}
