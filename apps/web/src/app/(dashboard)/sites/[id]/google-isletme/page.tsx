'use client';

import { useCallback, useEffect, useState } from 'react';
import { MapPin } from 'lucide-react';
import { useSiteContext } from '../site-context';
import { api, type GbpDurum, type GbpPanelDenetim } from '@/lib/api';
import { gbpHataMetni } from '@/lib/google-isletme';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { SectionHeader } from '@/components/ui/section-header';
import { Skeleton } from '@/components/ui/skeleton';
import { StatusBanner } from '@/components/ui/status-banner';
import { DenetimBolumu } from '@/components/google-isletme/denetim-bolumu';
import { ProfilSecimi } from '@/components/google-isletme/profil-secimi';
import { YerelSorular } from '@/components/google-isletme/yerel-sorular';
import { Yonetim } from '@/components/google-isletme/yonetim';

/**
 * Google Isletme Profili — profil secimi → canli denetim → profilden yerel AI sorulari → yonetim
 * (yorum/gonderi/performans; Google API onayindan sonra). Sunucu: apps/api/src/gbp.
 */
function Bolum({ baslik, aciklama, children }: { baslik: string; aciklama?: string; children: React.ReactNode }) {
  return (
    <Card density="dense" className="space-y-3 p-4">
      <div>
        <h3 className="font-brand text-base font-semibold tracking-tight">{baslik}</h3>
        {aciklama && <p className="mt-0.5 text-sm text-muted-foreground">{aciklama}</p>}
      </div>
      {children}
    </Card>
  );
}

export default function GoogleIsletmePage() {
  const { site } = useSiteContext();
  const siteId: string = site.id;
  const [durum, setDurum] = useState<GbpDurum | null>(null);
  const [hata, setHata] = useState<string | null>(null);
  const [denetim, setDenetim] = useState<GbpPanelDenetim | null>(null);
  const [denetimSayisi, setDenetimSayisi] = useState(0);
  const [bilinenAd, setBilinenAd] = useState<string | null>(null);

  const yukle = useCallback(async () => {
    setHata(null);
    try {
      setDurum(await api.getGbpDurum(siteId));
    } catch (err) {
      setHata(gbpHataMetni(err, 'panel'));
    }
  }, [siteId]);

  useEffect(() => { void yukle(); }, [yukle]);

  async function profilDegisti(ad: string | null) {
    // Baska profil secildi ya da secim kalkti: eski denetim bu profile ait degil
    setDenetim(null);
    setBilinenAd(ad);
    await yukle();
  }

  function denetimGeldi(s: GbpPanelDenetim) {
    setDenetim(s);
    setDenetimSayisi((n) => n + 1);
    if (s.ozet.ad) setBilinenAd(s.ozet.ad);
  }

  return (
    <div className="space-y-5">
      <SectionHeader
        icon={MapPin}
        title="Google İşletme Profili"
        description="Haritalar profilinizi denetleyin, profilden yerel AI soruları hazırlayın; Google onayından sonra yorumları ve gönderileri buradan yönetin."
      />

      {hata ? (
        <StatusBanner tone="warning" title="Google İşletme bilgisi alınamadı" action={<Button size="sm" variant="outline" onClick={yukle}>Tekrar dene</Button>}>
          {hata}
        </StatusBanner>
      ) : !durum ? (
        <div className="space-y-3">
          <Skeleton className="h-28 w-full" />
          <Skeleton className="h-28 w-full" />
        </div>
      ) : (
        <>
          <Bolum baslik="Profil seçimi" aciklama="Google Haritalar’daki işletmenizi bulun ve seçin.">
            <ProfilSecimi siteId={siteId} durum={durum} bilinenAd={bilinenAd} onDegisti={profilDegisti} />
          </Bolum>

          {durum.placesHazir && durum.placeId && (
            <Bolum
              baslik="Profil denetimi"
              aciklama="Kategori, saatler, telefon ve adres tutarlılığı, yorumlar, fotoğraflar ve ad kuralı — 10 madde, 100 puan."
            >
              <DenetimBolumu siteId={siteId} sonuc={denetim} onSonuc={denetimGeldi} />
            </Bolum>
          )}

          {denetim && (
            <Bolum baslik="Yerel AI soruları" aciklama="Profilinizdeki konum ve kategoriden AI asistanlarına sorulacak yerel sorular.">
              <YerelSorular key={denetimSayisi} siteId={siteId} oneri={denetim.yerelOneri} />
            </Bolum>
          )}

          <Bolum baslik="Yönetim" aciklama="Yorum yanıtları, gönderiler ve son 28 günün performansı.">
            <Yonetim siteId={siteId} durum={durum} onYenile={yukle} />
          </Bolum>
        </>
      )}
    </div>
  );
}
